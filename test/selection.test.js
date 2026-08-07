import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialSelection,
  selectClick,
  shiftToggle,
  pick,
  clearPick,
  applyExternal,
  escape,
  marqueeEnd,
  emptyCanvasClick,
  afterRemoveSelected,
  afterMultiDelete,
  hitsInBox,
  isClickBox,
} from '../src/components/diagram/selection.js';
import {
  linkClick,
  selectLink,
  clearSelLink,
  setLinkKind,
  setTool,
} from '../src/components/diagram/linking.js';

const sel = (over = {}) => ({ ...initialSelection, multi: new Set(), ...over });
const fxTypes = (r) => r.fx.map((f) => `${f.type}:${f.id !== undefined ? f.id : ''}`);

// ---- selectClick ---------------------------------------------------------

test('selectClick selects a room and notifies the shared selection', () => {
  const r = selectClick(sel(), 7, 2);
  assert.equal(r.sel.selected, 7);
  assert.equal(r.sel.selectedInst, 2);
  assert.deepEqual(fxTypes(r), ['notify:7']);
});

test('selectClick on the selected room retargets the instance silently', () => {
  const r = selectClick(sel({ selected: 7, selectedInst: 0 }), 7, 1);
  assert.equal(r.sel.selected, 7);
  assert.equal(r.sel.selectedInst, 1);
  assert.deepEqual(r.fx, []);
});

test('selectClick on the selected instance deselects and notifies null', () => {
  const r = selectClick(sel({ selected: 7, selectedInst: 1 }), 7, 1);
  assert.equal(r.sel.selected, null);
  assert.deepEqual(fxTypes(r), ['notify:null']);
});

test('selectClick moves the selection to another room', () => {
  const r = selectClick(sel({ selected: 7 }), 9, 0);
  assert.equal(r.sel.selected, 9);
  assert.deepEqual(fxTypes(r), ['notify:9']);
});

test('selectClick always drops a selected link', () => {
  const r = selectClick(sel({ selLink: { space_a: 1, space_b: 2 } }), 7);
  assert.equal(r.sel.selLink, null);
});

// ---- shiftToggle / multi -------------------------------------------------

test('shiftToggle adds then removes a key, clearing single + link selection', () => {
  const a = shiftToggle(sel({ selected: 7, selLink: { space_a: 1, space_b: 2 } }), '3:0');
  assert.deepEqual([...a.sel.multi], ['3:0']);
  assert.equal(a.sel.selected, null);
  assert.equal(a.sel.selLink, null);
  assert.deepEqual(fxTypes(a), ['notify:null']);
  const b = shiftToggle(a.sel, '3:0');
  assert.equal(b.sel.multi.size, 0);
});

// ---- pick / clearPick / external sync -------------------------------------

test('pick and clearPick notify; applyExternal never does', () => {
  const p = pick(sel(), 5, 1);
  assert.equal(p.sel.selected, 5);
  assert.equal(p.sel.selectedInst, 1);
  assert.deepEqual(fxTypes(p), ['notify:5']);
  const c = clearPick(p.sel);
  assert.equal(c.sel.selected, null);
  assert.deepEqual(fxTypes(c), ['notify:null']);
  const e = applyExternal(sel(), 5);
  assert.equal(e.sel.selected, 5);
  assert.equal(e.sel.selectedInst, 0);
  assert.deepEqual(e.fx, []);
});

// ---- escape ---------------------------------------------------------------

test('escape clears every kind of selection and notifies null', () => {
  const r = escape(
    sel({ selected: 7, multi: new Set(['1:0']), selLink: { space_a: 1, space_b: 2 }, linkFrom: 3 })
  );
  assert.equal(r.sel.selected, null);
  assert.equal(r.sel.multi.size, 0);
  assert.equal(r.sel.selLink, null);
  assert.equal(r.sel.linkFrom, null);
  assert.deepEqual(fxTypes(r), ['notify:null']);
});

// ---- marquee ---------------------------------------------------------------

test('marqueeEnd replaces the multi-selection and clears single + link', () => {
  const r = marqueeEnd(sel({ selected: 7, multi: new Set(['9:0']) }), ['1:0', '2:0'], false);
  assert.deepEqual([...r.sel.multi].sort(), ['1:0', '2:0']);
  assert.equal(r.sel.selected, null);
  assert.deepEqual(fxTypes(r), ['notify:null']);
});

test('marqueeEnd additive merges into the existing multi-selection', () => {
  const r = marqueeEnd(sel({ multi: new Set(['9:0']) }), ['1:0'], true);
  assert.deepEqual([...r.sel.multi].sort(), ['1:0', '9:0']);
});

