import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Point the DB at an isolated temp dir BEFORE importing the server, so these
// tests never touch the developer's data/brieftrack.db.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brieftrack-test-'));
process.env.BRIEFTRACK_DB_DIR = tmpDir;

let base;
let server;

let db;

before(async () => {
  const { app } = await import('../server/index.js');
  ({ db } = await import('../server/db.js'));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  // Close the SQLite handle so Windows lets us delete the WAL files.
  try {
    db?.close();
  } catch {
    /* already closed */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* OS may still hold a handle briefly; the temp dir is disposable */
  }
});

// Tiny fetch helper returning { status, body }.
async function api(method, urlPath, body) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  if (res.status !== 204) {
    const text = await res.text();
    parsed = text ? JSON.parse(text) : null;
  }
  return { status: res.status, body: parsed };
}

// Create a throwaway project and return its id.
async function newProject(name = 'Test Project') {
  const { body } = await api('POST', '/api/projects', { name });
  return body.id;
}

// ---- Projects -----------------------------------------------------------

test('seed: GET /api/projects returns the demo project', async () => {
  const { status, body } = await api('GET', '/api/projects');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length >= 1);
  assert.ok(body.some((p) => p.name === 'Greenfield Community Library'));
  // list rows expose computed fields
  const demo = body.find((p) => p.name === 'Greenfield Community Library');
  assert.equal(typeof demo.space_count, 'number');
  assert.equal(typeof demo.target_net, 'number');
});

test('POST /api/projects requires a name', async () => {
  const { status, body } = await api('POST', '/api/projects', { name: '   ' });
  assert.equal(status, 400);
  assert.match(body.error, /name is required/i);
});

test('POST /api/projects trims name and applies defaults', async () => {
  const { status, body } = await api('POST', '/api/projects', { name: '  Clinic  ', client: 'Acme' });
  assert.equal(status, 201);
  assert.equal(body.name, 'Clinic');
  assert.equal(body.client, 'Acme');
  assert.equal(body.units, 'm2');
  assert.equal(body.tolerance, 0.05);
});

test('PUT /api/projects/:id updates known fields and ignores unknown', async () => {
  const id = await newProject();
  const { status, body } = await api('PUT', `/api/projects/${id}`, {
    stage: 'Schematic Design',
    bubble_style: 'outline',
    not_a_column: 'ignored',
  });
  assert.equal(status, 200);
  assert.equal(body.stage, 'Schematic Design');
  assert.equal(body.bubble_style, 'outline');
  assert.equal(body.not_a_column, undefined);
});

test('PUT /api/projects/:id can clear a nullable field via explicit null (key present)', async () => {
  const id = await newProject();
  await api('PUT', `/api/projects/${id}`, { display_scale: 0.1323 });
  const cleared = await api('PUT', `/api/projects/${id}`, { display_scale: null });
  assert.equal(cleared.body.display_scale, null);
});

test('north_deg wraps into [0, 360) and north_locked freezes it', async () => {
  const id = await newProject();
  // Bearings wrap: 400 → 40, -30 → 330.
  let r = await api('PUT', `/api/projects/${id}`, { north_deg: 400 });
  assert.equal(r.body.north_deg, 40);
  r = await api('PUT', `/api/projects/${id}`, { north_deg: -30 });
  assert.equal(r.body.north_deg, 330);
  // Locking freezes the bearing — a locked write is silently dropped.
  r = await api('PUT', `/api/projects/${id}`, { north_locked: true });
  assert.equal(r.body.north_locked, 1);
  r = await api('PUT', `/api/projects/${id}`, { north_deg: 90 });
  assert.equal(r.body.north_deg, 330);
  // A request that unlocks may carry a new bearing in the same call.
  r = await api('PUT', `/api/projects/${id}`, { north_locked: 0, north_deg: 90 });
  assert.equal(r.body.north_locked, 0);
  assert.equal(r.body.north_deg, 90);
});

test('project responses never carry the legacy base64 image columns', async () => {
  const id = await newProject();
  // Legacy columns stay writable (additive-only rule) but must not travel back.
  const put = await api('PUT', `/api/projects/${id}`, { bg_image: 'data:image/png;base64,AAAA' });
  assert.equal(put.status, 200);
  assert.ok(!('bg_image' in put.body));
  assert.ok(!('sat_image' in put.body));
  const { body } = await api('GET', `/api/projects/${id}`);
  assert.ok(!('bg_image' in body.project));
  assert.ok(!('sat_image' in body.project));
});

