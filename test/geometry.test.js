import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convexHull, smoothHullPath, pinsOf, filterCss, IMAGE_FILTERS } from '../src/geometry.js';

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
