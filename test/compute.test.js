import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  targetTotal,
  isContainerKind,
  childIdSet,
  isPureContainer,
  isWithinDescendant,
  leafSpaces,
  childrenOf,
  orderedTree,
  subtreeArea,
  rootContainer,
  briefNet,
  snapshotNet,
  spaceStatus,
  rollup,
  departmentRollup,
  areaToM2,
  distToMeters,
  metersToDist,
  distUnit,
  fmtArea,
  fmtPct,
  buildCsv,
  M2_PER_FT2,
  M_PER_FT,
} from '../src/compute.js';

// ---- Small fixture builders ---------------------------------------------
let nextId = 1;
function space(overrides = {}) {
  return {
    id: nextId++,
    project_id: 1,
    department: 'General',
    name: 'Room',
    count: 1,
    target_area: 10,
    parent_id: null,
    kind: 'space',
    child_mode: 'group',
    sort_order: 0,
    ...overrides,
  };
}
function snap(areas, extra = {}) {
  return { id: 1, label: 'M1', taken_at: '2026-01-01', gross_area: 0, areas, ...extra };
}

test('targetTotal multiplies count by unit area, defaulting count to 1', () => {
  assert.equal(targetTotal({ count: 3, target_area: 30 }), 90);
  assert.equal(targetTotal({ target_area: 40 }), 40); // count defaults to 1
  assert.equal(targetTotal({ count: 2 }), 0); // area defaults to 0
  assert.equal(targetTotal({}), 0);
});

test('isContainerKind recognises building and group', () => {
  assert.equal(isContainerKind({ kind: 'building' }), true);
  assert.equal(isContainerKind({ kind: 'group' }), true);
  assert.equal(isContainerKind({ kind: 'space' }), false);
  assert.equal(isContainerKind({}), false);
});

test('childIdSet collects every referenced parent_id', () => {
  const a = space({ id: 1, parent_id: null });
  const b = space({ id: 2, parent_id: 1 });
  const c = space({ id: 3, parent_id: 1 });
  const set = childIdSet([a, b, c]);
  assert.ok(set.has(1));
  assert.equal(set.has(2), false);
  assert.equal(set.size, 1);
});

test('isPureContainer: building/group kinds and group-mode parents are pure', () => {
  const childIds = new Set([10]);
  assert.equal(isPureContainer({ kind: 'building', id: 99 }, childIds), true);
  // group-mode space that has children is a pure container
  assert.equal(isPureContainer({ kind: 'space', id: 10, child_mode: 'group' }, childIds), true);
  // 'within' / 'attached' parents carry their own area → not pure containers
  assert.equal(isPureContainer({ kind: 'space', id: 10, child_mode: 'within' }, childIds), false);
  assert.equal(isPureContainer({ kind: 'space', id: 10, child_mode: 'attached' }, childIds), false);
  // a leaf with no children is not a container
  assert.equal(isPureContainer({ kind: 'space', id: 10, child_mode: 'group' }, new Set()), false);
});

test('isWithinDescendant detects an enclosing within ancestor', () => {
  const within = space({ id: 1, kind: 'space', child_mode: 'within' });
  const child = space({ id: 2, parent_id: 1 });
  const grandchild = space({ id: 3, parent_id: 2 });
  const byId = new Map([within, child, grandchild].map((s) => [s.id, s]));
  assert.equal(isWithinDescendant(child, byId), true);
  assert.equal(isWithinDescendant(grandchild, byId), true);
  assert.equal(isWithinDescendant(within, byId), false); // the within space itself
});

test('isWithinDescendant is false under a group/attached ancestor', () => {
  const group = space({ id: 1, kind: 'space', child_mode: 'attached' });
  const child = space({ id: 2, parent_id: 1 });
  const byId = new Map([group, child].map((s) => [s.id, s]));
  assert.equal(isWithinDescendant(child, byId), false);
});

test('leafSpaces: only area-carrying leaves, containers and within-children excluded', () => {
  const building = space({ id: 1, kind: 'building', target_area: 0 });
  const roomA = space({ id: 2, parent_id: 1, target_area: 50 });
  const roomB = space({ id: 3, parent_id: 1, target_area: 30 });
  const withinSpace = space({ id: 4, parent_id: 1, kind: 'space', child_mode: 'within', target_area: 100 });
  const inside = space({ id: 5, parent_id: 4, target_area: 20 }); // swallowed by within
  const leaves = leafSpaces([building, roomA, roomB, withinSpace, inside]);
  const ids = leaves.map((s) => s.id).sort();
  assert.deepEqual(ids, [2, 3, 4]); // building excluded (container), inside excluded (within)
});

