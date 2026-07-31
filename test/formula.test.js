// Formula engine: arithmetic, variables, space references, functions, and
// whole-brief resolution with dependency ordering and cycle detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalFormula, resolveBrief, isFormula, referencedSpaces } from '../src/formula.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('arithmetic with precedence, grouping and unary minus', () => {
  near(evalFormula('2 + 3 * 4'), 14);
  near(evalFormula('(2 + 3) * 4'), 20);
  near(evalFormula('-5 + 10'), 5);
  near(evalFormula('10 / 4'), 2.5);
});

test('percent literals become hundredths', () => {
  near(evalFormula('15%'), 0.15);
  near(evalFormula('15% * 200'), 30);
});

test('leading = is optional', () => {
  assert.equal(isFormula('=1+1'), true);
  assert.equal(isFormula('1+1'), false);
  near(evalFormula('=1+1'), 2);
});

test('variables resolve from scope and error when missing', () => {
  near(evalFormula('@staff * 12', { vars: { staff: 20 } }), 240);
  assert.throws(() => evalFormula('@missing + 1', { vars: {} }), /Unknown variable/);
});

test('functions min/max/round/sum', () => {
  near(evalFormula('max(60, @staff*3)', { vars: { staff: 25 } }), 75);
  near(evalFormula('min(60, @staff*3)', { vars: { staff: 25 } }), 60);
  near(evalFormula('round(10/3)'), 3);
  near(evalFormula('sum(1,2,3,4)'), 10);
});

test('division by zero and non-number results are errors', () => {
  assert.throws(() => evalFormula('1/0'), /Division by zero/);
  assert.throws(() => evalFormula('unknownFn(2)'), /Unknown function/);
});

test('referencedSpaces lists bracketed names', () => {
  assert.deepEqual(referencedSpaces('=0.15 * [Adult Collection] + [Foyer]'), ['Adult Collection', 'Foyer']);
  assert.deepEqual(referencedSpaces('=@staff * 2'), []);
});

test('resolveBrief: literals and a formula referencing another space total', () => {
  const spaces = [
    { id: 1, name: 'Adult Collection', count: 1, target_area: 400, area_formula: null, kind: 'space' },
    { id: 2, name: 'Circulation', count: 1, target_area: 0, area_formula: '=15% * [Adult Collection]', kind: 'space' },
  ];
  const { each, total, errors } = resolveBrief(spaces, {});
  assert.equal(errors.size, 0);
  near(each.get(2), 60);   // 0.15 * 400
  near(total.get(2), 60);
});

test('resolveBrief: reference resolves to TOTAL (count × each)', () => {
  const spaces = [
    { id: 1, name: 'Meeting Room', count: 3, target_area: 28, area_formula: null, kind: 'space' },
    { id: 2, name: 'Lobby', count: 1, target_area: 0, area_formula: '=0.5 * [Meeting Room]', kind: 'space' },
  ];
  const { each } = resolveBrief(spaces, {});
  near(each.get(2), 42); // 0.5 * (3 * 28)
});

test('resolveBrief: variables drive areas', () => {
  const spaces = [
    { id: 1, name: 'Open Office', count: 1, target_area: 0, area_formula: '=@staff * 12', kind: 'space' },
  ];
  const { each } = resolveBrief(spaces, { staff: 20 });
  near(each.get(1), 240);
});

test('resolveBrief: chained references resolve by fixpoint regardless of order', () => {
  const spaces = [
    { id: 3, name: 'C', count: 1, target_area: 0, area_formula: '=[B] + 10', kind: 'space' },
    { id: 2, name: 'B', count: 1, target_area: 0, area_formula: '=[A] * 2', kind: 'space' },
    { id: 1, name: 'A', count: 1, target_area: 50, area_formula: null, kind: 'space' },
  ];
  const { each } = resolveBrief(spaces, {});
  near(each.get(2), 100); // A*2
  near(each.get(3), 110); // B+10
});

test('resolveBrief: circular references are flagged, not hung', () => {
  const spaces = [
    { id: 1, name: 'A', count: 1, target_area: 0, area_formula: '=[B] + 1', kind: 'space' },
    { id: 2, name: 'B', count: 1, target_area: 0, area_formula: '=[A] + 1', kind: 'space' },
  ];
  const { errors } = resolveBrief(spaces, {});
  assert.match(errors.get(1) || errors.get(2), /Circular/);
});

test('resolveBrief: unknown reference is an error, others still resolve', () => {
  const spaces = [
    { id: 1, name: 'Good', count: 1, target_area: 30, area_formula: null, kind: 'space' },
    { id: 2, name: 'Bad', count: 1, target_area: 0, area_formula: '=[Nonexistent] + 1', kind: 'space' },
  ];
  const { each, errors } = resolveBrief(spaces, {});
  near(each.get(1), 30);
  assert.match(errors.get(2), /Unknown space/);
});

test('resolveBrief: container reference rolls up leaf descendants', () => {
  const spaces = [
    { id: 1, name: 'Wing', count: 1, target_area: 0, area_formula: null, kind: 'building' },
    { id: 2, name: 'Room X', count: 1, target_area: 100, area_formula: null, parent_id: 1, kind: 'space' },
    { id: 3, name: 'Room Y', count: 2, target_area: 25, area_formula: null, parent_id: 1, kind: 'space' },
    { id: 4, name: 'Share', count: 1, target_area: 0, area_formula: '=10% * [Wing]', kind: 'space' },
  ];
  const { each, total } = resolveBrief(spaces, {});
  near(total.get(1), 150); // 100 + 2*25
  near(each.get(4), 15);   // 10% of 150
});
