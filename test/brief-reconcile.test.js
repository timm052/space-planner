import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parentsFirst } from '../server/brief.js';
import { pathKeyMap, briefTargetsFor, targetSource, effectiveTarget, spaceStatus, rollup, buildCsv } from '../src/compute.js';

// The Brief↔Design link is the product's whole premise. These pin the two ways
// it was silently failing: hierarchy lost on apply, and unmatched rooms quietly
// measured against themselves.

// ---- parentsFirst -------------------------------------------------------

test('parentsFirst emits a parent before its children', () => {
  // Sort order is the ORDER ROOMS WERE CREATED — rooms first, buildings after,
  // which is what a paste-import then a nest produces. That order is a trap.
  const rows = [
    { id: 1, name: 'Classroom', parent_id: 10, sort_order: 0 },
    { id: 2, name: 'Lab', parent_id: 10, sort_order: 1 },
    { id: 10, name: 'Building A', parent_id: null, sort_order: 2 },
  ];
  const order = parentsFirst(rows).map((r) => r.id);
  assert.ok(order.indexOf(10) < order.indexOf(1), `parent must precede child, got ${order}`);
  assert.ok(order.indexOf(10) < order.indexOf(2), `parent must precede child, got ${order}`);
  assert.equal(order.length, 3);
});

test('parentsFirst handles several levels', () => {
  const rows = [
    { id: 3, parent_id: 2 },
    { id: 2, parent_id: 1 },
    { id: 1, parent_id: null },
  ];
  assert.deepEqual(parentsFirst(rows).map((r) => r.id), [1, 2, 3]);
});

test('parentsFirst keeps every row when a parent is missing or cyclic', () => {
  const orphan = [{ id: 1, parent_id: 99 }, { id: 2, parent_id: null }];
  assert.equal(parentsFirst(orphan).length, 2);
  const cycle = [{ id: 1, parent_id: 2 }, { id: 2, parent_id: 1 }];
  assert.equal(parentsFirst(cycle).length, 2);
});

test('parentsFirst is stable for an already-ordered tree', () => {
  const rows = [{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }, { id: 3, parent_id: 1 }];
  assert.deepEqual(parentsFirst(rows).map((r) => r.id), [1, 2, 3]);
});

// ---- path matching depends on hierarchy ---------------------------------

const BRIEF = [
  { id: 10, name: 'Building C', parent_id: null, kind: 'building', count: 1, target_area: 0, sort_order: 2 },
  { id: 1, name: 'Library', parent_id: 10, kind: 'space', count: 1, target_area: 405, sort_order: 0 },
];

test('a flattened design loses its path match — the defect this fixes', () => {
  const flatDesign = [
    { id: 20, name: 'Building C', parent_id: null, kind: 'building', count: 1, target_area: 0, sort_order: 1 },
    { id: 21, name: 'Library', parent_id: null, kind: 'space', count: 1, target_area: 405, sort_order: 0 },
  ];
  const targets = briefTargetsFor(flatDesign, BRIEF);
  assert.equal(targets.has(21), false); // 'library' ≠ 'building c / library'
  assert.equal(targetSource({ id: 21 }, targets), 'unmatched');
});

test('a nested design matches by path', () => {
  const nested = [
    { id: 20, name: 'Building C', parent_id: null, kind: 'building', count: 1, target_area: 0, sort_order: 1 },
    { id: 21, name: 'Library', parent_id: 20, kind: 'space', count: 1, target_area: 396, sort_order: 0 },
  ];
  const targets = briefTargetsFor(nested, BRIEF);
  assert.equal(targets.get(21), 405);
  assert.equal(targetSource({ id: 21 }, targets), 'brief');
  assert.equal(pathKeyMap(nested).get(21), 'building c / library');
});

// ---- unmatched never falls back -----------------------------------------

test('targetSource separates "no Brief at all" from "Brief exists, no match"', () => {
  assert.equal(targetSource({ id: 1 }, null), 'own'); // no Brief — legitimate fallback
  assert.equal(targetSource({ id: 1 }, new Map()), 'unmatched');
  assert.equal(targetSource({ id: 1 }, new Map([[1, 100]])), 'brief');
});