test('childrenOf filters by parent_id, treating null/undefined alike', () => {
  const root = space({ id: 1, parent_id: null });
  const child = space({ id: 2, parent_id: 1 });
  const orphanish = space({ id: 3 }); // parent_id null
  assert.deepEqual(childrenOf([root, child, orphanish], 1).map((s) => s.id), [2]);
  assert.deepEqual(childrenOf([root, child, orphanish], null).map((s) => s.id), [1, 3]);
});

test('orderedTree does depth-first by sort_order with correct depths', () => {
  const b = space({ id: 1, kind: 'building', sort_order: 0 });
  const s2 = space({ id: 2, parent_id: 1, sort_order: 2 });
  const s1 = space({ id: 3, parent_id: 1, sort_order: 1 });
  const nested = space({ id: 4, parent_id: 3, sort_order: 0 });
  const tree = orderedTree([b, s2, s1, nested]);
  assert.deepEqual(
    tree.map((t) => [t.space.id, t.depth]),
    [
      [1, 0], // building
      [3, 1], // sort_order 1 before 2
      [4, 2], // nested under id 3
      [2, 1], // sort_order 2
    ]
  );
});

test('orderedTree falls back orphans (missing parent) to root level', () => {
  const orphan = space({ id: 9, parent_id: 999 }); // parent not present
  const tree = orderedTree([orphan]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].space.id, 9);
  assert.equal(tree[0].depth, 0);
});

test('subtreeArea rolls up leaf descendants; within children excluded', () => {
  const building = space({ id: 1, kind: 'building', target_area: 0 });
  const roomA = space({ id: 2, parent_id: 1, count: 2, target_area: 25 }); // 50
  const within = space({ id: 3, parent_id: 1, child_mode: 'within', target_area: 100 });
  const inside = space({ id: 4, parent_id: 3, target_area: 40 }); // excluded
  const all = [building, roomA, within, inside];
  assert.equal(subtreeArea(building, all), 150); // 50 + 100
  assert.equal(subtreeArea(roomA, all), 50);
  assert.equal(subtreeArea(within, all), 100); // its own area, not the inside child
});

test('subtreeArea with attached children sums parent + children', () => {
  const parent = space({ id: 1, child_mode: 'attached', target_area: 60 });
  const attached = space({ id: 2, parent_id: 1, target_area: 15 });
  assert.equal(subtreeArea(parent, [parent, attached]), 75);
});

test('rootContainer returns the top-most ancestor', () => {
  const building = space({ id: 1, kind: 'building' });
  const dept = space({ id: 2, parent_id: 1, kind: 'group' });
  const room = space({ id: 3, parent_id: 2 });
  const byId = new Map([building, dept, room].map((s) => [s.id, s]));
  assert.equal(rootContainer(room, byId).id, 1);
  assert.equal(rootContainer(building, byId), null); // already root
});

test('briefNet sums all leaf targets', () => {
  const building = space({ id: 1, kind: 'building' });
  const a = space({ id: 2, parent_id: 1, count: 3, target_area: 30 }); // 90
  const b = space({ id: 3, parent_id: 1, target_area: 60 }); // 60
  assert.equal(briefNet([building, a, b]), 150);
});

test('snapshotNet sums recorded leaf areas, missing treated as 0', () => {
  const a = space({ id: 1, target_area: 30 });
  const b = space({ id: 2, target_area: 60 });
  assert.equal(snapshotNet(snap({ 1: 28, 2: 64 }), [a, b]), 92);
  assert.equal(snapshotNet(snap({ 1: 28 }), [a, b]), 28); // b missing
});

test('spaceStatus classifies on/over/under and handles missing', () => {
  const s = space({ id: 1, count: 1, target_area: 100 });
  const tol = 0.05;
  assert.equal(spaceStatus(s, snap({ 1: 100 }), tol).status, 'on');
  assert.equal(spaceStatus(s, snap({ 1: 104 }), tol).status, 'on'); // within +5%
  assert.equal(spaceStatus(s, snap({ 1: 106 }), tol).status, 'over');
  assert.equal(spaceStatus(s, snap({ 1: 90 }), tol).status, 'under');
  const missing = spaceStatus(s, snap({}), tol);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.actual, null);
  assert.equal(missing.delta, null);
});

test('spaceStatus computes delta and pct', () => {
  const s = space({ id: 1, count: 2, target_area: 50 }); // target 100
  const r = spaceStatus(s, snap({ 1: 110 }), 0.05);
  assert.equal(r.target, 100);
  assert.equal(r.actual, 110);
  assert.equal(r.delta, 10);
  assert.ok(Math.abs(r.pct - 0.1) < 1e-9);
});

test('spaceStatus with zero target gives pct 0 (no divide-by-zero)', () => {
  const s = space({ id: 1, count: 1, target_area: 0 });
  const r = spaceStatus(s, snap({ 1: 5 }), 0.05);
  assert.equal(r.pct, 0);
  assert.equal(r.status, 'on');
});

