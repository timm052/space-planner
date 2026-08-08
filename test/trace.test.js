// Turning imported vector geometry into programme. The arithmetic here ends up
// on a schedule someone signs, so it is pinned against hand-computed figures
// rather than against whatever the code happened to produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isClosedRing, ringOf, traceCandidates, pickCandidate, areaFromRing, traceToOutline,
  MIN_TRACE_AREA,
} from '../src/trace.js';
import { polygonArea, outlinePoints } from '../src/geometry.js';
import { M2_PER_FT2 } from '../src/compute.js';

const rect = (x0, y0, w, h) => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]];
const survey = (id, points, over = {}) => ({ id, kind: 'survey', points, layer: 'A-WALL', source: 'plan.dxf', ...over });

// ---- closure -------------------------------------------------------------

test('a path whose ends meet is enclosed; an open one is not', () => {
  assert.equal(isClosedRing(rect(0, 0, 40, 30)), true);
  assert.equal(isClosedRing([[0, 0], [40, 0], [40, 30]]), false, 'three points, ends far apart');
});

test('closure tolerance is relative to the path, not absolute', () => {
  // A 2-unit gap is a rounding artefact in a 400-unit site boundary and the
  // whole shape in a 10-unit door swing. An absolute tolerance gets one of
  // those wrong whichever value you pick.
  const big = [[0, 0], [400, 0], [400, 300], [0, 300], [0, 2]];
  const small = [[0, 0], [10, 0], [10, 8], [0, 8], [0, 2]];
  assert.equal(isClosedRing(big), true, 'the site boundary closes');
  assert.equal(isClosedRing(small), false, 'the door swing does not');
});

test('a degenerate path bounds nothing', () => {
  assert.equal(isClosedRing([[5, 5], [5, 5], [5, 5]]), false);
  assert.equal(isClosedRing([[0, 0], [1, 1]]), false);
  assert.equal(isClosedRing(null), false);
});

test('ringOf drops the repeated closing vertex', () => {
  // polygonArea treats a ring as implicitly closed; the duplicate adds a
  // zero-length edge and, worse, a phantom vertex to edit later.
  assert.equal(ringOf(rect(0, 0, 40, 30)).length, 4);
  assert.equal(ringOf([[0, 0], [4, 0], [4, 3]]).length, 3);
});

// ---- candidates ----------------------------------------------------------

test('only imported geometry is a candidate — never a redline', () => {
  // Circling a room in red is a comment. If that could be scheduled, markup
  // would stop being inert with respect to the programme, which is the one
  // rule the whole markup layer rests on.
  const strokes = [
    survey(1, rect(0, 0, 40, 30)),
    { id: 2, kind: 'ink', points: rect(0, 0, 40, 30), layer: null },
    { id: 3, kind: 'note', points: [[5, 5]], text: 'here' },
  ];
  assert.deepEqual(traceCandidates(strokes).map((c) => c.id), [1]);
});

test('an open imported path is not offered', () => {
  const strokes = [survey(1, [[0, 0], [40, 0], [40, 30]])];
  assert.deepEqual(traceCandidates(strokes), []);
});

test('specks below the minimum area are skipped', () => {
  // Hatch fragments and text-glyph outlines arrive by the hundred in a real
  // DXF; offering them as rooms makes the tool unusable.
  const speck = survey(1, rect(0, 0, 1, 1)); // 1 unit², under MIN_TRACE_AREA
  assert.equal(MIN_TRACE_AREA > 1, true);
  assert.deepEqual(traceCandidates([speck]), []);
});

test('candidates carry their measured area, centroid and source layer', () => {
  const [c] = traceCandidates([survey(7, rect(10, 20, 40, 30))]);
  assert.equal(c.id, 7);
  assert.equal(c.area, 1200); // 40 × 30, by hand
  assert.deepEqual({ x: c.centroid.x, y: c.centroid.y }, { x: 30, y: 35 });
  assert.equal(c.layer, 'A-WALL');
  assert.equal(c.source, 'plan.dxf');
});

test('a ring wound clockwise still measures positive', () => {
  // Winding direction is a property of whatever wrote the file, not of the
  // room. A negative area would land in the schedule as a negative room.
  const cw = [[0, 0], [0, 30], [40, 30], [40, 0], [0, 0]];
  assert.equal(traceCandidates([survey(1, cw)])[0].area, 1200);
});

// ---- picking -------------------------------------------------------------

