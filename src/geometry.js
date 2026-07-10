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

// True when segments p1–p2 and p3–p4 properly cross (shared endpoints don't count).
function segmentsCross(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (!d) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

// Concave hull by edge digging: start from the convex hull and repeatedly
// replace any edge longer than `maxEdge` with a detour through the interior
// point nearest that edge's endpoints — so the outline sinks into empty
// stretches (between room clusters) but never between adjacent rooms. A
// candidate is only accepted when both new edges are strictly shorter than
// the edge it replaces (guarantees termination) and neither crosses the
// outline. Convex input (or maxEdge ≤ 0) returns the plain convex hull.
export function concaveHull(points, maxEdge) {
  const hull = convexHull(points);
  if (!(maxEdge > 0) || hull.length < 3) return hull;
  const out = hull.slice();
  const onHull = new Set(out);
  let candidates = points.filter((p) => !onHull.has(p));
  let i = 0;
  while (i < out.length && candidates.length) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= maxEdge) {
      i++;
      continue;
    }
    // Rank candidates by how tightly they tuck into this edge; take the best
    // one that keeps the outline simple.
    const ranked = candidates
      .map((p) => ({ p, d: Math.max(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y)) }))
      .filter((c) => c.d < len * 0.999)
      .sort((x, y) => x.d - y.d);
    let dug = false;
    for (const { p } of ranked) {
      let crosses = false;
      for (let j = 0; j < out.length && !crosses; j++) {
        const q1 = out[j];
        const q2 = out[(j + 1) % out.length];
        if (q1 === a || q2 === a || q1 === b || q2 === b) continue;
        crosses = segmentsCross(a, p, q1, q2) || segmentsCross(p, b, q1, q2);
      }
      if (crosses) continue;
      out.splice(i + 1, 0, p);
      candidates = candidates.filter((c) => c !== p);
      dug = true;
      break; // re-examine edge a–p from the same index
    }
    if (!dug) i++;
  }
  return out;
}

// The outline the diagram draws around a set of padded discs (bubbles + hull
// padding): 16 samples per disc taken to a concave hull whose dig threshold
// scales with the discs themselves — `digFactor` × the median padded radius —
// so the outline hugs the arrangement's real profile without cutting between
// neighbouring rooms. discs: [{ x, y, r }].
export function hullOfDiscs(discs, digFactor = 3) {
  const pts = [];
  const radii = [];
  for (const d of discs) {
    radii.push(d.r);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      pts.push({ x: d.x + Math.cos(a) * d.r, y: d.y + Math.sin(a) * d.r });
    }
  }
  if (pts.length < 3) return pts;
  radii.sort((a, b) => a - b);
  const med = radii[Math.floor(radii.length / 2)];
  return concaveHull(pts, med * digFactor);
}

// ---------- clipped Voronoi (master-plan interior) ----------

// Clip `poly` to the half-plane {x : (x − m)·n ≤ 0} — Sutherland–Hodgman
// against an arbitrary line. Shared core of both Voronoi clippers below.
function clipLine(poly, mx, my, nx, ny) {
  const side = (pt) => (pt.x - mx) * nx + (pt.y - my) * ny;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = side(a), db = side(b);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

// Clip a polygon to the half-plane of points at least as close to `p` as to
// `q` (the p–q perpendicular bisector).
export function clipHalfPlane(poly, p, q) {
  return clipLine(poly, (p.x + q.x) / 2, (p.y + q.y) / 2, q.x - p.x, q.y - p.y);
}

// The POWER-DIAGRAM partition of `boundary` under weighted `seeds`
// ([{x, y, w?}, …], w defaults to 0): one clipped convex cell per seed (null
// when the cell degenerates). The dividing line between two seeds is their
// radical axis — still a straight line perpendicular to the seed axis, but
// shifted toward the lighter seed by (wᵢ − wⱼ)/(2|d|), so a heavier weight
// claims more area. With all weights equal this IS the Voronoi diagram.
// O(n²) clips, trivial for room counts. Co-located seeds have no axis and
// simply share the space their neighbours leave them.
export function powerCells(seeds, boundary) {
  return seeds.map((s, i) => {
    const wi = s.w || 0;
    let cell = boundary;
    for (let j = 0; j < seeds.length && cell.length; j++) {
      if (j === i) continue;
      const o = seeds[j];
      const dx = o.x - s.x, dy = o.y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-18) continue;
      // Radical axis: midpoint shifted along d̂ by (wᵢ − wⱼ)/(2|d|).
      const shift = (wi - (o.w || 0)) / (2 * d2);
      const mx = (s.x + o.x) / 2 + dx * shift;
      const my = (s.y + o.y) / 2 + dy * shift;
      cell = clipLine(cell, mx, my, dx, dy);
    }
    return cell.length >= 3 ? cell : null;
  });
}

