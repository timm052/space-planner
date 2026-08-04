import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStackScene, build3DScene, boxExtents, boxCorners, polyAt, interiorSeeds, interiorCells,
} from '../src/components/diagram/scenes.js';
import { footHalf } from '../src/components/diagram/modes.js';
import { polygonArea, pointInPolygon } from '../src/geometry.js';

// ---------- shared footprint geometry ----------
// These three back BOTH the live canvas and the PDF sheet builder. Before they
// were shared, the same math sat in four hand-synced copies — the standing
// cause of an export disagreeing with the screen.

test('boxExtents always yields the target area, whatever the aspect', () => {
  for (const node of [null, { w: 1, h: 1 }, { w: 4, h: 1 }, { w: 1, h: 3 }, { w: 16, h: 9 }]) {
    const { w, h } = boxExtents(400, node);
    assert.ok(Math.abs(w * h - 400) < 1e-9, `area held for aspect ${node ? node.w / node.h : 'square'}`);
  }
});

test('boxExtents keeps the authored aspect ratio', () => {
  const { w, h } = boxExtents(400, { w: 40, h: 10 });
  assert.ok(Math.abs(w / h - 4) < 1e-9, 'aspect 4 preserved');
});

test('boxExtents treats a degenerate or missing box as square', () => {
  assert.deepEqual(boxExtents(100, null), { w: 10, h: 10 });
  assert.deepEqual(boxExtents(100, { w: 0, h: 5 }), { w: 10, h: 10 });
});

test('boxCorners places four corners around the position, area intact', () => {
  const pts = boxCorners(400, { x: 50, y: 60, w: 4, h: 1 });
  assert.equal(pts.length, 4);
  assert.ok(Math.abs(Math.abs(polygonArea(pts)) - 400) < 1e-6, 'the placed box still has the target area');
  const cx = pts.reduce((a, p) => a + p.x, 0) / 4;
  const cy = pts.reduce((a, p) => a + p.y, 0) / 4;
  assert.ok(Math.abs(cx - 50) < 1e-9 && Math.abs(cy - 60) < 1e-9, 'centred on the position');
});

test('boxCorners rotation preserves area and centre', () => {
  const pts = boxCorners(400, { x: 50, y: 60, w: 4, h: 1, rot: 37 });
  assert.ok(Math.abs(Math.abs(polygonArea(pts)) - 400) < 1e-6);
  const cx = pts.reduce((a, p) => a + p.x, 0) / 4;
  assert.ok(Math.abs(cx - 50) < 1e-9, 'rotation is about the centre');
});

// The invariant the whole extraction exists to protect.
test('the PDF sheet and the snap resolver agree on a box footprint', () => {
  const node = { w: 40, h: 10, rot: 0 };
  const half = footHalf({}, node, { isBuilding: true, areaUnits: () => 400, radiusOf: () => 0 });
  const pts = boxCorners(400, { x: 0, y: 0, ...node });
  const spanX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const spanY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
  assert.ok(Math.abs(spanX / 2 - half.x) < 1e-9, 'sheet width matches the snap half-extent');
  assert.ok(Math.abs(spanY / 2 - half.y) < 1e-9, 'sheet height matches the snap half-extent');
});

test('polyAt rescales an outline to the target area and places it', () => {
  const unit = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]; // area 4
  const pts = polyAt(unit, 400, { x: 10, y: 20 }, polygonArea);
  assert.ok(Math.abs(Math.abs(polygonArea(pts)) - 400) < 1e-6, 'rescaled to the target area');
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  assert.ok(Math.abs(cx - 10) < 1e-9, 'placed at the position');
});

test('polyAt rotation preserves the area', () => {
  const unit = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
  const pts = polyAt(unit, 250, { x: 0, y: 0, rot: 53 }, polygonArea);
  assert.ok(Math.abs(Math.abs(polygonArea(pts)) - 250) < 1e-6);
});

// ---------- interior sketch ----------
// The canvas and the PDF sheet used to compute this twice. These lock the
// shared core so they cannot drift apart again.

