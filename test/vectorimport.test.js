import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseSvg, parseTransform } from '../src/svgImport.js';
import { parseAi } from '../src/aiImport.js';
import { detectFormat, parseVector, placeVector, realWidthM } from '../src/vectorImport.js';

// ---- SVG ----------------------------------------------------------------

test('parseSvg reads the basic shapes', async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="10" y="10" width="20" height="30"/>
    <line x1="0" y1="0" x2="50" y2="50"/>
    <polyline points="1,1 2,2 3,1"/>
    <polygon points="5,5 9,5 9,9"/>
    <circle cx="50" cy="50" r="10"/>
    <path d="M 0 0 L 10 0 L 10 10 Z"/>
  </svg>`;
  const r = parseSvg(svg);
  assert.equal(r.count, 6);
  const rect = r.polylines[0];
  assert.deepEqual(rect.pts, [[10, 10], [30, 10], [30, 40], [10, 40]]);
  assert.equal(rect.closed, true);
  assert.equal(r.polylines[1].closed, false); // a line is open
  assert.equal(r.polylines[3].closed, true); // a polygon is closed
});

test('parseSvg resolves nested group transforms', () => {
  const svg = `<svg viewBox="0 0 100 100">
    <g transform="translate(10 20)"><g transform="scale(2)">
      <rect x="0" y="0" width="5" height="5"/>
    </g></g></svg>`;
  const r = parseSvg(svg);
  // scale first, then translate: (0,0)→(10,20), (5,5)→(20,30)
  assert.deepEqual(r.polylines[0].pts[0], [10, 20]);
  assert.deepEqual(r.polylines[0].pts[2], [20, 30]);
});

test('parseTransform composes the standard forms', () => {
  assert.deepEqual(parseTransform('translate(5 6)'), [1, 0, 0, 1, 5, 6]);
  assert.deepEqual(parseTransform('scale(2)'), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(parseTransform('matrix(1 2 3 4 5 6)'), [1, 2, 3, 4, 5, 6]);
  const rot = parseTransform('rotate(90)');
  assert.ok(Math.abs(rot[0]) < 1e-9 && Math.abs(rot[1] - 1) < 1e-9);
});

test('a group id becomes the layer name', () => {
  const svg = `<svg viewBox="0 0 10 10"><g id="SITE-BOUNDARY"><line x1="0" y1="0" x2="1" y2="1"/></g></svg>`;
  const r = parseSvg(svg);
  assert.deepEqual(r.layers, ['SITE-BOUNDARY']);
  assert.equal(r.polylines[0].layer, 'SITE-BOUNDARY');
});

test('a physical width plus a viewBox gives a real-world size', () => {
  // 200 mm wide across 1000 user units → 0.0002 m per unit.
  const svg = `<svg width="200mm" height="100mm" viewBox="0 0 1000 500"><line x1="0" y1="0" x2="1000" y2="0"/></svg>`;
  const r = parseSvg(svg);
  assert.ok(r.unitsKnown);
  assert.ok(Math.abs(r.unitsPerMetre - 0.0002) < 1e-12);
  assert.ok(Math.abs(realWidthM(r) - 0.2) < 1e-9);
});

test('a pixel-only SVG admits it does not know its size', () => {
  const svg = `<svg width="800" height="600" viewBox="0 0 800 600"><line x1="0" y1="0" x2="10" y2="0"/></svg>`;
  const r = parseSvg(svg);
  assert.equal(r.unitsKnown, false);
  assert.equal(r.unitsPerMetre, 1);
});

test('parseSvg counts what it cannot read', () => {
  const svg = `<svg viewBox="0 0 10 10"><text x="1" y="1">Hi</text><image href="a.png"/><line x1="0" y1="0" x2="1" y2="1"/></svg>`;
  const r = parseSvg(svg);
  assert.equal(r.count, 1);
  assert.equal(r.skipped.text, 1);
  assert.equal(r.skipped.image, 1);
});

test('parseSvg declines a non-SVG', () => {
  assert.equal(parseSvg('hello'), null);
  assert.equal(parseSvg(''), null);
});

test('SVG Y is not flipped — it already counts downward like the diagram', () => {
  const r = parseSvg(`<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="0" y2="10"/></svg>`);
  assert.equal(r.yUp, false);
});

// ---- Illustrator / PDF --------------------------------------------------

/** Minimal PDF carrying one content stream. */
const pdf = (content, { compress = false } = {}) => {
  const body = compress ? deflateSync(Buffer.from(content)) : Buffer.from(content);
  const head = `%PDF-1.4\n1 0 obj\n<< /Length ${body.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`;
  return Buffer.concat([Buffer.from(head), body, Buffer.from('\nendstream\nendobj\n%%EOF')]);
};

test('parseAi reads moveto / lineto out of a content stream', async () => {
  const r = await parseAi(pdf('0 0 m 72 0 l 72 72 l h S'));
  assert.equal(r.count, 1);
  assert.equal(r.polylines[0].closed, true);
  assert.deepEqual(r.polylines[0].pts.slice(0, 3), [[0, 0], [72, 0], [72, 72]]);
});

test('parseAi inflates a FlateDecode stream', async () => {
  const r = await parseAi(pdf('0 0 m 10 0 l S', { compress: true }));
  assert.equal(r.count, 1);
  assert.deepEqual(r.polylines[0].pts, [[0, 0], [10, 0]]);
});

test('parseAi applies the current transformation matrix', async () => {
  const r = await parseAi(pdf('q 1 0 0 1 100 50 cm 0 0 m 10 0 l S Q'));
  assert.deepEqual(r.polylines[0].pts, [[100, 50], [110, 50]]);
});

test('q/Q restore the matrix', async () => {
  const r = await parseAi(pdf('q 1 0 0 1 100 0 cm Q 0 0 m 10 0 l S'));
  assert.deepEqual(r.polylines[0].pts, [[0, 0], [10, 0]]);
});

test('re emits a closed rectangle', async () => {
  const r = await parseAi(pdf('10 20 30 40 re f'));
  assert.equal(r.polylines[0].closed, true);
  assert.deepEqual(r.polylines[0].pts, [[10, 20], [40, 20], [40, 60], [10, 60]]);
});

test('a curve is flattened onto its endpoints', async () => {
  const r = await parseAi(pdf('0 0 m 0 10 10 10 10 0 c S'));
  const pts = r.polylines[0].pts;
  assert.deepEqual(pts[0], [0, 0]);
  assert.ok(Math.abs(pts[pts.length - 1][0] - 10) < 1e-9 && Math.abs(pts[pts.length - 1][1]) < 1e-9);
});

test('an .ai always knows its size — PDF user space is points', async () => {
  const r = await parseAi(pdf('0 0 m 72 0 l S'));
  assert.ok(r.unitsKnown);
  assert.ok(Math.abs(r.unitsPerMetre - 0.0254 / 72) < 1e-12);
  // 72 pt is one inch.
  assert.ok(Math.abs(realWidthM(r) - 0.0254) < 1e-9);
  assert.equal(r.yUp, true);
});

test('parseAi reports text and images as unread rather than dropping them silently', async () => {
  const r = await parseAi(pdf('BT (hi) Tj ET /Im0 Do 0 0 m 5 0 l S'));
  assert.equal(r.skipped.text, 1);
  assert.equal(r.skipped.xobject, 1);
  assert.equal(r.count, 1);
});

// ---- dispatcher ---------------------------------------------------------

test('detectFormat prefers the extension and falls back to sniffing', () => {
  assert.equal(detectFormat('plan.dxf'), 'dxf');
  assert.equal(detectFormat('plan.svg'), 'svg');
  assert.equal(detectFormat('plan.ai'), 'ai');
  assert.equal(detectFormat('plan.pdf'), 'ai');
  // Renamed files are the norm, not the exception.
  assert.equal(detectFormat('mystery.txt', '%PDF-1.7'), 'ai');
  assert.equal(detectFormat('mystery.txt', '<svg xmlns="...">'), 'svg');
  assert.equal(detectFormat('mystery.txt', '0\r\nSECTION\r\n2\r\nENTITIES'), 'dxf');
  assert.equal(detectFormat('notes.txt', 'just words'), null);
});

test('parseVector routes each format and tags the result', async () => {
  const svg = await parseVector('<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="5" y2="0"/></svg>', 'a.svg');
  assert.equal(svg.format, 'svg');
  assert.equal(svg.count, 1);
  const ai = await parseVector(pdf('0 0 m 10 0 l S'), 'a.ai');
  assert.equal(ai.format, 'ai');
  const dxf = await parseVector('0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nLINE\r\n8\r\nA\r\n10\r\n0\r\n20\r\n0\r\n11\r\n5\r\n21\r\n0\r\n0\r\nENDSEC\r\n0\r\nEOF', 'a.dxf');
  assert.equal(dxf.format, 'dxf');
  assert.equal(await parseVector('nonsense', 'a.txt'), null);
});

// ---- placement ----------------------------------------------------------

test('placeVector converts real size to diagram units and centres the import', async () => {
  // A 100 m line in a metric DXF, at 1:500 (0.1323 m per diagram unit).
  const dxf = await parseVector(
    '0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n$INSUNITS\r\n70\r\n6\r\n0\r\nENDSEC\r\n'
    + '0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nLINE\r\n8\r\nA\r\n10\r\n0\r\n20\r\n0\r\n11\r\n100\r\n21\r\n0\r\n0\r\nENDSEC\r\n0\r\nEOF',
    'a.dxf'
  );
  const [s] = placeVector(dxf, 0.1323, { x: 450, y: 310 });
  const span = Math.abs(s.points[1][0] - s.points[0][0]);
  assert.ok(Math.abs(span - 100 / 0.1323) < 0.1, `expected ≈756 units, got ${span}`);
  const midX = (s.points[0][0] + s.points[1][0]) / 2;
  assert.ok(Math.abs(midX - 450) < 0.05, 'centred on the given point');
});

test('placeVector flips Y for CAD/PDF sources but not for SVG', async () => {
  const mk = (yUp) => ({
    polylines: [{ layer: 'A', closed: false, pts: [[0, 0], [0, 10]] }],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 10 }, unitsPerMetre: 1, yUp,
  });
  const [up] = placeVector(mk(true), 1, { x: 0, y: 0 });
  const [down] = placeVector(mk(false), 1, { x: 0, y: 0 });
  // Same source points, opposite screen direction.
  assert.equal(Math.sign(up.points[1][1] - up.points[0][1]), -1);
  assert.equal(Math.sign(down.points[1][1] - down.points[0][1]), 1);
});

test('placeVector applies a manual scale for files with no stated size', () => {
  const parsed = {
    polylines: [{ layer: 'A', closed: false, pts: [[0, 0], [100, 0]] }],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 }, unitsPerMetre: 1, unitsKnown: false, yUp: false,
  };
  const [a] = placeVector(parsed, 1, { x: 0, y: 0 }, 1);
  const [b] = placeVector(parsed, 1, { x: 0, y: 0 }, 2);
  assert.equal((b.points[1][0] - b.points[0][0]) / (a.points[1][0] - a.points[0][0]), 2);
});

test('placeVector declines without a scale or geometry', () => {
  assert.deepEqual(placeVector(null, 1), []);
  assert.deepEqual(placeVector({ polylines: [] }, 1), []);
});
