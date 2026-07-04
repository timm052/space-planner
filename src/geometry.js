// Pure geometry & rendering helpers for the bubble diagram. No React or DOM, so
// they're unit-testable in isolation (see test/geometry.test.js).

// Andrew's monotone-chain convex hull (counter-clockwise, no collinear points).
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// A soft, rounded closed path through a polygon's points (midpoint quadratics).
export function smoothHullPath(pts) {
  const n = pts.length;
  if (n < 3) return '';
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M ${mid(pts[n - 1], pts[0]).x} ${mid(pts[n - 1], pts[0]).y} `;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const m = mid(cur, pts[(i + 1) % n]);
    d += `Q ${cur.x} ${cur.y} ${m.x} ${m.y} `;
  }
  return d + 'Z';
}

// ---------- freeform (custom) polygon shapes ----------
// Polygons are persisted normalized (centroid at origin, area = 1) so any
// renderer can scale them by √(areaUnits) and the drawn footprint always has the
// exact area a bubble/box would have for the same space — i.e. dragging a corner
// changes the outline, never the area.

// Signed area ×2 (shoelace); positive for counter-clockwise winding.
function shoelace2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

// Absolute polygon area.
export function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0;
  return Math.abs(shoelace2(pts)) / 2;
}

// Area-weighted centroid of a (non-self-intersecting) polygon. Falls back to the
// vertex average for degenerate (zero-area) input.
export function polygonCentroid(pts) {
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  const a2 = shoelace2(pts);
  if (Math.abs(a2) < 1e-9) {
    const s = pts.reduce((m, p) => ({ x: m.x + p.x, y: m.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / pts.length, y: s.y / pts.length };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

// Translate centroid → origin and scale so the polygon's area is exactly 1.
// Returns a fresh array; returns the input unchanged when degenerate.
export function normalizePolygon(pts) {
  if (!pts || pts.length < 3) return pts;
  const c = polygonCentroid(pts);
  const centred = pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  const area = polygonArea(centred);
  if (!(area > 0)) return centred;
  const f = 1 / Math.sqrt(area);
  return centred.map((p) => ({ x: p.x * f, y: p.y * f }));
}

// Tolerant parse of a space's shape_json into an array of {x,y}; returns null
// when absent/invalid so callers fall back to bubble/box (mirrors pinsOf).
export function parsePoly(s) {
  if (!s || !s.shape_json) return null;
  try {
    const v = JSON.parse(s.shape_json);
    if (!Array.isArray(v) || v.length < 3) return null;
    const pts = v.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
    return pts;
  } catch {
    return null;
  }
}

// SVG path string for a closed polygon.
export function polygonPath(pts) {
  if (!pts || pts.length < 2) return '';
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';
}

// Sample a smooth closed curve through a polygon as dense points: each corner is
// rounded with a quadratic Bézier whose anchors are the adjacent edge midpoints
// and whose control point is the corner itself (same scheme as smoothHullPath).
// Returns a dense point ring that reads as an organic, bubble-like outline and
// can be drawn/extruded/area-measured like any polygon.
export function smoothPolygonPoints(pts, seg = 12) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const out = [];
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const p0 = mid(pts[(i - 1 + n) % n], cur);
    const p2 = mid(cur, pts[(i + 1) % n]);
    for (let s = 0; s < seg; s++) {
      const t = s / seg;
      const mt = 1 - t;
      out.push({
        x: mt * mt * p0.x + 2 * mt * t * cur.x + t * t * p2.x,
        y: mt * mt * p0.y + 2 * mt * t * cur.y + t * t * p2.y,
      });
    }
  }
  return out;
}

/**
 * Move one vertex of an area-locked polygon so it renders exactly at `target`
 * (diagram units relative to the shape's node), while the area lock rescales
 * the outline to keep the RENDERED (smoothed) area equal to `lockedArea`.
 *
 * The vertex position and the lock's scale factor depend on each other:
 * verts[vi] = target / f and f = √(lockedArea / area(smooth(verts))). The old
 * drag code ran ONE iteration of that fixed point per pointer frame, feeding
 * each frame's scale into the next frame's mapping — the outline visibly
 * juddered and snapped back and forth. This solves the fixed point to
 * convergence in one call (damped iteration), so the result is a smooth,
 * deterministic function of the cursor with no cross-frame feedback.
 *
 * Returns { verts, f }: the new vertex array (input is not mutated) and the
 * converged scale factor (√(lockedArea / smoothedArea), i.e. what polyScaleOf
 * recomputes from these verts).
 */
export function solveAreaLockedVertex(verts, vi, target, lockedArea, seg = 12) {
  const out = verts.map((p) => ({ ...p }));
  const areaOf = (v) => polygonArea(smoothPolygonPoints(v, seg)) || polygonArea(v) || 1;
  let f = Math.sqrt(lockedArea / areaOf(out));
  for (let i = 0; i < 20; i++) {
    out[vi] = { x: target.x / f, y: target.y / f };
    const nf = Math.sqrt(lockedArea / areaOf(out));
    if (Math.abs(nf - f) <= f * 1e-4) {
      f = nf;
      break;
    }
    f = (f + nf) / 2; // damped — the plain iteration can overshoot on big moves
  }
  out[vi] = { x: target.x / f, y: target.y / f };
  return { verts: out, f };
}

// Axis-aligned bounding box of a point set.
export function polyBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

// A regular n-gon, normalized to area 1 (default outline when converting to poly).
export function regularPolygon(n = 6) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return normalizePolygon(pts);
}

// An L-shaped footprint, normalized to area 1 (an alternative starting outline).
export function lShape() {
  return normalizePolygon([
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
    { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 },
  ]);
}

// Resolve a space's per-instance pins into a { instanceIndex: {x,y} } map.
// Prefers the current pin_json; falls back to the legacy single pin_x/pin_y
// (read as instance 0); tolerates malformed JSON.
export function pinsOf(s) {
  if (s.pin_json) {
    try {
      return JSON.parse(s.pin_json) || {};
    } catch {
      return {};
    }
  }
  if (s.pin_x != null) return { 0: { x: s.pin_x, y: s.pin_y } };
  return {};
}

// Diagrammatic image filter presets (applied as CSS filters on screen and baked
// into the PDF via canvas ctx.filter). [value, label].
export const IMAGE_FILTERS = [
  ['', 'None'],
  ['grayscale', 'Grayscale'],
  ['blueprint', 'Blueprint'],
  ['faded', 'Faded'],
  ['contrast', 'High contrast'],
  ['ink', 'Ink / line'],
];

export function filterCss(f) {
  return (
    {
      grayscale: 'grayscale(1) contrast(1.1)',
      blueprint: 'grayscale(1) brightness(0.85) sepia(1) hue-rotate(175deg) saturate(5) contrast(1.1)',
      faded: 'saturate(0.5) contrast(0.82) brightness(1.1)',
      contrast: 'contrast(1.6) brightness(1.05)',
      ink: 'grayscale(1) contrast(2.2) brightness(1.15)',
    }[f] || 'none'
  );
}
