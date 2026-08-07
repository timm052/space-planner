import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simplify, roundPoints, toPath, scaleStroke, bboxOf, parseStroke,
  PEN_WIDTHS, PEN_COLORS, DEFAULT_PEN,
} from '../src/markup.js';

// ---- simplify -----------------------------------------------------------

test('simplify keeps the endpoints and drops collinear interior points', () => {
  const line = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  assert.deepEqual(simplify(line, 0.5), [[0, 0], [4, 0]]);
});

test('simplify keeps a point that deviates by more than the tolerance', () => {
  const kinked = [[0, 0], [2, 3], [4, 0]];
  assert.deepEqual(simplify(kinked, 1), [[0, 0], [2, 3], [4, 0]]);
});

test('simplify drops a point that deviates by less than the tolerance', () => {
  const nearlyStraight = [[0, 0], [2, 0.4], [4, 0]];
  assert.deepEqual(simplify(nearlyStraight, 1), [[0, 0], [4, 0]]);
});

test('simplify passes short strokes through untouched', () => {
  const two = [[0, 0], [1, 1]];
  assert.deepEqual(simplify(two, 1), two);
  assert.deepEqual(simplify([], 1), []);
});

test('simplify cuts a dense freehand stroke down substantially', () => {
  // A circle sampled the way a pointermove stream would deliver it.
  const dense = [];
  for (let i = 0; i <= 360; i += 2) {
    const a = (i * Math.PI) / 180;
    dense.push([100 + 40 * Math.cos(a), 100 + 40 * Math.sin(a)]);
  }
  const out = simplify(dense, 1);
  assert.ok(out.length < dense.length / 3, `expected heavy reduction, got ${out.length} of ${dense.length}`);
  assert.deepEqual(out[0], dense[0]);
  assert.deepEqual(out[out.length - 1], dense[dense.length - 1]);
});

// ---- roundPoints --------------------------------------------------------

test('roundPoints trims stored precision without moving the mark', () => {
  assert.deepEqual(roundPoints([[1.23456, 9.87654]], 2), [[1.23, 9.88]]);
});

// ---- toPath -------------------------------------------------------------

test('toPath renders a single point as a zero-length line (a dot)', () => {
  assert.equal(toPath([[5, 6]]), 'M 5 6 L 5 6');
});

test('toPath renders two points as a straight line', () => {
  assert.equal(toPath([[0, 0], [10, 10]]), 'M 0 0 L 10 10');
});

test('toPath smooths three or more points through segment midpoints', () => {
  const d = toPath([[0, 0], [10, 0], [10, 10]]);
  assert.ok(d.startsWith('M 0 0'), d);
  assert.ok(d.includes('Q 10 0'), d); // control point is the sample itself
  assert.ok(d.endsWith('L 10 10'), d);
});

test('toPath is empty for an empty stroke', () => {
  assert.equal(toPath([]), '');
  assert.equal(toPath(null), '');
});

// ---- scaleStroke --------------------------------------------------------

test('scaleStroke moves points and width together through a scale change', () => {
  // 1:500 → 1:1000 halves the units a metre occupies, so f = 0.5.
  const stroke = { points: [[100, 100], [200, 100]], width: 5, color: '#e5484d' };
  const out = scaleStroke(stroke, { x: 100, y: 100 }, 0.5);
  assert.deepEqual(out.points, [[100, 100], [150, 100]]);
  assert.equal(out.width, 2.5);
  assert.equal(out.color, '#e5484d'); // everything else rides along
});

test('scaleStroke is identity at f = 1', () => {
  const stroke = { points: [[3, 4], [5, 6]], width: 2 };
  const out = scaleStroke(stroke, { x: 0, y: 0 }, 1);
  assert.deepEqual(out.points, stroke.points);
  assert.equal(out.width, stroke.width);
});

test('a stroke keeps its position relative to the drawing across a scale change', () => {
  // The mark sits 50 units right of a bubble; after the zoom it must still sit
  // 50 × f units right of that bubble's new position — this is the invariant
  // that stops ink drifting off the plan.
  const anchor = { x: 400, y: 300 };
  const bubble = { x: 500, y: 300 };
  const stroke = { points: [[550, 300]], width: 4 };
  const f = 0.5;
  const movedBubble = { x: anchor.x + (bubble.x - anchor.x) * f, y: 300 };
  const movedStroke = scaleStroke(stroke, anchor, f);
  assert.equal(movedStroke.points[0][0] - movedBubble.x, (550 - 500) * f);
});

// ---- bboxOf -------------------------------------------------------------

test('bboxOf spans every point of every stroke', () => {
  const box = bboxOf([
    { points: [[0, 0], [10, 5]] },
    { points: [[-4, 20]] },
  ]);
  assert.deepEqual(box, { x0: -4, y0: 0, x1: 10, y1: 20 });
});

test('bboxOf is null when there is nothing drawn', () => {
  assert.equal(bboxOf([]), null);
  assert.equal(bboxOf([{ points: [] }]), null);
});

// ---- parseStroke --------------------------------------------------------

test('parseStroke reads a stored row', () => {
  const s = parseStroke({ id: 7, env: 'masterplan', level: 'Ground', color: '#3e63dd', width: 5, points: '[[1,2],[3,4]]' });
  assert.deepEqual(s, { id: 7, env: 'masterplan', level: 'Ground', color: '#3e63dd', width: 5, points: [[1, 2], [3, 4]] });
});

test('parseStroke rejects unusable payloads rather than throwing', () => {
  assert.equal(parseStroke(null), null);
  assert.equal(parseStroke({ points: 'not json' }), null);
  assert.equal(parseStroke({ points: '[]' }), null);
  assert.equal(parseStroke({ points: '[[1,"x"],[null,2]]' }), null); // every point bad
});

test('parseStroke drops individual malformed points but keeps the stroke', () => {
  const s = parseStroke({ id: 1, points: '[[1,2],[null,3],[5,6]]' });
  assert.deepEqual(s.points, [[1, 2], [5, 6]]);
});

test('parseStroke falls back to the default pen when colour or width is missing', () => {
  const s = parseStroke({ id: 2, points: '[[0,0]]' });
  assert.equal(s.color, DEFAULT_PEN.color);
  assert.equal(s.width, DEFAULT_PEN.width);
  assert.equal(s.level, '');
});

// ---- palette ------------------------------------------------------------

test('the pen palette is fixed hex so it survives into a PDF', () => {
  for (const [hex] of PEN_COLORS) assert.match(hex, /^#[0-9a-f]{6}$/i);
  assert.ok(PEN_WIDTHS.every((w) => w > 0));
  assert.ok(PEN_COLORS.some(([hex]) => hex === DEFAULT_PEN.color));
});
