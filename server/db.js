import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'brieftrack.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client TEXT DEFAULT '',
    stage TEXT DEFAULT 'Concept',
    units TEXT DEFAULT 'm2',
    grossing_target REAL DEFAULT 0.70,
    tolerance REAL DEFAULT 0.05,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    department TEXT DEFAULT 'General',
    name TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    target_area REAL NOT NULL,
    notes TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    taken_at TEXT NOT NULL,
    gross_area REAL DEFAULT 0,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS adjacencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    space_a INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    space_b INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    strength TEXT DEFAULT 'desired',
    UNIQUE (space_a, space_b)
  );

  CREATE TABLE IF NOT EXISTS snapshot_areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    area REAL NOT NULL,
    UNIQUE (snapshot_id, space_id)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Background image layers (multiple per project). Each is calibrated on its
  -- own via mpp (metres per natural pixel) and shares the diagram scale.
  CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT DEFAULT 'custom',        -- 'custom' | 'satellite'
    name TEXT DEFAULT '',
    image TEXT NOT NULL,               -- data URL
    mpp REAL,                          -- metres per natural pixel (null until calibrated)
    opacity REAL DEFAULT 0.6,
    visible INTEGER DEFAULT 1,
    x REAL DEFAULT 0,
    y REAL DEFAULT 0,
    rot REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    attribution TEXT
  );
`);

// Additive migrations for databases created before these columns existed.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('projects', 'sim_enabled', 'sim_enabled INTEGER DEFAULT 1');
ensureColumn('projects', 'bg_image', 'bg_image TEXT');
ensureColumn('projects', 'bg_opacity', 'bg_opacity REAL DEFAULT 0.5');
ensureColumn('projects', 'bg_scale', 'bg_scale REAL'); // metres per diagram unit
ensureColumn('projects', 'bg_attribution', 'bg_attribution TEXT');
ensureColumn('projects', 'display_scale', 'display_scale REAL'); // metres per unit override (1:200 etc.)
ensureColumn('spaces', 'pin_x', 'pin_x REAL');
ensureColumn('spaces', 'pin_y', 'pin_y REAL');
ensureColumn('spaces', 'pin_json', 'pin_json TEXT'); // per-instance pins: {"0":{x,y},...}
ensureColumn('projects', 'bubble_opacity', 'bubble_opacity REAL DEFAULT 0.32');
ensureColumn('projects', 'view_x', 'view_x REAL DEFAULT 0');
ensureColumn('projects', 'view_y', 'view_y REAL DEFAULT 0');

// Two independent background image layers, each calibrated on its own.
// mpp = metres per natural image pixel; x/y = centre offset in diagram units.
// Custom layer reuses the legacy bg_* columns; satellite layer is new.
ensureColumn('projects', 'bg_mpp', 'bg_mpp REAL'); // custom image: metres per pixel
ensureColumn('projects', 'bg_visible', 'bg_visible INTEGER DEFAULT 1');
ensureColumn('projects', 'bg_x', 'bg_x REAL DEFAULT 0');
ensureColumn('projects', 'bg_y', 'bg_y REAL DEFAULT 0');
ensureColumn('projects', 'sat_image', 'sat_image TEXT');
ensureColumn('projects', 'sat_mpp', 'sat_mpp REAL');
ensureColumn('projects', 'sat_opacity', 'sat_opacity REAL DEFAULT 0.55');
ensureColumn('projects', 'sat_attribution', 'sat_attribution TEXT');
ensureColumn('projects', 'sat_visible', 'sat_visible INTEGER DEFAULT 1');
ensureColumn('projects', 'sat_x', 'sat_x REAL DEFAULT 0');
ensureColumn('projects', 'sat_y', 'sat_y REAL DEFAULT 0');
ensureColumn('projects', 'north_deg', 'north_deg REAL DEFAULT 0'); // project north, clockwise from up
ensureColumn('projects', 'category_colors', 'category_colors TEXT'); // JSON map: category/building label → custom colour
ensureColumn('projects', 'images_migrated', 'images_migrated INTEGER DEFAULT 0'); // legacy bg_/sat_ → images rows done

// One-time migration: fold the legacy single satellite + custom layers into the
// new multi-image `images` table so existing projects keep their backgrounds.
function migrateImages() {
  const projs = db.prepare('SELECT * FROM projects WHERE images_migrated = 0').all();
  if (projs.length === 0) return;
  const ins = db.prepare(
    `INSERT INTO images (project_id, kind, name, image, mpp, opacity, visible, x, y, rot, sort_order, attribution)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const done = db.prepare('UPDATE projects SET images_migrated = 1 WHERE id = ?');
  for (const p of projs) {
    let order = 0;
    if (p.sat_image) {
      ins.run(p.id, 'satellite', 'Satellite', p.sat_image, p.sat_mpp ?? null, p.sat_opacity ?? 0.55, p.sat_visible == null ? 1 : p.sat_visible, p.sat_x || 0, p.sat_y || 0, p.sat_rot || 0, order++, p.sat_attribution ?? null);
    }
    if (p.bg_image) {
      ins.run(p.id, 'custom', 'Imported image', p.bg_image, p.bg_mpp ?? null, p.bg_opacity ?? 0.5, p.bg_visible == null ? 1 : p.bg_visible, p.bg_x || 0, p.bg_y || 0, p.bg_rot || 0, order++, p.bg_attribution ?? null);
    }
    done.run(p.id);
  }
}
migrateImages();
ensureColumn('projects', 'bg_rot', 'bg_rot REAL DEFAULT 0'); // custom image rotation, degrees CW
ensureColumn('projects', 'sat_rot', 'sat_rot REAL DEFAULT 0'); // satellite rotation, degrees CW