// The unweighted special case, kept for callers (and tests) that want plain
// proximity cells.
export function voronoiCells(seeds, boundary) {
  return powerCells(seeds, boundary);
}

// Iteratively balance power-diagram weights so each seed's cell area
// approaches its share of the boundary: cell i aims at
// area(boundary) × targets[i] / Σtargets. Damped additive updates (a weight
// is a squared length, as is an area error, so the units line up); weights
// are re-centred each pass since only their differences matter. A vanished
// cell reads as area 0, so its weight grows back until it reappears.
// Returns the weights array; pass them back as `initial` for a warm start
// (e.g. re-balancing live while a seed is dragged).
export function balanceCellWeights(seeds, boundary, targets, { iters = 80, damp = 0.55, initial = null, tol = 0.01 } = {}) {
  const n = seeds.length;
  const A = Math.abs(polygonArea(boundary));
  if (!n || !(A > 0)) return new Array(n).fill(0);
  const sum = targets.reduce((t, v) => t + Math.max(v, 0), 0) || 1;
  const want = targets.map((t) => (A * Math.max(t, 0)) / sum);
  const w = initial && initial.length === n ? [...initial] : new Array(n).fill(0);
  const weighted = seeds.map((s, i) => ({ x: s.x, y: s.y, w: w[i] }));
  // The area's response to a weight change steepens as seeds get close, so a
  // fixed step can overshoot and ring. Adaptive damping: whenever the worst
  // error grows, the step shrinks; steady progress lets it creep back up.
  let step = damp;
  let prevWorst = Infinity;
  let best = { worst: Infinity, w: [...w] };
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) weighted[i].w = w[i];
    const cells = powerCells(weighted, boundary);
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const area = cells[i] ? Math.abs(polygonArea(cells[i])) : 0;
      worst = Math.max(worst, Math.abs(want[i] - area));
    }
    if (worst < best.worst) best = { worst, w: [...w] };
    if (worst / A < tol) break;
    if (worst > prevWorst * 1.001) step *= 0.6;
    else step = Math.min(damp, step * 1.05);
    prevWorst = worst;
    let mean = 0;
    for (let i = 0; i < n; i++) {
      const area = cells[i] ? Math.abs(polygonArea(cells[i])) : 0;
      w[i] += step * (want[i] - area);
      mean += w[i];
    }
    mean /= n;
    for (let i = 0; i < n; i++) {
      w[i] -= mean; // only differences matter — keep the weights centred
      w[i] = Math.max(-4 * A, Math.min(4 * A, w[i])); // runaway guard
    }
  }
  return best.w;
}

// Ray-cast point-in-polygon (boundary points count as outside on some edges —
// fine for the clamping use below).
export function pointInPolygon(pts, p) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

// Nearest point on a polygon's boundary to `p`.
export function closestPointOnPolygon(pts, p) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const vx = b.x - a.x, vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    const cx = a.x + vx * t, cy = a.y + vy * t;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) { bestD = d; best = { x: cx, y: cy }; }
  }
  return best;
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
// Per-vertex extras (the corner style `k`) ride along untouched.
export function normalizePolygon(pts) {
  if (!pts || pts.length < 3) return pts;
  const c = polygonCentroid(pts);
  const centred = pts.map((p) => ({ ...p, x: p.x - c.x, y: p.y - c.y }));
  const area = polygonArea(centred);
  if (!(area > 0)) return centred;
  const f = 1 / Math.sqrt(area);
  return centred.map((p) => ({ ...p, x: p.x * f, y: p.y * f }));
}

// Corner styles a polygon vertex can carry (shape_json `k` per vertex):
// 'c' curve (smooth through the corner — the default), 'f' fillet (tight
// rounding), 's' sharp (a true corner).
export const CORNER_STYLES = ['c', 'f', 's'];
export const cornerOf = (p) => (p.k === 's' || p.k === 'f' ? p.k : 'c');

