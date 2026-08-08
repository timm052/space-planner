// DXF export — the drawing as vectors, in real-world metres.
//
// Until now the only outputs were PNG, PDF and a CSV of the schedule, so
// whatever was drawn here had to be re-drawn by hand downstream. That is the
// single largest tax the tool imposes on a real project: consultants, the next
// stage and the authority all want geometry, and a raster of a plan is not
// geometry.
//
// Deliberately R12 ASCII. It is the most widely readable DXF there is — every
// CAD package, QGIS and Rhino open it without negotiation — and it needs no
// object handles, no class table and no binary encoding, so the whole writer is
// a few hundred lines with nothing to get subtly wrong. Later revisions buy
// features (splines, true colour, xdata) that a footprint export does not need.
//
// Units: the scene arrives in DIAGRAM UNITS; everything here is written in
// METRES (`$INSUNITS` 6), because a CAD file with no real scale is as useless
// as a raster. Y is negated: SVG counts downward, CAD counts up.

/** Layer table — names follow the "discipline-object" habit CAD users expect. */
const LAYERS = [
  ['SITE-ENVELOPE', 5], // building envelopes — blue
  ['SITE-ROOM', 3], // room footprints / interior cells — green
  ['ANNO-NAME', 7], // room and building names — white/black
  ['ANNO-AREA', 8], // area figures — grey
  ['ANNO-LINK', 4], // adjacency relationships — cyan
  ['ANNO-MARKUP', 1], // redlines — red
  ['ANNO-SHEET', 2], // title, scale note — yellow
];

/**
 * Build the DXF text for a sheet scene.
 *
 * @param {object} scene   From BubbleTab's buildSheetScene (diagram units).
 * @param {object} opts
 * @param {number} opts.effScale  Metres per diagram unit. Required — without a
 *                                drawing scale there is no real length to write.
 * @param {string} opts.title     Project / sheet name for the header comment.
 * @returns {string} DXF file contents.
 */
export function buildDxf(scene, { effScale, title = 'BriefTrack export' } = {}) {
  if (!scene) return null;
  if (!(effScale > 0)) return null; // an unscaled sheet cannot be exported as CAD

  const out = [];
  const g = (code, value) => { out.push(String(code), String(value)); };
  // Diagram units → metres, with CAD's upward Y.
  const X = (u) => +(u * effScale).toFixed(4);
  const Y = (u) => +(-u * effScale).toFixed(4);

  const b = scene.bounds || { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  // ── HEADER ──────────────────────────────────────────────────────────────
  g(999, `${title} — exported from BriefTrack`);
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009'); // R12
  g(9, '$INSUNITS'); g(70, 6); // metres
  g(9, '$EXTMIN'); g(10, X(b.minX)); g(20, Y(b.maxY)); g(30, 0);
  g(9, '$EXTMAX'); g(10, X(b.maxX)); g(20, Y(b.minY)); g(30, 0);
  g(0, 'ENDSEC');

  // ── TABLES ──────────────────────────────────────────────────────────────
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length);
  for (const [name, colour] of LAYERS) {
    g(0, 'LAYER'); g(2, name); g(70, 0); g(62, colour); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');

  // ── ENTITIES ────────────────────────────────────────────────────────────
  g(0, 'SECTION'); g(2, 'ENTITIES');

  /** Closed polyline from scene-space points. */
  const poly = (layer, pts, closed = true) => {
    if (!pts || pts.length < 2) return;
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, closed ? 1 : 0);
    g(10, 0); g(20, 0); g(30, 0);
    for (const p of pts) {
      g(0, 'VERTEX'); g(8, layer); g(10, X(p.x)); g(20, Y(p.y)); g(30, 0);
    }
    g(0, 'SEQEND'); g(8, layer);
  };
  const circle = (layer, cx, cy, r) => {
    g(0, 'CIRCLE'); g(8, layer); g(10, X(cx)); g(20, Y(cy)); g(30, 0); g(40, +(r * effScale).toFixed(4));
  };
  const line = (layer, x1, y1, x2, y2) => {
    g(0, 'LINE'); g(8, layer); g(10, X(x1)); g(20, Y(y1)); g(30, 0); g(11, X(x2)); g(21, Y(y2)); g(31, 0);
  };
  const text = (layer, x, y, height, value, align = 1) => {
    const s = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (!s) return;
    g(0, 'TEXT'); g(8, layer); g(10, X(x)); g(20, Y(y)); g(30, 0);
    g(40, +height.toFixed(4)); g(1, s);
    if (align === 1) { g(72, 1); g(11, X(x)); g(21, Y(y)); g(31, 0); } // centred
  };

  // Footprints. A drawn outline exports as its real polygon; a bubble with no
  // outline exports as the circle it is, rather than being squared off into a
  // shape the designer never drew.
  for (const bub of scene.bubbles || []) {
    const layer = bub.isContainer ? 'SITE-ENVELOPE' : 'SITE-ROOM';
    if (bub.poly && bub.poly.length >= 3) poly(layer, bub.poly);
    else circle(layer, bub.x, bub.y, bub.r);
    // Label height scales with the footprint so text stays readable at the
    // scale it was drawn for, floored so a small room is not microscopic.
    const h = Math.max(0.6, Math.min(3, bub.r * effScale * 0.22));
    text('ANNO-NAME', bub.x, bub.y, h, bub.label);
    if (bub.sublabel) text('ANNO-AREA', bub.x, bub.y + bub.r * 0.28, h * 0.8, bub.sublabel);
  }

  // Interior sketch cells (master plan) — real room outlines inside envelopes.
  for (const c of scene.cells || []) {
    poly('SITE-ROOM', c.poly);
    const h = Math.max(0.5, Math.min(2.5, c.r * effScale * 0.22));
    text('ANNO-NAME', avg(c.poly, 'x'), avg(c.poly, 'y'), h, c.label);
    if (c.sublabel) text('ANNO-AREA', avg(c.poly, 'x'), avg(c.poly, 'y') + c.r * 0.3, h * 0.8, c.sublabel);
  }

  for (const l of scene.links || []) line('ANNO-LINK', l.x1, l.y1, l.x2, l.y2);

  // Redlines travel as open polylines on their own layer, so a recipient can
  // freeze them and still have the geometry underneath.
  for (const m of scene.markup || []) {
    poly('ANNO-MARKUP', (m.points || []).map(([x, y]) => ({ x, y })), false);
  }

  // A scale note in the drawing itself. A CAD file is in real units, so the
  // ratio is only advisory — but a sheet exported at a non-standard scale is
  // worth saying out loud here too.
  if (scene.title) {
    const y = b.maxY + (b.maxY - b.minY) * 0.04 + 2;
    text('ANNO-SHEET', b.minX, y, 1.2, `${scene.title.name || ''} — ${scene.title.sheet || ''} — ${scene.title.scaleLabel || ''}`, 0);
  }

  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n');
}

function avg(pts, k) {
  if (!pts || !pts.length) return 0;
  return pts.reduce((s, p) => s + p[k], 0) / pts.length;
}

/** Trigger a browser download of `dxf` as `filename`. */
export function downloadDxf(dxf, filename) {
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