test('GET /api/projects/:id returns the full bundle; 404 when missing', async () => {
  const id = await newProject();
  const { status, body } = await api('GET', `/api/projects/${id}`);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['adjacencies', 'brief_adjacencies', 'brief_spaces', 'images', 'project', 'snapshots', 'spaces']);
  const missing = await api('GET', '/api/projects/99999');
  assert.equal(missing.status, 404);
});

test('DELETE /api/projects/:id removes it', async () => {
  const id = await newProject();
  const del = await api('DELETE', `/api/projects/${id}`);
  assert.equal(del.status, 204);
  assert.equal((await api('GET', `/api/projects/${id}`)).status, 404);
});

// ---- Spaces -------------------------------------------------------------

test('POST space: name required, leaf area must be positive', async () => {
  const pid = await newProject();
  assert.equal((await api('POST', `/api/projects/${pid}/spaces`, { name: '' })).status, 400);
  const noArea = await api('POST', `/api/projects/${pid}/spaces`, { name: 'Room', target_area: 0 });
  assert.equal(noArea.status, 400);
  assert.match(noArea.body.error, /positive/i);
});

test('POST space: container kinds may have zero area', async () => {
  const pid = await newProject();
  const { status, body } = await api('POST', `/api/projects/${pid}/spaces`, { name: 'Block', kind: 'building' });
  assert.equal(status, 201);
  assert.equal(body.kind, 'building');
  assert.equal(body.target_area, 0);
});

test('POST space: rejects a parent from another project', async () => {
  const p1 = await newProject('P1');
  const p2 = await newProject('P2');
  const building = (await api('POST', `/api/projects/${p1}/spaces`, { name: 'B', kind: 'building' })).body;
  const bad = await api('POST', `/api/projects/${p2}/spaces`, {
    name: 'Room', target_area: 10, parent_id: building.id,
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /parent/i);
});

test('PUT space: prevents creating a cycle', async () => {
  const pid = await newProject();
  const a = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'A', kind: 'group' })).body;
  const b = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'B', kind: 'group', parent_id: a.id })).body;
  // Try to make A a child of its own descendant B → cycle.
  const res = await api('PUT', `/api/spaces/${a.id}`, { parent_id: b.id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /cycle/i);
});

test('PUT space: stringifies pin_json objects and stores sort_order', async () => {
  const pid = await newProject();
  const s = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Room', target_area: 10 })).body;
  const res = await api('PUT', `/api/spaces/${s.id}`, {
    pin_json: { 0: { x: 1, y: 2 } },
    sort_order: 7,
  });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.pin_json, 'string');
  assert.deepEqual(JSON.parse(res.body.pin_json), { 0: { x: 1, y: 2 } });
  assert.equal(res.body.sort_order, 7);
});

test('PUT space: stores a poly shape with shape_json and clamps unknown shapes', async () => {
  const pid = await newProject();
  const s = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Room', target_area: 10 })).body;
  assert.equal(s.shape, 'bubble'); // default

  const poly = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
  const res = await api('PUT', `/api/spaces/${s.id}`, { shape: 'poly', shape_json: poly });
  assert.equal(res.status, 200);
  assert.equal(res.body.shape, 'poly');
  assert.equal(typeof res.body.shape_json, 'string'); // objects are stringified
  assert.deepEqual(JSON.parse(res.body.shape_json), poly);

  // An unknown shape falls back to 'bubble' (oneOf clamp).
  const bad = await api('PUT', `/api/spaces/${s.id}`, { shape: 'hexahedron' });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.shape, 'bubble');
});

test('DELETE space removes the whole subtree', async () => {
  const pid = await newProject();
  const building = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'B', kind: 'building' })).body;
  const room = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'R', target_area: 10, parent_id: building.id })).body;
  const nested = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'N', target_area: 5, parent_id: room.id })).body;
  const del = await api('DELETE', `/api/spaces/${building.id}`);
  assert.equal(del.status, 204);
  const spaces = (await api('GET', `/api/projects/${pid}`)).body.spaces;
  const ids = spaces.map((s) => s.id);
  assert.equal(ids.includes(building.id), false);
  assert.equal(ids.includes(room.id), false);
  assert.equal(ids.includes(nested.id), false);
});

test('DELETE space 404 for unknown id', async () => {
  assert.equal((await api('DELETE', '/api/spaces/99999')).status, 404);
});

// ---- Adjacencies --------------------------------------------------------