// Tolerant parse of a space's shape_json into an array of {x,y,k?}; returns
// null when absent/invalid so callers fall back to bubble/box (mirrors pinsOf).
export function parsePoly(s) {
  if (!s || !s.shape_json) return null;
  try {
    const v = JSON.parse(s.shape_json);
    if (!Array.isArray(v) || v.length < 3) return null;
    const pts = v.map((p) => ({
      x: Number(p.x),
      y: Number(p.y),
      ...(p.k === 's' || p.k === 'f' ? { k: p.k } : {}),
    }));
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

// Sample a polygon's RENDERED outline as dense points, honouring each vertex's
// corner style (`k`): 'c' curve = quadratic Bézier anchored at the adjacent
// edge midpoints (the classic smooth blob — the default), 'f' fillet = the
// same Bézier but with anchors pulled toward the corner (a tight rounding),
// 's' sharp = the exact corner point. Vertices without `k` behave as curves,
// so outlines saved before corner styles existed render unchanged. The result
// is a dense point ring that can be drawn/extruded/area-measured like any
// polygon — every view (plan, stacked, 3-D, PDF) consumes this one sampler.
const FILLET_T = 0.45; // fillet anchors sit this fraction of the way corner → edge midpoint
export function outlinePoints(pts, seg = 12) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const out = [];
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const k = cornerOf(cur);
    if (k === 's') {
      out.push({ x: cur.x, y: cur.y });
      continue;
    }
    const m0 = mid(pts[(i - 1 + n) % n], cur);
    const m1 = mid(cur, pts[(i + 1) % n]);
    // Curve anchors at the midpoints exactly (bit-identical to the classic
    // smoothing); fillet anchors pulled toward the corner for a tight round.
    const p0 = k === 'f' ? { x: cur.x + (m0.x - cur.x) * FILLET_T, y: cur.y + (m0.y - cur.y) * FILLET_T } : m0;
    const p2 = k === 'f' ? { x: cur.x + (m1.x - cur.x) * FILLET_T, y: cur.y + (m1.y - cur.y) * FILLET_T } : m1;
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

// Reduce a dense outline (e.g. a convex hull) to an editable vertex count:
// repeatedly drop the vertex that deviates least from its neighbours' chord,
// until under `maxVerts` AND every remaining vertex earns its keep. Keeps at
// least a triangle.
export function simplifyOutline(pts, maxVerts = 12) {
  const out = pts.map((p) => ({ ...p }));
  if (out.length <= 3) return out;
  const b = polyBounds(pts);
  const minDev = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 0.008; // "flat enough" threshold
  const devOf = (arr, i) => {
    const a = arr[(i - 1 + arr.length) % arr.length];
    const p = arr[i];
    const c = arr[(i + 1) % arr.length];
    const ux = c.x - a.x, uy = c.y - a.y;
    const len = Math.hypot(ux, uy) || 1;
    return Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux) / len;
  };
  while (out.length > 3) {
    let minI = 0, min = Infinity;
    for (let i = 0; i < out.length; i++) {
      const d = devOf(out, i);
      if (d < min) { min = d; minI = i; }
    }
    if (out.length <= maxVerts && min > minDev) break;
    out.splice(minI, 1);
  }
  return out;
}

// Sample a smooth closed curve through a polygon as dense points: each corner is
// rounded with a quadratic Bézier whose anchors are the adjacent edge midpoints
// and whose control point is the corner itself (same scheme as smoothHullPath).
// Returns a dense point ring that reads as an organic, bubble-like outline and
// can be drawn/extruded/area-measured like any polygon.
// (Kept for the frozen legacy diagram — the live diagram uses outlinePoints,
// which is identical when no vertex carries a corner style.)
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
  const keep = out[vi]; // the dragged vertex's corner style rides along
  const areaOf = (v) => polygonArea(outlinePoints(v, seg)) || polygonArea(v) || 1;
  let f = Math.sqrt(lockedArea / areaOf(out));
  for (let i = 0; i < 20; i++) {
    out[vi] = { ...keep, x: target.x / f, y: target.y / f };
    const nf = Math.sqrt(lockedArea / areaOf(out));
    if (Math.abs(nf - f) <= f * 1e-4) {
      f = nf;
      break;
    }
    f = (f + nf) / 2; // damped — the plain iteration can overshoot on big moves
  }
  out[vi] = { ...keep, x: target.x / f, y: target.y / f };
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
