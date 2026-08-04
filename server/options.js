// Design options — named saves of the whole design (spaces + adjacencies) so
// Option A / Option B schemes can be developed against one Brief and swapped.
//
// Loading an option RECONCILES it onto the live design by path key rather than
// wholesale delete+insert: matched rooms keep their ids, so milestone areas
// (snapshot_areas references space ids) survive a switch. Rooms only in the
// option are added; rooms only in the live design are removed (their milestone
// areas go with them — the load response reports the count).

import { db } from './db.js';
import { pathKeys, rowsNet, leafRows, resolveAndPersist } from './brief.js';
import { logChange } from './changelog.js';

// Every spaces column except the identity ones — resolved dynamically so new
// columns (geometry, formulas, …) ride along without touching this file.
function spaceCols() {
  return db
    .prepare('PRAGMA table_info(spaces)')
    .all()
    .map((c) => c.name)
    .filter((n) => n !== 'id' && n !== 'project_id');
}

export function saveOption(projectId, name) {
  const spaces = db.prepare('SELECT * FROM spaces WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
  if (spaces.length === 0) return { error: 'The design is empty — nothing to save' };
  const adjacencies = db.prepare('SELECT * FROM adjacencies WHERE project_id = ?').all(projectId);
  const roomCount = leafRows(spaces).length;
  const r = db
    .prepare('INSERT INTO design_options (project_id, name, room_count, net, data) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, (name || 'Option').trim(), roomCount, rowsNet(spaces), JSON.stringify({ spaces, adjacencies }));
  logChange(projectId, 'design', (name || 'Option').trim(), 'option saved', null, `${roomCount} rooms`);
  return listOptions(projectId).find((o) => o.id === Number(r.lastInsertRowid));
}

export function listOptions(projectId) {
  return db
    .prepare('SELECT id, project_id, name, created_at, room_count, net FROM design_options WHERE project_id = ? ORDER BY id')
    .all(projectId);
}

export function deleteOption(id) {
  return db.prepare('DELETE FROM design_options WHERE id = ?').run(id).changes > 0;
}

export function loadOption(projectId, optionId) {
  const opt = db.prepare('SELECT * FROM design_options WHERE id = ?').get(optionId);
  if (!opt || opt.project_id !== projectId) return { error: 'Option not found' };
  const target = JSON.parse(opt.data);

  const current = db.prepare('SELECT * FROM spaces WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
  const curKeys = pathKeys(current);
  const tgtKeys = pathKeys(target.spaces);
  const curByKey = new Map(current.map((s) => [curKeys.get(s.id), s]));
  const tgtKeySet = new Set(tgtKeys.values());

  const cols = spaceCols();
  const update = db.prepare(`UPDATE spaces SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`);
  const insert = db.prepare(
    `INSERT INTO spaces (project_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
  );

  // Old option-space id → live space id (parents processed before children
  // because the option rows were saved in tree order).
  const idMap = new Map();
  let added = 0;
  let updated = 0;
  for (const t of target.spaces) {
    const vals = cols.map((c) => (c === 'parent_id'
      ? (t.parent_id != null ? (idMap.get(t.parent_id) ?? null) : null)
      : t[c] ?? null));
    const match = curByKey.get(tgtKeys.get(t.id));
    if (match) {
      // Keep the live parent linkage consistent with the option's tree.
      update.run(...vals, match.id);
      idMap.set(t.id, match.id);
      updated++;
    } else {
      const r = insert.run(projectId, ...vals);
      idMap.set(t.id, Number(r.lastInsertRowid));
      added++;
    }
  }

  // Remove live rooms the option doesn't have (children first).
  let deleted = 0;
  let lostAreas = 0;
  const del = db.prepare('DELETE FROM spaces WHERE id = ?');
  const areaCount = db.prepare('SELECT COUNT(*) AS n FROM snapshot_areas WHERE space_id = ?');
  for (const s of [...current].reverse()) {
    if (tgtKeySet.has(curKeys.get(s.id))) continue;
    lostAreas += areaCount.get(s.id).n;
    del.run(s.id);
    deleted++;
  }

  // Adjacencies: replace wholesale, remapping ids through the path match.
  db.prepare('DELETE FROM adjacencies WHERE project_id = ?').run(projectId);
  const insAdj = db.prepare(
    'INSERT OR IGNORE INTO adjacencies (project_id, space_a, space_b, inst_a, inst_b, strength) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const a of target.adjacencies || []) {
    const sa = idMap.get(a.space_a);
    const sb = idMap.get(a.space_b);
    if (sa == null || sb == null) continue;
    insAdj.run(projectId, sa, sb, a.inst_a ?? 0, a.inst_b ?? 0, a.strength || 'desired');
  }

  resolveAndPersist(projectId);
  logChange(projectId, 'design', opt.name, 'option loaded', null, `${updated} kept · ${added} added · ${deleted} removed`);
  return { ok: true, added, updated, deleted, lostAreas };
}
