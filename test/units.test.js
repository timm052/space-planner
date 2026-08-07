import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaFactor, M2_PER_FT2 } from '../server/units.js';
import { areaToM2, fmtArea, distToMeters, metersToDist } from '../src/compute.js';

// The m²/ft² switch used to relabel stored areas instead of converting them:
// a 405 m² room read "405 ft²" against a true 4,359.4, wrong by 10.76×.

test('areaFactor is the reciprocal pair, and identity within one unit', () => {
  assert.equal(areaFactor('m2', 'm2'), 1);
  assert.equal(areaFactor('ft2', 'ft2'), 1);
  assert.equal(areaFactor('m2', 'ft2'), 1 / M2_PER_FT2);
  assert.equal(areaFactor('ft2', 'm2'), M2_PER_FT2);
  assert.ok(Math.abs(areaFactor('m2', 'ft2') * areaFactor('ft2', 'm2') - 1) < 1e-12);
});

test('the factor matches the real conversion, not a relabel', () => {
  // 405 m² is 4,359.4 ft² — the number the audit compared against.
  const ft2 = 405 * areaFactor('m2', 'ft2');
  assert.ok(Math.abs(ft2 - 4359.4) < 0.1, `expected ≈4359.4, got ${ft2}`);
  // …and the error a relabel produced.
  assert.ok(Math.abs(ft2 / 405 - 10.7639) < 0.001);
});

test('a converted area round-trips at the stored precision', () => {
  const r3 = (n) => Math.round(n * 1000) / 1000;
  for (const m2 of [405, 900, 1170, 40232, 0.5, 27]) {
    const there = r3(m2 * areaFactor('m2', 'ft2'));
    const back = r3(there * areaFactor('ft2', 'm2'));
    assert.ok(Math.abs(back - m2) < 0.001, `${m2} → ${there} → ${back}`);
  }
});

// ---- the existing display / geometry model stays coherent ---------------
// Stored numbers are in the project's units; that is correct while the units
// hold still, and these pin the two readers that depend on it.

test('a stored ft² area converts to m² for the scale maths', () => {
  assert.ok(Math.abs(areaToM2(4359.381, 'ft2') - 405) < 0.001);
  assert.equal(areaToM2(405, 'm2'), 405); // metric is already metric
});

test('fmtArea labels the stored number in the project unit', () => {
  assert.equal(fmtArea(405, 'm2'), '405 m²');
  assert.equal(fmtArea(4359.381, 'ft2'), '4,359 ft²');
  assert.equal(fmtArea(null, 'm2'), '—');
});

test('lengths convert independently of areas', () => {
  assert.ok(Math.abs(distToMeters(100, 'ft2') - 30.48) < 1e-9);
  assert.ok(Math.abs(metersToDist(30.48, 'ft2') - 100) < 1e-9);
  assert.equal(distToMeters(50, 'm2'), 50);
});
