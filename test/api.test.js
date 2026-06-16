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

test('PUT /api/projects/:id can clear an image to null (key present)', async () => {
  const id = await newProject();
  await api('PUT', `/api/projects/${id}`, { bg_image: 'data:image/png;base64,AAAA' });
  const cleared = await api('PUT', `/api/projects/${id}`, { bg_image: null });
  assert.equal(cleared.body.bg_image, null);
});

test('GET /api/projects/:id returns the full bundle; 404 when missing', async () => {
  const id = await newProject();
  const { status, body } = await api('GET', `/api/projects/${id}`);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['adjacencies', 'images', 'project', 'snapshots', 'spaces']);
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
  const adj = (await api('GET', `/api/projects/${pid}`)).body.adjacencies;
  assert.equal(adj.length, 1);
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
