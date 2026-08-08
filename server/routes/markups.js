import { Router } from 'express';
import { db } from '../db.js';
import { oneOf, clampNum } from '../validate.js';
import { requireProject } from './projects.js';

const router = Router();

const VALID_ENVS = new Set(['concept', 'masterplan', 'building']);
const VALID_KINDS = new Set(['ink', 'survey', 'note']);
// A note is an annotation, not a document: past this it belongs in the brief.
const MAX_NOTE = 400;
// A stroke longer than this is a runaway pointer stream, not a mark someone
// meant to make; the client already simplifies before posting.
const MAX_POINTS = 4000;

/**
 * Validate and normalise an incoming stroke. Returns { row } or { error }.
 * Points arrive as [[x, y], …] in diagram units.
 */
function readStroke(body) {
  // Points arrive as an array from the client, but as the stored JSON STRING
  // when a row is handed straight back to us — which is exactly what restore
  // and the scale-change PUT do. Accept both, or an undo silently restores
  // nothing.
  let points = body?.points;
  if (typeof points === 'string') {
    try {
      points = JSON.parse(points);
    } catch {
      return { error: 'Points must be JSON' };
    }
  }
  if (!Array.isArray(points) || points.length === 0) return { error: 'A stroke needs at least one point' };
  if (points.length > MAX_POINTS) return { error: `A stroke may not exceed ${MAX_POINTS} points` };
  const clean = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    clean.push([x, y]);
  }
  if (!clean.length) return { error: 'A stroke needs at least one finite point' };
  const colour = String(body.color ?? '#e5484d');
  const kind = oneOf(body.kind, VALID_KINDS, 'ink');
  // A note with nothing written on it is an invisible mark the user cannot
  // find again to delete, so it is refused rather than stored.
  const noteText = String(body.note_text ?? '').replace(/\r/g, '').trim().slice(0, MAX_NOTE);
  if (kind === 'note' && !noteText) return { error: 'A note needs some text' };
  return {
    row: {
      env: oneOf(body.env, VALID_ENVS, 'concept'),
      level: String(body.level ?? ''),
      kind,
      note_text: noteText || null,
      // Hex only — the palette is fixed so a mark reads the same in a PDF as on
      // screen, and so nothing user-supplied lands in an SVG paint attribute.
      color: /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : '#e5484d',
      width: clampNum(body.width, 0.25, 200, 5),
      src_layer: body.src_layer == null ? null : String(body.src_layer).slice(0, 120),
      src_name: body.src_name == null ? null : String(body.src_name).slice(0, 200),
      points: JSON.stringify(clean),
    },
  };
}

const insert = () =>
  db.prepare(
    'INSERT INTO markups (project_id, env, level, kind, color, width, points, src_layer, src_name, note_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

// POST /api/projects/:id/markups — add one stroke.
router.post('/projects/:id/markups', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const { row, error } = readStroke(req.body);
  if (error) return res.status(400).json({ error });
  const r = insert().run(project.id, row.env, row.level, row.kind, row.color, row.width, row.points, row.src_layer, row.src_name, row.note_text);
  res.status(201).json(db.prepare('SELECT * FROM markups WHERE id = ?').get(r.lastInsertRowid));
});

// POST /api/projects/:id/markups/bulk — many strokes in one call.
// A vector import is hundreds of polylines; one request each would be hundreds
// of round trips and a half-imported drawing if any of them failed. All or
// nothing, in a transaction.
router.post('/projects/:id/markups/bulk', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const items = Array.isArray(req.body?.markups) ? req.body.markups : [];
  if (!items.length) return res.status(400).json({ error: 'Nothing to import' });
  if (items.length > 20000) return res.status(400).json({ error: 'That import is too large (over 20,000 shapes)' });

  const rows = [];
  for (const raw of items) {
    const { row, error } = readStroke({ kind: 'survey', ...raw });
    if (error) continue; // skip an unusable shape rather than failing the file
    rows.push(row);
  }
  if (!rows.length) return res.status(400).json({ error: 'No usable geometry in that file' });

  const stmt = insert();
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      stmt.run(project.id, row.env, row.level, row.kind, row.color, row.width, row.points, row.src_layer, row.src_name, row.note_text);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: `Import failed, nothing was added: ${err.message}` });
  }
  const created = db
    .prepare('SELECT * FROM markups WHERE project_id = ? ORDER BY id DESC LIMIT ?')
    .all(project.id, rows.length);
  res.status(201).json({ imported: rows.length, skipped: items.length - rows.length, markups: created.reverse() });
});

// DELETE /api/projects/:id/markups/source — remove one whole import by name.
router.post('/projects/:id/markups/remove-source', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const name = String(req.body?.src_name ?? '');
  if (!name) return res.status(400).json({ error: 'A source name is required' });
  const rows = db.prepare('SELECT * FROM markups WHERE project_id = ? AND src_name = ?').all(project.id, name);
  db.prepare('DELETE FROM markups WHERE project_id = ? AND src_name = ?').run(project.id, name);
  res.json({ markups: rows });
});

// DELETE /api/markups/:id — returns the removed row so an undo can restore it.
router.delete('/markups/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM markups WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Markup not found' });
  db.prepare('DELETE FROM markups WHERE id = ?').run(row.id);
  res.json(row);
});

// POST /api/projects/:id/markups/clear — wipe one scope (env + level).
// Returns the removed rows, so "Clear markup" is a single undoable step
// rather than a destructive action with no way back.
router.post('/projects/:id/markups/clear', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const env = oneOf(req.body?.env, VALID_ENVS, 'concept');
  const level = String(req.body?.level ?? '');
  const rows = db
    .prepare('SELECT * FROM markups WHERE project_id = ? AND env = ? AND level = ?')
    .all(project.id, env, level);
  db.prepare('DELETE FROM markups WHERE project_id = ? AND env = ? AND level = ?').run(project.id, env, level);
  res.json({ markups: rows });
});

// POST /api/projects/:id/markups/restore — hand back rows from a delete or a
// clear. Ids are preserved so an undo restores exactly what was there.
router.post('/projects/:id/markups/restore', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const rows = Array.isArray(req.body?.markups) ? req.body.markups : [];
  if (!rows.length) return res.json({ markups: [] });
  const withId = db.prepare(
    'INSERT OR IGNORE INTO markups (id, project_id, env, level, kind, color, width, points, src_layer, src_name, note_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const raw of rows) {
      const { row, error } = readStroke(raw);
      if (error) continue; // skip an unusable row rather than failing the batch
      withId.run(
        Number(raw.id) || null,
        project.id,
        row.env,
        row.level,
        row.kind,
        row.color,
        row.width,
        row.points,
        row.src_layer,
        row.src_name,
        row.note_text,
        raw.created_at ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: `Restore failed: ${err.message}` });
  }
  res.json({ markups: db.prepare('SELECT * FROM markups WHERE project_id = ?').all(project.id) });
});

// PUT /api/markups/:id — reposition a stroke (used by a drawing-scale change,
// which zooms every persisted layout about the viewport centre).
router.put('/markups/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM markups WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Markup not found' });
  const { row, error } = readStroke({ ...existing, ...req.body });
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE markups SET points = ?, width = ?, color = ?, note_text = ? WHERE id = ?')
    .run(row.points, row.width, row.color, row.note_text, existing.id);
  res.json(db.prepare('SELECT * FROM markups WHERE id = ?').get(existing.id));
});

export default router;
