import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  M_PER_UNIT_PER_RATIO,
  SCALE_PRESETS,
  ratioToScale,
  scaleToRatio,
  zoomAbout,
} from '../src/scale.js';

test('ratioToScale and scaleToRatio are inverses for standard ratios', () => {
  for (const ratio of [100, 200, 500, 1000, 2000]) {
    const metresPerUnit = ratioToScale(ratio);
    assert.equal(scaleToRatio(metresPerUnit), ratio);
  }
});

test('ratioToScale uses the paper-unit constant', () => {
  assert.ok(Math.abs(ratioToScale(200) - 200 * M_PER_UNIT_PER_RATIO) < 1e-12);
  // 1:1000 → 0.2646 metres per diagram unit
  assert.ok(Math.abs(ratioToScale(1000) - 0.2646) < 1e-9);
});

test('SCALE_PRESETS expose labelled ratios per unit system', () => {
  assert.ok(SCALE_PRESETS.m2.some(([r, label]) => r === 200 && label === '1:200'));
  assert.ok(SCALE_PRESETS.ft2.length > 0);
  // every preset ratio round-trips through the conversion
  for (const sys of Object.values(SCALE_PRESETS)) {
    for (const [ratio] of sys) assert.equal(scaleToRatio(ratioToScale(ratio)), ratio);
  }
});

test('zoomAbout leaves the anchor fixed', () => {
  const A = { x: 100, y: 50 };
  assert.deepEqual(zoomAbout(A, A, 0.5), A);
  assert.deepEqual(zoomAbout(A, A, 3), A);
});

test('zoomAbout scales distance from the anchor by f', () => {
  const A = { x: 0, y: 0 };
  assert.deepEqual(zoomAbout({ x: 10, y: 20 }, A, 2), { x: 20, y: 40 });
  assert.deepEqual(zoomAbout({ x: 10, y: 20 }, A, 0.5), { x: 5, y: 10 });
});

test('zoomAbout preserves a point fractional position between two scaled points', () => {
  // The architecture invariant: a pinned bubble keeps its position relative to
  // an image when both are zoomed about the same anchor.
  const A = { x: 450, y: 310 };
  const f = 200 / 500; // a 1:200 → 1:500 change
  const bubble = { x: 600, y: 400 };
  const imgCorner = { x: 700, y: 480 };
  const before = (bubble.x - imgCorner.x) / (A.x - imgCorner.x);
  const b2 = zoomAbout(bubble, A, f);
  const i2 = zoomAbout(imgCorner, A, f);
  const after = (b2.x - i2.x) / (A.x - i2.x);
  assert.ok(Math.abs(before - after) < 1e-9);
});

// ---- satellite ground sample distance ------------------------------------
// The extent presets said how WIDE the imagery was and never how detailed, so
// there was no way to know whether it would carry a site plan or just context.

test('groundSampleDistance halves with each zoom level', async () => {
  const { groundSampleDistance } = await import('../src/components/diagram/LayersPanel.jsx');
  const z18 = groundSampleDistance(18, 0);
  const z19 = groundSampleDistance(19, 0);
  assert.ok(Math.abs(z18 / z19 - 2) < 1e-9);
});

test('groundSampleDistance matches the observed Esri figure at the audit site', async () => {
  const { groundSampleDistance } = await import('../src/components/diagram/LayersPanel.jsx');
  // Truganina, −37.83°: the fetched layer came back at 0.4715 m/px at z18.
  const g = groundSampleDistance(18, -37.83);
  assert.ok(Math.abs(g - 0.4715) < 0.002, `expected ≈0.4715, got ${g}`);
});

test('groundSampleDistance coarsens away from the equator', async () => {
  const { groundSampleDistance } = await import('../src/components/diagram/LayersPanel.jsx');
  const eq = groundSampleDistance(18, 0);
  const high = groundSampleDistance(18, 60);
  assert.ok(Math.abs(high / eq - 0.5) < 1e-6, 'cos(60°) = 0.5');
});
