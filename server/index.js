import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, seedIfEmpty } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '25mb' })); // background images arrive as data URLs

seedIfEmpty();

const getProject = db.prepare('SELECT * FROM projects WHERE id = ?');

function requireProject(req, res) {
  const project = getProject.get(Number(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return project;
}

// ---------- Projects ----------

app.get('/api/projects', (req, res) => {
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

app.post('/api/projects', (req, res) => {
  const { name, client = '', stage = 'Concept', units = 'm2', grossing_target = 0.7, tolerance = 0.05 } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required' });
  const r = db
    .prepare(
      'INSERT INTO projects (name, client, stage, units, grossing_target, tolerance) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(name.trim(), client, stage, units, grossing_target, tolerance);
  res.status(201).json(getProject.get(r.lastInsertRowid));
});

const PROJECT_FIELDS = [
  'name', 'client', 'stage', 'units', 'grossing_target', 'tolerance',
  'sim_enabled', 'bg_image', 'bg_opacity', 'bg_scale', 'bg_attribution', 'display_scale',
  'bubble_opacity', 'view_x', 'view_y',
  'bg_mpp', 'bg_visible', 'bg_x', 'bg_y',
  'sat_image', 'sat_mpp', 'sat_opacity', 'sat_attribution', 'sat_visible', 'sat_x', 'sat_y',
  'north_deg', 'bg_rot', 'sat_rot', 'category_colors', 'bubble_style',
];

app.put('/api/projects/:id', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const updates = {};
  for (const f of PROJECT_FIELDS) if (f in req.body) updates[f] = req.body[f];
  if (Object.keys(updates).length > 0) {
    const setSql = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
    db.prepare(`UPDATE projects SET ${setSql} WHERE id = ?`).run(...Object.values(updates), project.id);
  }
  res.json(getProject.get(project.id));
});

app.delete('/api/projects/:id', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  res.status(204).end();
});

// Full project detail: brief + snapshots with areas
app.get('/api/projects/:id', (req, res) => {
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
      for (const row of db
        .prepare('SELECT space_id, area FROM snapshot_areas WHERE snapshot_id = ?')
        .all(sn.id)) {
        areas[row.space_id] = row.area;
      }
      return { ...sn, areas };
    });
  const adjacencies = db
    .prepare('SELECT * FROM adjacencies WHERE project_id = ?')
    .all(project.id);
  const images = db
    .prepare('SELECT * FROM images WHERE project_id = ? ORDER BY sort_order, id')
    .all(project.id);
  res.json({ project, spaces, snapshots, adjacencies, images });
});

// ---------- Spaces (brief) ----------

// A container (kind building/group, or any space that has children) carries no
// area of its own — its area rolls up from descendants — so only leaf 'space'
// rows require a positive target area.
const CONTAINER_KINDS = new Set(['building', 'group']);

// Validate that parent (if any) belongs to this project and isn't the space itself
// or one of its descendants (which would create a cycle).
function parentOk(projectId, parentId, selfId) {
  if (parentId == null) return true;
  const get = db.prepare('SELECT id, project_id, parent_id FROM spaces WHERE id = ?');
  const parent = get.get(parentId);
  if (!parent || parent.project_id !== projectId) return false;
  if (selfId == null) return true;
  // Walk the ancestor chain of the proposed parent; if we meet ourselves it's a cycle.
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

app.post('/api/projects/:id/spaces', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const { department = 'General', name, count = 1, target_area, notes = '', kind = 'space', level = '' } = req.body;
  const child_mode = ['group', 'within', 'attached'].includes(req.body.child_mode) ? req.body.child_mode : 'group';
  const parent_id = req.body.parent_id != null ? Number(req.body.parent_id) : null;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Space name is required' });
  const isContainer = CONTAINER_KINDS.has(kind);
  if (!isContainer && !(Number(target_area) > 0)) {
    return res.status(400).json({ error: 'Target area must be positive' });
  }
  if (!parentOk(project.id, parent_id, null)) {
    return res.status(400).json({ error: 'Invalid parent' });
  }
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM spaces WHERE project_id = ?')
    .get(project.id).m;
  const r = db
    .prepare(
      `INSERT INTO spaces (project_id, department, name, count, target_area, notes, sort_order, parent_id, kind, child_mode, level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      project.id, department, name.trim(), Number(count) || 1,
      isContainer ? 0 : Number(target_area), notes, max + 1, parent_id, kind, child_mode, level
    );
  res.status(201).json(db.prepare('SELECT * FROM spaces WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/spaces/:id', (req, res) => {
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(Number(req.params.id));
  if (!space) return res.status(404).json({ error: 'Space not found' });
  const { department = space.department, name = space.name, count = space.count, target_area = space.target_area, notes = space.notes, kind = space.kind, shape = space.shape, child_mode = space.child_mode, level = space.level } = req.body;
  const parent_id = 'parent_id' in req.body ? (req.body.parent_id != null ? Number(req.body.parent_id) : null) : space.parent_id;
  if (!parentOk(space.project_id, parent_id, space.id)) {
    return res.status(400).json({ error: 'Invalid parent (would create a cycle)' });
  }
  // Pin fields are settable to null (unpin), so check key presence rather than defaulting.
  const pin_x = 'pin_x' in req.body ? req.body.pin_x : space.pin_x;
  const pin_y = 'pin_y' in req.body ? req.body.pin_y : space.pin_y;
  let pin_json = 'pin_json' in req.body ? req.body.pin_json : space.pin_json;
  if (pin_json != null && typeof pin_json !== 'string') pin_json = JSON.stringify(pin_json);
  // image and sort_order are settable (image to null clears it), so check key presence.
  const image = 'image' in req.body ? req.body.image : space.image;
  const sort_order = 'sort_order' in req.body ? Number(req.body.sort_order) : space.sort_order;
  const area = CONTAINER_KINDS.has(kind) ? 0 : Number(target_area);
  const childMode = ['group', 'within', 'attached'].includes(child_mode) ? child_mode : 'group';
  db.prepare(
    'UPDATE spaces SET department = ?, name = ?, count = ?, target_area = ?, notes = ?, pin_x = ?, pin_y = ?, pin_json = ?, parent_id = ?, kind = ?, shape = ?, image = ?, sort_order = ?, child_mode = ?, level = ? WHERE id = ?'
  ).run(department, name, Number(count) || 1, area, notes, pin_x, pin_y, pin_json, parent_id, kind, shape === 'box' ? 'box' : 'bubble', image, sort_order, childMode, level ?? '', space.id);
  res.json(db.prepare('SELECT * FROM spaces WHERE id = ?').get(space.id));
});

app.delete('/api/spaces/:id', (req, res) => {
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM spaces WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Space not found' });
  // Delete the whole subtree (no self-referential FK cascade on parent_id).
  const ids = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT ? UNION
         SELECT s.id FROM spaces s JOIN tree t ON s.parent_id = t.id
       ) SELECT id FROM tree`
    )
    .all(id)
    .map((r) => r.id);
  const del = db.prepare('DELETE FROM spaces WHERE id = ?');
  for (const sid of ids) del.run(sid);
  res.status(204).end();
});

// ---------- Adjacencies ----------

app.post('/api/projects/:id/adjacencies', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  let { space_a, space_b, strength = 'desired' } = req.body;
  space_a = Number(space_a);
  space_b = Number(space_b);
  if (!space_a || !space_b || space_a === space_b) {
    return res.status(400).json({ error: 'Two different spaces are required' });
  }
  const inProject = db.prepare('SELECT COUNT(*) AS n FROM spaces WHERE project_id = ? AND id IN (?, ?)');
  if (inProject.get(project.id, space_a, space_b).n !== 2) {
    return res.status(400).json({ error: 'Both spaces must belong to this project' });
  }
  if (!['required', 'desired'].includes(strength)) strength = 'desired';
  const [lo, hi] = space_a < space_b ? [space_a, space_b] : [space_b, space_a];
  const r = db
    .prepare(
      `INSERT INTO adjacencies (project_id, space_a, space_b, strength) VALUES (?, ?, ?, ?)
       ON CONFLICT (space_a, space_b) DO UPDATE SET strength = excluded.strength`
    )
    .run(project.id, lo, hi, strength);
  const row = db
    .prepare('SELECT * FROM adjacencies WHERE space_a = ? AND space_b = ?')
    .get(lo, hi);
  res.status(201).json(row);
});

