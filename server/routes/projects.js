import { Router } from 'express';
import { oneOf, clampNum } from '../validate.js';
import { db } from '../db.js';
import { publicProject, IMAGE_META_COLS } from '../serialize.js';
import { resolveAllAndPersist } from '../brief.js';
import { blockingReason, convertProjectAreas } from '../units.js';

const router = Router();

const getProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ?');

export function requireProject(req, res) {
  const project = getProjectStmt.get(Number(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return project;
}

// Fields writable through PUT /api/projects/:id. Presence-checked so explicit
// null clears nullable columns (e.g. bg_image).
export const PROJECT_FIELDS = [
  'name', 'client', 'stage', 'units', 'grossing_target', 'tolerance',
  'sim_enabled', 'bg_image', 'bg_opacity', 'bg_scale', 'bg_attribution', 'display_scale',
  'bubble_opacity', 'view_x', 'view_y',
  'bg_mpp', 'bg_visible', 'bg_x', 'bg_y',
  'sat_image', 'sat_mpp', 'sat_opacity', 'sat_attribution', 'sat_visible', 'sat_x', 'sat_y',
  'north_deg', 'north_locked', 'bg_rot', 'sat_rot', 'category_colors', 'bubble_style', 'diagram_env',
  'level_heights', 'variables', 'circulation', 'benchmarks',
];

const VALID_UNITS = new Set(['m2', 'ft2']);

// GET /api/projects — project list with summary counts.
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.client, p.stage, p.units, p.grossing_target, p.tolerance,
              p.sim_enabled, p.created_at,
              (SELECT COUNT(*) FROM spaces s WHERE s.project_id = p.id AND s.kind = 'space') AS space_count,
              (SELECT COUNT(*) FROM snapshots sn WHERE sn.project_id = p.id) AS snapshot_count,
              (SELECT SUM(s.count * s.target_area) FROM spaces s
               WHERE s.project_id = p.id
                 AND NOT EXISTS (SELECT 1 FROM spaces c WHERE c.parent_id = s.id)) AS target_net
       FROM projects p ORDER BY p.created_at DESC`
    )
    .all();
  res.json(rows);
});

// POST /api/projects
router.post('/', (req, res) => {
  const { name, client = '', stage = 'Concept', units: rawUnits = 'm2', grossing_target: rawGross = 0.7, tolerance: rawTol = 0.05, circulation: rawCirc = null } = req.body;
  const units = oneOf(rawUnits, VALID_UNITS, 'm2');
  const grossing_target = clampNum(rawGross, 0, 1, 0.7);
  const tolerance = clampNum(rawTol, 0, 1, 0.05);
  const circulation = rawCirc == null ? null : clampNum(rawCirc, 0, 1, 0);
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required' });
  const r = db
    .prepare('INSERT INTO projects (name, client, stage, units, grossing_target, tolerance, circulation) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), client, stage, units, grossing_target, tolerance, circulation); // all sanitised above
  res.status(201).json(publicProject(getProjectStmt.get(r.lastInsertRowid)));
});

// GET /api/projects/:id — full project detail: brief + snapshots + adjacencies + images.
router.get('/:id', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;

  const spaces = db
    .prepare('SELECT * FROM spaces WHERE project_id = ? ORDER BY sort_order, id')
    .all(project.id);

  // One query for all snapshot areas, grouped client-side of the DB (avoids a
  // per-snapshot round trip).
  const areasBySnapshot = new Map();
  for (const row of db
    .prepare(
      `SELECT sa.snapshot_id, sa.space_id, sa.area FROM snapshot_areas sa
       JOIN snapshots sn ON sn.id = sa.snapshot_id WHERE sn.project_id = ?`
    )
    .all(project.id)) {
    if (!areasBySnapshot.has(row.snapshot_id)) areasBySnapshot.set(row.snapshot_id, {});
    areasBySnapshot.get(row.snapshot_id)[row.space_id] = row.area;
  }
  const snapshots = db
    .prepare('SELECT * FROM snapshots WHERE project_id = ? ORDER BY taken_at, id')
    .all(project.id)
    .map((sn) => ({ ...sn, areas: areasBySnapshot.get(sn.id) || {} }));

  // The independent Brief tree (the "Brief" tab), separate from the diagram's
  // `spaces` (the "Design" tab).
  const brief_spaces = db
    .prepare('SELECT * FROM brief_spaces WHERE project_id = ? ORDER BY sort_order, id')
    .all(project.id);

  const adjacencies = db.prepare('SELECT * FROM adjacencies WHERE project_id = ?').all(project.id);
  // Brief adjacency REQUIREMENTS (scored against the diagram's links by path).
  const brief_adjacencies = db.prepare('SELECT * FROM brief_adjacencies WHERE project_id = ?').all(project.id);
  // Metadata only — pixels come from GET /api/images/:id/data, cached client-side.
  const images = db
    .prepare(`SELECT ${IMAGE_META_COLS} FROM images WHERE project_id = ? ORDER BY sort_order, id`)
    .all(project.id);

  // Redline ink drawn over the drawing. Small enough to travel with the
  // project; never mixed into `spaces`, so nothing that totals the programme
  // can reach it.
  const markups = db.prepare('SELECT * FROM markups WHERE project_id = ? ORDER BY id').all(project.id);

  res.json({ project: publicProject(project), spaces, brief_spaces, snapshots, adjacencies, brief_adjacencies, images, markups });
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const updates = {};
  // A units change CONVERTS every stored area rather than relabelling it.
  // Relabelling is what made a 405 m² room read "405 ft²" against a true
  // 4,359.4 — the whole schedule wrong by 10.76×. Converted here, before the
  // column is written, so a failure leaves the project in its old units with
  // its old numbers rather than half-way between the two.
  let unitConversion = null;
  if ('units' in req.body) {
    req.body.units = oneOf(req.body.units, VALID_UNITS, 'm2');
    if (req.body.units !== project.units) {
      const blocked = blockingReason(project.id);
      if (blocked) return res.status(400).json({ error: blocked });
      try {
        unitConversion = convertProjectAreas(project.id, project.units, req.body.units);
      } catch (err) {
        return res.status(500).json({ error: `Unit conversion failed, nothing was changed: ${err.message}` });
      }
    }
  }
  if ('tolerance' in req.body) req.body.tolerance = clampNum(req.body.tolerance, 0, 1, 0.05);
  if ('grossing_target' in req.body) req.body.grossing_target = clampNum(req.body.grossing_target, 0, 1, 0.7);
  // Circulation allowance: nullable fraction (0..1); explicit null clears it.
  if ('circulation' in req.body && req.body.circulation != null) {
    req.body.circulation = clampNum(req.body.circulation, 0, 1, 0);
  }
  // Benchmark override: must be JSON we can parse back, or null to clear.
  if ('benchmarks' in req.body && req.body.benchmarks != null) {
    try {
      const parsed = JSON.parse(req.body.benchmarks);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      req.body.benchmarks = JSON.stringify(parsed);
    } catch {
      return res.status(400).json({ error: 'benchmarks must be a JSON array or null' });
    }
  }
  // North: bearing always wraps into [0, 360); the lock flag is boolean.
  if ('north_deg' in req.body) {
    const n = Number(req.body.north_deg);
    req.body.north_deg = Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
  }
  if ('north_locked' in req.body) req.body.north_locked = req.body.north_locked ? 1 : 0;
  for (const f of PROJECT_FIELDS) if (f in req.body) updates[f] = req.body[f];
  // A locked north cannot be moved — only a request that also unlocks it may
  // carry a new bearing.
  const northLockedAfter = 'north_locked' in updates ? updates.north_locked : project.north_locked;
  if (northLockedAfter && 'north_deg' in updates) delete updates.north_deg;
  if (Object.keys(updates).length > 0) {
    const setSql = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
    db.prepare(`UPDATE projects SET ${setSql} WHERE id = ?`).run(...Object.values(updates), project.id);
  }
  // Editing variables re-derives formula areas in BOTH room trees.
  if ('variables' in updates) resolveAllAndPersist(project.id);
  const out = publicProject(getProjectStmt.get(project.id));
  res.json(unitConversion ? { ...out, unitConversion } : out);
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  res.status(204).end();
});

export default router;
