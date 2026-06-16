import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedLevels, levelRankMap, isoProject, ISO } from '../src/floors.js';

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

test('isoProject leaves the anchor fixed on the ground floor', () => {
  const anchor = { x: 100, y: 80 };
  assert.deepEqual(isoProject(anchor, 0, anchor), { x: 100, y: 80 });
});

test('isoProject rotates and foreshortens the plan about the anchor', () => {
  const anchor = { x: 0, y: 0 };
  // A point on the +x plan axis tilts down-right; the iso x/y use kx, ky.
  assert.deepEqual(isoProject({ x: 10, y: 0 }, 0, anchor), { x: 10 * ISO.kx, y: 10 * ISO.ky });
  // Equal x and y collapses onto the vertical screen axis (dx - dy = 0).
  const p = isoProject({ x: 10, y: 10 }, 0, anchor);
  assert.equal(p.x, 0);
  assert.equal(p.y, 20 * ISO.ky);
});

test('isoProject raises higher floors by k × lift', () => {
  const anchor = { x: 0, y: 0 };
  const ground = isoProject({ x: 4, y: 2 }, 0, anchor);
  const first = isoProject({ x: 4, y: 2 }, 1, anchor);
  assert.equal(first.x, ground.x); // same plan position, just lifted
  assert.equal(ground.y - first.y, ISO.lift);
});

test('isoProject honours custom geometry', () => {
  const anchor = { x: 0, y: 0 };
  assert.deepEqual(isoProject({ x: 10, y: 0 }, 2, anchor, { kx: 1, ky: 0.5, lift: 100 }), {
    x: 10,
    y: 10 * 0.5 - 200,
  });
});
