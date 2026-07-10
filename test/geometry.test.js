import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convexHull, concaveHull, hullOfDiscs, clipHalfPlane, voronoiCells, pointInPolygon,
  closestPointOnPolygon, smoothHullPath, pinsOf, filterCss, IMAGE_FILTERS,
  polygonArea, polygonCentroid, normalizePolygon, parsePoly, polygonPath, polyBounds,
  regularPolygon, lShape, smoothPolygonPoints, solveAreaLockedVertex,
  outlinePoints, simplifyOutline } from '../src/geometry.js';

// ---- convexHull ---------------------------------------------------------

test('convexHull returns a copy of the input for fewer than 3 points', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const hull = convexHull(pts);
  assert.deepEqual(hull, pts);
  assert.notEqual(hull, pts); // a copy, not the same array
});

test('convexHull drops interior points and keeps the corners', () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const hull = convexHull([...corners, { x: 5, y: 5 }]); // + interior point
  assert.equal(hull.length, 4);
  for (const c of corners) {
    assert.ok(hull.some((h) => h.x === c.x && h.y === c.y), `corner ${c.x},${c.y} present`);
  }
  assert.ok(!hull.some((h) => h.x === 5 && h.y === 5), 'interior point excluded');
});

test('convexHull excludes collinear points on an edge', () => {
  const hull = convexHull([
    { x: 0, y: 0 },
    { x: 5, y: 0 }, // collinear on the bottom edge
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
  // The midpoint of a straight edge is not a hull vertex.
  assert.ok(!hull.some((h) => h.x === 5 && h.y === 0));
  assert.equal(hull.length, 4);
});

// ---- smoothHullPath -----------------------------------------------------

test('smoothHullPath is empty for degenerate polygons', () => {
  assert.equal(smoothHullPath([]), '');
  assert.equal(smoothHullPath([{ x: 0, y: 0 }, { x: 1, y: 1 }]), '');
});

test('smoothHullPath builds a closed quadratic path with one Q per vertex', () => {
  const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }];
  const d = smoothHullPath(tri);
  assert.ok(d.startsWith('M '));
  assert.ok(d.trim().endsWith('Z'));
  assert.equal((d.match(/Q /g) || []).length, tri.length);
});

// ---- pinsOf -------------------------------------------------------------

test('pinsOf parses pin_json into an instance map', () => {
  assert.deepEqual(pinsOf({ pin_json: '{"0":{"x":1,"y":2},"2":{"x":3,"y":4}}' }), {
    0: { x: 1, y: 2 },
    2: { x: 3, y: 4 },
  });
});

test('pinsOf tolerates malformed or null pin_json', () => {
  assert.deepEqual(pinsOf({ pin_json: '{not json' }), {});
  assert.deepEqual(pinsOf({ pin_json: 'null' }), {}); // JSON.parse('null') || {} → {}
});

test('pinsOf falls back to the legacy single pin as instance 0', () => {
  assert.deepEqual(pinsOf({ pin_x: 7, pin_y: 9 }), { 0: { x: 7, y: 9 } });
});

test('pinsOf returns an empty map when there is no pin', () => {
  assert.deepEqual(pinsOf({}), {});
  assert.deepEqual(pinsOf({ pin_x: null, pin_y: null }), {});
});

// ---- freeform polygon helpers -------------------------------------------

test('polygonArea computes area by the shoelace formula (winding-independent)', () => {
  const sq = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  assert.equal(polygonArea(sq), 16);
  assert.equal(polygonArea([...sq].reverse()), 16); // sign of winding doesn't matter
  assert.equal(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }]), 0); // degenerate
});

test('polygonCentroid finds the area centroid of a square', () => {
  const c = polygonCentroid([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]);
  assert.ok(Math.abs(c.x - 1) < 1e-9 && Math.abs(c.y - 1) < 1e-9);
});

test('normalizePolygon centres at the origin and scales to unit area', () => {
  const np = normalizePolygon([{ x: 10, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 16 }, { x: 10, y: 16 }]);
  assert.ok(Math.abs(polygonArea(np) - 1) < 1e-9, 'area normalized to 1');
  const c = polygonCentroid(np);
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9, 'centroid at origin');
});

test('regularPolygon and lShape are normalized to unit area', () => {
  assert.ok(Math.abs(polygonArea(regularPolygon(6)) - 1) < 1e-9);
  assert.equal(regularPolygon(5).length, 5);
  assert.ok(Math.abs(polygonArea(lShape()) - 1) < 1e-9);
});

