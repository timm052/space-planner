import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinPatch } from '../src/pins.js';

const space = (pins) => ({
  id: 7,
  pin_json: pins ? JSON.stringify(pins) : null,
  pin_x: null,
  pin_y: null,
});

test('pinPatch sets a pin and clears the legacy columns', () => {
  const s = space({ 0: { x: 1, y: 2 } });
  const patch = pinPatch(s, [1], () => ({ x: 10, y: 20, locked: true }));
  assert.deepEqual(JSON.parse(patch.after.pin_json), {
    0: { x: 1, y: 2 },
    1: { x: 10, y: 20, locked: true },
  });
  assert.equal(patch.after.pin_x, null);
  assert.equal(patch.after.pin_y, null);
  assert.deepEqual(patch.touched, { 1: { x: 10, y: 20, locked: true } });
});

test('pinPatch removes a pin when the callback returns null', () => {
  const s = space({ 0: { x: 1, y: 2 }, 1: { x: 3, y: 4 } });
  const patch = pinPatch(s, [0], () => null);
  assert.deepEqual(JSON.parse(patch.after.pin_json), { 1: { x: 3, y: 4 } });
  assert.deepEqual(patch.touched, { 0: null });
});

test('pinPatch passes the previous pin to the callback (lock preservation)', () => {
  const s = space({ 0: { x: 1, y: 2, locked: true }, 1: { x: 3, y: 4 } });
  const keepLock = (i, prev) => (prev?.locked ? { x: 100, y: 100, locked: true } : { x: 100, y: 100 });
  const patch = pinPatch(s, [0, 1], keepLock);
  const pins = JSON.parse(patch.after.pin_json);
  assert.equal(pins[0].locked, true);
  assert.equal(pins[1].locked, undefined);
});

test('pinPatch before captures the prior persisted state', () => {
  const s = { id: 7, pin_json: '{"0":{"x":1,"y":2}}', pin_x: 5, pin_y: 6 };
  const patch = pinPatch(s, [0], () => null);
  assert.deepEqual(patch.before, { pin_json: '{"0":{"x":1,"y":2}}', pin_x: 5, pin_y: 6 });
});
