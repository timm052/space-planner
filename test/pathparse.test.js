import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToPolylines, tokenizePath } from '../src/pathParse.js';

const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const pointNear = (p, q, t = 1e-6) => near(p[0], q[0], t) && near(p[1], q[1], t);

test('tokenizePath splits commands from their numbers', () => {
  assert.deepEqual(tokenizePath('M 10 20 L30 40'), [
    { cmd: 'M', args: [10, 20] },
    { cmd: 'L', args: [30, 40] },
  ]);
});

test('tokenizePath reads negatives, decimals and exponents', () => {
  const t = tokenizePath('M-1.5.25 L1e2 -3E-2');
  assert.deepEqual(t[0].args, [-1.5, 0.25]);
  assert.deepEqual(t[1].args, [100, -0.03]);
});

test('absolute moveto / lineto', () => {
  const [s] = pathToPolylines('M 0 0 L 10 0 L 10 10');
  assert.deepEqual(s.pts, [[0, 0], [10, 0], [10, 10]]);
  assert.equal(s.closed, false);
});

test('relative commands accumulate from the current point', () => {
  const [s] = pathToPolylines('m 5 5 l 10 0 l 0 10');
  assert.deepEqual(s.pts, [[5, 5], [15, 5], [15, 15]]);
});

test('H and V move on one axis only, absolute and relative', () => {
  const [s] = pathToPolylines('M 0 0 H 10 V 5 h -4 v -2');
  assert.deepEqual(s.pts, [[0, 0], [10, 0], [10, 5], [6, 5], [6, 3]]);
});

test('Z closes the subpath and returns the pen to its start', () => {
  const [s] = pathToPolylines('M 0 0 L 10 0 L 10 10 Z');
  assert.equal(s.closed, true);
  assert.deepEqual(s.pts[0], [0, 0]);
});

test('extra coordinate pairs after M are implicit linetos', () => {
  const [s] = pathToPolylines('M 0 0 10 0 10 10');
  assert.deepEqual(s.pts, [[0, 0], [10, 0], [10, 10]]);
});

test('a second M starts a new subpath', () => {
  const subs = pathToPolylines('M 0 0 L 5 0 M 20 20 L 25 20');
  assert.equal(subs.length, 2);
  assert.deepEqual(subs[0].pts, [[0, 0], [5, 0]]);
  assert.deepEqual(subs[1].pts, [[20, 20], [25, 20]]);
});

test('a cubic starts and ends on its endpoints', () => {
  const [s] = pathToPolylines('M 0 0 C 0 10 10 10 10 0', 8);
  assert.ok(pointNear(s.pts[0], [0, 0]));
  assert.ok(pointNear(s.pts[s.pts.length - 1], [10, 0]));
  assert.equal(s.pts.length, 9); // start + 8 samples
  // A symmetric cubic peaks at its midpoint, below the control height.
  const mid = s.pts[4];
  assert.ok(mid[1] > 0 && mid[1] < 10);
});

test('S mirrors the previous cubic control point', () => {
  const [a] = pathToPolylines('M 0 0 C 0 5 5 5 5 0 S 10 -5 10 0', 8);
  const [b] = pathToPolylines('M 0 0 C 0 5 5 5 5 0 C 5 -5 10 -5 10 0', 8);
  for (let i = 0; i < a.pts.length; i++) assert.ok(pointNear(a.pts[i], b.pts[i], 1e-9));
});

test('a quadratic matches its cubic equivalent', () => {
  const [q] = pathToPolylines('M 0 0 Q 5 10 10 0', 8);
  const [c] = pathToPolylines('M 0 0 C 3.3333333333 6.6666666667 6.6666666667 6.6666666667 10 0', 8);
  for (let i = 0; i < q.pts.length; i++) assert.ok(pointNear(q.pts[i], c.pts[i], 1e-6));
});

test('T mirrors the previous quadratic control point', () => {
  const [s] = pathToPolylines('M 0 0 Q 5 10 10 0 T 20 0', 8);
  assert.ok(pointNear(s.pts[s.pts.length - 1], [20, 0], 1e-6));
});

test('an arc lands on its endpoint and bows the right way', () => {
  const [s] = pathToPolylines('M 0 0 A 10 10 0 0 1 20 0', 16);
  assert.ok(pointNear(s.pts[0], [0, 0]));
  assert.ok(pointNear(s.pts[s.pts.length - 1], [20, 0], 1e-6));
  // With the centre at (10,0), sweep=1 runs 180°→360°, so the midpoint is at
  // (10, −10): the arc goes OVER the top in SVG's y-down space.
  const mid = s.pts[Math.floor(s.pts.length / 2)];
  assert.ok(mid[1] < 0, `expected the arc to bow −y (over the top), got ${mid[1]}`);
  // Every sampled point sits on a circle of radius 10 about (10, 0).
  for (const p of s.pts) assert.ok(near(Math.hypot(p[0] - 10, p[1] - 0), 10, 1e-6));
});

test('the sweep flag reverses the bow', () => {
  const [down] = pathToPolylines('M 0 0 A 10 10 0 0 0 20 0', 16);
  const mid = down.pts[Math.floor(down.pts.length / 2)];
  assert.ok(mid[1] > 0, `expected the opposite bow, got ${mid[1]}`);
});

test('arc radii too small to span the endpoints are scaled up, not NaN', () => {
  // SVG F.6.6 — real files contain these, and without the correction the whole
  // subpath comes out as NaN and silently disappears.
  const [s] = pathToPolylines('M 0 0 A 1 1 0 0 1 20 0', 12);
  for (const p of s.pts) {
    assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), `NaN at ${p}`);
  }
  assert.ok(pointNear(s.pts[s.pts.length - 1], [20, 0], 1e-6));
});

test('a zero-radius arc degenerates to a line rather than dividing by zero', () => {
  const [s] = pathToPolylines('M 0 0 A 0 0 0 0 1 10 10');
  assert.ok(pointNear(s.pts[s.pts.length - 1], [10, 10]));
});

test('repeated coordinate sets repeat the command', () => {
  const [s] = pathToPolylines('M 0 0 L 1 0 2 0 3 0');
  assert.deepEqual(s.pts, [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('degenerate and empty input yields no subpaths, never a throw', () => {
  assert.deepEqual(pathToPolylines(''), []);
  assert.deepEqual(pathToPolylines(null), []);
  assert.deepEqual(pathToPolylines('M 5 5'), []); // a lone point is not a line
  assert.deepEqual(pathToPolylines('garbage'), []);
});