// This used to assert the opposite — that a single selection SURVIVED an empty
// marquee — which made the outcome hinge on a few pixels of hand movement: a
// click on empty canvas cleared everything (emptyCanvasClick), a 5px drag across
// the same empty canvas did not. Every comparable tool (AutoCAD, Illustrator,
// Figma) treats a marquee that catches nothing as "select none", so it now
// agrees with the click. The additive case below is what protects a selection
// you are building up.
test('a non-additive marquee that catches nothing clears the selection', () => {
  const r = marqueeEnd(sel({ selected: 7, multi: new Set(['9:0']), selLink: { space_a: 1, space_b: 2 } }), [], false);
  assert.equal(r.sel.multi.size, 0);
  assert.equal(r.sel.selected, null);
  assert.equal(r.sel.selLink, null);
  assert.deepEqual(fxTypes(r), ['notify:null']);
});

test('an ADDITIVE marquee that catches nothing leaves the selection alone', () => {
  const r = marqueeEnd(sel({ selected: 7 }), [], true);
  assert.equal(r.sel.selected, 7, 'shift-drag never destroys what you have');
  assert.equal(r.sel.multi.size, 0);
  assert.deepEqual(r.fx, []);
});

// An additive marquee that DOES catch something still drops the single
// selection — multi and single are mutually exclusive, which is long-standing.
test('an additive marquee that catches something moves you into multi-select', () => {
  const r = marqueeEnd(sel({ selected: 7, multi: new Set(['9:0']) }), ['1:0'], true);
  assert.deepEqual([...r.sel.multi].sort(), ['1:0', '9:0']);
  assert.equal(r.sel.selected, null);
  assert.deepEqual(fxTypes(r), ['notify:null']);
});

test('emptyCanvasClick clears everything unless additive', () => {
  const state = sel({ selected: 7, multi: new Set(['1:0']), linkFrom: 3 });
  const r = emptyCanvasClick(state, false);
  assert.equal(r.sel.selected, null);
  assert.equal(r.sel.multi.size, 0);
  assert.equal(r.sel.linkFrom, null);
  assert.deepEqual(fxTypes(r), ['notify:null']);
  const additive = emptyCanvasClick(state, true);
  assert.equal(additive.sel, state, 'additive empty click is a no-op');
});

// Without half-extents the function degrades to the old centre-only test.
test('hitsInBox returns keys inside the (unordered) box corners', () => {
  const instances = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const pos = { a: { x: 10, y: 10 }, b: { x: 50, y: 50 }, c: { x: 200, y: 10 } };
  const hits = hitsInBox(instances, (k) => pos[k], { x0: 60, y0: 60, x1: 0, y1: 0 });
  assert.deepEqual(hits, ['a', 'b']);
});

// Window vs crossing — the CAD convention. Testing the node CENTRE alone (which
// is all this used to do) selected a room whose centre happened to fall inside
// even when it was mostly outside, and missed a large envelope you had visibly
// boxed three-quarters of.
const HALFS = { a: { x: 20, y: 20 }, b: { x: 5, y: 5 } };
const boxInstances = [{ key: 'a' }, { key: 'b' }];
const boxPos = { a: { x: 50, y: 50 }, b: { x: 100, y: 100 } };
const half = (o) => HALFS[o.key];

test('a left→right marquee (window) takes only fully-enclosed footprints', () => {
  // Box spans 0..70: it contains a's centre AND a's full ±20 extent.
  const all = hitsInBox(boxInstances, (k) => boxPos[k], { x0: 0, y0: 0, x1: 70, y1: 70 }, half);
  assert.deepEqual(all, ['a']);
  // Now clip it to 0..60 — a's centre is still inside but its right edge is not.
  const clipped = hitsInBox(boxInstances, (k) => boxPos[k], { x0: 0, y0: 0, x1: 60, y1: 60 }, half);
  assert.deepEqual(clipped, [], 'a window select does not take a partially-covered room');
});

test('a right→left marquee (crossing) takes anything it touches', () => {
  // Same 0..60 region, dragged the other way: x1 < x0 marks it as a crossing.
  const hits = hitsInBox(boxInstances, (k) => boxPos[k], { x0: 60, y0: 60, x1: 0, y1: 0 }, half);
  assert.deepEqual(hits, ['a'], 'touching is enough when dragging leftwards');
});

