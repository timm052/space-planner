import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Tests (and any embedding shell) can point the DB at an isolated directory.
const dataDir = process.env.BRIEFTRACK_DB_DIR || path.join(__dirname, '..', 'data');
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
// How a space relates to its children: 'group' = pure grouping container (sums
// children, no own area, default/legacy), 'within' = a real space whose children
// sit inside its own area (children excluded from totals), 'attached' = a real
// space whose children are separate areas that move with it on the diagram.
ensureColumn('spaces', 'child_mode', "child_mode TEXT DEFAULT 'group'");
ensureColumn('spaces', 'level', "level TEXT DEFAULT ''"); // building level / storey label

// Per-image diagrammatic filter preset (''|grayscale|blueprint|faded|contrast|ink).
ensureColumn('images', 'filter', "filter TEXT DEFAULT ''");

// Bubble rendering style: 'solid' (default) | 'outline' | 'sketch'.
ensureColumn('projects', 'bubble_style', "bubble_style TEXT DEFAULT 'solid'");

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
    .run('Greenfield Community Library', 'Town of Greenfield', 'Design Development', 'm2', 0.72, 0.05);
  const pid = proj.lastInsertRowid;
  // A standard 1:500 drawing scale (metres per diagram unit = ratio × 0.0002646).
  db.prepare('UPDATE projects SET display_scale = ? WHERE id = ?').run(500 * 0.0002646, pid);

  const insertSpace = db.prepare(
    `INSERT INTO spaces (project_id, department, name, count, target_area, sort_order, parent_id, kind, level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let order = 0;
  const addSpace = (department, name, count, area, parentId, kind, level) =>
    Number(insertSpace.run(pid, department, name, count, area, order++, parentId, kind, level).lastInsertRowid);

  // Two buildings, so the brief hierarchy and the diagram's building rollups,
  // hulls and Areas "by building / level" mode all have something to show.
  const mainId = addSpace('Building', 'Main Library', 1, 0, null, 'building', '');
  const pavilionId = addSpace('Building', 'Community Pavilion', 1, 0, null, 'building', '');

  // [department, name, count, targetEach, building, level]
  const brief = [
    ['Public', 'Entrance & Foyer', 1, 110, mainId, 'Ground Floor'],
    ['Public', 'Welcome / Returns Desk', 1, 35, mainId, 'Ground Floor'],
    ['Public', "Children's Library", 1, 200, mainId, 'Ground Floor'],
    ['Public', 'Teen Zone', 1, 85, mainId, 'Ground Floor'],
    ['Public', 'Café', 1, 75, mainId, 'Ground Floor'],
    ['Staff', 'Open Office', 1, 90, mainId, 'Ground Floor'],
    ['Staff', 'Workroom / Sorting', 1, 65, mainId, 'Ground Floor'],
    ['Staff', 'Staff Lounge', 1, 38, mainId, 'Ground Floor'],
    ['Support', 'Book Storage', 1, 80, mainId, 'Ground Floor'],
    ['Support', 'IT / Server', 1, 18, mainId, 'Ground Floor'],
    ['Support', 'Loading & Receiving', 1, 42, mainId, 'Ground Floor'],
    ['Public', 'Adult Collection', 1, 380, mainId, 'First Floor'],
    ['Public', 'Quiet Reading Room', 1, 140, mainId, 'First Floor'],
    ['Community', 'Multipurpose Hall', 1, 180, pavilionId, 'Ground Floor'],
    ['Community', 'Meeting Rooms', 3, 28, pavilionId, 'Ground Floor'],
    ['Community', 'Maker Space', 1, 100, pavilionId, 'Ground Floor'],
  ];
  const spaceIds = brief.map(([dept, name, cnt, area, parentId, level]) =>
    addSpace(dept, name, cnt, area, parentId, 'space', level)
  );

  // Adjacencies for the bubble diagram (indices into `brief`). A satisfiable
  // graph — no room carries more than two required links — so a settled layout
  // can score well.
  const insertAdj = db.prepare(
    `INSERT INTO adjacencies (project_id, space_a, space_b, strength) VALUES (?, ?, ?, ?)`
  );
  const adjacencies = [
    [0, 1, 'required'], // Foyer — Welcome Desk
    [0, 2, 'required'], // Foyer — Children's Library
    [5, 6, 'required'], // Open Office — Workroom
    [6, 8, 'required'], // Workroom — Book Storage
    [8, 10, 'required'], // Book Storage — Loading
    [11, 12, 'required'], // Adult Collection — Quiet Reading
    [0, 4, 'desired'], // Foyer — Café
    [0, 11, 'desired'], // Foyer — Adult Collection (upstairs)
    [0, 13, 'desired'], // Foyer — Multipurpose Hall (pavilion)
    [2, 3, 'desired'], // Children's — Teen Zone
    [3, 15, 'desired'], // Teen Zone — Maker Space
    [13, 14, 'desired'], // Multipurpose — Meeting Rooms
    [13, 15, 'desired'], // Multipurpose — Maker Space
    [13, 4, 'desired'], // Multipurpose — Café
    [5, 7, 'desired'], // Open Office — Staff Lounge
    [9, 5, 'desired'], // IT / Server — Open Office
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

  // Three milestones showing typical drift: concept generous, SD trimmed, DD
  // with a few spaces drifting outside tolerance. Areas align to `brief` order.
  const milestones = [
    {
      label: 'Concept Design',
      taken_at: '2026-02-12',
      gross: 2480,
      areas: [116, 36, 208, 88, 78, 93, 67, 39, 83, 19, 44, 392, 146, 186, 86, 104],
    },
    {
      label: 'Schematic Design',
      taken_at: '2026-04-08',
      gross: 2410,
      areas: [112, 35, 201, 84, 75, 90, 65, 38, 80, 18, 42, 378, 140, 181, 84, 100],
    },
    {
      label: 'Design Development',
      taken_at: '2026-06-05',
      gross: 2440,
      areas: [108, 34, 196, 80, 72, 88, 63, 36, 78, 19, 46, 372, 150, 178, 82, 96],
    },
  ];

  for (const m of milestones) {
    const s = insertSnap.run(pid, m.label, m.taken_at, m.gross, '');
    const sid = Number(s.lastInsertRowid);
    m.areas.forEach((a, i) => insertArea.run(sid, spaceIds[i], a));
  }
}
