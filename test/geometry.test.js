import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convexHull, smoothHullPath, pinsOf, filterCss, IMAGE_FILTERS,
  polygonArea, polygonCentroid, normalizePolygon, parsePoly, polygonPath, polyBounds,
  regularPolygon, lShape, smoothPolygonPoints } from '../src/geometry.js';

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
