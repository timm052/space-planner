import { Router } from 'express';
import { db } from '../db.js';
import { requireProject } from './projects.js';
import { oneOf, clampNum } from '../validate.js';
import {
  resolveBriefAndPersist, formulaErrorsFor, protectParentArea, briefApplyDiff, applyBriefToDiagram, briefToMilestone, seedBriefFromDesign,
  pullSpaceToBrief,
} from '../brief.js';
import { logCreated, logRemoved, logSpaceDiff } from '../changelog.js';

const router = Router();

const CONTAINER_KINDS = new Set(['building', 'group']);
const VALID_KINDS = new Set(['building', 'group', 'space']);
const VALID_CHILD_MODES = new Set(['group', 'within', 'attached']);
const isFormulaStr = (v) => typeof v === 'string' && v.trim().startsWith('=');

// Parent must be in this project's brief tree and not create a cycle.
function parentOk(projectId, parentId, selfId) {
  if (parentId == null) return true;
  const get = db.prepare('SELECT id, project_id, parent_id FROM brief_spaces WHERE id = ?');
  const parent = get.get(parentId);
  if (!parent || parent.project_id !== projectId) return false;
  if (selfId == null) return true;
  let cur = parent;
  const seen = new Set();
  while (cur) {
    if (cur.id === selfId) return false;
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    cur = cur.parent_id != null ? get.get(cur.parent_id) : null;
  }
  return true;
}

// POST /api/projects/:id/brief-spaces
router.post('/projects/:id/brief-spaces', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const { department = 'General', name, count = 1, target_area, notes = '', kind: rawKind = 'space', level = '' } = req.body;
  const kind = oneOf(rawKind, VALID_KINDS, 'space');
  const child_mode = VALID_CHILD_MODES.has(req.body.child_mode) ? req.body.child_mode : 'group';
  const parent_id = req.body.parent_id != null ? Number(req.body.parent_id) : null;
  const area_formula = isFormulaStr(req.body.area_formula) ? req.body.area_formula.trim() : null;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Space name is required' });
  const isContainer = CONTAINER_KINDS.has(kind);
  if (!isContainer && !area_formula && !(Number(target_area) > 0)) {
    return res.status(400).json({ error: 'Target area must be positive' });
  }
  if (!parentOk(project.id, parent_id, null)) return res.status(400).json({ error: 'Invalid parent' });

  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM brief_spaces WHERE project_id = ?').get(project.id).m;
  const r = db
    .prepare(
      `INSERT INTO brief_spaces (project_id, department, name, count, target_area, notes, sort_order, parent_id, kind, child_mode, level, area_formula)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      project.id, department, name.trim(), Number(count) || 1,
      isContainer ? 0 : (Number(target_area) || 0), notes, max + 1, parent_id, kind, child_mode, level, area_formula
    );
  resolveBriefAndPersist(project.id);
  const created = db.prepare('SELECT * FROM brief_spaces WHERE id = ?').get(r.lastInsertRowid);
  logCreated(project.id, 'brief', created);
  res.status(201).json(created);
});

// PUT /api/brief-spaces/:id
router.put('/brief-spaces/:id', (req, res) => {
  const space = db.prepare('SELECT * FROM brief_spaces WHERE id = ?').get(Number(req.params.id));
  if (!space) return res.status(404).json({ error: 'Space not found' });

  const {
    department = space.department, name = space.name, count = space.count,
    target_area = space.target_area, notes = space.notes, kind = space.kind, level = space.level,
  } = req.body;
  const child_mode = VALID_CHILD_MODES.has(req.body.child_mode) ? req.body.child_mode : space.child_mode;
  const parent_id = 'parent_id' in req.body ? (req.body.parent_id != null ? Number(req.body.parent_id) : null) : space.parent_id;
  if (!parentOk(space.project_id, parent_id, space.id)) {
    return res.status(400).json({ error: 'Invalid parent (would create a cycle)' });
  }
  const image = 'image' in req.body ? req.body.image : space.image;
  const sort_order = 'sort_order' in req.body ? Number(req.body.sort_order) : space.sort_order;
  const area_formula = 'area_formula' in req.body
    ? (isFormulaStr(req.body.area_formula) ? req.body.area_formula.trim() : null)
    : space.area_formula;
  const area = CONTAINER_KINDS.has(kind) ? 0 : Number(target_area);

  db.prepare(
    `UPDATE brief_spaces SET department = ?, name = ?, count = ?, target_area = ?, notes = ?,
     parent_id = ?, kind = ?, image = ?, sort_order = ?, child_mode = ?, level = ?, area_formula = ? WHERE id = ?`
  ).run(
    department, name, clampNum(count, 1, 100, 1), area, notes,
    parent_id, oneOf(kind, VALID_KINDS, 'space'), image, sort_order, child_mode, level ?? '', area_formula, space.id
  );
  // A formula that does not evaluate is refused rather than stored. Storing it
  // used to set the room's area to 0 m² and let that zero flow into the design
  // and the issued milestone — a typo silently deleting a room from the
  // programme. The write is rolled back so the last good area survives.
  const parentChanged = parent_id !== space.parent_id;
  // Re-checked on a MOVE as well as a formula edit: re-parenting a row under a
  // space its formula references creates a cycle just as surely as writing a
  // bad expression, and the row doing the moving need not be the one that
  // carries the formula.
  if (area_formula || parentChanged) {
    const errs = formulaErrorsFor(space.project_id, 'brief_spaces');
    const err = errs.get(space.id) ?? (parentChanged ? [...errs.values()][0] : null);
    if (err) {
      db.prepare(
        `UPDATE brief_spaces SET department = ?, name = ?, count = ?, target_area = ?, notes = ?,
         parent_id = ?, kind = ?, image = ?, sort_order = ?, child_mode = ?, level = ?, area_formula = ? WHERE id = ?`
      ).run(
        space.department, space.name, space.count, space.target_area, space.notes,
        space.parent_id, space.kind, space.image, space.sort_order, space.child_mode, space.level ?? '', space.area_formula, space.id
      );
      resolveBriefAndPersist(space.project_id);
      // "Circular reference between spaces" is accurate and useless on its own
      // when the user's action was a drag: say what the move did.
      const msg = parentChanged && /circular/i.test(err)
        ? `${err} — nesting “${name}” here makes an area formula depend on its own total. Move it elsewhere, or replace the formula with a figure.`
        : err;
      return res.status(400).json({ error: msg });
    }
  }
  // Nesting under a space that carries its own area must not silently drop it.
  const protectedParent = parentChanged ? protectParentArea('brief_spaces', parent_id) : null;
  resolveBriefAndPersist(space.project_id);
  const updated = db.prepare('SELECT * FROM brief_spaces WHERE id = ?').get(space.id);
  logSpaceDiff(space.project_id, 'brief', space, updated); // programme fields only
  res.json(protectedParent ? { ...updated, protectedParent } : updated);
});

// DELETE /api/brief-spaces/:id — recursive subtree delete.
router.delete('/brief-spaces/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM brief_spaces WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Space not found' });
  const ids = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT ? UNION
         SELECT s.id FROM brief_spaces s JOIN tree t ON s.parent_id = t.id
       ) SELECT id FROM tree`
    )
    .all(id)
    .map((r) => r.id);
  const del = db.prepare('DELETE FROM brief_spaces WHERE id = ?');
  // Capture the subtree BEFORE deleting: without it the response carried
  // nothing and the delete was one-way, so a mis-drop on a building took its
  // whole contents with no way back.
  const removed = ids.map((sid) => db.prepare('SELECT * FROM brief_spaces WHERE id = ?').get(sid)).filter(Boolean);
  for (const sid of ids) del.run(sid);
  logRemoved(row.project_id, 'brief', row);
  resolveBriefAndPersist(row.project_id);
  res.json({ brief_spaces: removed });
});