test('parsePoly reads shape_json and tolerates junk', () => {
  assert.deepEqual(parsePoly({ shape_json: '[{"x":0,"y":0},{"x":1,"y":0},{"x":0,"y":1}]' }), [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  ]);
  assert.equal(parsePoly({}), null);
  assert.equal(parsePoly({ shape_json: '{not json' }), null);
  assert.equal(parsePoly({ shape_json: '[{"x":0,"y":0},{"x":1,"y":1}]' }), null); // < 3 verts
  assert.equal(parsePoly({ shape_json: '[{"x":0,"y":0},{"x":1,"y":"z"},{"x":2,"y":2}]' }), null); // NaN
});

test('polygonPath builds a closed M/L path', () => {
  const d = polygonPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.ok(d.startsWith('M 0.00 0.00'));
  assert.ok(d.includes('L '));
  assert.ok(d.trim().endsWith('Z'));
});

test('smoothPolygonPoints samples a dense, smaller closed curve inside the polygon', () => {
  const sq = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
  const curve = smoothPolygonPoints(sq, 10);
  assert.equal(curve.length, sq.length * 10); // seg points per edge
  const a = polygonArea(curve);
  assert.ok(a > 0 && a < polygonArea(sq), 'rounded curve area is positive but inside the polygon');
  assert.deepEqual(smoothPolygonPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }]), [{ x: 0, y: 0 }, { x: 1, y: 1 }]); // degenerate passthrough
});

test('polyBounds returns the axis-aligned bounding box', () => {
  assert.deepEqual(polyBounds([{ x: -2, y: 1 }, { x: 3, y: -4 }, { x: 0, y: 5 }]), {
    minX: -2, minY: -4, maxX: 3, maxY: 5,
  });
});

// ---- filterCss / IMAGE_FILTERS ------------------------------------------

test('filterCss maps known presets and defaults to none', () => {
  assert.equal(filterCss(''), 'none');
  assert.equal(filterCss('nope'), 'none');
  assert.match(filterCss('grayscale'), /grayscale\(1\)/);
  assert.match(filterCss('blueprint'), /hue-rotate/);
  assert.match(filterCss('ink'), /contrast\(2\.2\)/);
});

test('every non-empty IMAGE_FILTERS preset has a real CSS mapping', () => {
  assert.ok(IMAGE_FILTERS.some(([v, label]) => v === '' && label === 'None'));
  for (const [value] of IMAGE_FILTERS) {
    if (value === '') assert.equal(filterCss(value), 'none');
    else assert.notEqual(filterCss(value), 'none');
  }
});

// ---- solveAreaLockedVertex ------------------------------------------------
// The vertex-drag fixed point: the dragged handle must land exactly under the
// cursor while the area lock holds the rendered (smoothed) outline's area.

test('solveAreaLockedVertex puts the dragged vertex exactly at the target', () => {
  const verts = regularPolygon(6);
  const lockedArea = 5000; // ≈ a 40-unit-radius room's footprint
  const target = { x: 120, y: -35 };
  const { verts: out, f } = solveAreaLockedVertex(verts, 2, target, lockedArea, 14);
  // Rendered position of the vertex = normalized vert × scale.
  assert.ok(Math.abs(out[2].x * f - target.x) < 0.1, `x lands on target (${out[2].x * f})`);
  assert.ok(Math.abs(out[2].y * f - target.y) < 0.1, `y lands on target (${out[2].y * f})`);
});

test('solveAreaLockedVertex holds the rendered area to the lock', () => {
  const verts = regularPolygon(5);
  const lockedArea = 7200;
  const { verts: out, f } = solveAreaLockedVertex(verts, 0, { x: 150, y: 60 }, lockedArea, 14);
  const rendered = polygonArea(smoothPolygonPoints(out, 14)) * f * f;
  assert.ok(Math.abs(rendered - lockedArea) / lockedArea < 0.001, `area locked (${rendered})`);
});

test('solveAreaLockedVertex is deterministic and continuous in the cursor', () => {
  const verts = regularPolygon(6);
  const a1 = solveAreaLockedVertex(verts, 1, { x: 90, y: 40 }, 5000, 14);
  const a2 = solveAreaLockedVertex(verts, 1, { x: 90, y: 40 }, 5000, 14);
  assert.deepEqual(a1, a2, 'same cursor → identical result (no hidden state)');
  const b = solveAreaLockedVertex(verts, 1, { x: 91, y: 40 }, 5000, 14);
  for (let i = 0; i < verts.length; i++) {
    const d = Math.hypot(b.verts[i].x - a1.verts[i].x, b.verts[i].y - a1.verts[i].y);
    assert.ok(d < 0.05, `1px cursor step moves vert ${i} smoothly (${d})`);
  }
});

test('solveAreaLockedVertex does not mutate its input', () => {
  const verts = regularPolygon(4);
  const snapshot = JSON.stringify(verts);
  solveAreaLockedVertex(verts, 0, { x: 200, y: 0 }, 3000, 14);
  assert.equal(JSON.stringify(verts), snapshot);
});

