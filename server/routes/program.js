// Programme extras: Brief revisions, Brief adjacency requirements, the change
// log, and design options. Kept in one router — they are all small.

import { Router } from 'express';
import { db } from '../db.js';
import { requireProject } from './projects.js';
import { saveBriefRevision, listBriefRevisions, getBriefRevision } from '../brief.js';
import { listChanges } from '../changelog.js';
import { saveOption, listOptions, loadOption, deleteOption } from '../options.js';

const router = Router();

// ---------- Brief revisions ----------

router.get('/projects/:id/brief-revisions', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  res.json(listBriefRevisions(project.id));
});

router.post('/projects/:id/brief-revisions', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const result = saveBriefRevision(project.id, { label: req.body.label, taken_at: req.body.taken_at });
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

router.get('/brief-revisions/:id', (req, res) => {
  const rev = getBriefRevision(Number(req.params.id));
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  res.json(rev);
});

router.delete('/brief-revisions/:id', (req, res) => {
  const r = db.prepare('DELETE FROM brief_revisions WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: 'Revision not found' });
  res.status(204).end();
});

// ---------- Brief adjacency requirements ----------

router.post('/projects/:id/brief-adjacencies', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const a = Number(req.body.a_id);
  const b = Number(req.body.b_id);
  if (!a || !b || a === b) return res.status(400).json({ error: 'Pick two different Brief rooms' });
  const inProject = db.prepare('SELECT project_id FROM brief_spaces WHERE id = ?');
  if (inProject.get(a)?.project_id !== project.id || inProject.get(b)?.project_id !== project.id) {
    return res.status(400).json({ error: 'Rooms must belong to this project’s Brief' });
  }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const strength = req.body.strength === 'desired' ? 'desired' : 'required';
  try {
    const r = db
      .prepare('INSERT INTO brief_adjacencies (project_id, a_id, b_id, strength) VALUES (?, ?, ?, ?)')
      .run(project.id, lo, hi, strength);
    res.status(201).json(db.prepare('SELECT * FROM brief_adjacencies WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'That requirement already exists' });
  }
});

router.delete('/brief-adjacencies/:id', (req, res) => {
  const r = db.prepare('DELETE FROM brief_adjacencies WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: 'Requirement not found' });
  res.status(204).end();
});

// ---------- Change log ----------

router.get('/projects/:id/changes', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  res.json(listChanges(project.id, req.query.limit));
});

// ---------- Design options ----------

router.get('/projects/:id/options', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  res.json(listOptions(project.id));
});

router.post('/projects/:id/options', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const result = saveOption(project.id, req.body.name);
  if (result?.error) return res.status(400).json(result);
  res.status(201).json(result);
});

// Load an option into the live design (path-reconciled; matched rooms keep
// their ids so milestone areas survive). Optional `saveCurrentAs` snapshots
// the current design as its own option first.
router.post('/projects/:id/options/:optionId/load', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  let savedCurrent = null;
  if (req.body.saveCurrentAs && String(req.body.saveCurrentAs).trim()) {
    savedCurrent = saveOption(project.id, String(req.body.saveCurrentAs).trim());
    if (savedCurrent?.error) return res.status(400).json(savedCurrent);
  }
  const result = loadOption(project.id, Number(req.params.optionId));
  if (result.error) return res.status(404).json(result);
  res.json({ ...result, savedCurrent });
});

router.delete('/options/:id', (req, res) => {
  if (!deleteOption(Number(req.params.id))) return res.status(404).json({ error: 'Option not found' });
  res.status(204).end();
});

export default router;