test('POST adjacency canonicalises order and upserts strength', async () => {
  const pid = await newProject();
  const a = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'A', target_area: 10 })).body;
  const b = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'B', target_area: 10 })).body;
  const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  // Insert with reversed order — server canonicalises to lo/hi.
  const first = await api('POST', `/api/projects/${pid}/adjacencies`, { space_a: hi, space_b: lo, strength: 'desired' });
  assert.equal(first.status, 201);
  assert.equal(first.body.space_a, lo);
  assert.equal(first.body.space_b, hi);
  // Re-insert same pair with a new strength → upsert, not duplicate.
  const second = await api('POST', `/api/projects/${pid}/adjacencies`, { space_a: lo, space_b: hi, strength: 'required' });
  assert.equal(second.body.strength, 'required');
  assert.equal(second.body.inst_a, 0); // defaults to the first instances
  assert.equal(second.body.inst_b, 0);
  const adj = (await api('GET', `/api/projects/${pid}`)).body.adjacencies;
  assert.equal(adj.length, 1);
});

test('POST adjacency: distinct instance pairs coexist and clamp to count', async () => {
  const pid = await newProject();
  const a = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Meeting', target_area: 10, count: 3 })).body;
  const b = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Hall', target_area: 40 })).body;
  const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  // Two different instances of the count-3 space, linked to the same hall → two rows.
  await api('POST', `/api/projects/${pid}/adjacencies`, { space_a: a.id, space_b: b.id, inst_a: 0, strength: 'desired' });
  await api('POST', `/api/projects/${pid}/adjacencies`, { space_a: a.id, space_b: b.id, inst_a: 2, strength: 'required' });
  const adj = (await api('GET', `/api/projects/${pid}`)).body.adjacencies;
  assert.equal(adj.length, 2, 'per-instance links coexist under the widened unique key');
  // An out-of-range instance clamps to count-1 (2), colliding with the second → upsert.
  const clamped = await api('POST', `/api/projects/${pid}/adjacencies`, { space_a: a.id, space_b: b.id, inst_a: 9, strength: 'desired' });
  assert.equal(clamped.body.inst_a === 2 || clamped.body.inst_b === 2, true, 'instance clamped to count-1');
  assert.equal((await api('GET', `/api/projects/${pid}`)).body.adjacencies.length, 2, 'clamped insert upserted, no third row');
  // The instance rides with its space under canonicalisation.
  const rowA2 = adj.find((l) => l.strength === 'required');
  assert.equal(a.id < b.id ? rowA2.inst_a : rowA2.inst_b, 2);
});

test('POST adjacency rejects identical or foreign spaces', async () => {
  const pid = await newProject();
  const a = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'A', target_area: 10 })).body;
  assert.equal((await api('POST', `/api/projects/${pid}/adjacencies`, { space_a: a.id, space_b: a.id })).status, 400);
  assert.equal((await api('POST', `/api/projects/${pid}/adjacencies`, { space_a: a.id, space_b: 99999 })).status, 400);
});

test('PUT/DELETE adjacency update strength and remove', async () => {
  const pid = await newProject();
  const a = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'A', target_area: 10 })).body;
  const b = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'B', target_area: 10 })).body;
  const adj = (await api('POST', `/api/projects/${pid}/adjacencies`, { space_a: a.id, space_b: b.id })).body;
  const upd = await api('PUT', `/api/adjacencies/${adj.id}`, { strength: 'required' });
  assert.equal(upd.body.strength, 'required');
  assert.equal((await api('DELETE', `/api/adjacencies/${adj.id}`)).status, 204);
  assert.equal((await api('DELETE', `/api/adjacencies/${adj.id}`)).status, 404);
});

// ---- Snapshots ----------------------------------------------------------

test('POST snapshot: requires a label, persists only valid areas', async () => {
  const pid = await newProject();
  const s = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'R', target_area: 10 })).body;
  assert.equal((await api('POST', `/api/projects/${pid}/snapshots`, { label: '' })).status, 400);
  const snap = await api('POST', `/api/projects/${pid}/snapshots`, {
    label: 'CD', taken_at: '2026-05-01', gross_area: 100,
    areas: { [s.id]: 12, 99999: -5 }, // negative dropped; foreign id stored (no FK check here) but value valid
  });
  assert.equal(snap.status, 201);
  assert.equal(snap.body.label, 'CD');
  assert.equal(snap.body.areas[s.id], 12);
  // negative area was rejected
  assert.equal(snap.body.areas['99999'], undefined);
});

test('PUT snapshot updates fields and merges areas', async () => {
  const pid = await newProject();
  const s = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'R', target_area: 10 })).body;
  const snap = (await api('POST', `/api/projects/${pid}/snapshots`, { label: 'A', areas: { [s.id]: 5 } })).body;
  const upd = await api('PUT', `/api/snapshots/${snap.id}`, { label: 'B', areas: { [s.id]: 9 } });
  assert.equal(upd.body.label, 'B');
  assert.equal(upd.body.areas[s.id], 9);
  assert.equal((await api('DELETE', `/api/snapshots/${snap.id}`)).status, 204);
});

