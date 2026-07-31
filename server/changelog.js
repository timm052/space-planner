// Change log — an audit trail of PROGRAMME edits on both room trees, so "when
// did that room grow?" has an answer. Geometry churn (pins, shapes, plan
// placement) is deliberately not logged; the diagram saves those constantly.

import { db } from './db.js';

const ins = db.prepare(
  'INSERT INTO change_log (project_id, tree, name, field, old, new) VALUES (?, ?, ?, ?, ?, ?)'
);

export function logChange(projectId, tree, name, field, oldV, newV) {
  ins.run(projectId, tree, name, field, oldV == null ? null : String(oldV), newV == null ? null : String(newV));
}

// The programme fields worth an audit line, with human labels.
const WATCHED = [
  ['name', 'name'],
  ['department', 'category'],
  ['count', 'count'],
  ['target_area', 'area'],
  ['area_formula', 'formula'],
  ['level', 'level'],
];

// Diff a room row before/after an update and log what changed. `tree` is
// 'design' or 'brief'. Returns how many lines were written.
export function logSpaceDiff(projectId, tree, before, after) {
  let n = 0;
  for (const [col, label] of WATCHED) {
    const a = before[col] ?? null;
    const b = after[col] ?? null;
    if (String(a ?? '') === String(b ?? '')) continue;
    logChange(projectId, tree, after.name || before.name || '?', label, a, b);
    n++;
  }
  return n;
}

export function logCreated(projectId, tree, row) {
  logChange(projectId, tree, row.name || '?', 'created', null, row.kind === 'building' ? 'building' : `${(row.count || 1)} × ${row.target_area}`);
}

export function logRemoved(projectId, tree, row) {
  logChange(projectId, tree, row.name || '?', 'removed', row.kind === 'building' ? 'building' : `${(row.count || 1)} × ${row.target_area}`, null);
}

export function listChanges(projectId, limit = 50) {
  return db
    .prepare('SELECT * FROM change_log WHERE project_id = ? ORDER BY id DESC LIMIT ?')
    .all(projectId, Math.min(200, Math.max(1, Number(limit) || 50)));
}