const room = (id, name, level) => ({ id, name, level, count: 1 });
const frame = {
  hc: { x: 0, y: 0 },
  hullArea: 400,
  discs: [
    { s: room(1, 'A', 'Ground'), i: 0, x: -8, y: -8 },
    { s: room(2, 'B', 'Ground'), i: 0, x: 8, y: -8 },
    { s: room(3, 'C', 'First'), i: 0, x: 0, y: 8 },
  ],
};
const square = (half) => [
  { x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half },
];
const storeyOf = (s) => s.level;

test('interiorSeeds maps the concept frame into the envelope, one seed per room', () => {
  const boundary = square(40).map((p) => ({ x: p.x + 100, y: p.y + 100 }));
  const seeds = interiorSeeds({
    frame, boundary, origin: { x: 100, y: 100 }, area: 1600, storey: null, storeyOf,
  });
  assert.equal(seeds.length, 3);
  assert.deepEqual(seeds.map((s) => s.key), ['1:0', '2:0', '3:0']);
  // hullArea 400 → area 1600 doubles the frame, so a disc at -8 lands at -16.
  assert.deepEqual({ x: seeds[0].x, y: seeds[0].y }, { x: 84, y: 84 });
});

test('interiorSeeds filters to one storey but keeps the whole-building frame', () => {
  const boundary = square(40).map((p) => ({ x: p.x + 100, y: p.y + 100 }));
  const args = { frame, boundary, origin: { x: 100, y: 100 }, area: 1600, storeyOf };
  const ground = interiorSeeds({ ...args, storey: 'Ground' });
  assert.deepEqual(ground.map((s) => s.s.name), ['A', 'B']);
  // The mapping frame is unchanged by the filter, so A does not shift when the
  // storey changes — that is what stops seeds jumping between storeys.
  const all = interiorSeeds({ ...args, storey: null });
  assert.deepEqual({ x: ground[0].x, y: ground[0].y }, { x: all[0].x, y: all[0].y });
});

test('interiorSeeds clamps a seed that falls outside the envelope', () => {
  // A tight envelope: the mapped seeds land well outside it.
  const boundary = square(4).map((p) => ({ x: p.x + 100, y: p.y + 100 }));
  const seeds = interiorSeeds({
    frame, boundary, origin: { x: 100, y: 100 }, area: 1600, storey: null, storeyOf,
  });
  for (const s of seeds) {
    assert.ok(pointInPolygon(boundary, { x: s.x, y: s.y }), `${s.key} was pulled inside the envelope`);
  }
});

test('interiorSeeds honours a live seed drag via override', () => {
  const boundary = square(40).map((p) => ({ x: p.x + 100, y: p.y + 100 }));
  const seeds = interiorSeeds({
    frame, boundary, origin: { x: 100, y: 100 }, area: 1600, storey: null, storeyOf,
    override: (key) => (key === '2:0' ? { x: 110, y: 95 } : undefined),
  });
  assert.deepEqual({ x: seeds[1].x, y: seeds[1].y }, { x: 110, y: 95 }, 'the dragged seed wins');
  assert.deepEqual({ x: seeds[0].x, y: seeds[0].y }, { x: 84, y: 84 }, 'its neighbours are untouched');
});

test('interiorCells returns one entry per seed, aligned by index', () => {
  const boundary = square(40).map((p) => ({ x: p.x + 100, y: p.y + 100 }));
  const seeds = interiorSeeds({
    frame, boundary, origin: { x: 100, y: 100 }, area: 1600, storey: null, storeyOf,
  });
  const cells = interiorCells({
    seeds, boundary, weights: seeds.map(() => 0), circ: 0, netAreaOf: () => 100,
  });
  assert.equal(cells.length, seeds.length, 'aligned with the seeds');
  for (let i = 0; i < cells.length; i++) {
    assert.equal(cells[i].seed.key, seeds[i].key);
    assert.ok(cells[i].cell.length >= 3, 'a real polygon');
  }
});