// ---- Images -------------------------------------------------------------

test('POST image: requires data, coerces visible, supports update/delete', async () => {
  const pid = await newProject();
  assert.equal((await api('POST', `/api/projects/${pid}/images`, { name: 'x' })).status, 400);
  const img = (await api('POST', `/api/projects/${pid}/images`, {
    image: 'data:image/png;base64,AAAA', kind: 'custom', visible: 1,
  })).body;
  assert.equal(img.visible, 1);
  const upd = await api('PUT', `/api/images/${img.id}`, { visible: false, opacity: 0.3 });
  assert.equal(upd.body.visible, 0);
  assert.equal(upd.body.opacity, 0.3);
  assert.equal((await api('DELETE', `/api/images/${img.id}`)).status, 204);
  assert.equal((await api('DELETE', `/api/images/${img.id}`)).status, 404);
});

test('image payloads are metadata-only; pixels come from /data', async () => {
  const pid = await newProject();
  const dataUrl = 'data:image/png;base64,BBBB';
  const img = (await api('POST', `/api/projects/${pid}/images`, { image: dataUrl })).body;
  // POST / PUT responses and the project bundle omit the data URL…
  assert.ok(!('image' in img));
  const upd = await api('PUT', `/api/images/${img.id}`, { opacity: 0.4 });
  assert.ok(!('image' in upd.body));
  const bundle = (await api('GET', `/api/projects/${pid}`)).body;
  assert.equal(bundle.images.length, 1);
  assert.ok(!('image' in bundle.images[0]));
  assert.equal(bundle.images[0].id, img.id);
  // …while GET /api/images/:id/data serves exactly what was uploaded.
  const data = await api('GET', `/api/images/${img.id}/data`);
  assert.equal(data.status, 200);
  assert.equal(data.body.image, dataUrl);
  assert.equal((await api('GET', '/api/images/99999/data')).status, 404);
});

// ---- Settings -----------------------------------------------------------

test('GET settings returns defaults; PUT upserts', async () => {
  const { body } = await api('GET', '/api/settings');
  assert.equal(body.default_units, 'm2');
  const upd = await api('PUT', '/api/settings', { default_tolerance: '7' });
  assert.equal(upd.body.default_tolerance, '7');
});

// ---- Geocode validation (no network) ------------------------------------

test('GET geocode requires a query', async () => {
  const { status, body } = await api('GET', '/api/geocode?q=');
  assert.equal(status, 400);
  assert.match(body.error, /required/i);
});

test('GET tile rejects out-of-range coordinates', async () => {
  assert.equal((await api('GET', '/api/tile/99/1/1')).status, 400);
});

// ---- Brief formulas + baseline (milestone-zero) -------------------------

test('a formula space resolves target_area server-side from a variable', async () => {
  const pid = await newProject('Formulas');
  await api('PUT', `/api/projects/${pid}`, { variables: JSON.stringify({ staff: 20 }) });
  const s = (await api('POST', `/api/projects/${pid}/spaces`, {
    name: 'Open Office', area_formula: '=@staff * 12',
  })).body;
  assert.equal(s.area_formula, '=@staff * 12');
  // Server resolved and persisted the derived area (20 * 12).
  const fresh = (await api('GET', `/api/projects/${pid}`)).body.spaces.find((x) => x.id === s.id);
  assert.equal(fresh.target_area, 240);
});

test('editing a variable re-derives dependent formula areas', async () => {
  const pid = await newProject('Vars');
  await api('PUT', `/api/projects/${pid}`, { variables: JSON.stringify({ staff: 10 }) });
  const s = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Office', area_formula: '=@staff * 12' })).body;
  await api('PUT', `/api/projects/${pid}`, { variables: JSON.stringify({ staff: 30 }) });
  const fresh = (await api('GET', `/api/projects/${pid}`)).body.spaces.find((x) => x.id === s.id);
  assert.equal(fresh.target_area, 360);
});

test('a formula space may skip the positive-area rule', async () => {
  const pid = await newProject('NoPositive');
  const res = await api('POST', `/api/projects/${pid}/spaces`, { name: 'Derived', area_formula: '=10 + 5' });
  assert.equal(res.status, 201);
  const fresh = (await api('GET', `/api/projects/${pid}`)).body.spaces.find((x) => x.id === res.body.id);
  assert.equal(fresh.target_area, 15);
});

