import { Router } from 'express';
import { db } from '../db.js';
import { requireProject } from './projects.js';

const router = Router();

const VALID_STRENGTHS = new Set(['required', 'desired']);

// POST /api/projects/:id/adjacencies
router.post('/projects/:id/adjacencies', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;

  let { space_a, space_b, inst_a = 0, inst_b = 0, strength = 'desired' } = req.body;
  space_a = Number(space_a);
  space_b = Number(space_b);
  inst_a = Math.max(0, Math.trunc(Number(inst_a) || 0));
  inst_b = Math.max(0, Math.trunc(Number(inst_b) || 0));

  if (!space_a || !space_b || space_a === space_b) {
    return res.status(400).json({ error: 'Two different spaces are required' });
  }
  // Both spaces must belong to the project; clamp each instance to [0, count-1].
  const rows = db.prepare('SELECT id, count FROM spaces WHERE project_id = ? AND id IN (?, ?)').all(project.id, space_a, space_b);
  if (rows.length !== 2) {
    return res.status(400).json({ error: 'Both spaces must belong to this project' });
  }
  const countOf = (id) => Math.max(1, rows.find((r) => r.id === id)?.count || 1);
  inst_a = Math.min(inst_a, countOf(space_a) - 1);
  inst_b = Math.min(inst_b, countOf(space_b) - 1);
  if (!VALID_STRENGTHS.has(strength)) strength = 'desired';

  // Canonical ordering: lower space id first (its instance rides along), so the
  // UNIQUE (space_a, space_b, inst_a, inst_b) key is order-independent.
  const [la, lai, lb, lbi] = space_a < space_b ? [space_a, inst_a, space_b, inst_b] : [space_b, inst_b, space_a, inst_a];
  db.prepare(
    `INSERT INTO adjacencies (project_id, space_a, space_b, inst_a, inst_b, strength) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (space_a, space_b, inst_a, inst_b) DO UPDATE SET strength = excluded.strength`
  ).run(project.id, la, lb, lai, lbi, strength);

  const row = db.prepare('SELECT * FROM adjacencies WHERE space_a = ? AND space_b = ? AND inst_a = ? AND inst_b = ?').get(la, lb, lai, lbi);
  res.status(201).json(row);
});

// PUT /api/adjacencies/:id
router.put('/adjacencies/:id', (req, res) => {
  const adj = db.prepare('SELECT * FROM adjacencies WHERE id = ?').get(Number(req.params.id));
  if (!adj) return res.status(404).json({ error: 'Adjacency not found' });
  const strength = VALID_STRENGTHS.has(req.body.strength) ? req.body.strength : adj.strength;
  db.prepare('UPDATE adjacencies SET strength = ? WHERE id = ?').run(strength, adj.id);
  res.json(db.prepare('SELECT * FROM adjacencies WHERE id = ?').get(adj.id));
});

// DELETE /api/adjacencies/:id
router.delete('/adjacencies/:id', (req, res) => {
  const r = db.prepare('DELETE FROM adjacencies WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: 'Adjacency not found' });
  res.status(204).end();
});

export default router;
