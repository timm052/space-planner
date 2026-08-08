// Title-block identity: the fields BS EN ISO 7200 treats as mandatory data
// (identification number, revision index, date of issue, responsible people)
// and how they reach a filename and the one-line note the CAD/SVG writers use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetFileStem, sheetNote } from '../src/sheet.js';
import { buildSvg } from '../src/svgExport.js';
import { buildDxf } from '../src/dxfExport.js';
import { buildSheetDoc } from '../src/pdfExport.js';

const title = {
  name: 'Wapping Wharf',
  client: 'Bristol CC',
  stage: 'Concept',
  sheet: 'Master plan',
  scaleLabel: '1:500',
  date: '2026-04-02',
  number: '1234-XX-00-DR-A-1001',
  revision: 'P02',
  status: 'Preliminary',
};

test('a numbered sheet files itself under its number and revision', () => {
  // Two issues of the same drawing have to sit next to each other in a folder
  // and sort by revision — the project name does neither.
  assert.equal(sheetFileStem(title), '1234-XX-00-DR-A-1001-P02');
  assert.equal(sheetFileStem({ ...title, revision: '' }), '1234-XX-00-DR-A-1001');
});

test('an unnumbered sheet keeps the project-name stem', () => {
  assert.equal(sheetFileStem({ name: 'Wapping Wharf' }), 'Wapping_Wharf');
  assert.equal(sheetFileStem({}), 'diagram');
});

