import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDxf } from '../src/dxfExport.js';

// Vector export is what stops the tool being a dead end: until now the only
// outputs were PNG, PDF and a CSV of the schedule, so anything drawn here had
// to be re-drawn by hand downstream.

const scene = () => ({
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
  bubbles: [
    { x: 50, y: 40, r: 20, label: 'Hall', sublabel: '900 m²', isContainer: false, poly: null },
    {
      x: 20, y: 20, r: 10, label: 'Building A', sublabel: '939 m²', isContainer: true,
      poly: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }],
    },
  ],
  cells: [],
  links: [{ x1: 20, y1: 20, x2: 50, y2: 40, strength: 'required' }],
  markup: [{ points: [[5, 5], [15, 15]], color: '#e5484d', width: 5 }],
  title: { name: 'Test', sheet: 'Master plan', scaleLabel: '1:500' },
});

// A drawing scale of 1:500 means 0.1323 metres per diagram unit.
const S = 0.1323;

test('a DXF is refused without a drawing scale', () => {
  // A CAD file in diagram units opens at an arbitrary size — worse than none.
  assert.equal(buildDxf(scene(), { effScale: 0 }), null);
  assert.equal(buildDxf(scene(), {}), null);
  assert.equal(buildDxf(null, { effScale: S }), null);
});

test('the file is well-formed R12 with metric units', () => {
  const d = buildDxf(scene(), { effScale: S });
  assert.match(d, /^999\r\n/); // leading comment
  assert.ok(d.includes('AC1009'), 'R12 — the most widely readable revision');
  assert.ok(d.includes('$INSUNITS\r\n70\r\n6'), 'units declared as metres');
  assert.ok(d.trimEnd().endsWith('EOF'));
  // Every SECTION is closed.
  assert.equal((d.match(/\nSECTION\r?\n/g) || []).length, (d.match(/\nENDSEC\r?\n/g) || []).length);
});

test('geometry is written in metres, with CAD’s upward Y', () => {
  const d = buildDxf(scene(), { effScale: S });
  // Values are emitted as numbers, so trailing zeros are absent — compare the
  // way the file actually writes them.
  const n = (v) => String(+v.toFixed(4));
  // The circle centre: x = 50 units → 6.615 m; y = 40 units → −5.292 m.
  assert.ok(d.includes(`10\r\n${n(50 * S)}\r\n`), 'x converted to metres');
  assert.ok(d.includes(`20\r\n${n(-40 * S)}\r\n`), 'y negated for CAD');
  assert.ok(d.includes(`40\r\n${n(20 * S)}\r\n`), 'radius converted too');
  // Sanity: 50 diagram units at 1:500 really is 6.615 m.
  assert.equal(n(50 * S), '6.615');
});

test('envelopes and rooms land on different layers', () => {
  const d = buildDxf(scene(), { effScale: S });
  for (const layer of ['SITE-ENVELOPE', 'SITE-ROOM', 'ANNO-NAME', 'ANNO-AREA', 'ANNO-LINK', 'ANNO-MARKUP']) {
    assert.ok(d.includes(layer), `${layer} declared and used`);
  }
  // The container has an outline, so it exports as a POLYLINE…
  assert.ok(/POLYLINE\r\n8\r\nSITE-ENVELOPE/.test(d));
  // …and the plain bubble as the CIRCLE it actually is, not a squared-off box.
  assert.ok(/CIRCLE\r\n8\r\nSITE-ROOM/.test(d));
});

test('names and areas are written as text', () => {
  const d = buildDxf(scene(), { effScale: S });
  assert.ok(d.includes('\r\nHall\r\n'));
  assert.ok(d.includes('\r\n900 m²\r\n'));
  assert.ok(d.includes('\r\nBuilding A\r\n'));
});

test('links and markup are exported, each on its own layer', () => {
  const d = buildDxf(scene(), { effScale: S });
  assert.ok(/LINE\r\n8\r\nANNO-LINK/.test(d));
  assert.ok(/POLYLINE\r\n8\r\nANNO-MARKUP/.test(d));
});

test('markup polylines are open, footprints are closed', () => {
  const d = buildDxf(scene(), { effScale: S });
  const markupBlock = d.slice(d.indexOf('ANNO-MARKUP\r\n66'));
  assert.ok(/66\r\n1\r\n70\r\n0/.test(markupBlock), 'a redline is not a closed region');
  const envBlock = d.slice(d.indexOf('SITE-ENVELOPE\r\n66'));
  assert.ok(/66\r\n1\r\n70\r\n1/.test(envBlock), 'a footprint is closed');
});

test('an empty scene still produces a valid, openable file', () => {
  const d = buildDxf({ bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, bubbles: [], cells: [], links: [], markup: [] }, { effScale: S });
  assert.ok(d.includes('ENTITIES'));
  assert.ok(d.trimEnd().endsWith('EOF'));
});

test('newlines in a label cannot break the entity stream', () => {
  const s = scene();
  s.bubbles[0].label = 'Hall\nGymnasium';
  const d = buildDxf(s, { effScale: S });
  assert.ok(d.includes('Hall Gymnasium'), 'flattened to one line');
  assert.ok(!d.includes('Hall\r\nGymnasium'));
});
