import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseDxf, toStrokes } from '../src/dxfImport.js';
import { buildDxf } from '../src/dxfExport.js';

const dxf = (...pairs) => pairs.join('\r\n');

test('parses a LINE into a two-point polyline on its layer', () => {
  const d = dxf('0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'SITE-BOUNDARY', '10', '0', '20', '0', '11', '10', '21', '5',
    '0', 'ENDSEC', '0', 'EOF');
  const r = parseDxf(d);
  assert.equal(r.count, 1);
  assert.deepEqual(r.polylines[0].pts, [[0, 0], [10, 5]]);
  assert.equal(r.polylines[0].layer, 'SITE-BOUNDARY');
  assert.deepEqual(r.layers, ['SITE-BOUNDARY']);
});

test('parses an LWPOLYLINE and honours its closed flag', () => {
  const d = dxf('0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'A', '70', '1',
    '10', '0', '20', '0', '10', '4', '20', '0', '10', '4', '20', '3',
    '0', 'ENDSEC', '0', 'EOF');
  const r = parseDxf(d);
  assert.equal(r.count, 1);
  assert.deepEqual(r.polylines[0].pts, [[0, 0], [4, 0], [4, 3]]);
  assert.equal(r.polylines[0].closed, true);
});

test('parses an old-style POLYLINE with VERTEX children', () => {
  const d = dxf('0', 'SECTION', '2', 'ENTITIES',
    '0', 'POLYLINE', '8', 'SURV', '66', '1', '70', '1',
    '0', 'VERTEX', '8', 'SURV', '10', '1', '20', '2',
    '0', 'VERTEX', '8', 'SURV', '10', '5', '20', '2',
    '0', 'VERTEX', '8', 'SURV', '10', '5', '20', '9',
    '0', 'SEQEND', '8', 'SURV',
    '0', 'ENDSEC', '0', 'EOF');
  const r = parseDxf(d);
  assert.equal(r.count, 1);
  assert.deepEqual(r.polylines[0].pts, [[1, 2], [5, 2], [5, 9]]);
  assert.equal(r.polylines[0].layer, 'SURV');
});

test('a CIRCLE becomes a closed polyline of the right radius', () => {
  const d = dxf('0', 'SECTION', '2', 'ENTITIES',
    '0', 'CIRCLE', '8', 'TREE', '10', '100', '20', '50', '40', '7',
    '0', 'ENDSEC', '0', 'EOF');
  const r = parseDxf(d);
  const pts = r.polylines[0].pts;
  assert.ok(r.polylines[0].closed);
  for (const [x, y] of pts) {
    assert.ok(Math.abs(Math.hypot(x - 100, y - 50) - 7) < 1e-6, 'every point is on the circle');
  }
});

test('unsupported entities are counted, not silently dropped', () => {
  // A parser that half-understands a block puts geometry in the wrong place,
  // which is worse than declining — so say what was left behind.
  const d = dxf('0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '8', 'BLOCKS', '10', '0', '20', '0',
    '0', 'SPLINE', '8', 'CURVES',
    '0', 'LINE', '8', 'A', '10', '0', '20', '0', '11', '1', '21', '1',
    '0', 'ENDSEC', '0', 'EOF');
  const r = parseDxf(d);
  assert.equal(r.count, 1, 'the LINE still imports');
  assert.equal(r.skipped.INSERT, 1);
  assert.equal(r.skipped.SPLINE, 1);
});

test('$INSUNITS decides what the coordinates mean', () => {
  const withUnits = (n) => dxf('0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', String(n), '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'A', '10', '0', '20', '0', '11', '1000', '21', '0',
    '0', 'ENDSEC', '0', 'EOF');
  assert.equal(parseDxf(withUnits(6)).unitsPerMetre, 1); // metres
  assert.equal(parseDxf(withUnits(4)).unitsPerMetre, 0.001); // millimetres
  assert.equal(parseDxf(withUnits(2)).unitsPerMetre, 0.3048); // feet
  assert.equal(parseDxf(withUnits(6)).unitsKnown, true);
  // Unitless files are assumed metric, and say so rather than pretending.
  assert.equal(parseDxf(withUnits(0)).unitsKnown, false);
  assert.equal(parseDxf(withUnits(0)).unitsPerMetre, 1);
});

