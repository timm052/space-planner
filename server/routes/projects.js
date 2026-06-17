import { Router } from 'express';
import { oneOf, clampNum } from '../validate.js';
import { db } from '../db.js';

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
  'north_deg', 'bg_rot', 'sat_rot', 'category_colors', 'bubble_style',
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
  const { name, client = '', stage = 'Concept', units: rawUnits = 'm2', grossing_target: rawGross = 0.7, tolerance: rawTol = 0.05 } = req.body;
  const units = oneOf(rawUnits, VALID_UNITS, 'm2');
  const grossing_target = clampNum(rawGross, 0, 1, 0.7);
  const tolerance = clampNum(rawTol, 0, 1, 0.05);
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required' });
  const r = db
    .prepare('INSERT INTO projects (name, client, stage, units, grossing_target, tolerance) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), client, stage, units, grossing_target, tolerance); // all sanitised above
  res.status(201).json(getProjectStmt.get(r.lastInsertRowid));
});

// GET /api/projects/:id — full project detail: brief + snapshots + adjacencies + images.
router.get('/:id', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;

  const spaces = db
    .prepare('SELECT * FROM spaces WHERE project_id = ? ORDER BY sort_order, id')
    .all(project.id);

  const snapshots = db
    .prepare('SELECT * FROM snapshots WHERE project_id = ? ORDER BY taken_at, id')
    .all(project.id)
    .map((sn) => {
      const areas = {};
      for (const row of db.prepare('SELECT space_id, area FROM snapshot_areas WHERE snapshot_id = ?').all(sn.id)) {
        areas[row.space_id] = row.area;
      }
      return { ...sn, areas };
    });

  const adjacencies = db.prepare('SELECT * FROM adjacencies WHERE project_id = ?').all(project.id);
  const images = db.prepare('SELECT * FROM images WHERE project_id = ? ORDER BY sort_order, id').all(project.id);

  res.json({ project, spaces, snapshots, adjacencies, images });
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const updates = {};
  if ('units' in req.body) req.body.units = oneOf(req.body.units, VALID_UNITS, 'm2');
  if ('tolerance' in req.body) req.body.tolerance = clampNum(req.body.tolerance, 0, 1, 0.05);
  if ('grossing_target' in req.body) req.body.grossing_target = clampNum(req.body.grossing_target, 0, 1, 0.7);
  for (const f of PROJECT_FIELDS) if (f in req.body) updates[f] = req.body[f];
  if (Object.keys(updates).length > 0) {
    const setSql = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
    db.prepare(`UPDATE projects SET ${setSql} WHERE id = ?`).run(...Object.values(updates), project.id);
  }
  res.json(getProjectStmt.get(project.id));
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  res.status(204).end();
});

export default router;
