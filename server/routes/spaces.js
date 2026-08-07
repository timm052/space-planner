import { Router } from 'express';
import { db } from '../db.js';
import { requireProject } from './projects.js';
import { oneOf, clampNum } from '../validate.js';
import { resolveAndPersist, formulaErrorsFor, protectParentArea } from '../brief.js';
import { logCreated, logRemoved, logSpaceDiff } from '../changelog.js';

const isFormulaStr = (v) => typeof v === 'string' && v.trim().startsWith('=');

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
  // A formula-driven area resolves server-side; only literals must be positive.
  const area_formula = isFormulaStr(req.body.area_formula) ? req.body.area_formula.trim() : null;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Space name is required' });
  const isContainer = CONTAINER_KINDS.has(kind);
  if (!isContainer && !area_formula && !(Number(target_area) > 0)) {
    return res.status(400).json({ error: 'Target area must be positive' });
  }
  if (!parentOk(project.id, parent_id, null)) {
    return res.status(400).json({ error: 'Invalid parent' });
  }

  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM spaces WHERE project_id = ?').get(project.id).m;
  const r = db
    .prepare(
      `INSERT INTO spaces (project_id, department, name, count, target_area, notes, sort_order, parent_id, kind, child_mode, level, area_formula)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      project.id, department, name.trim(), Number(count) || 1,
      isContainer ? 0 : (Number(target_area) || 0), notes, max + 1, parent_id, kind, child_mode, level, area_formula
    );
  resolveAndPersist(project.id); // derive formula areas + mirror the baseline
  const created = db.prepare('SELECT * FROM spaces WHERE id = ?').get(r.lastInsertRowid);
  logCreated(project.id, 'design', created);
  res.status(201).json(created);
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

  // plan_json (master-plan placement) is nullable — same key-presence + stringify rule.
  let plan_json = 'plan_json' in req.body ? req.body.plan_json : space.plan_json;
  if (plan_json != null && typeof plan_json !== 'string') plan_json = JSON.stringify(plan_json);

  // block_json (building placement) is nullable — same key-presence + stringify rule.
  let block_json = 'block_json' in req.body ? req.body.block_json : space.block_json;
  if (block_json != null && typeof block_json !== 'string') block_json = JSON.stringify(block_json);

  // Optional per-space clear height (metres; null = inherit the storey's) and
  // per-building circulation share (0..0.6 of gross; null = project default).
  const height_m = 'height_m' in req.body
    ? (req.body.height_m != null && Number(req.body.height_m) > 0 ? clampNum(req.body.height_m, 1, 50, 3.5) : null)
    : space.height_m;
  const circ_pct = 'circ_pct' in req.body
    ? (req.body.circ_pct != null ? clampNum(req.body.circ_pct, 0, 0.6, 0) : null)
    : space.circ_pct;

  // area_formula (nullable): a leading-'=' expression, else cleared to a literal.
  const area_formula = 'area_formula' in req.body
    ? (isFormulaStr(req.body.area_formula) ? req.body.area_formula.trim() : null)
    : space.area_formula;

  const safeCount = clampNum(count, 1, 100, 1);
  db.prepare(
    `UPDATE spaces SET department = ?, name = ?, count = ?, target_area = ?, notes = ?,
     pin_x = ?, pin_y = ?, pin_json = ?, parent_id = ?, kind = ?, shape = ?, shape_json = ?,
     plan_json = ?, block_json = ?, image = ?, sort_order = ?, child_mode = ?, level = ?,
     height_m = ?, circ_pct = ?, area_formula = ? WHERE id = ?`
  ).run(
    department, name, safeCount, area, notes,
    pin_x, pin_y, pin_json, parent_id, kind, oneOf(shape, VALID_SHAPES, 'bubble'), shape_json,
    plan_json, block_json, image, sort_order, child_mode, level ?? '',
    height_m, circ_pct, area_formula, space.id
  );
  // Same rule as the Brief tree: a formula that does not evaluate is refused,
  // not stored as a 0 m² room. Restore the row's previous programme fields so
  // the last good area survives the rejected write.
  if (area_formula) {
    const err = formulaErrorsFor(space.project_id, 'spaces').get(space.id);
    if (err) {
      db.prepare('UPDATE spaces SET target_area = ?, area_formula = ?, count = ? WHERE id = ?')
        .run(space.target_area, space.area_formula, space.count, space.id);
      resolveAndPersist(space.project_id);
      return res.status(400).json({ error: err });
    }
  }
  const protectedParent =
    parent_id !== space.parent_id ? protectParentArea('spaces', parent_id) : null;
  resolveAndPersist(space.project_id); // re-derive formula areas + mirror baseline
  const updated = db.prepare('SELECT * FROM spaces WHERE id = ?').get(space.id);
  logSpaceDiff(space.project_id, 'design', space, updated); // programme fields only
  res.json(protectedParent ? { ...updated, protectedParent } : updated);
});

// DELETE /api/spaces/:id — recursive subtree delete via CTE.
// Uses UNION (not UNION ALL) as defence-in-depth against data cycles.
//
// Returns the removed rows and their adjacencies (200, not 204) so the client
// can offer undo. Deleting a room used to be the one irreversible act in the
// diagram: it took the room's recorded areas and links with it AND the client
// wiped its whole undo stack afterwards, so an accidental confirm also cost
// every unrelated edit made before it.
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
  const root = db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
  const ph = ids.map(() => '?').join(',');
  // Capture BEFORE deleting — the rows are the restore payload.
  const spaces = db.prepare(`SELECT * FROM spaces WHERE id IN (${ph})`).all(...ids);
  const adjacencies = db
    .prepare(`SELECT * FROM adjacencies WHERE space_a IN (${ph}) OR space_b IN (${ph})`)
    .all(...ids, ...ids);
  const del = db.prepare('DELETE FROM spaces WHERE id = ?');
  for (const sid of ids) del.run(sid);
  if (root) {
    logRemoved(root.project_id, 'design', root);
    resolveAndPersist(root.project_id); // references/rollups may have changed
  }
  res.json({ spaces, adjacencies });
});

// POST /api/projects/:id/spaces/restore — put a deleted subtree back.
//
// Re-inserts with the ORIGINAL ids, which is what makes this a true undo:
// parent_id links inside the subtree, adjacency endpoints, and any layout slot
// keyed by space id all keep pointing at the same rows. A fresh createSpace
// would mint new ids and silently orphan every one of those references.
router.post('/projects/:id/spaces/restore', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const spaces = Array.isArray(req.body?.spaces) ? req.body.spaces : [];
  const adjacencies = Array.isArray(req.body?.adjacencies) ? req.body.adjacencies : [];
  if (!spaces.length) return res.status(400).json({ error: 'Nothing to restore' });
  if (spaces.some((s) => Number(s.project_id) !== project.id)) {
    return res.status(400).json({ error: 'Rows belong to another project' });
  }

  // Take the column list from the live table rather than hardcoding it: this
  // schema grows by migration (shape_json, plan_json, block_json, height_m,
  // circ_pct, area_formula all arrived that way), and a stale list here would
  // silently drop whichever column was added last.
  const cols = db
    .prepare('PRAGMA table_info(spaces)')
    .all()
    .map((c) => c.name);
  const insSpace = db.prepare(
    `INSERT OR IGNORE INTO spaces (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  );
  const insAdj = db.prepare(
    `INSERT OR IGNORE INTO adjacencies (id, project_id, space_a, space_b, strength, inst_a, inst_b)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // Parents first, so parent_id never dangles mid-insert (foreign_keys is ON).
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const ordered = [];
  const seen = new Set();
  const visit = (s) => {
    if (!s || seen.has(s.id)) return;
    seen.add(s.id);
    if (s.parent_id != null && byId.has(s.parent_id)) visit(byId.get(s.parent_id));
    ordered.push(s);
  };
  for (const s of spaces) visit(s);

  // One transaction — a half-restored subtree (rooms back, links missing) is
  // worse than a clean failure. node:sqlite has no transaction() wrapper, so
  // drive it with SQL, as the rest of this server does.
  db.exec('BEGIN');
  try {
    for (const s of ordered) insSpace.run(...cols.map((c) => s[c] ?? null));
    for (const a of adjacencies) {
      insAdj.run(a.id ?? null, project.id, a.space_a, a.space_b, a.strength ?? 'desired', a.inst_a ?? 0, a.inst_b ?? 0);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: `Restore failed: ${err.message}` });
  }
  resolveAndPersist(project.id);
  const restored = db
    .prepare(`SELECT * FROM spaces WHERE id IN (${spaces.map(() => '?').join(',')})`)
    .all(...spaces.map((s) => s.id));
  for (const s of restored) logCreated(project.id, 'design', s);
  res.status(201).json(restored);
});

export default router;
