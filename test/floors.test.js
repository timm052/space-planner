import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedLevels, levelRankMap, floorOffset } from '../src/floors.js';

const sp = (level, sort_order) => ({ level, sort_order });

test('orderedLevels lists distinct levels in sort_order (ground → up)', () => {
  const spaces = [
    sp('First Floor', 5),
    sp('Ground Floor', 1),
    sp('Ground Floor', 2),
    sp('First Floor', 6),
  ];
  assert.deepEqual(orderedLevels(spaces), ['Ground Floor', 'First Floor']);
});

test('orderedLevels ignores blank/whitespace levels', () => {
  const spaces = [sp('', 0), sp('   ', 1), sp('Ground Floor', 2)];
  assert.deepEqual(orderedLevels(spaces), ['Ground Floor']);
});

test('orderedLevels breaks sort_order ties alphabetically', () => {
  const spaces = [sp('Mezzanine', 3), sp('Basement', 3)];
  assert.deepEqual(orderedLevels(spaces), ['Basement', 'Mezzanine']);
});

test('levelRankMap assigns 0-based ranks in order', () => {
  const rank = levelRankMap(['Ground Floor', 'First Floor', 'Second Floor']);
  assert.equal(rank.get('Ground Floor'), 0);
  assert.equal(rank.get('First Floor'), 1);
  assert.equal(rank.get('Second Floor'), 2);
});

test('floorOffset is zero for the overlaid arrangement (floors superimposed)', () => {
  assert.deepEqual(floorOffset(0, 'overlaid', 200, 3), { x: 0, y: 0 });
  assert.deepEqual(floorOffset(2, 'overlaid', 200, 3), { x: 0, y: 0 });
});

test('floorOffset separates floors vertically and centres the stack', () => {
  // 3 floors, spacing 200 → recenter = (3-1)*200/2 = 200.
  assert.deepEqual(floorOffset(0, 'offset', 200, 3), { x: 0, y: 200 }); // ground at the bottom
  assert.deepEqual(floorOffset(1, 'offset', 200, 3), { x: 0, y: 0 }); // middle on the origin
  assert.deepEqual(floorOffset(2, 'offset', 200, 3), { x: 0, y: -200 }); // top floor up
});

test('floorOffset keeps the gap exactly `spacing` between adjacent floors', () => {
  const a = floorOffset(0, 'offset', 150, 2);
  const b = floorOffset(1, 'offset', 150, 2);
  assert.equal(a.y - b.y, 150);
});

test('floorOffset defaults a single level to no vertical shift', () => {
  assert.deepEqual(floorOffset(0, 'offset', 200, 1), { x: 0, y: 0 });
});
