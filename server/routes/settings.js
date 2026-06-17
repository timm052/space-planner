import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// GET /api/settings
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

// PUT /api/settings
router.put('/settings', (req, res) => {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(req.body || {})) {
    if (typeof k === 'string' && k.length < 100) upsert.run(k, String(v));
  }
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

export default router;