test('the stem never carries a character a filesystem would refuse', () => {
  const stem = sheetFileStem({ number: '1234/XX:00 DR*A?1001', revision: 'P/02' });
  assert.equal(stem, '1234_XX_00_DR_A_1001-P_02');
  assert.ok(!/[/\\:*?"<>|]/.test(stem));
});

test('the sheet note carries the number, revision and status, in reading order', () => {
  assert.equal(
    sheetNote(title),
    'Wapping Wharf — Master plan — 1:500 — 1234-XX-00-DR-A-1001 rev P02 — Preliminary — 2026-04-02'
  );
});

test('blank fields are left out rather than printed empty', () => {
  // An unnumbered working print should look like one, not like a numbered
  // sheet with the number missing.
  assert.equal(sheetNote({ name: 'P', sheet: 'Concept diagram', scaleLabel: 'NTS' }), 'P — Concept diagram — NTS');
});

const scene = () => ({
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
  bubbles: [{ x: 50, y: 40, r: 20, color: '#4a63c0', opacity: 0.32, label: 'Hall', sublabel: '900 m²', poly: null }],
  layers: [], cells: [], links: [], markup: [], legend: [],
  title,
});

test('the SVG and DXF sheet notes both carry the identification', () => {
  const svg = buildSvg(scene(), { mmPerUnit: 0.2645833 });
  assert.ok(svg.includes('1234-XX-00-DR-A-1001 rev P02'), svg.slice(-400));
  const dxf = buildDxf(scene(), { effScale: 0.5 });
  assert.ok(dxf.includes('1234-XX-00-DR-A-1001 rev P02'));
});

// ---- the block as it actually prints ------------------------------------
// Reading the PDF back rather than trusting the draw calls: jsPDF writes page
// text as (…) Tj in the content stream, so the strings are recoverable.
function sheetText(scn, opts) {
  const { doc } = buildSheetDoc(scn, opts);
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  // Unescape the PDF string escapes jsPDF applies inside (…).
  return [...raw.matchAll(/\((.*?)\)\s*Tj/gs)]
    .map((m) => m[1].replace(/\\([()\\])/g, '$1'))
    .join('\n');
}

test('the printed title block carries the number, revision and status', () => {
  const text = sheetText(scene());
  for (const want of ['DRAWING No.', '1234-XX-00-DR-A-1001', 'REV', 'P02', 'STATUS', 'Preliminary']) {
    assert.ok(text.includes(want), `title block prints ${want}\n---\n${text}`);
  }
  assert.ok(text.includes('SCALE') && text.includes('1:500'));
  assert.ok(text.includes('2026-04-02'), 'the issue date, not the print date');
});

test('who drew and checked it appears on the sheet', () => {
  const text = sheetText({ ...scene(), title: { ...title, drawnBy: 'TM', checkedBy: 'JS' } });
  assert.ok(text.includes('Drawn TM'), text);
  assert.ok(text.includes('Checked JS'), text);
});

test('an unnumbered sheet prints a dash, not a blank cell', () => {
  // A blank cell reads as "the number is missing"; a dash reads as "this print
  // has no number", which is the true statement.
  const lines = sheetText({ ...scene(), title: { ...title, number: '', revision: '', status: '' } }).split('\n');
  assert.equal(lines[lines.indexOf('DRAWING No.') + 1], '-');
  assert.equal(lines[lines.indexOf('REV') + 1], '-');
  assert.ok(!lines.includes('STATUS'), 'an empty status prints no caption at all');
});

test('no printed string contains an em dash', () => {
  // jsPDF's standard-font encoding DROPS U+2014 outright, so a fallback or a
  // warning written with one prints as nothing / a double space. This caught
  // the "—" the empty drawing-number cell used to print.
  const text = sheetText({ ...scene(), title: { ...title, number: '', revision: '', nonStandardScale: true } });
  assert.ok(!text.includes('—'), text);
  assert.match(text, /non-standard scale - do not measure/);
});

test('a non-standard scale still says so on the sheet', () => {
  const text = sheetText({ ...scene(), title: { ...title, nonStandardScale: true } });
  assert.match(text, /do not measure from this print/);
});

// ---- sheet notes on the outputs ------------------------------------------
// A note is stored as one or two points plus its words; every exporter has to
// draw it as TEXT with a leader, never as the polyline it is stored as.
const noted = () => ({
  ...scene(),
  notes: [
    { x: 60, y: 30, leader: { x: 20, y: 55 }, text: 'Level change to confirm', height: 12, color: '#e5484d' },
    { x: 10, y: 70, leader: null, text: 'Two lines\nsecond line', height: 8, color: '#3e63dd' },
  ],
});

test('the PDF prints the note text, not a polyline', () => {
  const text = sheetText(noted());
  assert.ok(text.includes('Level change to confirm'), text);
  assert.ok(text.includes('Two lines') && text.includes('second line'), 'the author line breaks are the layout');
});

test('the PDF says notes are markup, so nobody reads the print as issued', () => {
  assert.match(sheetText(noted()), /notes are markup - not drawn geometry/);
});

test('the SVG keeps note text as text, with a leader line', () => {
  const svg = buildSvg(noted(), { mmPerUnit: 0.2645833 });
  assert.ok(svg.includes('id="ANNO-NOTE"'), 'notes get their own group');
  assert.ok(/<tspan[^>]*>Level change to confirm<\/tspan>/.test(svg), svg.slice(-900));
  assert.ok(/<tspan[^>]*>second line<\/tspan>/.test(svg), 'a second line is a second tspan');
  // Words to the right of the leader foot run leftwards, so the leader never
  // crosses its own text.
  assert.ok(svg.includes('text-anchor="start"'), svg.slice(-900));
});

test('the DXF writes notes as TEXT on their own layer, sized in metres', () => {
  const dxf = buildDxf(noted(), { effScale: 0.5 });
  assert.ok(dxf.includes('ANNO-NOTE'), 'the layer is declared and used');
  // Walk the group pairs to the TEXT entity carrying the note, and read the
  // height (group 40) off it rather than string-matching a formatted number.
  const g = dxf.split(/\r?\n/);
  const at = g.findIndex((v, i) => v.trim() === '1' && g[i + 1] === 'Level change to confirm');
  assert.ok(at > 0, 'the note text is a TEXT value, not a polyline');
  const layerAt = g.lastIndexOf('8', at);
  assert.equal(g[layerAt + 1], 'ANNO-NOTE');
  const heightAt = g.lastIndexOf('40', at);
  // 12 diagram units at 0.5 m/unit = 6 m of text height, the same convention
  // every other label in this writer uses.
  assert.equal(Number(g[heightAt + 1]), 6);
});