test('circulation shrinks each cell toward its own seed', () => {
  const boundary = square(40).map((p) => ({ x: p.x + 100, y: p.y + 100 }));
  const seeds = interiorSeeds({
    frame, boundary, origin: { x: 100, y: 100 }, area: 1600, storey: null, storeyOf,
  });
  const weights = seeds.map(() => 0);
  const full = interiorCells({ seeds, boundary, weights, circ: 0, netAreaOf: () => 1e9 });
  const shrunk = interiorCells({ seeds, boundary, weights, circ: 0.3, netAreaOf: () => 50 });
  for (let i = 0; i < seeds.length; i++) {
    const a0 = Math.abs(polygonArea(full[i].cell));
    const a1 = Math.abs(polygonArea(shrunk[i].cell));
    assert.ok(a1 < a0, 'the cell gave up area to circulation');
    assert.ok(Math.abs(a1 - 50) < 1e-6, 'and shrank to exactly the net target');
  }
});

test('a zero circulation fraction leaves the cells filling the envelope', () => {
  const boundary = square(40).map((p) => ({ x: p.x + 100, y: p.y + 100 }));
  const seeds = interiorSeeds({
    frame, boundary, origin: { x: 100, y: 100 }, area: 1600, storey: null, storeyOf,
  });
  const weights = seeds.map(() => 0);
  const cells = interiorCells({ seeds, boundary, weights, circ: 0, netAreaOf: () => 1 });
  const total = cells.reduce((a, c) => a + Math.abs(polygonArea(c.cell)), 0);
  assert.ok(Math.abs(total - 6400) < 1e-6, 'the cells partition the whole 80x80 envelope');
});

// A tiny two-storey program: two rooms on Ground, one on First.
const spaces = [
  { id: 1, name: 'A', count: 1, level: 'Ground' },
  { id: 2, name: 'B', count: 1, level: 'Ground' },
  { id: 3, name: 'C', count: 1, level: 'First' },
];
const instances = spaces.map((s) => ({ s, i: 0, key: `${s.id}:0` }));
const nodes = new Map([
  ['1:0', { x: 100, y: 100 }],
  ['2:0', { x: 200, y: 100 }],
  ['3:0', { x: 150, y: 150 }],
]);
const levels = ['Ground', 'First'];
const levelRank = new Map([['Ground', 0], ['First', 1]]);
const radiusOf = () => 20;
const levelOf = (s) => s.level;
const rankOf = (s) => levelRank.get(s.level) ?? 0;
const palette = ['#111111', '#222222'];

const base = { nodes, instances, levels, levelRank, radiusOf, levelOf, palette };

