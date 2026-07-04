import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitLabel } from '../src/textfit.js';

// Deterministic fake metric: every character is half the font size wide.
const measure = (text, size) => text.length * size * 0.5;
const fit = (label, maxWidth, baseSize = 12, over = {}) =>
  fitLabel({ label, maxWidth, baseSize, measure, ...over });

test('a short name stays on one line at the base size', () => {
  const r = fit('Café', 200);
  assert.equal(r.fontSize, 12);
  assert.deepEqual(r.lines, ['Café']);
});

test('wrapping balances line widths instead of greedy-filling the first line', () => {
  // "Quiet Reading Room": greedy at this width would give the lopsided
  // ["Quiet Reading", "Room"]; balanced breaking prefers ["Quiet", "Reading Room"].
  const width = measure('Quiet Reading', 12) + 1; // two lines forced, greedy trap open
  const r = fit('Quiet Reading Room', width);
  assert.equal(r.fontSize, 12);
  assert.deepEqual(r.lines, ['Quiet', 'Reading Room']);
});

test('uses the fewest lines that fit before adding more', () => {
  const r = fit('Main Hall', measure('Main Hall', 12) + 1);
  assert.deepEqual(r.lines, ['Main Hall'], 'fits on one line → one line');
});

test('a long word shrinks the font until it fits instead of overflowing', () => {
  // "Multipurpose" (12 chars): 72px at size 12 — give it a 50px budget.
  const r = fit('Multipurpose', 50);
  assert.ok(r.fontSize < 12, 'font stepped down');
  assert.deepEqual(r.lines, ['Multipurpose']);
  assert.ok(measure('Multipurpose', r.fontSize) <= 50, 'fits at the chosen size');
});

test('ellipsizes only when even the minimum size cannot fit', () => {
  const r = fit('Extraordinarily', 30, 12, { minSize: 8 });
  assert.equal(r.fontSize, 8);
  assert.equal(r.lines.length, 1);
  assert.ok(r.lines[0].endsWith('…'));
  assert.ok(measure(r.lines[0], 8) <= 30, 'ellipsized line fits the budget');
});

test('folds overflow beyond maxLines into an ellipsized last line', () => {
  const r = fit('One Two Three Four Five Six Seven Eight', 40, 12, { minSize: 8, maxLines: 3 });
  assert.equal(r.lines.length, 3);
  assert.ok(r.lines[2].endsWith('…'));
  for (const l of r.lines) assert.ok(measure(l, r.fontSize) <= 40);
});

test('every returned line fits the budget across a spread of names', () => {
  const names = ['Entrance & Foyer', 'Welcome / Returns Desk', 'Multipurpose Hall', 'IT / Server', 'Children’s Library'];
  for (const name of names) {
    for (const width of [40, 70, 120, 200]) {
      const { fontSize, lines } = fit(name, width);
      assert.ok(lines.length >= 1 && lines.length <= 3);
      for (const l of lines) assert.ok(measure(l, fontSize) <= width, `"${l}" fits ${width} at ${fontSize}`);
    }
  }
});

test('empty labels come back empty rather than crashing', () => {
  assert.deepEqual(fit('', 100).lines, []);
});
