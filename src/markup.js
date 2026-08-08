// Redline markup geometry — pure, React/DOM-free, so it's unit-testable.
//
// A markup stroke is freehand ink drawn OVER the plan. It is not programme and
// not geometry: it never contributes to an area, a total or a compliance
// figure. See docs/DESIGN.md "Markup is not geometry".
//
// Units: stroke points and widths are in DIAGRAM UNITS, the same space as
// bubbles and image layers — never screen pixels. That is what makes ink stay
// on the thing it was drawn over through pan, zoom and a drawing-scale change,
// and what makes it print at the right weight on an exported sheet. A pointer
// position becomes a stroke point via the caller's toSvgCoords.

/** Default pen widths (diagram units at 1:1). Fine / medium / broad. */
export const PEN_WIDTHS = [2, 5, 10];

/**
 * The redline palette. Deliberately fixed hex rather than theme tokens: a
 * markup colour means the same thing in light and dark, and it has to survive
 * into a PDF where there is no theme at all.
 */
export const PEN_COLORS = [
  ['#e5484d', 'Red'],
  ['#f5a524', 'Amber'],
  ['#3e63dd', 'Blue'],
  ['#30a46c', 'Green'],
];

/**
 * Note text heights, in diagram units. One unit is ~0.2646 mm on paper at 1:1,
 * so these print at roughly 2.1 / 3.2 / 4.8 mm — the range a hand annotation
 * occupies on a drawing, small enough not to fight the plan and large enough to
 * survive a reduction to A4.
 */
export const NOTE_HEIGHTS = [8, 12, 18];

export const DEFAULT_PEN = { mode: 'ink', color: PEN_COLORS[0][0], width: PEN_WIDTHS[1] };

/**
 * Split a note into where its text sits and what it points at.
 *
 * A note is stored as [[textX, textY]] alone, or [[textX, textY], [tx, ty]]
 * when it carries a leader. Returns null for anything that isn't a note, so a
 * caller can map over every stroke without pre-filtering.
 */
export function noteParts(stroke) {
  if (!stroke || stroke.kind !== 'note' || !stroke.points?.length) return null;
  const [at, target] = stroke.points;
  return {
    x: at[0],
    y: at[1],
    // A leader that lands on its own anchor is not a leader.
    leader: target && (target[0] !== at[0] || target[1] !== at[1]) ? { x: target[0], y: target[1] } : null,
    text: stroke.text || '',
    height: stroke.width,
    color: stroke.color,
  };
}

/**
 * Stable identity for "this project has no markup". A fresh `[]` default makes
 * every render look like new data to a prop-change check, which is how you get
 * "Too many re-renders" out of an otherwise correct derivation.
 */
export const NO_MARKUP = Object.freeze([]);

/** Perpendicular distance from p to the segment ab. */
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Ramer–Douglas–Peucker. A freehand drag emits a point per pointermove — a few
 * hundred for one circled room — and storing them raw makes the payload, the
 * SVG path and the PDF all heavier than the mark deserves. Simplifying at a
 * fraction of the pen width is visually lossless.
 *
 * @param {Array<[number, number]>} pts
 * @param {number} tol Diagram units; points closer than this to the chord go.
 * @returns {Array<[number, number]>}
 */
export function simplify(pts, tol = 1) {
  if (!Array.isArray(pts) || pts.length < 3 || tol <= 0) return pts ? [...pts] : [];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1;
    let best = tol;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist(pts[i], pts[lo], pts[hi]);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far !== -1) {
      keep[far] = 1;
      stack.push([lo, far], [far, hi]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Round to `dp` decimals — keeps stored strokes compact without visible loss. */
export function roundPoints(pts, dp = 2) {
  const k = 10 ** dp;
  return pts.map(([x, y]) => [Math.round(x * k) / k, Math.round(y * k) / k]);
}

/**
 * SVG path `d` for a stroke. Quadratic segments through the midpoints of
 * consecutive samples give the smooth ink feel a polyline can't, without
 * needing a spline fit.
 *
 * A one-point stroke (a tap) renders as a dot: a zero-length line with a round
 * cap, which is what the user drew.
 *
 * @param {Array<[number, number]>} pts
 * @returns {string}
 */
export function toPath(pts) {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[0][0]} ${pts[0][1]}`;
  if (pts.length === 2) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/**
 * Transform a stroke through a uniform zoom-about-a-point — what a drawing
 * SCALE change does to the whole drawing (see scale.js zoomAbout). The width
 * scales by the same factor, because a unit means a different number of metres
 * afterwards and the pen mark has to keep its physical weight.
 *
 * Miss this and ink silently drifts off the plan the first time someone
 * switches 1:500 → 1:1000, which reads as a rendering bug rather than a missed
 * call site.
 *
 * @param {{points: Array<[number, number]>, width: number}} stroke
 * @param {{x: number, y: number}} anchor
 * @param {number} f Scale factor.
 */
export function scaleStroke(stroke, anchor, f) {
  return {
    ...stroke,
    points: stroke.points.map(([x, y]) => [anchor.x + (x - anchor.x) * f, anchor.y + (y - anchor.y) * f]),
    width: stroke.width * f,
  };
}

/** Bounding box in diagram units, or null for an empty stroke set. */
export function bboxOf(strokes) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s.points || []) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** Parse a stored row into a stroke, or null when the payload is unusable. */
export function parseStroke(row) {
  if (!row) return null;
  let points;
  try {
    points = JSON.parse(row.points);
  } catch {
    return null;
  }
  if (!Array.isArray(points) || points.length === 0) return null;
  const clean = points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!clean.length) return null;
  return {
    id: row.id,
    env: row.env,
    level: row.level ?? '',
    kind: row.kind || 'ink',
    text: row.note_text || '',
    // Kept for imported geometry: the source drawing's layer is the best guess
    // at what a traced ring IS, and the import name groups it (see trace.js).
    layer: row.src_layer || null,
    source: row.src_name || null,
    color: row.color || DEFAULT_PEN.color,
    width: Number(row.width) || DEFAULT_PEN.width,
    points: clean,
  };
}