test('garbage in returns null or an empty parse, never a throw', () => {
  assert.equal(parseDxf(''), null);
  assert.equal(parseDxf(null), null);
  // A non-DXF has no readable code/value pairs, so it reads as "nothing here"
  // rather than throwing halfway through a file the user chose by mistake.
  for (const junk of ['not a dxf at all', '%PDF-1.7\nbinary junk', '0\n', '\n\n\n']) {
    const r = parseDxf(junk);
    assert.ok(r === null || r.count === 0, `${JSON.stringify(junk)} → ${JSON.stringify(r)?.slice(0, 60)}`);
  }
});

// ---- toStrokes ----------------------------------------------------------

test('toStrokes converts to diagram units and flips Y', () => {
  const parsed = parseDxf(dxf('0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'A', '70', '0', '10', '0', '20', '0', '10', '100', '20', '0',
    '0', 'ENDSEC', '0', 'EOF'));
  // 1:500 → 0.1323 m per diagram unit, so 100 m spans ~756 units.
  const [s] = toStrokes(parsed, 0.1323, { x: 0, y: 0 });
  const span = Math.abs(s.points[1][0] - s.points[0][0]);
  assert.ok(Math.abs(span - 100 / 0.1323) < 0.1, `expected ≈756 units, got ${span}`);
  // Centred on the origin, so the two ends straddle it.
  assert.ok(s.points[0][0] < 0 && s.points[1][0] > 0);
});

test('toStrokes centres the import rather than honouring survey coordinates', () => {
  // Real easting/northing would land the drawing hundreds of km off-screen,
  // looking exactly like a failed import.
  const parsed = parseDxf(dxf('0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'A', '70', '0',
    '10', '320450', '20', '5812300', '10', '320550', '20', '5812300',
    '0', 'ENDSEC', '0', 'EOF'));
  const [s] = toStrokes(parsed, 0.1323, { x: 450, y: 310 });
  const midX = (s.points[0][0] + s.points[1][0]) / 2;
  assert.ok(Math.abs(midX - 450) < 0.05, `centred on the given point, got ${midX}`);
});

test('toStrokes declines without a scale or geometry', () => {
  assert.deepEqual(toStrokes(null, 0.1323), []);
  assert.deepEqual(toStrokes({ polylines: [] }, 0.1323), []);
  const p = parseDxf(dxf('0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'A', '10', '0', '20', '0', '11', '1', '21', '1', '0', 'ENDSEC', '0', 'EOF'));
  assert.deepEqual(toStrokes(p, 0), []);
});

// ---- round-trip against our own exporter --------------------------------

test('what we export, we can read back', () => {
  const scene = {
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
    bubbles: [{
      x: 20, y: 20, r: 10, label: 'A', sublabel: '100 m²', isContainer: true,
      poly: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }],
    }],
    cells: [], links: [], markup: [],
  };
  const out = buildDxf(scene, { effScale: 0.1323 });
  const back = parseDxf(out);
  assert.ok(back.count >= 1, 'the exported polyline parses');
  const env = back.polylines.find((p) => p.layer === 'SITE-ENVELOPE');
  assert.ok(env, 'on the layer we wrote it to');
  assert.equal(env.pts.length, 4);
  assert.equal(back.unitsPerMetre, 1, 'metres, as exported');
});

// ---- the real survey DXF generated for the audit -------------------------

const SURVEY = 'C:/Users/timmo/AppData/Local/Temp/claude/C--Users-timmo-AI-Temp-archi-app/28f4d518-08d8-43ff-95af-bf69a763b4a8/scratchpad/site/site.dxf';

test('reads the audit survey: boundary, contours, trees and TPZs', { skip: !existsSync(SURVEY) }, () => {
  const r = parseDxf(readFileSync(SURVEY, 'utf8'));
  assert.ok(r.count > 20, `expected a real drawing, got ${r.count} polylines`);
  for (const layer of ['SITE-BOUNDARY', 'SURV-CONTOUR-INDEX', 'SURV-TREE', 'SURV-TPZ', 'CADASTRE']) {
    assert.ok(r.layers.includes(layer), `${layer} preserved`);
  }
  assert.equal(r.unitsPerMetre, 1, 'declared as metres');
  // The boundary encloses the surveyed 40,232 m².
  const b = r.polylines.find((p) => p.layer === 'SITE-BOUNDARY');
  const area = Math.abs(b.pts.reduce((a, p, i) => {
    const q = b.pts[(i + 1) % b.pts.length];
    return a + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
  assert.ok(Math.abs(area - 40232) < 1, `expected 40,232 m², got ${area.toFixed(0)}`);
  // TEXT labels are not geometry and are reported as skipped, not imported.
  assert.ok(r.skipped.TEXT > 0);
});