test('rollup by department groups leaves and computes status', () => {
  const a = space({ id: 1, department: 'Public', target_area: 100 });
  const b = space({ id: 2, department: 'Public', target_area: 100 });
  const c = space({ id: 3, department: 'Staff', target_area: 50 });
  const rows = rollup([a, b, c], snap({ 1: 100, 2: 100, 3: 60 }), 0.05, 'department');
  const pub = rows.find((r) => r.department === 'Public');
  const staff = rows.find((r) => r.department === 'Staff');
  assert.equal(pub.target, 200);
  assert.equal(pub.actual, 200);
  assert.equal(pub.status, 'on');
  assert.equal(staff.status, 'over'); // 60 vs 50 = +20%
});

test('rollup by building uses root container name', () => {
  const building = space({ id: 1, kind: 'building', name: 'Block A' });
  const room = space({ id: 2, parent_id: 1, department: 'Public', target_area: 80 });
  const loose = space({ id: 3, department: 'Public', target_area: 20 }); // no building
  const rows = rollup([building, room, loose], snap({ 2: 80, 3: 20 }), 0.05, 'building');
  const keys = rows.map((r) => r.key).sort();
  assert.deepEqual(keys, ['Block A', 'Unassigned']);
});

test('rollup marks groups missing when no actuals and null snapshot', () => {
  const a = space({ id: 1, department: 'Public', target_area: 100 });
  const rows = rollup([a], null, 0.05, 'department');
  assert.equal(rows[0].status, 'missing');
  assert.equal(rows[0].delta, null);
  assert.equal(rows[0].pct, null);
});

test('departmentRollup is an alias for rollup by department', () => {
  const a = space({ id: 1, department: 'X', target_area: 10 });
  assert.deepEqual(
    departmentRollup([a], snap({ 1: 10 }), 0.05),
    rollup([a], snap({ 1: 10 }), 0.05, 'department')
  );
});

test('unit conversions round-trip', () => {
  assert.equal(areaToM2(10, 'm2'), 10);
  assert.ok(Math.abs(areaToM2(1, 'ft2') - M2_PER_FT2) < 1e-12);
  assert.equal(distToMeters(10, 'm2'), 10);
  assert.ok(Math.abs(distToMeters(1, 'ft2') - M_PER_FT) < 1e-12);
  assert.ok(Math.abs(metersToDist(distToMeters(7, 'ft2'), 'ft2') - 7) < 1e-9);
  assert.equal(distUnit('m2'), 'm');
  assert.equal(distUnit('ft2'), 'ft');
});

test('fmtArea formats and handles nullish/NaN', () => {
  assert.equal(fmtArea(1234.6, 'm2'), '1,235 m²');
  assert.equal(fmtArea(100, 'ft2'), '100 ft²');
  assert.equal(fmtArea(null, 'm2'), '—');
  assert.equal(fmtArea(NaN, 'm2'), '—');
});

test('fmtPct signs positive, omits sign when asked, handles nullish', () => {
  assert.equal(fmtPct(0.1234), '+12.3%');
  assert.equal(fmtPct(-0.05), '-5.0%');
  assert.equal(fmtPct(0.1234, { signed: false }), '12.3%');
  assert.equal(fmtPct(null), '—');
});

test('buildCsv emits header, leaf rows, totals and gross with escaping', () => {
  const building = space({ id: 1, kind: 'building', name: 'Main' });
  const a = space({ id: 2, parent_id: 1, department: 'Public, Wing', name: 'Lobby', count: 1, target_area: 100 });
  const b = space({ id: 3, parent_id: 1, department: 'Staff', name: 'Office', count: 2, target_area: 25 });
  const snapshots = [snap({ 2: 95, 3: 55 }, { label: 'CD', taken_at: '2026-03-01', gross_area: 300 })];
  const csv = buildCsv({}, [building, a, b], snapshots);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Building,Department,Space,Count,Unit Target,Total Target,CD (2026-03-01)');
  // department with a comma must be quoted
  assert.ok(lines[1].includes('"Public, Wing"'));
  assert.ok(lines[1].startsWith('Main,'));
  // totals row: NET TOTAL = 100 + 50, snapshot net = 95 + 55
  const totals = lines.find((l) => l.includes('NET TOTAL'));
  assert.ok(totals.endsWith('150,150'));
  // gross row carries gross_area
  const gross = lines.find((l) => l.includes('GROSS (GIA)'));
  assert.ok(gross.endsWith('300'));
});

test('distUnit returns m2/ft2 for area-unit labels', () => {
  assert.strictEqual(distUnit('m2'), 'm');
  assert.strictEqual(distUnit('ft2'), 'ft');
});

test('metersToDist converts m→ft and passes m through', () => {
  assert.ok(Math.abs(metersToDist(1, 'ft2') - 1 / 0.3048) < 0.001);
  assert.strictEqual(metersToDist(5, 'm2'), 5);
});
