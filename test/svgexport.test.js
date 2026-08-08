import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSvg } from '../src/svgExport.js';
import { parseSvg } from '../src/svgImport.js';

const scene = () => ({
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
  bubbles: [
    { x: 50, y: 40, r: 20, color: '#4a63c0', opacity: 0.32, label: 'Hall', sublabel: '900 m²', poly: null },
    { x: 20, y: 20, r: 10, color: '#3faa9c', opacity: 0.32, label: 'Building A', sublabel: '939 m²',
      poly: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }] },
  ],
  cells: [], links: [{ x1: 20, y1: 20, x2: 50, y2: 40, strength: 'required' }],
  markup: [{ points: [[5, 5], [15, 15]], color: '#e5484d', width: 5 }],
  title: { name: 'Test', sheet: 'Master plan', scaleLabel: '1:500' },
});

test('the SVG states a physical size so it opens at true scale', () => {
  const s = buildSvg(scene(), { mmPerUnit: 0.2645833 });
  assert.match(s, /width="[\d.]+mm"/);
  assert.match(s, /height="[\d.]+mm"/);
  assert.match(s, /viewBox="0 0 [\d.]+ [\d.]+"/);
});

test('groups are named the way the DXF layers are', () => {
  const s = buildSvg(scene(), { mmPerUnit: 0.2645833 });
  for (const id of ['SITE-ENVELOPE', 'ANNO-NAME', 'ANNO-LINK', 'ANNO-MARKUP', 'ANNO-SHEET']) {
    assert.ok(s.includes(`id="${id}"`), `${id} present`);
  }
});

test('text stays text — the reason a designer wants SVG over a raster', () => {
  const s = buildSvg(scene(), { mmPerUnit: 0.2645833 });
  assert.ok(/<text[^>]*>Hall<\/text>/.test(s));
  assert.ok(s.includes('900 m²'));
});

test('a room with an outline exports as a polygon, a bubble as a circle', () => {
  const s = buildSvg(scene(), { mmPerUnit: 0.2645833 });
  assert.ok(s.includes('<polygon'));
  assert.ok(s.includes('<circle'));
});

test('labels are escaped, so a name cannot break the document', () => {
  const sc = scene();
  sc.bubbles[0].label = 'Plant & <Services>';
  const s = buildSvg(sc, { mmPerUnit: 0.2645833 });
  assert.ok(s.includes('Plant &amp; &lt;Services&gt;'));
  assert.ok(!s.includes('<Services>'));
});

test('what we export, our own importer reads back', () => {
  const s = buildSvg(scene(), { mmPerUnit: 0.2645833 });
  const back = parseSvg(s);
  assert.ok(back.count >= 3, `expected geometry back, got ${back.count}`);
  // The physical width and viewBox together give a real size.
  assert.ok(back.unitsKnown);
  assert.ok(back.layers.includes('SITE-ENVELOPE'));
});

test('an empty scene is declined rather than producing a blank file', () => {
  assert.equal(buildSvg(null, {}), null);
  assert.equal(buildSvg({}, {}), null);
});