test('solveAreaLockedVertex converges even for extreme pulls', () => {
  const verts = regularPolygon(3);
  const { verts: out, f } = solveAreaLockedVertex(verts, 0, { x: 900, y: 0 }, 2000, 14);
  assert.ok(Number.isFinite(f) && f > 0);
  assert.ok(Math.abs(out[0].x * f - 900) < 2, 'still lands near the cursor after a huge pull');
});

// ---- outlinePoints (corner styles) --------------------------------------

test('outlinePoints without corner styles matches the classic smoothing', () => {
  const verts = regularPolygon(6);
  assert.deepEqual(outlinePoints(verts, 12), smoothPolygonPoints(verts, 12));
});

test('outlinePoints: sharp corners pass through the exact vertices', () => {
  const square = [
    { x: -1, y: -1, k: 's' }, { x: 1, y: -1, k: 's' },
    { x: 1, y: 1, k: 's' }, { x: -1, y: 1, k: 's' },
  ];
  const out = outlinePoints(square, 12);
  assert.equal(out.length, 4, 'one point per sharp corner');
  assert.deepEqual(out, square.map(({ x, y }) => ({ x, y })));
  assert.ok(Math.abs(polygonArea(out) - 4) < 1e-9, 'a sharp square keeps its full area');
});

test('outlinePoints: curve < fillet < sharp in enclosed area', () => {
  const sq = (k) => [
    { x: -1, y: -1, k }, { x: 1, y: -1, k }, { x: 1, y: 1, k }, { x: -1, y: 1, k },
  ];
  const a = (k) => polygonArea(outlinePoints(sq(k), 16));
  assert.ok(a('c') < a('f'), 'a fillet hugs the corner tighter than a curve');
  assert.ok(a('f') < a('s'), 'sharp corners enclose the most area');
});

test('parsePoly preserves corner styles and drops junk ones', () => {
  const s = { shape_json: JSON.stringify([
    { x: 0, y: 0, k: 's' }, { x: 1, y: 0, k: 'f' }, { x: 1, y: 1, k: 'weird' }, { x: 0, y: 1 },
  ]) };
  const pts = parsePoly(s);
  assert.equal(pts[0].k, 's');
  assert.equal(pts[1].k, 'f');
  assert.equal(pts[2].k, undefined, 'unknown styles are dropped (default curve)');
  assert.equal(pts[3].k, undefined);
});

test('normalizePolygon keeps corner styles riding on the vertices', () => {
  const verts = [
    { x: 10, y: 10, k: 's' }, { x: 30, y: 10 }, { x: 30, y: 30, k: 'f' }, { x: 10, y: 30 },
  ];
  const norm = normalizePolygon(verts);
  assert.equal(norm[0].k, 's');
  assert.equal(norm[2].k, 'f');
  assert.ok(Math.abs(polygonArea(norm) - 1) < 1e-9, 'still normalized to area 1');
});

test('solveAreaLockedVertex keeps the dragged vertex corner style', () => {
  const verts = regularPolygon(5).map((p, i) => (i === 2 ? { ...p, k: 's' } : p));
  const { verts: out } = solveAreaLockedVertex(verts, 2, { x: 120, y: -35 }, 6000, 14);
  assert.equal(out[2].k, 's');
});

// ---- simplifyOutline -----------------------------------------------------

test('simplifyOutline caps the vertex count and keeps the shape', () => {
  // A dense circle → at most 12 verts, similar area, at least a triangle.
  const dense = Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return { x: Math.cos(a) * 100, y: Math.sin(a) * 100 };
  });
  const out = simplifyOutline(dense, 12);
  assert.ok(out.length <= 12 && out.length >= 3, `capped (${out.length})`);
  const ratio = polygonArea(out) / polygonArea(dense);
  assert.ok(ratio > 0.9, `area mostly preserved (${ratio.toFixed(3)})`);
});

test('simplifyOutline drops collinear vertices even under the cap', () => {
  const withCollinear = [
    { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, // middle vertex is collinear
    { x: 10, y: 10 }, { x: 0, y: 10 },
  ];
  const out = simplifyOutline(withCollinear, 12);
  assert.equal(out.length, 4, 'the collinear vertex was removed');
});

// ---- clipHalfPlane / voronoiCells ----------------------------------------

const unitSquare = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

test('clipHalfPlane keeps the half of a square closer to p', () => {
  const left = clipHalfPlane(unitSquare, { x: 2, y: 5 }, { x: 8, y: 5 });
  assert.ok(Math.abs(polygonArea(left) - 50) < 1e-9, `left half is 50 (${polygonArea(left)})`);
  assert.ok(left.every((pt) => pt.x <= 5 + 1e-9), 'everything is left of the bisector');
});

test('voronoiCells tile the boundary exactly', () => {
  const seeds = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 2, y: 8 }, { x: 8, y: 8 }];
  const cells = voronoiCells(seeds, unitSquare);
  assert.equal(cells.length, 4);
  for (const c of cells) assert.ok(c && polygonArea(c) > 0, 'every cell survives');
  const total = cells.reduce((t, c) => t + polygonArea(c), 0);
  assert.ok(Math.abs(total - 100) < 1e-6, `cells partition the square (${total})`);
  // Symmetric seeds → four equal quarters.
  for (const c of cells) assert.ok(Math.abs(polygonArea(c) - 25) < 1e-6);
});

