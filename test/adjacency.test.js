import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  edgeGap,
  linkSatisfied,
  linkCredit,
  adjacencyScore,
  scoreBand,
  CREDIT_FALLOFF,
  DEFAULT_THRESHOLDS_M,
  LINK_WEIGHT,
} from '../src/adjacency.js';

test('edgeGap subtracts both radii and clamps overlap to zero', () => {
  assert.equal(edgeGap(100, 20, 30), 50); // 100 - 20 - 30
  assert.equal(edgeGap(40, 20, 30), 0); // overlapping → touching, not negative
});

test('linkSatisfied compares the gap against the per-strength threshold', () => {
  assert.equal(linkSatisfied('required', 2, DEFAULT_THRESHOLDS_M), true); // exactly at threshold
  assert.equal(linkSatisfied('required', 2.5, DEFAULT_THRESHOLDS_M), false);
  assert.equal(linkSatisfied('desired', 10, DEFAULT_THRESHOLDS_M), true);
  assert.equal(linkSatisfied('desired', 15, DEFAULT_THRESHOLDS_M), false);
});

test('linkSatisfied falls back to the desired threshold for unknown strengths', () => {
  assert.equal(linkSatisfied('mystery', DEFAULT_THRESHOLDS_M.desired, DEFAULT_THRESHOLDS_M), true);
  assert.equal(linkSatisfied('mystery', DEFAULT_THRESHOLDS_M.desired + 1, DEFAULT_THRESHOLDS_M), false);
});

test('linkCredit gives full credit within the threshold and none past the falloff', () => {
  const t = DEFAULT_THRESHOLDS_M.required;
  assert.equal(linkCredit('required', 0), 1);
  assert.equal(linkCredit('required', t), 1); // exactly at the threshold
  assert.equal(linkCredit('required', t * CREDIT_FALLOFF), 0); // at the falloff limit
  assert.equal(linkCredit('required', 999), 0);
});

test('linkCredit falls smoothly and monotonically between threshold and limit', () => {
  const t = DEFAULT_THRESHOLDS_M.desired;
  const mid = linkCredit('desired', t * 2); // halfway through the falloff band
  assert.ok(Math.abs(mid - 0.5) < 1e-9, 'smoothstep midpoint is exactly half credit');
  let prev = 1;
  for (let gap = t; gap <= t * CREDIT_FALLOFF; gap += t / 10) {
    const c = linkCredit('desired', gap);
    assert.ok(c <= prev + 1e-12, `credit never rises as the gap grows (gap ${gap})`);
    prev = c;
  }
});

test('linkCredit with a zero threshold is all-or-nothing', () => {
  const strict = { required: 0, desired: 0 };
  assert.equal(linkCredit('required', 0, strict), 1);
  assert.equal(linkCredit('required', 0.01, strict), 0);
});

test('adjacencyScore grades partial credit between threshold and falloff', () => {
  // A desired link halfway through its falloff band scores half its weight,
  // but still counts as UNMET for the badge count / highlighting.
  const gap = DEFAULT_THRESHOLDS_M.desired * 2;
  const r = adjacencyScore([{ id: 1, strength: 'desired', gap }]);
  assert.ok(Math.abs(r.score - 0.5) < 1e-9);
  assert.equal(r.met, 0);
  assert.deepEqual(r.unmet.map((l) => l.id), [1]);
});

test('adjacencyScore weights required links above desired ones', () => {
  // One required met, one desired unmet → metWeight 2 of totalWeight 3.
  const r = adjacencyScore([
    { id: 1, strength: 'required', gap: 0 },
    { id: 2, strength: 'desired', gap: 99 },
  ]);
  assert.equal(r.metWeight, LINK_WEIGHT.required);
  assert.equal(r.totalWeight, LINK_WEIGHT.required + LINK_WEIGHT.desired);
  assert.ok(Math.abs(r.score - 2 / 3) < 1e-9);
  assert.equal(r.met, 1);
  assert.equal(r.total, 2);
});

test('adjacencyScore returns the unmet links with their identifying fields', () => {
  const r = adjacencyScore([
    { id: 10, strength: 'required', gap: 100 },
    { id: 11, strength: 'required', gap: 0 },
  ]);
  assert.deepEqual(r.unmet.map((l) => l.id), [10]);
  assert.equal(r.score, LINK_WEIGHT.required / (2 * LINK_WEIGHT.required)); // 0.5
});

test('adjacencyScore is 1 when everything is satisfied', () => {
  const r = adjacencyScore([
    { id: 1, strength: 'required', gap: 0 },
    { id: 2, strength: 'desired', gap: 5 },
  ]);
  assert.equal(r.score, 1);
  assert.equal(r.unmet.length, 0);
});

test('adjacencyScore yields a null score for no links', () => {
  const r = adjacencyScore([]);
  assert.equal(r.score, null);
  assert.equal(r.total, 0);
});

test('adjacencyScore honours custom thresholds', () => {
  const strict = { required: 0, desired: 0 };
  const r = adjacencyScore([{ id: 1, strength: 'required', gap: 1 }], { thresholds: strict });
  assert.equal(r.score, 0); // gap 1 > 0 → unmet
});

test('scoreBand maps a score to good / warn / bad', () => {
  assert.equal(scoreBand(1), 'good');
  assert.equal(scoreBand(0.9), 'good');
  assert.equal(scoreBand(0.89), 'warn');
  assert.equal(scoreBand(0.7), 'warn');
  assert.equal(scoreBand(0.69), 'bad');
  assert.equal(scoreBand(0), 'bad');
  assert.equal(scoreBand(null), null);
});

