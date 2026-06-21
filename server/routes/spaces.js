import { Router } from 'express';
import { db } from '../db.js';
import { requireProject } from './projects.js';
import { oneOf, clampNum } from '../validate.js';

const router = Router();

// Kinds that carry no area of their own — area rolls up from leaf descendants.
const CONTAINER_KINDS = new Set(['building', 'group']);
const VALID_KINDS = new Set(['building', 'group', 'space']);

// Validate that parent (if any) belongs to this project and isn't the space
// itself or a descendant (which would create a cycle). Walk the ancestor chain.
function parentOk(projectId, parentId, selfId) {
  if (parentId == null) return true;
  const get = db.prepare('SELECT id, project_id, parent_id FROM spaces WHERE id = ?');
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

const VALID_CHILD_MODES = new Set(['group', 'within', 'attached']);
const VALID_SHAPES = new Set(['bubble', 'box', 'poly']);

// POST /api/projects/:id/spaces
router.post('/projects/:id/spaces', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;

  const {
    department = 'General', name, count = 1, target_area, notes = '',
    kind: rawKind = 'space', level = '',
  } = req.body;
  const kind = oneOf(rawKind, VALID_KINDS, 'space');
  const child_mode = VALID_CHILD_MODES.has(req.body.child_mode) ? req.body.child_mode : 'group';
  const parent_id = req.body.parent_id != null ? Number(req.body.parent_id) : null;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Space name is required' });
  const isContainer = CONTAINER_KINDS.has(kind);
  if (!isContainer && !(Number(target_area) > 0)) {
    return res.status(400).json({ error: 'Target area must be positive' });
  }
  if (!parentOk(project.id, parent_id, null)) {
    return res.status(400).json({ error: 'Invalid parent' });
  }

  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM spaces WHERE project_id = ?').get(project.id).m;
  const r = db
    .prepare(
      `INSERT INTO spaces (project_id, department, name, count, target_area, notes, sort_order, parent_id, kind, child_mode, level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      project.id, department, name.trim(), Number(count) || 1,
      isContainer ? 0 : Number(target_area), notes, max + 1, parent_id, kind, child_mode, level
    );
  res.status(201).json(db.prepare('SELECT * FROM spaces WHERE id = ?').get(r.lastInsertRowid));
});

// PUT /api/spaces/:id
router.put('/spaces/:id', (req, res) => {
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(Number(req.params.id));
  if (!space) return res.status(404).json({ error: 'Space not found' });

  const {
    department = space.department, name = space.name, count = space.count,
    target_area = space.target_area, notes = space.notes, kind = space.kind,
    shape = space.shape, level = space.level,
  } = req.body;
  const child_mode = VALID_CHILD_MODES.has(req.body.child_mode) ? req.body.child_mode : space.child_mode;
  const parent_id = 'parent_id' in req.body
    ? (req.body.parent_id != null ? Number(req.body.parent_id) : null)
    : space.parent_id;

  if (!parentOk(space.project_id, parent_id, space.id)) {
    return res.status(400).json({ error: 'Invalid parent (would create a cycle)' });
  }

  // Pin fields and image are nullable — check key presence rather than defaulting.
  const pin_x = 'pin_x' in req.body ? req.body.pin_x : space.pin_x;
  const pin_y = 'pin_y' in req.body ? req.body.pin_y : space.pin_y;
  let pin_json = 'pin_json' in req.body ? req.body.pin_json : space.pin_json;
  if (pin_json != null && typeof pin_json !== 'string') pin_json = JSON.stringify(pin_json);
  const image = 'image' in req.body ? req.body.image : space.image;
  const sort_order = 'sort_order' in req.body ? Number(req.body.sort_order) : space.sort_order;
  const area = CONTAINER_KINDS.has(kind) ? 0 : Number(target_area);

  // shape_json (freeform polygon) is nullable — check key presence, stringify objects.
  let shape_json = 'shape_json' in req.body ? req.body.shape_json : space.shape_json;
  if (shape_json != null && typeof shape_json !== 'string') shape_json = JSON.stringify(shape_json);

  const safeCount = clampNum(count, 1, 100, 1);
  db.prepare(
    `UPDATE spaces SET department = ?, name = ?, count = ?, target_area = ?, notes = ?,
     pin_x = ?, pin_y = ?, pin_json = ?, parent_id = ?, kind = ?, shape = ?, shape_json = ?,
     image = ?, sort_order = ?, child_mode = ?, level = ? WHERE id = ?`
  ).run(
    department, name, safeCount, area, notes,
    pin_x, pin_y, pin_json, parent_id, kind, oneOf(shape, VALID_SHAPES, 'bubble'), shape_json,
    image, sort_order, child_mode, level ?? '', space.id
  );
  res.json(db.prepare('SELECT * FROM spaces WHERE id = ?').get(space.id));
});

// DELETE /api/spaces/:id — recursive subtree delete via CTE.
// Uses UNION (not UNION ALL) as defence-in-depth against data cycles.
router.delete('/spaces/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM spaces WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Space not found' });
  }
  const ids = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT ? UNION
         SELECT s.id FROM spaces s JOIN tree t ON s.parent_id = t.id
       ) SELECT id FROM tree`
    )
    .all(id)
    .map((r) => r.id);
  const del = db.prepare('DELETE FROM spaces WHERE id = ?');
  for (const sid of ids) del.run(sid);
  res.status(204).end();
});

export default router;