test('voronoiCells: a lone seed owns the whole boundary; co-located seeds do not vanish the space', () => {
  const [only] = voronoiCells([{ x: 5, y: 5 }], unitSquare);
  assert.ok(Math.abs(polygonArea(only) - 100) < 1e-9);
  const twin = voronoiCells([{ x: 3, y: 3 }, { x: 3, y: 3 }, { x: 8, y: 8 }], unitSquare);
  // The two co-located seeds share the same (identical) cell rather than clipping each other away.
  assert.ok(twin[0] && twin[1] && polygonArea(twin[0]) > 0);
});

test('pointInPolygon and closestPointOnPolygon agree about a square', () => {
  assert.equal(pointInPolygon(unitSquare, { x: 5, y: 5 }), true);
  assert.equal(pointInPolygon(unitSquare, { x: 15, y: 5 }), false);
  const c = closestPointOnPolygon(unitSquare, { x: 15, y: 4 });
  assert.ok(Math.abs(c.x - 10) < 1e-9 && Math.abs(c.y - 4) < 1e-9, `clamps to the right edge (${c.x},${c.y})`);
});

// ---- concaveHull / hullOfDiscs -------------------------------------------

// A simple-polygon check: no two non-adjacent edges may cross.
function isSimple(pts) {
  const cross = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (!d) return false;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
  };
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

// Two dense clusters of points far apart — a dumbbell.
function dumbbell(sep = 300) {
  const pts = [];
  for (const cx of [0, sep]) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * 40, y: Math.sin(a) * 40 });
    }
  }
  return pts;
}

test('concaveHull equals the convex hull when maxEdge is generous or invalid', () => {
  const pts = dumbbell();
  assert.deepEqual(concaveHull(pts, 1e9), convexHull(pts));
  assert.deepEqual(concaveHull(pts, 0), convexHull(pts));
});

test('concaveHull digs into the waist of a dumbbell', () => {
  const pts = dumbbell();
  const convex = convexHull(pts);
  const concave = concaveHull(pts, 100);
  assert.ok(polygonArea(concave) < polygonArea(convex) * 0.9,
    `concave area shrinks (${(polygonArea(concave) / polygonArea(convex)).toFixed(3)})`);
  assert.ok(isSimple(concave), 'no self-intersection');
  // Every edge respects the dig threshold or had no acceptable candidate.
  const long = concave.filter((p, i) => {
    const q = concave[(i + 1) % concave.length];
    return Math.hypot(q.x - p.x, q.y - p.y) > 100;
  });
  assert.ok(long.length <= 2, `at most the un-diggable bridge edges stay long (${long.length})`);
});

test('concaveHull leaves a convex cluster alone', () => {
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * 50, y: Math.sin(a) * 50 });
  }
  const concave = concaveHull(pts, 30);
  const convex = convexHull(pts);
  assert.ok(polygonArea(concave) >= polygonArea(convex) * 0.999, 'dense ring stays convex');
});

test('hullOfDiscs hugs an L-shaped arrangement tighter than the convex wrap', () => {
  // An L of five rooms: three across, two down — the convex hull bridges the notch.
  const discs = [
    { x: 0, y: 0, r: 30 }, { x: 70, y: 0, r: 30 }, { x: 140, y: 0, r: 30 },
    { x: 0, y: 70, r: 30 }, { x: 0, y: 140, r: 30 },
  ];
  const hull = hullOfDiscs(discs);
  assert.ok(hull.length >= 3);
  assert.ok(isSimple(hull), 'outline is simple');
  const convexPts = [];
  for (const d of discs)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8)
      convexPts.push({ x: d.x + Math.cos(a) * d.r, y: d.y + Math.sin(a) * d.r });
  assert.ok(polygonArea(hull) < polygonArea(convexHull(convexPts)) * 0.97,
    'notch dug out of the L');
  // Still contains every disc centre — hugging, not slicing through rooms.
  for (const d of discs) {
    let inside = false;
    for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
      const a = hull[i], b = hull[j];
      if ((a.y > d.y) !== (b.y > d.y) && d.x < ((b.x - a.x) * (d.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    assert.ok(inside, `disc centre ${d.x},${d.y} inside the outline`);
  }
});
