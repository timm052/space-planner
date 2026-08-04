// Unit tests for diagram/modes.js — the snap/pan/marquee geometry lifted out of
// BubbleTab. None of this had direct coverage before: it was reachable only by
// driving a full pointer gesture against a mounted diagram, which is why the
// edge cases below (corner latching, guide bounds, Alt-fine grid) went untested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAP_TOL,
  MODE_ORDER,
  snapToGrid,
  footHalf,
  neighbourEdges,
  resolveAxis,
  resolveDrag,
  panTo,
  panMoved,
  marqueeBoxAt,
} from '../src/components/diagram/modes.js';

const GRID = { step: 50, minorStep: 10 };

// ---------- snapToGrid ----------

test('snapToGrid is the identity when there is no grid', () => {
  assert.equal(snapToGrid(137.4, false, null), 137.4);
  assert.equal(snapToGrid(137.4, true, null), 137.4);
});

test('snapToGrid rounds to the major step, or the minor step when fine', () => {
  assert.equal(snapToGrid(137, false, GRID), 150);
  assert.equal(snapToGrid(137, true, GRID), 140);
  assert.equal(snapToGrid(-137, false, GRID), -150, 'negative coordinates round symmetrically');
});

// ---------- footHalf ----------

const ctxConcept = { isBuilding: false, areaUnits: () => 400, radiusOf: () => 11 };
const ctxBuilding = { isBuilding: true, areaUnits: () => 400, radiusOf: () => 11 };

test('outside the Building env a footprint is the circle radius on both axes', () => {
  assert.deepEqual(footHalf({}, { w: 3, h: 1 }, ctxConcept), { x: 11, y: 11 });
});

test('a Building box without measured w/h is a square of the target area', () => {
  // 400 units² → 20×20 → half-extents 10.
  assert.deepEqual(footHalf({}, null, ctxBuilding), { x: 10, y: 10 });
});

test('a Building box keeps its aspect while matching the target area', () => {
  // aspect 4 at 400 units² → 40 wide × 10 high → halves 20 × 5.
  const h = footHalf({}, { w: 40, h: 10 }, ctxBuilding);
  assert.deepEqual(h, { x: 20, y: 5 });
  assert.equal(h.x * 2 * (h.y * 2), 400, 'the rescaled box still has the target area');
});

test('an odd quarter-turn swaps the half-extents; an even one does not', () => {
  const node = { w: 40, h: 10 };
  assert.deepEqual(footHalf({}, { ...node, rot: 90 }, ctxBuilding), { x: 5, y: 20 });
  assert.deepEqual(footHalf({}, { ...node, rot: 270 }, ctxBuilding), { x: 5, y: 20 });
  assert.deepEqual(footHalf({}, { ...node, rot: 180 }, ctxBuilding), { x: 20, y: 5 });
  assert.deepEqual(footHalf({}, { ...node, rot: 0 }, ctxBuilding), { x: 20, y: 5 });
});

// ---------- neighbourEdges ----------

function edgeCtx(nodes, { visible = () => true } = {}) {
  return {
    instances: Object.keys(nodes).map((key) => ({ key, s: { id: key } })),
    nodeOf: (k) => nodes[k],
    levelVisible: visible,
    halfOf: () => ({ x: 10, y: 5 }),
  };
}

test('neighbourEdges offers each neighbour three lines per axis and excludes the dragged one', () => {
  const nodes = { a: { x: 100, y: 200 }, b: { x: 300, y: 400 } };
  const cands = neighbourEdges('a', edgeCtx(nodes));
  assert.deepEqual(cands.x.map((c) => c.at), [290, 300, 310], 'near edge, centre, far edge');
  assert.deepEqual(cands.y.map((c) => c.at), [395, 400, 405]);
  assert.equal(cands.x[0].c, 400, 'carries the neighbour perpendicular centre');
  assert.equal(cands.x[0].h, 5, 'and its perpendicular half-extent, for bounded guides');
});

test('neighbourEdges skips rooms hidden on another level', () => {
  const nodes = { a: { x: 0, y: 0 }, b: { x: 300, y: 400 } };
  const cands = neighbourEdges('a', edgeCtx(nodes, { visible: () => false }));
  assert.deepEqual(cands, { x: [], y: [] });
});

// ---------- resolveAxis ----------

const candsAt = (...ats) => ats.map((at) => ({ at, c: 0, h: 0 }));

test('resolveAxis passes the position straight through when both snaps are off', () => {
  const r = resolveAxis(137, 10, candsAt(140), false, false, false, GRID);
  assert.equal(r.val, 137);
  assert.equal(r.cand, null);
});

test('resolveAxis latches the CENTRE onto a neighbour line within tolerance', () => {
  const r = resolveAxis(137, 0, candsAt(140), false, true, false, GRID);
  assert.equal(r.val, 140);
  assert.ok(r.cand, 'reports the matched candidate so a guide can be drawn');
});

test('resolveAxis latches an EDGE, not just the centre — boxes go flush', () => {
  // Half-extent 10, so the right edge sits at 145 and reaches the line at 148.
  const r = resolveAxis(135, 10, candsAt(148), false, true, false, GRID);
  assert.equal(r.val, 138, 'centre moved so the EDGE lands on the line');
});

test('resolveAxis takes the nearest candidate when several are in reach', () => {
  const r = resolveAxis(100, 0, candsAt(106, 102, 95), false, true, false, GRID);
  assert.equal(r.val, 102);
});

