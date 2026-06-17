import { Router } from 'express';
import { db } from '../db.js';
import { requireProject } from './projects.js';

const router = Router();

const VALID_STRENGTHS = new Set(['required', 'desired']);

// POST /api/projects/:id/adjacencies
router.post('/projects/:id/adjacencies', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;

  let { space_a, space_b, strength = 'desired' } = req.body;
  space_a = Number(space_a);
  space_b = Number(space_b);

  if (!space_a || !space_b || space_a === space_b) {
    return res.status(400).json({ error: 'Two different spaces are required' });
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM spaces WHERE project_id = ? AND id IN (?, ?)').get(project.id, space_a, space_b).n !== 2) {
    return res.status(400).json({ error: 'Both spaces must belong to this project' });
  }
  if (!VALID_STRENGTHS.has(strength)) strength = 'desired';

  // Canonical ordering: lower id first, ensures UNIQUE constraint works.
  const [lo, hi] = space_a < space_b ? [space_a, space_b] : [space_b, space_a];
  db.prepare(
    `INSERT INTO adjacencies (project_id, space_a, space_b, strength) VALUES (?, ?, ?, ?)
     ON CONFLICT (space_a, space_b) DO UPDATE SET strength = excluded.strength`
  ).run(project.id, lo, hi, strength);

  const row = db.prepare('SELECT * FROM adjacencies WHERE space_a = ? AND space_b = ?').get(lo, hi);
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
