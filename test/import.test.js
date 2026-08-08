import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport } from '../src/components/ProgramTab.jsx';

// Paste-import is the only realistic way a real programme gets in — every other
// route is one room at a time. These pin the column mapping, and especially the
// level column, which gates per-floor editing, the stacking readout and 3-D.

test('positional rows map to name / category / count / area', () => {
  const { good } = parseImport('Entrance Foyer\tPublic\t1\t110\nMeeting Rooms\tCommunity\t3\t28');
  assert.equal(good.length, 2);
  assert.deepEqual(
    good.map((r) => [r.name, r.category, r.count, r.area]),
    [['Entrance Foyer', 'Public', 1, 110], ['Meeting Rooms', 'Community', 3, 28]]
  );
});

test('a 5th positional column is the storey', () => {
  const { good } = parseImport('Foyer\tPublic\t1\t110\tGround\nOffice\tStaff\t2\t20\tFirst');
  assert.deepEqual(good.map((r) => r.level), ['Ground', 'First']);
});

test('a header row maps a level column wherever it sits', () => {
  const text = [
    'Storey\tName\tArea\tCategory',
    'Ground\tFoyer\t110\tPublic',
    'First\tOffice\t20\tStaff',
  ].join('\n');
  const { good } = parseImport(text);
  assert.deepEqual(good.map((r) => [r.name, r.level, r.area, r.category]), [
    ['Foyer', 'Ground', 110, 'Public'],
    ['Office', 'First', 20, 'Staff'],
  ]);
});

test('"level" and "floor" are recognised as well as "storey"', () => {
  for (const word of ['Level', 'Floor', 'Storey', 'Story']) {
    const { good } = parseImport(`Name\tArea\t${word}\nFoyer\t110\tGround`);
    assert.equal(good[0].level, 'Ground', `${word} should map to level`);
  }
});

test('rows without a level import with an empty one, not a missing field', () => {
  const { good } = parseImport('Foyer\tPublic\t1\t110');
  assert.equal(good[0].level, '');
});

test('an =formula area is carried through as a formula', () => {
  const { good } = parseImport('Library\tPublic\t1\t=@students * 0.45');
  assert.equal(good[0].isFormula, true);
  assert.equal(good[0].area, '=@students * 0.45');
  assert.equal(good[0].ok, true);
});

test('rows without a name or a usable area are rejected, not silently zeroed', () => {
  const { good, bad } = parseImport('\tPublic\t1\t110\nFoyer\tPublic\t1\t0\nHall\tPublic\t1\t50');
  assert.equal(good.length, 1);
  assert.equal(good[0].name, 'Hall');
  assert.equal(bad.length, 2);
});

test('CSV is accepted as well as TSV', () => {
  const { good } = parseImport('Foyer,Public,1,110');
  assert.equal(good[0].name, 'Foyer');
  assert.equal(good[0].area, 110);
});

test('a count is at least 1 and always a whole number', () => {
  const { good } = parseImport('A\tX\t0\t10\nB\tX\t2.7\t10\nC\tX\t\t10');
  assert.deepEqual(good.map((r) => r.count), [1, 2, 1]);
});

test('empty input returns null rather than an empty parse', () => {
  assert.equal(parseImport(''), null);
  assert.equal(parseImport('   \n  '), null);
});