test('resolveAxis ignores candidates beyond SNAP_TOL', () => {
  const r = resolveAxis(100, 0, candsAt(100 + SNAP_TOL + 1), false, true, false, GRID);
  assert.equal(r.val, 100, 'nothing latched');
  assert.equal(r.cand, null);
});

test('resolveAxis falls back to the grid when edge snap finds nothing', () => {
  const r = resolveAxis(137, 0, candsAt(900), false, true, true, GRID);
  assert.equal(r.val, 150, 'no edge in reach → the grid takes over');
  assert.equal(r.cand, null);
});

test('edge snap beats the grid when both are on and an edge is in reach', () => {
  const r = resolveAxis(137, 0, candsAt(140), false, true, true, GRID);
  assert.equal(r.val, 140, 'the neighbour wins over the grid cell at 150');
});

// ---------- resolveDrag ----------

const dragArgs = (over) => ({
  raw: { x: 100, y: 100 },
  half: { x: 10, y: 5 },
  neighbours: { x: [], y: [] },
  fine: false,
  useEdges: false,
  useGrid: false,
  grid: GRID,
  ...over,
});

test('resolveDrag with no snapping returns the raw point and no guides', () => {
  const r = resolveDrag(dragArgs());
  assert.deepEqual({ x: r.x, y: r.y }, { x: 100, y: 100 });
  assert.deepEqual(r.guides, []);
});

test('resolveDrag emits one bounded guide per snapped axis', () => {
  const r = resolveDrag(
    dragArgs({
      useEdges: true,
      neighbours: { x: [{ at: 104, c: 300, h: 20 }], y: [] },
    })
  );
  assert.equal(r.x, 104, 'x latched');
  assert.equal(r.y, 100, 'y untouched');
  assert.equal(r.guides.length, 1);
  const g = r.guides[0];
  assert.equal(g.x, 104, 'the guide sits on the snapped line');
  // Spans from the dragged box (100 ± 5) to the neighbour (300 ± 20) — and no
  // further. A guide running the full canvas height would be the bug here.
  assert.equal(g.y0, 95);
  assert.equal(g.y1, 320);
});

test('resolveDrag can snap both axes at once — a corner latch', () => {
  const r = resolveDrag(
    dragArgs({
      useEdges: true,
      neighbours: { x: [{ at: 104, c: 300, h: 20 }], y: [{ at: 97, c: 500, h: 30 }] },
    })
  );
  // x: the centre itself latches (half-extent 10 puts no edge nearer).
  // y: the NEAR EDGE latches — at half-extent 5 the edge sits at 95 and the
  // line is at 97, so the centre lands at 102, not on the line itself.
  assert.deepEqual({ x: r.x, y: r.y }, { x: 104, y: 102 });
  assert.equal(r.y - 5, 97, 'the near edge, not the centre, is what sits on the line');
  assert.equal(r.guides.length, 2, 'a guide for each axis');
});

// ---------- pan ----------

const rect = { width: 900, height: 620 };
const vbz = { w: 900, h: 620 };

test('panTo moves the view opposite the cursor, one-to-one at zoom 1', () => {
  const pan = { sx: 400, sy: 300, vx: 0, vy: 0 };
  assert.deepEqual(panTo(pan, { clientX: 340, clientY: 260 }, vbz, rect), { x: 60, y: 40 });
});

test('panTo scales the delta by the visible world size — a zoomed view pans slower', () => {
  const pan = { sx: 400, sy: 300, vx: 0, vy: 0 };
  const zoomed = { w: 450, h: 310 }; // 2x zoom → half the world visible
  assert.deepEqual(panTo(pan, { clientX: 340, clientY: 300 }, zoomed, rect), { x: 30, y: 0 });
});

test('panMoved distinguishes a stationary press from a real drag', () => {
  const pan = { sx: 400, sy: 300, vx: 0, vy: 0 };
  assert.equal(panMoved(pan, { clientX: 401, clientY: 301 }), false, 'a 2px twitch is a click');
  assert.equal(panMoved(pan, { clientX: 410, clientY: 300 }), true);
});

// ---------- marquee ----------

test('marqueeBoxAt moves only the trailing corner, and may invert', () => {
  const box = { x0: 100, y0: 100, x1: 100, y1: 100 };
  assert.deepEqual(marqueeBoxAt(box, { x: 200, y: 180 }), { x0: 100, y0: 100, x1: 200, y1: 180 });
  assert.deepEqual(
    marqueeBoxAt(box, { x: 40, y: 20 }),
    { x0: 100, y0: 100, x1: 40, y1: 20 },
    'dragging up-left inverts the box rather than clamping'
  );
});

// ---------- arbitration ----------

test('MODE_ORDER puts the hook-owned modes ahead of the inline ones', () => {
  // The precedence contract: a gesture that could be read two ways goes to the
  // earlier mode. Vertex editing must win over a plain room drag, and a room
  // drag must win over marquee — otherwise pressing a room would rubber-band.
  const idx = (m) => MODE_ORDER.indexOf(m);
  assert.ok(idx('poly') < idx('drag'), 'vertex editing beats dragging the room');
  assert.ok(idx('layer') < idx('marquee'), 'moving an image layer beats marquee select');
  assert.ok(idx('link') < idx('drag'), 'a link drag beats moving the room');
  assert.ok(idx('pan') < idx('marquee'), 'a held pan beats rubber-band select');
  assert.equal(new Set(MODE_ORDER).size, MODE_ORDER.length, 'no duplicates');
});
