import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialLayerTools,
  startCalibrate,
  addScalePoint,
  setScaleDistance,
  endCalibrate,
  toggleMove,
  toggleRotate,
  layerDeleted,
  computeMpp,
} from '../src/components/diagram/layerTools.js';

const lt = (over = {}) => ({ ...initialLayerTools, ...over });

test('startCalibrate is exclusive with move/rotate and resets the marking', () => {
  const r = startCalibrate(lt({ moveLayer: 3, rotateLayer: 4, scaleDistance: '12' }), 9);
  assert.equal(r.calibrateLayer, 9);
  assert.equal(r.moveLayer, null);
  assert.equal(r.rotateLayer, null);
  assert.deepEqual(r.scalePoints, []);
  assert.equal(r.scaleDistance, '');
});

test('addScalePoint records at most two points and ignores clicks outside calibration', () => {
  let s = startCalibrate(lt(), 9);
  s = addScalePoint(s, { x: 0, y: 0 });
  s = addScalePoint(s, { x: 30, y: 40 });
  assert.equal(s.scalePoints.length, 2);
  assert.equal(addScalePoint(s, { x: 1, y: 1 }).scalePoints.length, 2);
  assert.equal(addScalePoint(lt(), { x: 1, y: 1 }).scalePoints, null);
});

test('endCalibrate clears the whole calibration but not move/rotate', () => {
  const s = endCalibrate(lt({ calibrateLayer: 9, scalePoints: [{ x: 0, y: 0 }], scaleDistance: '5', moveLayer: 2 }));
  assert.equal(s.calibrateLayer, null);
  assert.equal(s.scalePoints, null);
  assert.equal(s.scaleDistance, '');
  assert.equal(s.moveLayer, 2);
});

test('toggleMove / toggleRotate are mutually exclusive and self-toggling', () => {
  const moving = toggleMove(lt({ rotateLayer: 7 }), 3);
  assert.equal(moving.moveLayer, 3);
  assert.equal(moving.rotateLayer, null);
  assert.equal(toggleMove(moving, 3).moveLayer, null);
  const rotating = toggleRotate(moving, 5);
  assert.equal(rotating.rotateLayer, 5);
  assert.equal(rotating.moveLayer, null);
  assert.equal(toggleRotate(rotating, 5).rotateLayer, null);
});

test('layerDeleted clears only the modes that referenced the layer', () => {
  const s = lt({ moveLayer: 3, rotateLayer: 4, calibrateLayer: 5, scalePoints: [] });
  assert.equal(layerDeleted(s, 3).moveLayer, null);
  assert.equal(layerDeleted(s, 3).rotateLayer, 4);
  const cal = layerDeleted(s, 5);
  assert.equal(cal.calibrateLayer, null);
  assert.equal(cal.scalePoints, null);
  assert.equal(layerDeleted(s, 99), s, 'unrelated deletes change nothing');
});

test('computeMpp derives metres-per-natural-pixel from the marked distance', () => {
  // 30-40-50 triangle: 50 diagram units marked as 25 m on an image drawn
  // 100 units wide with 400 natural px → 50/100*400 = 200 px → 0.125 m/px.
  const mpp = computeMpp({
    points: [{ x: 0, y: 0 }, { x: 30, y: 40 }],
    meters: 25,
    rectW: 100,
    naturalW: 400,
  });
  assert.equal(mpp, 0.125);
});

test('computeMpp rejects incomplete or degenerate input', () => {
  assert.equal(computeMpp({ points: [{ x: 0, y: 0 }], meters: 5, rectW: 100, naturalW: 400 }), null);
  assert.equal(computeMpp({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], meters: 5, rectW: 100, naturalW: 400 }), null);
  assert.equal(computeMpp({ points: [{ x: 0, y: 0 }, { x: 30, y: 40 }], meters: 0, rectW: 100, naturalW: 400 }), null);
  assert.equal(computeMpp({ points: [{ x: 0, y: 0 }, { x: 30, y: 40 }], meters: 5, rectW: 0, naturalW: 400 }), null);
});
