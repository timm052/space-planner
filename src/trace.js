// Turning imported vector geometry into programme.
//
// A DXF/SVG/AI import lands as REFERENCE: polylines in the markups table that
// never touch an area or a total (see server/db.js). That is the right default
// — the app cannot know what an imported circle means — but it leaves the most
// common real task undone. You import a site plan or a floor plan, and the
// rooms are already drawn on it. Re-typing their areas into the schedule, or
// re-tracing outlines the file already contains, is exactly the hand work the
// import was supposed to remove.
//
// This module answers the two questions that stand between an imported path
// and a scheduled room: is the path ENCLOSED (does it bound an area at all),
// and what does it enclose. Everything here is pure — points in, numbers out —
// so the arithmetic behind a figure that will appear on a contractual schedule
// is testable on its own. See test/trace.test.js.
//
// Units: rings are in DIAGRAM UNITS like every other geometry module. The
// conversion to project area units needs the drawing scale and belongs to the
// caller (areaFromRing below takes it explicitly).

import { polygonArea, polygonCentroid, polygonPath, polyBounds, pointInPolygon, simplifyOutline } from './geometry.js';

/**
 * How far apart a path's ends may be and still count as closed, as a fraction
 * of the path's own diagonal.
 *
 * Relative, not absolute: a 2 mm gap in a 300-unit site boundary is a rounding
 * artefact of whatever wrote the file, while the same gap in a 5-unit door
 * symbol is the whole shape. An absolute tolerance would either miss real site
 * boundaries or weld open door swings into rooms.
 */
const CLOSE_FRAC = 0.02;

/** Vertices a traced outline is reduced to — enough shape to be recognisable,
 *  few enough to edit by hand afterwards. A surveyed curve arrives with
 *  hundreds. */
export const TRACE_MAX_VERTS = 24;

/** Minimum enclosed area, in diagram units², for a path to be worth offering.
 *  Below this it is a symbol, a hatch fragment or a text glyph outline. */
export const MIN_TRACE_AREA = 4;

/**
 * Is this path enclosed? True for a ring whose ends meet (or very nearly), or
 * one already stored with its first point repeated at the end.
 *
 * @param {Array<[number, number]>} points
 * @returns {boolean}
 */
export function isClosedRing(points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  const b = ringBounds(points);
  const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
  if (!(diag > 0)) return false;
  return Math.hypot(lx - fx, ly - fy) <= diag * CLOSE_FRAC;
}

function ringBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * A stored stroke's points as a polygon ring: {x, y} objects with the repeated
 * closing vertex dropped, since polygonArea treats the ring as implicitly
 * closed and a duplicate adds a zero-length edge.
 *
 * @param {Array<[number, number]>} points
 * @returns {Array<{x: number, y: number}>}
 */
export function ringOf(points) {
  const pts = points.map(([x, y]) => ({ x, y }));
  if (pts.length > 3) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) pts.pop();
  }
  return pts;
}

/**
 * Every imported path in `strokes` that bounds an area worth offering.
 *
 * Sorted SMALLEST FIRST. A floor plan nests: rooms inside a building outline
 * inside a site boundary, and a click lands inside all three. Smallest-first is
 * what makes "the thing under the cursor" mean the room rather than the site.
 *
 * Only `kind: 'survey'` rows are candidates — a redline is somebody's comment,
 * and circling a room in red must never be mistaken for scheduling it.
 *
 * @param {Array<object>} strokes Parsed strokes (see markup.js parseStroke).
 * @param {{minArea?: number}} [opts]
 * @returns {Array<{id: *, ring: Array<{x,y}>, area: number, centroid: {x,y},
 *   bounds: object, path: string, layer: string|null, source: string|null}>}
 */
export function traceCandidates(strokes, { minArea = MIN_TRACE_AREA } = {}) {
  const out = [];
  for (const s of strokes || []) {
    if (!s || s.kind !== 'survey' || !isClosedRing(s.points)) continue;
    const ring = ringOf(s.points);
    if (ring.length < 3) continue;
    const area = Math.abs(polygonArea(ring));
    if (!(area >= minArea)) continue;
    out.push({
      id: s.id,
      ring,
      area,
      centroid: polygonCentroid(ring),
      bounds: polyBounds(ring),
      path: polygonPath(ring),
      layer: s.layer ?? null,
      source: s.source ?? null,
    });
  }
  return out.sort((a, b) => a.area - b.area);
}

/**
 * The candidate under a point — the smallest one containing it, so a room wins
 * over the building it sits in. Returns null when the point is in open ground.
 *
 * @param {Array<object>} candidates From traceCandidates (already sorted).
 * @param {{x: number, y: number}} p
 */
export function pickCandidate(candidates, p) {
  for (const c of candidates || []) {
    if (p.x < c.bounds.minX || p.x > c.bounds.maxX || p.y < c.bounds.minY || p.y > c.bounds.maxY) continue;
    if (pointInPolygon(c.ring, p)) return c;
  }
  return null;
}

/**
 * What a traced ring encloses, in PROJECT area units.
 *
 * @param {Array<{x,y}>} ring Diagram units.
 * @param {number} metresPerUnit The drawing scale (effScale).
 * @param {string} units Project units — 'm2' | 'ft2'.
 * @param {number} m2PerFt2 Conversion constant, passed in to keep this pure.
 * @returns {number}
 */
export function areaFromRing(ring, metresPerUnit, units, m2PerFt2) {
  const m2 = Math.abs(polygonArea(ring)) * metresPerUnit * metresPerUnit;
  return units === 'ft2' ? m2 / m2PerFt2 : m2;
}

/**
 * A traced ring as an editable outline: reduced to a workable vertex count,
 * every corner SHARP, re-centred on its own centroid.
 *
 * Sharp matters twice over. A traced outline is a measured thing — a surveyed
 * boundary or a drawn wall line — and rounding its corners would be the app
 * inventing geometry the file does not contain. It also keeps the arithmetic
 * honest: outlinePoints passes a sharp corner through unchanged, so the area
 * the schedule records is the area of the polygon actually on screen, not of a
 * smoothed approximation of it.
 *
 * The area is measured AFTER simplification for the same reason: what the user
 * sees is what gets recorded.
 *
 * @param {Array<{x,y}>} ring
 * @param {{maxVerts?: number}} [opts]
 * @returns {{verts: Array<{x,y,k:string}>, centroid: {x,y}, area: number}}
 */
export function traceToOutline(ring, { maxVerts = TRACE_MAX_VERTS } = {}) {
  const simplified = simplifyOutline(ring, maxVerts).map((p) => ({ x: p.x, y: p.y, k: 's' }));
  const centroid = polygonCentroid(simplified);
  return {
    verts: simplified.map((p) => ({ ...p, x: p.x - centroid.x, y: p.y - centroid.y })),
    centroid,
    area: Math.abs(polygonArea(simplified)),
  };
}