test('the Brief tree is independent of the diagram spaces', async () => {
  const pid = await newProject('IndependentBrief');
  await api('POST', `/api/projects/${pid}/spaces`, { name: 'Foyer', target_area: 100 });
  const b = (await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Foyer', target_area: 130 })).body;
  const bundle = (await api('GET', `/api/projects/${pid}`)).body;
  assert.equal(bundle.spaces.length, 1);
  assert.equal(bundle.brief_spaces.length, 1);
  assert.equal(bundle.spaces[0].target_area, 100); // diagram number unchanged
  assert.equal(bundle.brief_spaces[0].target_area, 130); // brief number independent
  assert.ok(b.id !== bundle.spaces[0].id); // separate rows
});

test('Brief formulas resolve independently of the diagram', async () => {
  const pid = await newProject('BriefFormula');
  await api('PUT', `/api/projects/${pid}`, { variables: JSON.stringify({ staff: 15 }) });
  const b = (await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Office', area_formula: '=@staff * 10' })).body;
  const fresh = (await api('GET', `/api/projects/${pid}`)).body.brief_spaces.find((x) => x.id === b.id);
  assert.equal(fresh.target_area, 150);
});

test('overwrite: diff previews, then apply reconciles the diagram', async () => {
  const pid = await newProject('Overwrite');
  const foyer = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Foyer', target_area: 100 })).body;
  await api('POST', `/api/projects/${pid}/spaces`, { name: 'Old Store', target_area: 40 });
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Foyer', target_area: 150 });
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Cafe', target_area: 60 });

  const diff = (await api('GET', `/api/projects/${pid}/brief-diff`)).body;
  assert.equal(diff.adds.length, 1);    // Cafe
  assert.equal(diff.updates.length, 1); // Foyer 100→150
  assert.equal(diff.deletes.length, 1); // Old Store

  // Per-row selection: apply everything, choosing to delete the missing room.
  await api('POST', `/api/projects/${pid}/apply-brief`, { deleteKeys: diff.deletes.map((d) => d.path) });
  const spaces = (await api('GET', `/api/projects/${pid}`)).body.spaces;
  const names = spaces.map((s) => s.name).sort();
  assert.deepEqual(names, ['Cafe', 'Foyer']); // Old Store removed, Cafe added
  const f = spaces.find((s) => s.name === 'Foyer');
  assert.equal(f.id, foyer.id);        // matched room kept its identity (pins preserved)
  assert.equal(f.target_area, 150);    // area overwritten
});

test('overwrite: unchecked deletes are kept', async () => {
  const pid = await newProject('OverwriteKeep');
  await api('POST', `/api/projects/${pid}/spaces`, { name: 'Keep Me', target_area: 40 });
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Cafe', target_area: 60 });
  // deleteKeys omitted → the diagram-only room survives; Cafe is added.
  await api('POST', `/api/projects/${pid}/apply-brief`, {});
  const names = (await api('GET', `/api/projects/${pid}`)).body.spaces.map((s) => s.name).sort();
  assert.deepEqual(names, ['Cafe', 'Keep Me']);
});

test('pull-to-brief upserts one diagram room into the Brief', async () => {
  const pid = await newProject('Pull');
  const foyer = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Foyer', target_area: 111 })).body;
  // First pull creates it in the Brief.
  const r1 = (await api('POST', `/api/projects/${pid}/pull-to-brief`, { spaceId: foyer.id })).body;
  assert.equal(r1.upserted, 'created');
  let brief = (await api('GET', `/api/projects/${pid}`)).body.brief_spaces;
  assert.equal(brief.length, 1);
  assert.equal(brief[0].target_area, 111);
  // Change the design, pull again → updates the same Brief room.
  await api('PUT', `/api/spaces/${foyer.id}`, { target_area: 222 });
  const r2 = (await api('POST', `/api/projects/${pid}/pull-to-brief`, { spaceId: foyer.id })).body;
  assert.equal(r2.upserted, 'updated');
  brief = (await api('GET', `/api/projects/${pid}`)).body.brief_spaces;
  assert.equal(brief.length, 1);
  assert.equal(brief[0].target_area, 222);
});

test('brief-milestone snapshots the Brief mapped onto diagram rooms', async () => {
  const pid = await newProject('BriefMilestone');
  const foyer = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Foyer', target_area: 100 })).body;
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Foyer', target_area: 120 });
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Orphan', target_area: 50 });
  const r = (await api('POST', `/api/projects/${pid}/brief-milestone`, { label: 'Agreed brief' })).body;
  assert.deepEqual(r.unmatched, ['Orphan']); // no diagram match
  const snaps = (await api('GET', `/api/projects/${pid}`)).body.snapshots;
  const ms = snaps.find((s) => s.label === 'Agreed brief');
  assert.ok(ms);
  assert.equal(ms.areas[foyer.id], 120); // Brief area recorded against the diagram room
});

test('brief-from-design copies the diagram into the Brief', async () => {
  const pid = await newProject('BriefSeed');
  await api('POST', `/api/projects/${pid}/spaces`, { name: 'Foyer', target_area: 100 });
  await api('POST', `/api/projects/${pid}/spaces`, { name: 'Hall', target_area: 200 });
  await api('POST', `/api/projects/${pid}/brief-from-design`);
  const brief = (await api('GET', `/api/projects/${pid}`)).body.brief_spaces;
  assert.equal(brief.length, 2);
  assert.deepEqual(brief.map((b) => b.name).sort(), ['Foyer', 'Hall']);
});

// ---- Brief revisions ------------------------------------------------------

test('brief revisions: save, list, fetch data, delete', async () => {
  const pid = await newProject('Revisions');
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Hall', target_area: 200 });

  // Empty-brief guard is on a different project.
  const emptyPid = await newProject('RevEmpty');
  const bad = await api('POST', `/api/projects/${emptyPid}/brief-revisions`, { label: 'Rev A' });
  assert.equal(bad.status, 400);

  const saved = await api('POST', `/api/projects/${pid}/brief-revisions`, { label: 'Rev A' });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.net, 200);
  assert.equal(saved.body.room_count, 1);

  // The revision is immutable: change the Brief, the revision keeps 200.
  const brief = (await api('GET', `/api/projects/${pid}`)).body.brief_spaces;
  await api('PUT', `/api/brief-spaces/${brief[0].id}`, { target_area: 250 });
  const list = (await api('GET', `/api/projects/${pid}/brief-revisions`)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].net, 200);
  const full = (await api('GET', `/api/brief-revisions/${list[0].id}`)).body;
  assert.equal(full.data.length, 1);
  assert.equal(full.data[0].target_area, 200);

  const del = await api('DELETE', `/api/brief-revisions/${list[0].id}`);
  assert.equal(del.status, 204);
  assert.equal((await api('GET', `/api/projects/${pid}/brief-revisions`)).body.length, 0);
});

