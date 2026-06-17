import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  edgeGap,
  linkSatisfied,
  adjacencyScore,
  scoreBand,
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
