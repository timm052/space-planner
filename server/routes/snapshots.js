import { Router } from 'express';
import { db } from '../db.js';
import { requireProject } from './projects.js';

const router = Router();

// Upsert measured areas for a snapshot. Only finite, non-negative values are stored.
function saveSnapshotAreas(snapshotId, areas) {
  const insert = db.prepare(
    `INSERT INTO snapshot_areas (snapshot_id, space_id, area) VALUES (?, ?, ?)
     ON CONFLICT (snapshot_id, space_id) DO UPDATE SET area = excluded.area`
  );
  for (const [spaceId, area] of Object.entries(areas || {})) {
    const value = Number(area);
    if (Number.isFinite(value) && value >= 0) insert.run(snapshotId, Number(spaceId), value);
  }
}

// Return a snapshot row with its areas map attached.
function snapshotWithAreas(id) {
  const sn = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id);
  if (!sn) return null;
  const areas = {};
  for (const row of db.prepare('SELECT space_id, area FROM snapshot_areas WHERE snapshot_id = ?').all(id)) {
    areas[row.space_id] = row.area;
  }
  return { ...sn, areas };
}

// POST /api/projects/:id/snapshots
router.post('/projects/:id/snapshots', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const { label, taken_at, gross_area = 0, notes = '', areas = {} } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'Milestone label is required' });
  const date = taken_at || new Date().toISOString().slice(0, 10);
  const r = db
    .prepare('INSERT INTO snapshots (project_id, label, taken_at, gross_area, notes) VALUES (?, ?, ?, ?, ?)')
    .run(project.id, label.trim(), date, Number(gross_area) || 0, notes);
  saveSnapshotAreas(Number(r.lastInsertRowid), areas);
  res.status(201).json(snapshotWithAreas(Number(r.lastInsertRowid)));
});

// PUT /api/snapshots/:id
router.put('/snapshots/:id', (req, res) => {
  const sn = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(Number(req.params.id));
  if (!sn) return res.status(404).json({ error: 'Snapshot not found' });
  const { label = sn.label, taken_at = sn.taken_at, gross_area = sn.gross_area, notes = sn.notes, areas } = req.body;
  db.prepare('UPDATE snapshots SET label = ?, taken_at = ?, gross_area = ?, notes = ? WHERE id = ?').run(
    label, taken_at, Number(gross_area) || 0, notes, sn.id
  );
  if (areas) saveSnapshotAreas(sn.id, areas);
  res.json(snapshotWithAreas(sn.id));
});

// DELETE /api/snapshots/:id
router.delete('/snapshots/:id', (req, res) => {
  const r = db.prepare('DELETE FROM snapshots WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: 'Snapshot not found' });
  res.status(204).end();
});

export default router;
