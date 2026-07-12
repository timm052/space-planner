import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStackScene, build3DScene } from '../src/components/diagram/scenes.js';

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