test('linkSatisfied: required gap ≤ 2 m is satisfied, gap > 2 m is not', () => {
  assert.ok(linkSatisfied('required', 1.5));
  assert.ok(!linkSatisfied('required', 3));
});

test('linkSatisfied: desired gap ≤ 12 m is satisfied', () => {
  assert.ok(linkSatisfied('desired', 10));
  assert.ok(!linkSatisfied('desired', 15));
});

test('scoreBand maps score ranges to colour bands', () => {
  assert.strictEqual(scoreBand(1),   'good'); // ≥ 0.9
  assert.strictEqual(scoreBand(0.8), 'warn'); // ≥ 0.7
  assert.strictEqual(scoreBand(0.5), 'bad');  // < 0.7
  assert.strictEqual(scoreBand(null), null);
});

// ---- closestInstancePair ---------------------------------------------------

import { closestInstancePair } from '../src/adjacency.js';

test('closestInstancePair picks the minimal pair across instances', () => {
  const positions = new Map([
    ['1:0', { x: 0, y: 0 }],
    ['1:1', { x: 100, y: 0 }],
    ['2:0', { x: 110, y: 0 }],
    ['2:1', { x: 500, y: 0 }],
  ]);
  const pair = closestInstancePair(positions, { id: 1, count: 2 }, { id: 2, count: 2 });
  assert.equal(pair.d, 10); // 1:1 ↔ 2:0
  assert.equal(pair.ai, 1);
  assert.equal(pair.bi, 0);
});

test('closestInstancePair treats a missing/zero count as one instance', () => {
  const positions = new Map([
    ['1:0', { x: 0, y: 0 }],
    ['2:0', { x: 3, y: 4 }],
  ]);
  const pair = closestInstancePair(positions, { id: 1 }, { id: 2 });
  assert.equal(pair.d, 5);
});

test('closestInstancePair returns null when either side has no placed instance', () => {
  const positions = new Map([['1:0', { x: 0, y: 0 }]]);
  assert.equal(closestInstancePair(positions, { id: 1 }, { id: 9 }), null);
});

// ---- Concept (scale-free) thresholds ----------------------------------------

import { CONCEPT_REST_GAP_U, CONCEPT_THRESHOLDS_U } from '../src/adjacency.js';

test('Concept thresholds sit above the sim rest gaps, so a settled layout is met', () => {
  // The Concept sim's springs rest links at these edge gaps and its collision
  // force keeps ALL bubbles ~20u apart — a link sitting exactly where the sim
  // put it must grade as met (the old touching-only threshold graded 0%).
  assert.ok(CONCEPT_THRESHOLDS_U.required > CONCEPT_REST_GAP_U.required);
  assert.ok(CONCEPT_THRESHOLDS_U.desired > CONCEPT_REST_GAP_U.desired);
  assert.ok(linkSatisfied('required', CONCEPT_REST_GAP_U.required, CONCEPT_THRESHOLDS_U));
  assert.ok(linkSatisfied('desired', CONCEPT_REST_GAP_U.desired, CONCEPT_THRESHOLDS_U));
  // The collision pad alone (any two bubbles at rest) also counts as touching.
  assert.ok(linkSatisfied('required', 20, CONCEPT_THRESHOLDS_U));
});

// ---- aggregateByRoot (envelope master plan) ---------------------------------

import { aggregateByRoot } from '../src/adjacency.js';

const aggWorld = () => {
  // Buildings A (id 100) and B (id 200); rooms 1,2 ∈ A; 3 ∈ B; 9 floating.
  const byId = new Map([
    [1, { id: 1, root: 100 }],
    [2, { id: 2, root: 100 }],
    [3, { id: 3, root: 200 }],
    [9, { id: 9, root: null }],
  ]);
  const rootIdOf = (s) => s.root ?? s.id; // floating rooms stand for themselves
  return { byId, rootIdOf };
};

test('aggregateByRoot rolls cross-building room links into one building link', () => {
  const { byId, rootIdOf } = aggWorld();
  const out = aggregateByRoot(
    [
      { id: 'l1', space_a: 1, space_b: 3, strength: 'desired' },
      { id: 'l2', space_a: 2, space_b: 3, strength: 'required' },
    ],
    byId,
    rootIdOf
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].space_a, 100);
  assert.equal(out[0].space_b, 200);
  assert.equal(out[0].count, 2);
  assert.equal(out[0].strength, 'required'); // strongest member wins
  assert.ok(String(out[0].id).startsWith('agg:')); // marked read-only
});

test('aggregateByRoot drops same-building links (an interior concern)', () => {
  const { byId, rootIdOf } = aggWorld();
  const out = aggregateByRoot([{ id: 'l1', space_a: 1, space_b: 2, strength: 'required' }], byId, rootIdOf);
  assert.equal(out.length, 0);
});

test('aggregateByRoot keeps floating-room links under their own ids', () => {
  const { byId, rootIdOf } = aggWorld();
  const out = aggregateByRoot([{ id: 'l1', space_a: 9, space_b: 3, strength: 'desired' }], byId, rootIdOf);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].space_a, out[0].space_b].sort((a, b) => a - b), [9, 200]);
});

test('aggregateByRoot canonicalises pair order and skips unknown spaces', () => {
  const { byId, rootIdOf } = aggWorld();
  const out = aggregateByRoot(
    [
      { id: 'l1', space_a: 3, space_b: 1, strength: 'desired' }, // reversed
      { id: 'l2', space_a: 1, space_b: 777, strength: 'required' }, // 777 missing
    ],
    byId,
    rootIdOf
  );
  assert.equal(out.length, 1);
  assert.ok(out[0].space_a < out[0].space_b);
  assert.equal(out[0].count, 1);
});