test('buildStackScene projects every placed instance and builds one plate per level', () => {
  const scene = buildStackScene({ ...base, floorMode: 'offset', floorGap: 0.6 });
  assert.equal(scene.floors.length, 2);
  assert.equal(scene.screenPos.size, 3);
  assert.equal(scene.guides.length, 4); // offset mode → corner guides
  assert.ok(scene.groundTransform); // iso camera warps ground images
  // Ordered bottom→top: Ground instances before First.
  const ranks = scene.ordered.map((o) => levelRank.get(levelOf(o.s)));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('buildStackScene overlaid mode has no lift (no guides, shared plane)', () => {
  const scene = buildStackScene({ ...base, floorMode: 'overlaid', floorGap: 0.6 });
  assert.equal(scene.guides.length, 0);
  // With zero lift, the two rooms on the same spot of different floors project
  // to the same screen point.
  const g = scene.screenPos.get('1:0');
  assert.ok(Number.isFinite(g.x) && Number.isFinite(g.y));
});

test('buildStackScene closestPairScreen works in projected space', () => {
  const scene = buildStackScene({ ...base, floorMode: 'offset', floorGap: 0.6 });
  const pair = scene.closestPairScreen(spaces[0], spaces[1]);
  assert.ok(pair && pair.d > 0);
});

test('build3DScene re-centres rooms onto a shared footprint and keeps links', () => {
  const scene = build3DScene({
    ...base,
    adjacencies: [{ space_a: 1, space_b: 2, strength: 'required' }],
    byId: new Map(spaces.map((s) => [s.id, s])),
    rankOf,
    shapeOf: () => 'bubble',
    polyVertsOf: () => null,
    colorOf: () => '#abcdef',
    groundImage: null,
  });
  assert.equal(scene.rooms.length, 3);
  assert.equal(scene.links.length, 1);
  assert.equal(scene.links[0].strength, 'required');
  assert.equal(scene.floorCount, 2);
  assert.equal(scene.image, null);
  // Ground floor content is centred: rooms 1 and 2 straddle the origin in x.
  const [r1, r2] = scene.rooms;
  assert.ok(Math.abs(r1.x + r2.x) < 1e-9);
});

test('build3DScene stacks real storey heights when a scale exists', () => {
  const heights = { Ground: 3, First: 4 };
  const withHeights = spaces.map((s) => (s.id === 3 ? { ...s, height_m: 7 } : s));
  const scene = build3DScene({
    ...base,
    instances: withHeights.map((s) => ({ s, i: 0, key: `${s.id}:0` })),
    adjacencies: [{ space_a: 1, space_b: 3, strength: 'required' }],
    byId: new Map(withHeights.map((s) => [s.id, s])),
    rankOf,
    shapeOf: () => 'box',
    polyVertsOf: () => null,
    colorOf: () => '#abcdef',
    groundImage: null,
    mToU: 2, // 1 m = 2 diagram units
    levelHeightM: (label) => heights[label],
    roomHeightM: (s) => (s.height_m > 0 ? s.height_m : heights[s.level]),
  });
  assert.equal(scene.metric, true);
  // Level bases are cumulative sums of the storeys below (in units).
  const ground = scene.floors.find((f) => f.label === 'Ground');
  const first = scene.floors.find((f) => f.label === 'First');
  assert.equal(ground.baseU, 0);
  assert.equal(ground.heightU, 6); // 3 m × 2
  assert.equal(first.baseU, 6);
  assert.equal(first.heightU, 8); // 4 m × 2
  // Rooms inherit their storey's height unless they declare their own.
  const hall = scene.rooms.find((r) => r.key === '1:0');
  const studio = scene.rooms.find((r) => r.key === '3:0');
  assert.equal(hall.baseU, 0);
  assert.equal(hall.hU, 6);
  assert.equal(studio.baseU, 6);
  assert.equal(studio.hU, 14); // its own 7 m × 2
  // Links carry the same base/height so endpoints sit on their floors.
  const [link] = scene.links;
  assert.equal(link.a[5], 0);
  assert.equal(link.b[5], 6);
  assert.equal(link.b[6], 14);
});

test('build3DScene falls back to uniform heights without a scale', () => {
  const scene = build3DScene({
    ...base,
    adjacencies: [],
    byId: new Map(spaces.map((s) => [s.id, s])),
    rankOf,
    shapeOf: () => 'box',
    polyVertsOf: () => null,
    colorOf: () => '#abcdef',
    groundImage: null,
    mToU: null,
    levelHeightM: (label) => ({ Ground: 3, First: 4 })[label],
    roomHeightM: () => 3,
  });
  assert.equal(scene.metric, false);
  for (const f of scene.floors) assert.equal(f.baseU, 0);
  for (const r of scene.rooms) assert.equal(r.hU, 0);
});

test('build3DScene positions the ground image relative to the ground-floor centre', () => {
  const scene = build3DScene({
    ...base,
    adjacencies: [],
    byId: new Map(spaces.map((s) => [s.id, s])),
    rankOf,
    shapeOf: () => 'bubble',
    polyVertsOf: () => null,
    colorOf: () => '#abcdef',
    groundImage: { href: 'data:image/png;base64,AAAA', x: 100, y: 50, w: 200, h: 100 },
  });
  assert.ok(scene.image);
  assert.equal(scene.image.w, 200);
  // Ground centre is (150, 100); image centre (200, 100) → cx = 50, cy = 0.
  assert.equal(scene.image.cx, 50);
  assert.equal(scene.image.cy, 0);
});
