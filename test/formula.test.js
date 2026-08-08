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

// ---- broken formulas hold their last good area --------------------------
// A formula that does not evaluate used to resolve to 0 m². That zero flowed
// into the net, into the applied design and into the issued milestone — a
// typo'd variable name silently deleting a room from the programme.

test('an unknown variable holds the last good area instead of zeroing', () => {
  const rows = [{ id: 1, name: 'Canteen', count: 1, target_area: 180, area_formula: '=@pupils * 0.2', parent_id: null }];
  const { each, total, errors } = resolveBrief(rows, { students: 900 });
  assert.match(errors.get(1), /Unknown variable/);
  assert.equal(each.get(1), 180); // held, not 0
  assert.equal(total.get(1), 180);
});

test('a circular reference holds the last good area and is reported', () => {
  const rows = [
    { id: 1, name: 'A', count: 1, target_area: 50, area_formula: '=[B]', parent_id: null },
    { id: 2, name: 'B', count: 1, target_area: 70, area_formula: '=[A]', parent_id: null },
  ];
  const { each, errors } = resolveBrief(rows, {});
  assert.match(errors.get(1), /Circular/);
  assert.match(errors.get(2), /Circular/);
  assert.equal(each.get(1), 50);
  assert.equal(each.get(2), 70);
});

test('a room with no previous area still resolves to 0 when its formula breaks', () => {
  const rows = [{ id: 1, name: 'New', count: 1, target_area: 0, area_formula: '=@nope', parent_id: null }];
  const { each, errors } = resolveBrief(rows, {});
  assert.ok(errors.has(1));
  assert.equal(each.get(1), 0); // nothing good to hold onto
});

test('the count still multiplies a held area', () => {
  const rows = [{ id: 1, name: 'Lab', count: 6, target_area: 90, area_formula: '=@missing', parent_id: null }];
  const { total } = resolveBrief(rows, {});
  assert.equal(total.get(1), 540);
});

// ---- [Space].each vs [Space].total --------------------------------------

test('a bare [Space] reference still means the TOTAL (back-compat)', () => {
  const rows = [
    { id: 1, name: 'Science laboratory', count: 6, target_area: 90, parent_id: null },
    { id: 2, name: 'Prep', count: 1, target_area: 0, area_formula: '=5% * [Science laboratory]', parent_id: null },
  ];
  const { each } = resolveBrief(rows, {});
  assert.equal(each.get(2), 0.05 * 540); // 27
});

test('[Space].each takes the unit area, not the total', () => {
  const rows = [
    { id: 1, name: 'Science laboratory', count: 6, target_area: 90, parent_id: null },
    { id: 2, name: 'Prep', count: 1, target_area: 0, area_formula: '=5% * [Science laboratory].each', parent_id: null },
  ];
  const { each } = resolveBrief(rows, {});
  assert.equal(each.get(2), 0.05 * 90); // 4.5 — 5% of ONE lab
});

test('[Space].total is the explicit form of the bare reference', () => {
  const rows = [
    { id: 1, name: 'Lab', count: 4, target_area: 25, parent_id: null },
    { id: 2, name: 'A', count: 1, target_area: 0, area_formula: '=[Lab].total', parent_id: null },
    { id: 3, name: 'B', count: 1, target_area: 0, area_formula: '=[Lab]', parent_id: null },
  ];
  const { each } = resolveBrief(rows, {});
  assert.equal(each.get(2), 100);
  assert.equal(each.get(3), 100);
});

test('.each on a count-1 room equals its total', () => {
  const rows = [
    { id: 1, name: 'Hall', count: 1, target_area: 900, parent_id: null },
    { id: 2, name: 'X', count: 1, target_area: 0, area_formula: '=[Hall].each', parent_id: null },
  ];
  assert.equal(resolveBrief(rows, {}).each.get(2), 900);
});

test('an unknown suffix is a parse error, not a silent total', () => {
  const rows = [
    { id: 1, name: 'Lab', count: 2, target_area: 10, parent_id: null },
    { id: 2, name: 'X', count: 1, target_area: 5, area_formula: '=[Lab].average', parent_id: null },
  ];
  const { errors, each } = resolveBrief(rows, {});
  assert.ok(errors.has(2));
  assert.equal(each.get(2), 5); // holds its last good area
});
