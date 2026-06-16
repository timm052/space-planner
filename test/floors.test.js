import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedLevels, levelRankMap, stackOffset, STACK } from '../src/floors.js';

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

test('stackOffset lifts higher floors up and shifts them right', () => {
  const rank = levelRankMap(['Ground Floor', 'First Floor']);
  assert.deepEqual(stackOffset('Ground Floor', rank), { x: 0, y: 0 });
  assert.deepEqual(stackOffset('First Floor', rank), { x: STACK.shift, y: -STACK.lift });
});

test('stackOffset trims the label and falls unknown levels to the ground plane', () => {
  const rank = levelRankMap(['Ground Floor', 'First Floor']);
  assert.deepEqual(stackOffset('  First Floor  ', rank), { x: STACK.shift, y: -STACK.lift });
  assert.deepEqual(stackOffset('Roof', rank), { x: 0, y: 0 });
  assert.deepEqual(stackOffset('', rank), { x: 0, y: 0 });
});

test('stackOffset honours custom geometry', () => {
  const rank = levelRankMap(['G', 'F']);
  assert.deepEqual(stackOffset('F', rank, { lift: 100, shift: 10 }), { x: 10, y: -100 });
});