test('the smallest ring under the cursor wins', () => {
  // A floor plan nests: room inside building inside site, and one click lands
  // inside all three. Smallest-first is what makes "under the cursor" mean the
  // room rather than the site boundary.
  const site = survey(1, rect(0, 0, 400, 300));
  const building = survey(2, rect(50, 50, 200, 150));
  const room = survey(3, rect(60, 60, 40, 30));
  const cands = traceCandidates([site, building, room]);
  assert.deepEqual(cands.map((c) => c.id), [3, 2, 1], 'sorted smallest first');
  assert.equal(pickCandidate(cands, { x: 70, y: 70 }).id, 3, 'inside all three → the room');
  assert.equal(pickCandidate(cands, { x: 200, y: 100 }).id, 2, 'inside two → the building');
  assert.equal(pickCandidate(cands, { x: 350, y: 280 }).id, 1, 'inside one → the site');
});

test('a click on open ground picks nothing', () => {
  const cands = traceCandidates([survey(1, rect(0, 0, 40, 30))]);
  assert.equal(pickCandidate(cands, { x: 500, y: 500 }), null);
});

// ---- area ----------------------------------------------------------------

test('the enclosed area converts through the drawing scale to real units', () => {
  // 40 × 30 diagram units at 0.5 m/unit = 20 m × 15 m = 300 m². Hand figure.
  const ring = ringOf(rect(0, 0, 40, 30));
  assert.equal(areaFromRing(ring, 0.5, 'm2', M2_PER_FT2), 300);
  // The same ring in an imperial project: 300 m² / 0.09290304 = 3229.17 ft².
  const ft2 = areaFromRing(ring, 0.5, 'ft2', M2_PER_FT2);
  assert.ok(Math.abs(ft2 - 3229.1731) < 0.01, `${ft2}`);
});

test('area scales with the SQUARE of the drawing scale', () => {
  const ring = ringOf(rect(0, 0, 40, 30));
  assert.equal(areaFromRing(ring, 1, 'm2', M2_PER_FT2), 1200);
  assert.equal(areaFromRing(ring, 2, 'm2', M2_PER_FT2), 4800); // ×2 scale → ×4 area
});

// ---- outline -------------------------------------------------------------

test('a traced outline keeps sharp corners, so it is the shape in the file', () => {
  // Rounding a surveyed boundary would be the app inventing geometry the file
  // does not contain — and it would make the recorded area a smoothed
  // approximation rather than what is on screen.
  const { verts } = traceToOutline(ringOf(rect(0, 0, 40, 30)));
  assert.equal(verts.length, 4);
  assert.ok(verts.every((v) => v.k === 's'), 'every corner sharp');
  // outlinePoints passes a sharp corner straight through, so the rendered ring
  // IS the polygon: the area on screen equals the area recorded.
  assert.equal(Math.abs(polygonArea(outlinePoints(verts, 14))), 1200);
});

test('a traced outline is re-centred on its own centroid', () => {
  // shape_json is stored centred on the node, so the offset has to come out
  // here or the room renders beside the thing it was traced from.
  const { verts, centroid } = traceToOutline(ringOf(rect(10, 20, 40, 30)));
  assert.deepEqual({ x: centroid.x, y: centroid.y }, { x: 30, y: 35 });
  const cx = verts.reduce((t, v) => t + v.x, 0) / verts.length;
  const cy = verts.reduce((t, v) => t + v.y, 0) / verts.length;
  assert.ok(Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9, `centred (${cx}, ${cy})`);
});

test('a dense surveyed curve is reduced to an editable vertex count', () => {
  // A surveyed boundary arrives with hundreds of points; nobody can drag that.
  const circle = [];
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    circle.push({ x: 100 * Math.cos(a), y: 100 * Math.sin(a) });
  }
  const { verts, area } = traceToOutline(circle, { maxVerts: 24 });
  assert.ok(verts.length <= 24, `${verts.length} vertices`);
  assert.ok(verts.length >= 3);
  // The area is measured AFTER simplification, so what is recorded is what is
  // drawn — a simplified circle is a polygon slightly inside the true circle.
  assert.equal(area, Math.abs(polygonArea(verts)), 'recorded area is the simplified ring');
  assert.ok(area < Math.PI * 100 * 100, 'and it is the inscribed polygon, not the circle');
  assert.ok(area > Math.PI * 100 * 100 * 0.97, 'but within 3% of it');
});