app.put('/api/adjacencies/:id', (req, res) => {
  const adj = db.prepare('SELECT * FROM adjacencies WHERE id = ?').get(Number(req.params.id));
  if (!adj) return res.status(404).json({ error: 'Adjacency not found' });
  const strength = ['required', 'desired'].includes(req.body.strength) ? req.body.strength : adj.strength;
  db.prepare('UPDATE adjacencies SET strength = ? WHERE id = ?').run(strength, adj.id);
  res.json(db.prepare('SELECT * FROM adjacencies WHERE id = ?').get(adj.id));
});

app.delete('/api/adjacencies/:id', (req, res) => {
  const r = db.prepare('DELETE FROM adjacencies WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: 'Adjacency not found' });
  res.status(204).end();
});

// ---------- Snapshots ----------

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

function snapshotWithAreas(id) {
  const sn = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id);
  if (!sn) return null;
  const areas = {};
  for (const row of db
    .prepare('SELECT space_id, area FROM snapshot_areas WHERE snapshot_id = ?')
    .all(id)) {
    areas[row.space_id] = row.area;
  }
  return { ...sn, areas };
}

app.post('/api/projects/:id/snapshots', (req, res) => {
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

app.put('/api/snapshots/:id', (req, res) => {
  const sn = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(Number(req.params.id));
  if (!sn) return res.status(404).json({ error: 'Snapshot not found' });
  const { label = sn.label, taken_at = sn.taken_at, gross_area = sn.gross_area, notes = sn.notes, areas } = req.body;
  db.prepare('UPDATE snapshots SET label = ?, taken_at = ?, gross_area = ?, notes = ? WHERE id = ?').run(
    label, taken_at, Number(gross_area) || 0, notes, sn.id
  );
  if (areas) saveSnapshotAreas(sn.id, areas);
  res.json(snapshotWithAreas(sn.id));
});

app.delete('/api/snapshots/:id', (req, res) => {
  const r = db.prepare('DELETE FROM snapshots WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: 'Snapshot not found' });
  res.status(204).end();
});

// ---------- Image layers ----------

const IMAGE_FIELDS = ['kind', 'name', 'image', 'mpp', 'opacity', 'visible', 'x', 'y', 'rot', 'sort_order', 'attribution', 'filter'];

app.post('/api/projects/:id/images', (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const { kind = 'custom', name = '', image, mpp = null, opacity = 0.6, visible = 1, x = 0, y = 0, rot = 0, attribution = null } = req.body;
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

app.put('/api/images/:id', (req, res) => {
  const img = db.prepare('SELECT * FROM images WHERE id = ?').get(Number(req.params.id));
  if (!img) return res.status(404).json({ error: 'Image not found' });
  const updates = {};
  for (const f of IMAGE_FIELDS) if (f in req.body) updates[f] = f === 'visible' ? (req.body[f] ? 1 : 0) : req.body[f];
  if (Object.keys(updates).length > 0) {
    const setSql = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
    db.prepare(`UPDATE images SET ${setSql} WHERE id = ?`).run(...Object.values(updates), img.id);
  }
  res.json(db.prepare('SELECT * FROM images WHERE id = ?').get(img.id));
});

app.delete('/api/images/:id', (req, res) => {
  const r = db.prepare('DELETE FROM images WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: 'Image not found' });
  res.status(204).end();
});

// ---------- Settings ----------

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

app.put('/api/settings', (req, res) => {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(req.body || {})) {
    if (typeof k === 'string' && k.length < 100) upsert.run(k, String(v));
  }
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

// ---------- Geocoding & satellite tiles (server-side proxies) ----------

app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query is required' });
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'BriefTrack/1.0 (local architecture planning app)' } }
    );
    if (!r.ok) throw new Error(`Geocoder returned ${r.status}`);
    const results = await r.json();
    if (!results.length) return res.status(404).json({ error: `No location found for "${q}"` });
    const { lat, lon, display_name } = results[0];
    res.json({ lat: Number(lat), lon: Number(lon), display: display_name });
  } catch (err) {
    res.status(502).json({ error: `Geocoding failed: ${err.message}` });
  }
});

// Esri World Imagery tiles, proxied so the browser canvas stays same-origin (untainted).
app.get('/api/tile/:z/:x/:y', async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 20) {
    return res.status(400).json({ error: 'Invalid tile coordinates' });
  }
  try {
    const r = await fetch(
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    );
    if (!r.ok) return res.status(502).json({ error: `Tile fetch failed (${r.status})` });
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: `Tile fetch failed: ${err.message}` });
  }
});

// ---------- Static (production) ----------

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// In dev, Vite owns PORT (the launcher may inject it); the API listens on its own port.
const PORT =
  process.env.API_PORT ||
  (process.env.NODE_ENV === 'production' && process.env.PORT) ||
  3001;
app.listen(PORT, () => {
  console.log(`BriefTrack API listening on http://localhost:${PORT}`);
});