// ---- Brief adjacency requirements ------------------------------------------

test('brief adjacencies: create validates rooms, dedupes, cascades on delete', async () => {
  const pid = await newProject('Reqs');
  const a = (await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Kitchen', target_area: 40 })).body;
  const b = (await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Servery', target_area: 20 })).body;

  const made = await api('POST', `/api/projects/${pid}/brief-adjacencies`, { a_id: a.id, b_id: b.id });
  assert.equal(made.status, 201);
  const dupe = await api('POST', `/api/projects/${pid}/brief-adjacencies`, { a_id: b.id, b_id: a.id });
  assert.equal(dupe.status, 409); // normalised pair already exists
  const self = await api('POST', `/api/projects/${pid}/brief-adjacencies`, { a_id: a.id, b_id: a.id });
  assert.equal(self.status, 400);

  const bundle = (await api('GET', `/api/projects/${pid}`)).body;
  assert.equal(bundle.brief_adjacencies.length, 1);

  // Deleting a Brief room removes requirements that reference it.
  await api('DELETE', `/api/brief-spaces/${a.id}`);
  const after = (await api('GET', `/api/projects/${pid}`)).body;
  assert.equal(after.brief_adjacencies.length, 0);
});

// ---- Change log -------------------------------------------------------------

test('change log records programme edits but not geometry', async () => {
  const pid = await newProject('Changes');
  const room = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Foyer', target_area: 100 })).body;
  await api('PUT', `/api/spaces/${room.id}`, { target_area: 150 });
  await api('PUT', `/api/spaces/${room.id}`, { pin_x: 12, pin_y: 34 }); // geometry — must not log
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Foyer', target_area: 120 });

  const changes = (await api('GET', `/api/projects/${pid}/changes`)).body;
  assert.ok(changes.some((c) => c.tree === 'design' && c.field === 'created' && c.name === 'Foyer'));
  const areaEdit = changes.find((c) => c.tree === 'design' && c.field === 'area');
  assert.ok(areaEdit);
  assert.equal(areaEdit.old, '100');
  assert.equal(areaEdit.new, '150');
  assert.ok(changes.some((c) => c.tree === 'brief' && c.field === 'created'));
  // exactly one design update line (the pin move logged nothing)
  assert.equal(changes.filter((c) => c.tree === 'design' && c.field === 'area').length, 1);
});

// ---- Design options ---------------------------------------------------------

test('options: save, load reconciles by path keeping milestone areas', async () => {
  const pid = await newProject('Options');
  const foyer = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Foyer', target_area: 100 })).body;
  const hall = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Hall', target_area: 200 })).body;
  // A milestone whose areas reference the current space ids.
  await api('POST', `/api/projects/${pid}/snapshots`, {
    label: 'SD', taken_at: '2026-01-01', areas: { [foyer.id]: 110, [hall.id]: 190 },
  });

  // Save Option A (Foyer 100 + Hall 200), then mutate into a different scheme.
  const optA = (await api('POST', `/api/projects/${pid}/options`, { name: 'Option A' })).body;
  assert.equal(optA.net, 300);
  await api('PUT', `/api/spaces/${foyer.id}`, { target_area: 130 });
  await api('DELETE', `/api/spaces/${hall.id}`);
  await api('POST', `/api/projects/${pid}/spaces`, { name: 'Studio', target_area: 80 });

  // Load Option A back, saving the current scheme first.
  const loaded = (await api('POST', `/api/projects/${pid}/options/${optA.id}/load`, { saveCurrentAs: 'Option B' })).body;
  assert.equal(loaded.ok, true);
  assert.equal(loaded.updated, 1); // Foyer matched by path (id kept)
  assert.equal(loaded.added, 1); // Hall came back (new id)
  assert.equal(loaded.deleted, 1); // Studio removed
  assert.equal(loaded.savedCurrent.name, 'Option B');

  const bundle = (await api('GET', `/api/projects/${pid}`)).body;
  const names = bundle.spaces.map((s) => s.name).sort();
  assert.deepEqual(names, ['Foyer', 'Hall']);
  const foyerNow = bundle.spaces.find((s) => s.name === 'Foyer');
  assert.equal(foyerNow.id, foyer.id); // matched room kept its id…
  assert.equal(foyerNow.target_area, 100); // …and took the option's area
  const ms = bundle.snapshots.find((s) => s.label === 'SD');
  assert.equal(ms.areas[foyer.id], 110); // milestone record survived the switch

  const opts = (await api('GET', `/api/projects/${pid}/options`)).body;
  assert.deepEqual(opts.map((o) => o.name), ['Option A', 'Option B']);
});

test('project circulation persists and clamps', async () => {
  const pid = await newProject('Circ');
  const upd = await api('PUT', `/api/projects/${pid}`, { circulation: 0.35 });
  assert.equal(upd.body.circulation, 0.35);
  const cleared = await api('PUT', `/api/projects/${pid}`, { circulation: null });
  assert.equal(cleared.body.circulation, null);
});

test('nested brief: milestones and revisions count the same leaves as the client', async () => {
  const pid = await newProject('NestedBrief');
  // Teen Zone is a group-mode parent (pure container — children carry the
  // area); Lounge is a 'within' parent (a real space whose child is inside it).
  const zone = (await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Teen Zone', target_area: 85 })).body;
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Games', target_area: 40, parent_id: zone.id });
  const lounge = (await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Lounge', target_area: 60 })).body;
  await api('PUT', `/api/brief-spaces/${lounge.id}`, { child_mode: 'within' });
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Nook', target_area: 10, parent_id: lounge.id });
  await api('PUT', `/api/brief-spaces/${zone.id}`, { child_mode: 'group' });

  // Client-visible net: Games 40 (zone is a container) + Lounge 60 (Nook is
  // within it) = 100. The revision must agree.
  const rev = (await api('POST', `/api/projects/${pid}/brief-revisions`, { label: 'Rev A' })).body;
  assert.equal(rev.net, 100);
  assert.equal(rev.room_count, 2);

  // Milestone captures the same two leaves (matched onto design rooms).
  const games = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Games', target_area: 1, parent_id: null })).body;
  await api('PUT', `/api/spaces/${games.id}`, { name: 'Games' });
  const ms = (await api('POST', `/api/projects/${pid}/brief-milestone`, { label: 'Check' })).body;
  // Games has no matching path (brief Games sits under Teen Zone) → unmatched,
  // along with Lounge; the group parent Teen Zone and within-child Nook are
  // NOT captured at all.
  assert.deepEqual(ms.unmatched.sort(), ['Games', 'Lounge']);
});

// ---- Duplicate sibling names (path keys take ' #2', ' #3', …) ---------------

test('duplicate siblings: diff and apply pair them one-to-one', async () => {
  const pid = await newProject('DupSiblings');
  // The Greenfield shape: a group with two same-named children in the Brief.
  const zone = (await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Teen Zone', kind: 'group' })).body;
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Book Storage Copy', target_area: 40, parent_id: zone.id });
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Book Storage Copy', target_area: 60, parent_id: zone.id });
  // The design has the group and only the first copy.
  const dZone = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Teen Zone', kind: 'group' })).body;
  const dCopy = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Book Storage Copy', target_area: 10, parent_id: dZone.id })).body;

  const diff = (await api('GET', `/api/projects/${pid}/brief-diff`)).body;
  assert.deepEqual(diff.updates.map((u) => u.path), ['teen zone / book storage copy']); // 10→40
  assert.deepEqual(diff.adds.map((a) => a.path), ['teen zone / book storage copy #2']); // the 2nd duplicate
  assert.equal(diff.deletes.length, 0);

  await api('POST', `/api/projects/${pid}/apply-brief`, {});
  const spaces = (await api('GET', `/api/projects/${pid}`)).body.spaces;
  const copies = spaces.filter((s) => s.name === 'Book Storage Copy').sort((a, b) => a.sort_order - b.sort_order);
  assert.equal(copies.length, 2); // both duplicates exist now
  assert.equal(copies[0].id, dCopy.id); // 1st matched in place (placement kept)
  assert.equal(copies[0].target_area, 40);
  assert.equal(copies[1].target_area, 60);
  assert.equal(copies[1].parent_id, dZone.id); // 2nd added under the matched group

  // Idempotent: a second diff finds nothing to do.
  const again = (await api('GET', `/api/projects/${pid}/brief-diff`)).body;
  assert.equal(again.adds.length + again.updates.length + again.deletes.length, 0);
});

test('duplicate siblings: deleting by key removes only the chosen duplicate', async () => {
  const pid = await newProject('DupDelete');
  const keep = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Store', target_area: 10 })).body;
  await api('POST', `/api/projects/${pid}/spaces`, { name: 'Store', target_area: 20 });
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Store', target_area: 15 });

  const diff = (await api('GET', `/api/projects/${pid}/brief-diff`)).body;
  assert.deepEqual(diff.deletes.map((d) => d.path), ['store #2']); // only the unmatched one
  await api('POST', `/api/projects/${pid}/apply-brief`, { deleteKeys: ['store #2'] });
  const spaces = (await api('GET', `/api/projects/${pid}`)).body.spaces;
  assert.equal(spaces.length, 1);
  assert.equal(spaces[0].id, keep.id); // the 1st duplicate survived
  assert.equal(spaces[0].target_area, 15); // …and took the Brief's area
});

test('duplicate siblings: milestone records each Brief room against its own match', async () => {
  const pid = await newProject('DupMilestone');
  const d1 = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Store', target_area: 1 })).body;
  const d2 = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Store', target_area: 2 })).body;
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Store', target_area: 40 });
  await api('POST', `/api/projects/${pid}/brief-spaces`, { name: 'Store', target_area: 60 });

  const r = (await api('POST', `/api/projects/${pid}/brief-milestone`, { label: 'Dup check' })).body;
  assert.deepEqual(r.unmatched, []); // both found a partner
  const ms = (await api('GET', `/api/projects/${pid}`)).body.snapshots.find((s) => s.label === 'Dup check');
  assert.equal(ms.areas[d1.id], 40); // 1st ↔ 1st
  assert.equal(ms.areas[d2.id], 60); // 2nd ↔ 2nd
});

test('duplicate siblings: loading an option reconciles each one by ordinal', async () => {
  const pid = await newProject('DupOptions');
  const s1 = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Store', target_area: 10 })).body;
  const s2 = (await api('POST', `/api/projects/${pid}/spaces`, { name: 'Store', target_area: 20 })).body;
  const opt = (await api('POST', `/api/projects/${pid}/options`, { name: 'Twin stores' })).body;

  // Drop the 2nd duplicate and drift the 1st, then restore the option.
  await api('DELETE', `/api/spaces/${s2.id}`);
  await api('PUT', `/api/spaces/${s1.id}`, { target_area: 99 });
  const loaded = (await api('POST', `/api/projects/${pid}/options/${opt.id}/load`, {})).body;
  assert.equal(loaded.updated, 1); // the surviving 1st duplicate, matched in place
  assert.equal(loaded.added, 1); // the 2nd came back

  const spaces = (await api('GET', `/api/projects/${pid}`)).body.spaces.sort((a, b) => a.sort_order - b.sort_order);
  assert.equal(spaces.length, 2);
  assert.equal(spaces[0].id, s1.id); // id (and thus pins/milestones) kept
  assert.equal(spaces[0].target_area, 10);
  assert.equal(spaces[1].target_area, 20);
});
