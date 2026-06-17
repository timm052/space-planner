import { Router } from 'express';
import { oneOf, clampNum } from '../validate.js';
import { db } from '../db.js';
import { requireProject } from './projects.js';

const router = Router();

const IMAGE_FIELDS = ['kind', 'name', 'image', 'mpp', 'opacity', 'visible', 'x', 'y', 'rot', 'sort_order', 'attribution', 'filter'];
const VALID_IMAGE_KINDS = new Set(['custom', 'satellite']);
const VALID_FILTERS = new Set(['none', 'grayscale', 'sepia', 'invert', 'blueprint', 'faded']);

// POST /api/projects/:id/images
router.post('/projects/:id/images', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const { kind: rawKind = 'custom', name = '', image, mpp = null, opacity: rawOpacity = 0.6, visible = 1, x = 0, y = 0, rot = 0, attribution = null } = req.body;
  const kind = oneOf(rawKind, VALID_IMAGE_KINDS, 'custom');
  const opacity = clampNum(rawOpacity, 0, 1, 0.6);
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'Image data is required' });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM images WHERE project_id = ?').get(project.id).m;
  const r = db
    .prepare(
      `INSERT INTO images (project_id, kind, name, image, mpp, opacity, visible, x, y, rot, sort_order, attribution)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(project.id, kind, name, image, mpp, opacity, visible ? 1 : 0, x, y, rot, max + 1, attribution);
  res.status(201).json(db.prepare('SELECT * FROM images WHERE id = ?').get(r.lastInsertRowid));
});

// PUT /api/images/:id
router.put('/images/:id', (req, res) => {
  const img = db.prepare('SELECT * FROM images WHERE id = ?').get(Number(req.params.id));
  if (!img) return res.status(404).json({ error: 'Image not found' });
  const updates = {};
  if ('kind' in req.body) req.body.kind = oneOf(req.body.kind, VALID_IMAGE_KINDS, img.kind);
  if ('filter' in req.body) req.body.filter = oneOf(req.body.filter, VALID_FILTERS, 'none');
  if ('opacity' in req.body) req.body.opacity = clampNum(req.body.opacity, 0, 1, img.opacity);
  for (const f of IMAGE_FIELDS) {
    if (f in req.body) updates[f] = f === 'visible' ? (req.body[f] ? 1 : 0) : req.body[f];
  }
  if (Object.keys(updates).length > 0) {
    const setSql = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
    db.prepare(`UPDATE images SET ${setSql} WHERE id = ?`).run(...Object.values(updates), img.id);
  }
  res.json(db.prepare('SELECT * FROM images WHERE id = ?').get(img.id));
});

// DELETE /api/images/:id
router.delete('/images/:id', (req, res) => {
  const r = db.prepare('DELETE FROM images WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: 'Image not found' });
  res.status(204).end();
});

export default router;