test('an unmatched room reports "unmatched", not a 0% variance', () => {
  const space = { id: 21, name: 'Library', count: 1, target_area: 396 };
  const snapshot = { areas: { 21: 396 } };
  // Falling back to the design's own target made actual === target → 0% → "on".
  const naive = spaceStatus(space, snapshot, 0.05, null);
  assert.equal(naive.status, 'on');
  assert.equal(naive.pct, 0);
  // With a Brief present and no match, that reading is refused.
  const real = spaceStatus(space, snapshot, 0.05, new Map());
  assert.equal(real.status, 'unmatched');
  assert.equal(real.pct, null);
  assert.equal(real.target, null);
  assert.equal(real.actual, 396);
});

test('a matched room reports its real variance against the Brief figure', () => {
  const space = { id: 21, name: 'Library', count: 1, target_area: 396 };
  const snapshot = { areas: { 21: 396 } };
  const st = spaceStatus(space, snapshot, 0.05, new Map([[21, 405]]));
  assert.equal(st.source, 'brief');
  assert.equal(st.target, 405); // the AGREED figure, not the design's own 396
  assert.ok(Math.abs(st.pct - (396 - 405) / 405) < 1e-9); // −2.22%
  assert.equal(st.status, 'on'); // inside ±5%
});

test('a matched room outside tolerance reports over / under', () => {
  const space = { id: 21, name: 'Library', count: 1, target_area: 300 };
  const under = spaceStatus(space, { areas: { 21: 300 } }, 0.05, new Map([[21, 405]]));
  assert.equal(under.status, 'under'); // −25.9%
  const over = spaceStatus(space, { areas: { 21: 500 } }, 0.05, new Map([[21, 405]]));
  assert.equal(over.status, 'over'); // +23.5%
});

test('rollup counts unmatched rooms instead of inflating the group target', () => {
  const spaces = [
    { id: 1, name: 'A', department: 'Community', count: 1, target_area: 100 },
    { id: 2, name: 'B', department: 'Community', count: 1, target_area: 200 },
  ];
  const snapshot = { areas: { 1: 100, 2: 200 } };
  const targets = new Map([[1, 120]]); // only A is in the Brief
  const [group] = rollup(spaces, snapshot, 0.05, 'department', targets);
  assert.equal(group.unmatched, 1);
  assert.equal(group.target, 120); // B's own 200 is NOT folded in
  assert.equal(group.actual, 300);
});

// ---- CSV ----------------------------------------------------------------

test('the CSV says "unmatched" rather than leaving a blank cell', () => {
  const spaces = [{ id: 21, name: 'Library', department: 'Community', count: 1, target_area: 396, parent_id: null, sort_order: 0 }];
  const brief = [{ id: 1, name: 'Reading Room', department: 'Community', count: 1, target_area: 405, parent_id: null, sort_order: 0 }];
  const csv = buildCsv({ name: 'P' }, spaces, [], brief);
  const row = csv.split('\n').find((l) => l.startsWith(',Community,Library'));
  assert.ok(row.endsWith(',unmatched'), row);
});

test('a matched room with a zero target is not reported as unmatched', () => {
  // Truthiness on the target value made an agreed 0 look like "no Brief row",
  // which sends the reader hunting for something that is right there.
  const spaces = [{ id: 5, name: 'Canteen', department: 'Community', count: 1, target_area: 0, parent_id: null, sort_order: 0 }];
  const brief = [{ id: 1, name: 'Canteen', department: 'Community', count: 1, target_area: 0, parent_id: null, sort_order: 0 }];
  const row = buildCsv({ name: 'P' }, spaces, [], brief).split('\n').find((l) => l.includes('Canteen'));
  assert.ok(!row.includes('unmatched'), row);
  assert.ok(row.endsWith(',0,'), row); // Brief Target 0, variance blank (undefined at 0)
});

test('effectiveTarget still returns a usable number for layout', () => {
  // Sizing code must not get null — only the COMPLIANCE read refuses to guess.
  const space = { id: 21, count: 2, target_area: 50 };
  assert.equal(effectiveTarget(space, new Map()), 100);
  assert.equal(effectiveTarget(space, new Map([[21, 130]])), 130);
});