// Hierarchy: a space may belong to a parent space; kind distinguishes containers.
ensureColumn('spaces', 'parent_id', 'parent_id INTEGER');
ensureColumn('spaces', 'kind', "kind TEXT DEFAULT 'space'"); // 'space' | 'building' | 'group'
ensureColumn('spaces', 'shape', "shape TEXT DEFAULT 'bubble'"); // 'bubble' | 'box'
ensureColumn('spaces', 'image', 'image TEXT'); // per-space reference image (data URL)

const DEFAULT_SETTINGS = {
  default_units: 'm2',
  default_tolerance: '5',
  default_grossing: '70',
};
{
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insert.run(k, v);
}

export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  if (count > 0) return;

  const proj = db
    .prepare(
      `INSERT INTO projects (name, client, stage, units, grossing_target, tolerance)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run('Riverside Community Library', 'City of Riverside', 'Design Development', 'm2', 0.72, 0.05);
  const pid = proj.lastInsertRowid;

  const insertSpace = db.prepare(
    `INSERT INTO spaces (project_id, department, name, count, target_area, sort_order, parent_id, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // One building containing the whole program, so hierarchy is demonstrable.
  const buildingId = Number(
    insertSpace.run(pid, 'Building', 'Main Library Building', 1, 0, 0, null, 'building').lastInsertRowid
  );

  const brief = [
    ['Public', 'Entrance Lobby & Foyer', 1, 120],
    ['Public', 'Adult Collection Hall', 1, 450],
    ['Public', "Children's Library", 1, 220],
    ['Public', 'Teen Zone', 1, 90],
    ['Public', 'Reading Room', 1, 160],
    ['Community', 'Multipurpose Hall', 1, 200],
    ['Community', 'Meeting Room', 3, 30],
    ['Community', 'Maker Space', 1, 110],
    ['Community', 'Café', 1, 80],
    ['Staff', 'Open Office', 1, 95],
    ['Staff', 'Workroom / Sorting', 1, 70],
    ['Staff', 'Staff Lounge', 1, 40],
    ['Support', 'Book Storage', 1, 85],
    ['Support', 'IT / Server Room', 1, 20],
    ['Support', 'Loading & Receiving', 1, 45],
  ];
  const spaceIds = brief.map(([dept, name, cnt, area], i) => {
    const r = insertSpace.run(pid, dept, name, cnt, area, i + 1, buildingId, 'space');
    return Number(r.lastInsertRowid);
  });

  // Adjacency relationships for the bubble diagram (indices into the brief above).
  const insertAdj = db.prepare(
    `INSERT INTO adjacencies (project_id, space_a, space_b, strength) VALUES (?, ?, ?, ?)`
  );
  const adjacencies = [
    [0, 1, 'required'], // Lobby — Adult Collection
    [0, 2, 'required'], // Lobby — Children's
    [0, 5, 'required'], // Lobby — Multipurpose Hall
    [0, 8, 'desired'], // Lobby — Café
    [1, 4, 'required'], // Adult Collection — Reading Room
    [1, 3, 'desired'], // Adult Collection — Teen Zone
    [2, 3, 'desired'], // Children's — Teen Zone
    [3, 7, 'desired'], // Teen Zone — Maker Space
    [5, 6, 'desired'], // Multipurpose — Meeting Rooms
    [5, 8, 'desired'], // Multipurpose — Café
    [9, 1, 'desired'], // Open Office — Adult Collection
    [9, 10, 'required'], // Open Office — Workroom
    [10, 12, 'required'], // Workroom — Book Storage
    [12, 14, 'required'], // Book Storage — Loading
    [13, 9, 'desired'], // IT — Open Office
  ];
  for (const [a, b, strength] of adjacencies) {
    const [lo, hi] = [spaceIds[a], spaceIds[b]].sort((x, y) => x - y);
    insertAdj.run(pid, lo, hi, strength);
  }

  const insertSnap = db.prepare(
    `INSERT INTO snapshots (project_id, label, taken_at, gross_area, notes) VALUES (?, ?, ?, ?, ?)`
  );
  const insertArea = db.prepare(
    `INSERT INTO snapshot_areas (snapshot_id, space_id, area) VALUES (?, ?, ?)`
  );

  // Three milestones showing typical drift: concept generous, SD trimmed, DD drifting over on circulation-heavy spaces.
  const milestones = [
    {
      label: 'Concept Design',
      taken_at: '2026-02-10',
      gross: 2580,
      areas: [128, 470, 235, 95, 170, 210, 96, 118, 86, 100, 72, 42, 88, 20, 48],
    },
    {
      label: 'Schematic Design',
      taken_at: '2026-04-02',
      gross: 2495,
      areas: [122, 455, 224, 88, 158, 202, 90, 112, 81, 96, 70, 39, 84, 19, 46],
    },
    {
      label: 'Design Development',
      taken_at: '2026-06-01',
      gross: 2540,
      areas: [115, 438, 216, 82, 148, 196, 84, 104, 78, 92, 68, 36, 80, 21, 44],
    },
  ];

  for (const m of milestones) {
    const s = insertSnap.run(pid, m.label, m.taken_at, m.gross, '');
    const sid = Number(s.lastInsertRowid);
    m.areas.forEach((a, i) => insertArea.run(sid, spaceIds[i], a));
  }
}
