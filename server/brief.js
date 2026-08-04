// Server-side formula resolution for both room trees — the diagram's live
// `spaces` (Design tab) and the independent `brief_spaces` (Brief tab). Each
// tree's areas may be formula-driven (area_formula + project variables); this
// module resolves them into a plain target_area so the diagram/exports keep
// reading numbers. It also reconciles the Brief onto the diagram ("overwrite")
// and snapshots the Brief as a milestone.

import { db } from './db.js';
import { resolveBrief } from '../src/formula.js';

const CONTAINER_KINDS = new Set(['building', 'group']);

export function parseVariables(project) {
  if (!project || !project.variables) return {};
  try {
    const raw = JSON.parse(project.variables);
    const out = {};
    for (const [k, v] of Object.entries(raw || {})) {
      const n = Number(v);
      if (k && Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

// Resolve every formula in one room tree and persist the derived target_area.
// `table` is 'spaces' or 'brief_spaces'. Idempotent.
export function resolveTable(projectId, table) {
  const project = db.prepare('SELECT id, variables FROM projects WHERE id = ?').get(projectId);
  if (!project) return;
  const rows = db.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId);
  const vars = parseVariables(project);
  const { each } = resolveBrief(rows, vars);
  const upd = db.prepare(`UPDATE ${table} SET target_area = ? WHERE id = ?`);
  for (const s of rows) {
    if (!s.area_formula || !String(s.area_formula).trim().startsWith('=')) continue;
    const value = Math.round((each.get(s.id) ?? 0) * 1000) / 1000; // trim FP noise
    if (value !== s.target_area) upd.run(value, s.id);
  }
}

// Called by the diagram-room (spaces) routes.
export function resolveAndPersist(projectId) {
  resolveTable(projectId, 'spaces');
}
// Called by the Brief-room (brief_spaces) routes and when variables change.
export function resolveBriefAndPersist(projectId) {
  resolveTable(projectId, 'brief_spaces');
}
// Variables feed both trees.
export function resolveAllAndPersist(projectId) {
  resolveTable(projectId, 'spaces');
  resolveTable(projectId, 'brief_spaces');
}

// ---------- tree helpers (shared shape between the two tables) ----------

// Mirrors the client's isLeaf/isPureContainer rules (src/compute.js): a
// group-mode parent is a pure container (children carry the area); a
// 'within'/'attached' parent is a real space that keeps its own area.
export function isLeafRow(s, childIds) {
  if (CONTAINER_KINDS.has(s.kind)) return false;
  if (childIds.has(s.id)) return s.child_mode === 'within' || s.child_mode === 'attached';
  return true;
}

// True when an ancestor 'within' space already accounts for this row's area
// (mirrors the client's isWithinDescendant).
function isWithinDescendantRow(s, byId) {
  let cur = s;
  const seen = new Set();
  while (cur && cur.parent_id != null && byId.has(cur.parent_id) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parent_id);
    if (!CONTAINER_KINDS.has(cur.kind) && cur.child_mode === 'within') return true;
  }
  return false;
}

// The area-carrying rows of a tree — the same set the client sums.
export function leafRows(rows) {
  const childIds = new Set();
  for (const s of rows) if (s.parent_id != null) childIds.add(s.parent_id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.filter((s) => isLeafRow(s, childIds) && !isWithinDescendantRow(s, byId));
}

// Net total over a rows array (leaves only) — shared by revisions and options.
export function rowsNet(rows) {
  return leafRows(rows).reduce((t, s) => t + (s.count || 1) * (s.target_area || 0), 0);
}

// A stable match key for a room: its name plus its ancestors' names (so a
// "Store" under two different buildings stays distinct). Case-insensitive.
// Siblings that share a name would collide, so duplicates take ' #2', ' #3', …
// in (sort_order, id) order — the n-th duplicate in one tree matches the n-th
// in the other. The client's pathKeyMap (src/compute.js) must stay identical.
export function pathKeys(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Siblings grouped per parent; a parent missing from `rows` counts as root.
  const kids = new Map();
  for (const r of rows) {
    const pid = r.parent_id != null && byId.has(r.parent_id) ? r.parent_id : null;
    if (!kids.has(pid)) kids.set(pid, []);
    kids.get(pid).push(r);
  }
  const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0);
  const keys = new Map();
  // Top-down, so each key extends its parent's already-disambiguated key.
  const stack = [[null, '']];
  while (stack.length) {
    const [pid, parentKey] = stack.pop();
    const group = kids.get(pid);
    if (!group) continue;
    const used = new Set();
    for (const r of group.sort(bySort)) {
      const base = (r.name || '').trim().toLowerCase();
      let name = base;
      for (let n = 2; used.has(name); n++) name = `${base} #${n}`;
      used.add(name);
      const key = parentKey ? `${parentKey} / ${name}` : name;
      keys.set(r.id, key);
      stack.push([r.id, key]);
    }
  }
  // Rows inside a parent cycle are unreachable from any root (the API rejects
  // cycles, but stay total on bad data): key them by their raw name walk.
  for (const r of rows) {
    if (keys.has(r.id)) continue;
    const parts = [];
    const seen = new Set();
    for (let cur = r; cur && !seen.has(cur.id); cur = cur.parent_id != null ? byId.get(cur.parent_id) : null) {
      seen.add(cur.id);
      parts.push((cur.name || '').trim().toLowerCase());
    }
    keys.set(r.id, parts.reverse().join(' / '));
  }
  return keys;
}

// ---------- Brief → diagram reconciliation ("overwrite") ----------

// Compute the diff of applying the Brief onto the diagram: which rooms would be
// added, updated (area/props change) or deleted. Matched by path key.
export function briefApplyDiff(projectId) {
  const brief = db.prepare('SELECT * FROM brief_spaces WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
  const design = db.prepare('SELECT * FROM spaces WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
  const briefKeys = pathKeys(brief);
  const designKeys = pathKeys(design);
  const designByKey = new Map(design.map((s) => [designKeys.get(s.id), s]));
  const briefByKey = new Map(brief.map((s) => [briefKeys.get(s.id), s]));

  const adds = [];
  const updates = [];
  for (const b of brief) {
    const match = designByKey.get(briefKeys.get(b.id));
    if (!match) {
      adds.push({ name: b.name, path: briefKeys.get(b.id), area: (b.count || 1) * b.target_area });
    } else {
      const changed =
        match.target_area !== b.target_area || match.count !== b.count ||
        match.department !== b.department || (match.level || '') !== (b.level || '') ||
        (match.area_formula || null) !== (b.area_formula || null);
      if (changed) {
        updates.push({
          name: b.name, path: briefKeys.get(b.id),
          from: (match.count || 1) * match.target_area,
          to: (b.count || 1) * b.target_area,
        });
      }
    }
  }
  const deletes = [];
  for (const s of design) {
    if (!briefByKey.get(designKeys.get(s.id))) {
      deletes.push({ name: s.name, path: designKeys.get(s.id), area: (s.count || 1) * s.target_area });
    }
  }
  return { adds, updates, deletes };
}

// Apply the Brief onto the diagram, reconciling by path key. Selection is
// per-row: `addKeys`/`updateKeys`/`deleteKeys` are path lists to act on
// (undefined addKeys/updateKeys = apply all; undefined deleteKeys = delete
// none). Matched rooms keep their diagram geometry (pins/shape/placement);
// only programme fields are overwritten.
export function applyBriefToDiagram(projectId, { addKeys, updateKeys, deleteKeys } = {}) {
  const brief = db.prepare('SELECT * FROM brief_spaces WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
  const design = db.prepare('SELECT * FROM spaces WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
  const briefKeys = pathKeys(brief);
  const designKeys = pathKeys(design);
  const designByKey = new Map(design.map((s) => [designKeys.get(s.id), s]));
  const wants = (set, key) => set == null || set.includes(key);

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM spaces WHERE project_id = ?').get(projectId).m;
  let order = maxOrder + 1;
  const insert = db.prepare(
    `INSERT INTO spaces (project_id, department, name, count, target_area, notes, sort_order, parent_id, kind, child_mode, level, area_formula)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    'UPDATE spaces SET department = ?, count = ?, target_area = ?, kind = ?, child_mode = ?, level = ?, area_formula = ? WHERE id = ?'
  );

  // Map each brief room id → the diagram space id it corresponds to (existing or
  // newly created), so children can be parented correctly. Process parents first.
  const briefToDesign = new Map();
  let added = 0, updated = 0;
  for (const b of brief) {
    const key = briefKeys.get(b.id);
    const match = designByKey.get(key);
    if (match) {
      briefToDesign.set(b.id, match.id); // keep the mapping even if the update is skipped
      if (wants(updateKeys, key)) {
        update.run(b.department, b.count, b.target_area, b.kind, b.child_mode, b.level || '', b.area_formula || null, match.id);
        updated++;
      }
    } else if (wants(addKeys, key)) {
      const parentDesignId = b.parent_id != null ? (briefToDesign.get(b.parent_id) ?? null) : null;
      const r = insert.run(
        projectId, b.department, b.name, b.count || 1, b.target_area, b.notes || '',
        order++, parentDesignId, b.kind, b.child_mode || 'group', b.level || '', b.area_formula || null
      );
      briefToDesign.set(b.id, Number(r.lastInsertRowid));
      added++;
    }
  }

  let deleted = 0;
  if (deleteKeys && deleteKeys.length) {
    const briefByKey = new Set([...briefKeys.values()]);
    const del = db.prepare('DELETE FROM spaces WHERE id = ?');
    // Delete leaves-first so container deletes don't orphan then re-scan.
    for (const s of [...design].reverse()) {
      const key = designKeys.get(s.id);
      if (!briefByKey.has(key) && deleteKeys.includes(key)) { del.run(s.id); deleted++; }
    }
  }
  resolveAndPersist(projectId);
  return { added, updated, deleted };
}

// Reverse of an apply, one room at a time: copy a single diagram space's
// programme into the Brief, upserting the Brief room that matches its path.
export function pullSpaceToBrief(projectId, spaceId) {
  const design = db.prepare('SELECT * FROM spaces WHERE project_id = ?').all(projectId);
  const target = design.find((s) => s.id === spaceId);
  if (!target) return { error: 'Space not found' };
  const designKeys = pathKeys(design);
  const key = designKeys.get(spaceId);

  const brief = db.prepare('SELECT * FROM brief_spaces WHERE project_id = ?').all(projectId);
  const briefKeys = pathKeys(brief);
  const briefByKey = new Map(brief.map((b) => [briefKeys.get(b.id), b]));

  const existing = briefByKey.get(key);
  if (existing) {
    db.prepare(
      'UPDATE brief_spaces SET department = ?, count = ?, target_area = ?, kind = ?, child_mode = ?, level = ?, area_formula = ? WHERE id = ?'
    ).run(target.department, target.count, target.target_area, target.kind, target.child_mode, target.level || '', target.area_formula || null, existing.id);
  } else {
    // Parent to the Brief room matching the diagram parent's path, if any.
    let parentBriefId = null;
    if (target.parent_id != null) {
      const parentKey = designKeys.get(target.parent_id);
      parentBriefId = briefByKey.get(parentKey)?.id ?? null;
    }
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM brief_spaces WHERE project_id = ?').get(projectId).m;
    db.prepare(
      `INSERT INTO brief_spaces (project_id, department, name, count, target_area, notes, sort_order, parent_id, kind, child_mode, level, area_formula)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(projectId, target.department, target.name, target.count || 1, target.target_area, target.notes || '', maxOrder + 1, parentBriefId, target.kind, target.child_mode || 'group', target.level || '', target.area_formula || null);
  }
  resolveBriefAndPersist(projectId);
  return { ok: true, upserted: existing ? 'updated' : 'created' };
}

// Snapshot the Brief's resolved programme as a milestone. Areas are keyed to
// the diagram spaces they match (by path); unmatched Brief rooms are reported.
export function briefToMilestone(projectId, { label, taken_at } = {}) {
  resolveBriefAndPersist(projectId);
  const brief = db.prepare('SELECT * FROM brief_spaces WHERE project_id = ?').all(projectId);
  const design = db.prepare('SELECT * FROM spaces WHERE project_id = ?').all(projectId);
  const briefKeys = pathKeys(brief);
  const designKeys = pathKeys(design);
  const designByKey = new Map(design.map((s) => [designKeys.get(s.id), s]));

  const date = taken_at || new Date().toISOString().slice(0, 10);
  const r = db
    .prepare("INSERT INTO snapshots (project_id, label, taken_at, gross_area, notes, kind) VALUES (?, ?, ?, 0, ?, 'milestone')")
    .run(projectId, (label || 'Brief').trim(), date, 'Captured from the Brief');
  const snapId = Number(r.lastInsertRowid);

  const ins = db.prepare('INSERT INTO snapshot_areas (snapshot_id, space_id, area) VALUES (?, ?, ?)');
  const unmatched = [];
  for (const b of leafRows(brief)) {
    const match = designByKey.get(briefKeys.get(b.id));
    const total = (b.count || 1) * b.target_area;
    if (match) ins.run(snapId, match.id, total);
    else unmatched.push(b.name);
  }
  return { snapshotId: snapId, unmatched };
}

// Bootstrap the Brief from the current diagram: copy the `spaces` tree into
// `brief_spaces` (programme fields only), preserving hierarchy. Replaces any
// existing Brief rows. Gives the Brief tab a starting point to edit.
export function seedBriefFromDesign(projectId) {
  const design = db.prepare('SELECT * FROM spaces WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
  db.prepare('DELETE FROM brief_spaces WHERE project_id = ?').run(projectId);
  const insert = db.prepare(
    `INSERT INTO brief_spaces (project_id, department, name, count, target_area, notes, sort_order, parent_id, kind, child_mode, level, area_formula, image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const idMap = new Map(); // design id → new brief id (parents processed first)
  let order = 0;
  for (const s of design) {
    const parent = s.parent_id != null ? (idMap.get(s.parent_id) ?? null) : null;
    const r = insert.run(
      projectId, s.department, s.name, s.count || 1, s.target_area, s.notes || '',
      order++, parent, s.kind, s.child_mode || 'group', s.level || '', s.area_formula || null, s.image || null
    );
    idMap.set(s.id, Number(r.lastInsertRowid));
  }
  return { copied: design.length };
}

// ---------- Brief revisions (Rev A / B / C as the brief is renegotiated) ----------

// The programme fields a revision preserves (ids kept so the tree re-links).
const REVISION_COLS = [
  'id', 'parent_id', 'kind', 'department', 'name', 'count',
  'target_area', 'area_formula', 'child_mode', 'level', 'sort_order',
];

export function saveBriefRevision(projectId, { label, taken_at } = {}) {
  resolveBriefAndPersist(projectId);
  const rows = db.prepare('SELECT * FROM brief_spaces WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
  if (rows.length === 0) return { error: 'The Brief is empty — nothing to record' };
  const data = rows.map((r) => Object.fromEntries(REVISION_COLS.map((c) => [c, r[c] ?? null])));
  const roomCount = leafRows(rows).length;
  const date = taken_at || new Date().toISOString().slice(0, 10);
  const r = db
    .prepare('INSERT INTO brief_revisions (project_id, label, taken_at, room_count, net, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(projectId, (label || 'Revision').trim(), date, roomCount, rowsNet(rows), JSON.stringify(data));
  return { id: Number(r.lastInsertRowid), label: (label || 'Revision').trim(), taken_at: date, room_count: roomCount, net: rowsNet(rows) };
}

export function listBriefRevisions(projectId) {
  return db
    .prepare('SELECT id, project_id, label, taken_at, room_count, net FROM brief_revisions WHERE project_id = ? ORDER BY id')
    .all(projectId);
}

export function getBriefRevision(id) {
  const row = db.prepare('SELECT * FROM brief_revisions WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data) };
}

// Startup: resolve any existing formulas in both trees so target_area is current.
export function ensureAllResolved() {
  for (const p of db.prepare('SELECT id FROM projects').all()) {
    resolveTable(p.id, 'spaces');
    resolveTable(p.id, 'brief_spaces');
  }
}
