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
    inst_a INTEGER NOT NULL DEFAULT 0,
    inst_b INTEGER NOT NULL DEFAULT 0,
    strength TEXT DEFAULT 'desired',
    UNIQUE (space_a, space_b, inst_a, inst_b)
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
ensureColumn('projects', 'north_locked', 'north_locked INTEGER DEFAULT 0'); // 1 = north frozen (rose + sat sync inert)
ensureColumn('projects', 'category_colors', 'category_colors TEXT'); // JSON map: category/building label → custom colour
ensureColumn('projects', 'images_migrated', 'images_migrated INTEGER DEFAULT 0'); // legacy bg_/sat_ → images rows done

// Which way round a room's area and its outline are related.
//
// 1 (the default, and how the app has always behaved): the typed area is the
// truth and the outline only supplies proportion — dragging a corner reshapes
// the footprint and the enclosed area is held constant.
//
// 0: the DRAWING is the truth. Dragging a corner changes what the footprint
// encloses, and the schedule figure follows it. That is how a plan is actually
// developed once it stops being a bubble diagram, and until now there was no
// way to say it: no figure on a sheet could be traced back to the geometry it
// sat on.
ensureColumn('spaces', 'area_locked', 'area_locked INTEGER DEFAULT 1');

// Title-block fields. A sheet that leaves the office is identified by more than
// its project name: BS EN ISO 7200 makes the identification number, the
// revision index, the date of issue and the people who created and approved it
// mandatory data fields. The export carried none of them, so every print was
// unreferenced and every reissue looked identical to the last.
ensureColumn('projects', 'drawing_number', "drawing_number TEXT DEFAULT ''");
ensureColumn('projects', 'revision', "revision TEXT DEFAULT ''");
ensureColumn('projects', 'drawn_by', "drawn_by TEXT DEFAULT ''");
ensureColumn('projects', 'checked_by', "checked_by TEXT DEFAULT ''");
// Free text, not an enum: office conventions differ (BS 1192 suitability codes
// S0–S7, "PRELIMINARY", "FOR CONSTRUCTION"), and guessing wrong is worse than
// letting the user type theirs.
ensureColumn('projects', 'issue_status', "issue_status TEXT DEFAULT ''");
// The date the current revision was issued. Blank means the sheet is dated the
// day it is printed, which is the old behaviour.
ensureColumn('projects', 'issue_date', "issue_date TEXT DEFAULT ''");

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
ensureColumn('spaces', 'shape', "shape TEXT DEFAULT 'bubble'"); // 'bubble' | 'box' | 'poly'
ensureColumn('spaces', 'shape_json', 'shape_json TEXT'); // freeform polygon: normalized verts [{x,y},…]
// Master-plan placement, independent of the concept pin_json: per-instance
// {"0":{x,y,rot,a},…}. Presence = "placed on the site". See ARCHITECTURE §4.
ensureColumn('spaces', 'plan_json', 'plan_json TEXT');
// Building placement, independent of concept/master-plan: per-instance
// {"0":{x,y,w,h,rot},…} (level stays in spaces.level). See ARCHITECTURE §4.
ensureColumn('spaces', 'block_json', 'block_json TEXT');
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

// Diagram environment: which geometry-specific workspace is active.
// 'concept' (bubbles + relationships) | 'masterplan' (scaled site) | 'building'
// (massing/floors). See ARCHITECTURE §4 "Per-environment layouts".
ensureColumn('projects', 'diagram_env', "diagram_env TEXT DEFAULT 'concept'");

// Storey heights: JSON map { "<level label>": metres } (absent level → the
// 3.5 m default). Per-space height_m optionally overrides its storey's clear
// height (high ceilings / multi-floor volumes); null = inherit the floor's.
ensureColumn('projects', 'level_heights', 'level_heights TEXT');
ensureColumn('spaces', 'height_m', 'height_m REAL');
// Circulation share of a BUILDING's gross footprint (0..0.6), stored on the
// container row. null = project default (1 − grossing_target); 0 = off.
ensureColumn('spaces', 'circ_pct', 'circ_pct REAL');

// Instance-level adjacencies: a relationship targets a SPECIFIC instance of
// each space (inst 0 = the first/only room; count=1 spaces are always 0). Old
// DBs had UNIQUE(space_a, space_b) — one link per space pair — which can't hold
// the multiple instance-pair links a count>1 space needs, so rebuild the table
// with the wider key. Existing rows migrate to inst 0-0.
function migrateAdjacencies() {
  const cols = db.prepare('PRAGMA table_info(adjacencies)').all();
  if (cols.some((c) => c.name === 'inst_a')) return; // already the new schema
  db.exec(`
    CREATE TABLE adjacencies_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      space_a INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      space_b INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      inst_a INTEGER NOT NULL DEFAULT 0,
      inst_b INTEGER NOT NULL DEFAULT 0,
      strength TEXT DEFAULT 'desired',
      UNIQUE (space_a, space_b, inst_a, inst_b)
    );
    INSERT INTO adjacencies_new (id, project_id, space_a, space_b, inst_a, inst_b, strength)
      SELECT id, project_id, space_a, space_b, 0, 0, strength FROM adjacencies;
    DROP TABLE adjacencies;
    ALTER TABLE adjacencies_new RENAME TO adjacencies;
  `);
}
migrateAdjacencies();