// The slop is passed in as WORLD units converted from a screen distance at the
// current zoom, so the click/drag boundary means the same at 0.2× and 6×. A
// fixed 4 units was under a pixel zoomed out — hand tremor turned a click into
// a marquee that cleared the selection.
test('isClickBox scales with the caller-supplied slop', () => {
  const small = { x0: 5, y0: 5, x1: 8, y1: 7 };
  assert.equal(isClickBox(small), true, 'default slop keeps the old behaviour');
  assert.equal(isClickBox({ x0: 5, y0: 5, x1: 15, y1: 5 }), false);
  // Zoomed out (slop = 4px / 0.2 = 20 units) the same 10-unit drag is a click.
  assert.equal(isClickBox({ x0: 5, y0: 5, x1: 15, y1: 5 }, 20), true);
  // Zoomed in (slop = 4px / 6 ≈ 0.67 units) a 3-unit drag is a real marquee.
  assert.equal(isClickBox(small, 0.67), false);
});

// ---- delete aftermath ------------------------------------------------------

test('afterRemoveSelected / afterMultiDelete clear silently', () => {
  const a = afterRemoveSelected(sel({ selected: 7 }));
  assert.equal(a.sel.selected, null);
  assert.deepEqual(a.fx, []);
  const b = afterMultiDelete(sel({ multi: new Set(['1:0']) }));
  assert.equal(b.sel.multi.size, 0);
  assert.deepEqual(b.fx, []);
});

// ---- linking ----------------------------------------------------------------

test('linkClick arms, disarms on the same room, links on a second room', () => {
  const armed = linkClick(sel({ tool: 'link' }), 4);
  assert.equal(armed.sel.linkFrom, 4);
  assert.deepEqual(armed.fx, []);
  const disarmed = linkClick(armed.sel, 4);
  assert.equal(disarmed.sel.linkFrom, null);
  assert.deepEqual(disarmed.fx, []);
  const linked = linkClick(armed.sel, 9);
  assert.equal(linked.sel.linkFrom, null);
  assert.deepEqual(linked.fx, [{ type: 'maybeCreateLink', a: 4, b: 9, ia: 0, ib: 0, kind: 'desired' }]);
});

test('linkClick carries the SPECIFIC instances clicked (count>1 spaces)', () => {
  const armed = linkClick(sel({ tool: 'link' }), 4, 2); // room C of space 4
  assert.equal(armed.sel.linkFrom, 4);
  assert.equal(armed.sel.linkFromInst, 2);
  const linked = linkClick(armed.sel, 9, 1); // → room B of space 9
  assert.deepEqual(linked.fx, [{ type: 'maybeCreateLink', a: 4, b: 9, ia: 2, ib: 1, kind: 'desired' }]);
  assert.equal(linked.sel.linkFromInst, 0);
});

test('linkClick uses the chosen link kind and drops a selected link', () => {
  const s = sel({ tool: 'link', linkFrom: 4, linkKind: 'required', selLink: { space_a: 1, space_b: 2 } });
  const r = linkClick(s, 9);
  assert.equal(r.sel.selLink, null);
  assert.equal(r.fx[0].kind, 'required');
});

test('selectLink selects the link and clears room/multi/pending link', () => {
  const s = sel({ selected: 7, multi: new Set(['1:0']), linkFrom: 3 });
  const r = selectLink(s, { id: 12, space_a: 1, space_b: 2, inst_a: 0, inst_b: 2, strength: 'desired' });
  assert.deepEqual(r.sel.selLink, { space_a: 1, space_b: 2, inst_a: 0, inst_b: 2 });
  assert.equal(r.sel.selected, null);
  assert.equal(r.sel.multi.size, 0);
  assert.equal(r.sel.linkFrom, null);
  assert.deepEqual(fxTypes(r), ['notify:null']);
});

test('clearSelLink and setLinkKind are plain field updates', () => {
  assert.equal(clearSelLink(sel({ selLink: { space_a: 1, space_b: 2 } })).sel.selLink, null);
  assert.equal(setLinkKind(sel(), 'required').sel.linkKind, 'required');
});

test('setTool link clears room + link selection WITHOUT notifying', () => {
  const r = setTool(sel({ selected: 7, selLink: { space_a: 1, space_b: 2 } }), 'link');
  assert.equal(r.sel.tool, 'link');
  assert.equal(r.sel.selected, null);
  assert.equal(r.sel.selLink, null);
  assert.deepEqual(r.fx, [], 'the Brief keeps its highlight when entering Link mode');
});

test('setTool select disarms a half-made link and keeps the selection', () => {
  const r = setTool(sel({ tool: 'link', linkFrom: 4, selected: 7 }), 'select');
  assert.equal(r.sel.tool, 'select');
  assert.equal(r.sel.linkFrom, null);
  assert.equal(r.sel.selected, 7);
});
