// Converting a project between m² and ft².
//
// Areas are stored as bare numbers interpreted in the project's units, and that
// model is CORRECT while the units hold still: a ft² project stores 4,359,
// displays "4,359 ft²", and the scale math converts it to 405 m² for geometry.
// The defect was only ever the switch, which changed the label and left every
// number alone — so 405 m² became "405 ft²", wrong by a factor of 10.76.
//
// So this converts rather than relabels, everywhere an area is persisted:
// both room trees, milestone areas and gross figures, and the areas frozen
// inside Brief revisions and design options.
//
// It deliberately REFUSES a project whose areas are formula-driven or which
// defines variables. A formula's literals are unit-bearing — `=@students * 0.45`
// means 0.45 m² per student, and `@site_area = 40232` is an area — but nothing
// records which numbers are areas and which are counts or ratios. Rescaling
// them by guess would corrupt the programme quietly, which is the failure mode
// this whole change exists to remove. Better to say no and say why.

import { db } from './db.js';

export const M2_PER_FT2 = 0.09290304;

/** Round to 3 dp — enough that a round-trip returns the original figure. */
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Factor to multiply a stored area by when moving `from` → `to`. */
export function areaFactor(from, to) {
  if (from === to) return 1;
  return to === 'ft2' ? 1 / M2_PER_FT2 : M2_PER_FT2;
}

/**
 * Why this project cannot be converted, or null when it can.
 * @returns {string|null}
 */
export function blockingReason(projectId) {
  const p = db.prepare('SELECT variables FROM projects WHERE id = ?').get(projectId);
  if (!p) return 'Project not found';
  let vars = {};
  try {
    vars = JSON.parse(p.variables || '{}') || {};
  } catch {
    vars = {};
  }
  if (Object.keys(vars).length > 0) {
    return 'This project defines variables, and there is no way to tell which of them are areas — converting would silently rescale the wrong numbers. Remove the variables first, or set the units on a new project.';
  }
  const withFormula = ['spaces', 'brief_spaces'].reduce(
    (n, t) => n + db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE project_id = ? AND area_formula IS NOT NULL AND TRIM(area_formula) <> ''`).get(projectId).n,
    0
  );
  if (withFormula > 0) {
    return `${withFormula} room${withFormula === 1 ? '' : 's'} take their area from a formula whose numbers are written in the current units — converting would leave the formula saying one thing and the area another. Replace those formulas with figures first.`;
  }
  return null;
}

/**
 * Convert every persisted area on a project. Caller has already checked
 * blockingReason(). Returns a per-table count of the rows it touched.
 */
export function convertProjectAreas(projectId, from, to) {
  const f = areaFactor(from, to);
  if (f === 1) return { spaces: 0, brief_spaces: 0, snapshot_areas: 0, snapshots: 0, brief_revisions: 0, design_options: 0 };
  const counted = {};

  db.exec('BEGIN');
  try {
    for (const table of ['spaces', 'brief_spaces']) {
      const rows = db.prepare(`SELECT id, target_area FROM ${table} WHERE project_id = ?`).all(projectId);
      const upd = db.prepare(`UPDATE ${table} SET target_area = ? WHERE id = ?`);
      for (const row of rows) upd.run(r3((row.target_area || 0) * f), row.id);
      counted[table] = rows.length;
    }

    const areas = db
      .prepare('SELECT sa.id, sa.area FROM snapshot_areas sa JOIN snapshots s ON s.id = sa.snapshot_id WHERE s.project_id = ?')
      .all(projectId);
    const updArea = db.prepare('UPDATE snapshot_areas SET area = ? WHERE id = ?');
    for (const a of areas) updArea.run(r3((a.area || 0) * f), a.id);
    counted.snapshot_areas = areas.length;

    const snaps = db.prepare('SELECT id, gross_area FROM snapshots WHERE project_id = ?').all(projectId);
    const updSnap = db.prepare('UPDATE snapshots SET gross_area = ? WHERE id = ?');
    for (const s of snaps) updSnap.run(r3((s.gross_area || 0) * f), s.id);
    counted.snapshots = snaps.length;

    // Areas frozen inside JSON payloads. A revision or option that kept its old
    // figures would read as a huge drift the moment it was compared.
    const revs = db.prepare('SELECT id, net, data FROM brief_revisions WHERE project_id = ?').all(projectId);
    const updRev = db.prepare('UPDATE brief_revisions SET net = ?, data = ? WHERE id = ?');
    for (const rev of revs) {
      const rows = JSON.parse(rev.data);
      for (const row of rows) row.target_area = r3((row.target_area || 0) * f);
      updRev.run(r3((rev.net || 0) * f), JSON.stringify(rows), rev.id);
    }
    counted.brief_revisions = revs.length;

    const opts = db.prepare('SELECT id, net, data FROM design_options WHERE project_id = ?').all(projectId);
    const updOpt = db.prepare('UPDATE design_options SET net = ?, data = ? WHERE id = ?');
    for (const opt of opts) {
      const payload = JSON.parse(opt.data);
      for (const s of payload.spaces || []) s.target_area = r3((s.target_area || 0) * f);
      // The option's own parameter snapshot has to follow, or loading it would
      // put the project back into the units it just left.
      if (payload.params) payload.params.units = to;
      updOpt.run(r3((opt.net || 0) * f), JSON.stringify(payload), opt.id);
    }
    counted.design_options = opts.length;

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return counted;
}