// Brief formulas (both room trees) and the independent Brief tree.
// {spaces,brief_spaces}.area_formula: when set, target_area is DERIVED from this
//   expression (resolved server-side into target_area; see server/brief.js).
// projects.variables: JSON map { name: number } referenced by formulas as @name.
ensureColumn('spaces', 'area_formula', 'area_formula TEXT');
ensureColumn('projects', 'variables', 'variables TEXT');
ensureColumn('snapshots', 'kind', "kind TEXT DEFAULT 'milestone'");

// brief_spaces — the INDEPENDENT agreed programme (the "Brief" tab), a separate
// room tree from the diagram's `spaces` (the "Design" tab). It carries only
// programme fields (no diagram geometry): areas may be formula-driven, and the
// tree can be reconciled onto the diagram or snapshotted as a milestone.
db.exec(`
  CREATE TABLE IF NOT EXISTS brief_spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id INTEGER,
    kind TEXT DEFAULT 'space',
    department TEXT DEFAULT 'General',
    name TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    target_area REAL NOT NULL DEFAULT 0,
    area_formula TEXT,
    child_mode TEXT DEFAULT 'group',
    level TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    image TEXT,
    sort_order INTEGER DEFAULT 0
  );
`);

// Circulation / grossing allowance: fraction of net added to estimate gross
// (e.g. 0.35 → gross ≈ net × 1.35). Null = no estimate.
ensureColumn('projects', 'circulation', 'circulation REAL');
// Per-project benchmark library override (JSON [{type, items:[{label,m2,per,v}]}]);
// null = the app-settings library, which itself falls back to the built-ins.
ensureColumn('projects', 'benchmarks', 'benchmarks TEXT');

// Brief revisions — dated, immutable copies of the whole Brief tree (Rev A/B/C
// as the brief gets renegotiated). `data` is the serialized brief_spaces rows.
db.exec(`
  CREATE TABLE IF NOT EXISTS brief_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    taken_at TEXT NOT NULL,
    room_count INTEGER DEFAULT 0,
    net REAL DEFAULT 0,
    data TEXT NOT NULL
  );
`);

// Brief adjacency REQUIREMENTS ("Kitchen must adjoin Servery") — declared on
// Brief rooms, scored against the diagram's actual adjacency links by path.
db.exec(`
  CREATE TABLE IF NOT EXISTS brief_adjacencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    a_id INTEGER NOT NULL REFERENCES brief_spaces(id) ON DELETE CASCADE,
    b_id INTEGER NOT NULL REFERENCES brief_spaces(id) ON DELETE CASCADE,
    strength TEXT DEFAULT 'required',
    UNIQUE (a_id, b_id)
  );
`);

// Change log — a lightweight audit trail of programme edits ("when did the
// Foyer grow?"). Only programme fields are logged, never geometry.
db.exec(`
  CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    at TEXT DEFAULT (datetime('now')),
    tree TEXT NOT NULL,
    name TEXT NOT NULL,
    field TEXT NOT NULL,
    old TEXT,
    new TEXT
  );
`);

// Redline markup — freehand ink drawn OVER the drawing. Deliberately its own
// table and NOT part of spaces: markup never contributes to an area, a total
// or a compliance figure, and nothing that reads the programme should be able
// to reach it by accident.
//
// Scoped per environment and per storey, because a note about the ground floor
// has no business showing over the first. `points` is JSON [[x,y],…] in DIAGRAM
// UNITS (see src/markup.js), so ink stays on what it was drawn over through
// pan, zoom and a drawing-scale change.
//
// Markup is NOT captured by design options: a redline is a comment on the
// project, not part of a scheme, so it must not vanish when you switch A → B.
db.exec(`
  CREATE TABLE IF NOT EXISTS markups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    env TEXT NOT NULL DEFAULT 'concept',
    level TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'ink',
    color TEXT NOT NULL DEFAULT '#e5484d',
    width REAL NOT NULL DEFAULT 5,
    points TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS markups_scope ON markups (project_id, env, level);
`);

// Imported vector underlays ride in the same table as redlines: both are
// reference over the drawing that never touches an area or a total, and they
// therefore want identical rendering, scoping, undo and export. `src_layer`
// keeps the source drawing's layer name so an import can be shown, hidden or
// removed a layer at a time; `src_name` groups a single import together.
ensureColumn('markups', 'src_layer', 'src_layer TEXT');
ensureColumn('markups', 'src_name', 'src_name TEXT');

// Sheet notes ride in the same table again (kind 'note'): a note is markup by
// every rule that matters — it never touches an area, it is scoped to an
// environment and storey, it undoes and exports with the ink. `points` holds
// [[textX, textY]] for a plain note, or [[textX, textY], [targetX, targetY]]
// when the note has a leader pointing at something. `width` is the TEXT HEIGHT
// in diagram units, so a note keeps its paper size through a scale change for
// the same reason a pen stroke keeps its weight.
ensureColumn('markups', 'note_text', 'note_text TEXT');

// Design options — named saves of the whole design (spaces + adjacencies) so
// Option A/B schemes can be compared against one Brief and swapped in.
db.exec(`
  CREATE TABLE IF NOT EXISTS design_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    room_count INTEGER DEFAULT 0,
    net REAL DEFAULT 0,
    data TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
  default_units: 'm2',
  default_tolerance: '5',
  default_grossing: '70',
  default_circulation: '', // % circulation allowance for new projects; '' = unset
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