// POST /api/projects/:id/brief-spaces/restore — hand a deleted subtree back.
// Ids and parents are preserved, so an undo rebuilds exactly what was there
// and anything matching by path still matches.
router.post('/projects/:id/brief-spaces/restore', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const rows = Array.isArray(req.body?.brief_spaces) ? req.body.brief_spaces : [];
  if (!rows.length) return res.json({ brief_spaces: [] });
  if (rows.some((r) => Number(r.project_id) !== project.id)) {
    return res.status(400).json({ error: 'Those rows belong to another project' });
  }
  const cols = db.prepare('PRAGMA table_info(brief_spaces)').all().map((c) => c.name);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO brief_spaces (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  );
  // Parents first, so a child never references a row that does not exist yet.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const done = new Set();
  const visit = (r, guard) => {
    if (!r || done.has(r.id) || guard.has(r.id)) return;
    guard.add(r.id);
    if (r.parent_id != null && byId.has(r.parent_id)) visit(byId.get(r.parent_id), guard);
    if (done.has(r.id)) return;
    done.add(r.id);
    ins.run(...cols.map((c) => r[c] ?? null));
  };
  db.exec('BEGIN');
  try {
    for (const r of rows) visit(r, new Set());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: `Restore failed: ${err.message}` });
  }
  resolveBriefAndPersist(project.id);
  res.json({ brief_spaces: db.prepare('SELECT * FROM brief_spaces WHERE project_id = ? ORDER BY sort_order, id').all(project.id) });
});

// GET /api/projects/:id/brief-diff — preview an "overwrite the diagram" apply.
router.get('/projects/:id/brief-diff', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  res.json(briefApplyDiff(project.id));
});

// POST /api/projects/:id/apply-brief — reconcile the Brief onto the diagram.
// Body: { addKeys?, updateKeys?, deleteKeys? } path lists (per-row selection).
router.post('/projects/:id/apply-brief', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const arr = (v) => (Array.isArray(v) ? v : undefined);
  const result = applyBriefToDiagram(project.id, {
    addKeys: arr(req.body.addKeys),
    updateKeys: arr(req.body.updateKeys),
    deleteKeys: arr(req.body.deleteKeys),
  });
  res.json(result);
});

// POST /api/projects/:id/pull-to-brief — copy one diagram room into the Brief.
router.post('/projects/:id/pull-to-brief', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const spaceId = Number(req.body.spaceId);
  const result = pullSpaceToBrief(project.id, spaceId);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// POST /api/projects/:id/brief-milestone — snapshot the Brief as a milestone.
router.post('/projects/:id/brief-milestone', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const result = briefToMilestone(project.id, { label: req.body.label, taken_at: req.body.taken_at });
  res.status(201).json(result);
});

// POST /api/projects/:id/brief-from-design — copy the diagram into the Brief.
router.post('/projects/:id/brief-from-design', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const result = seedBriefFromDesign(project.id);
  resolveBriefAndPersist(project.id);
  res.json(result);
});

export default router;
