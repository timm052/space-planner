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
