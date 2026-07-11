// Interaction tests for the existing-feature improvement pass: rubber-band
// linking, matrix layout grading, the unmet-links popover, vertical-badge
// floor jumps, overlaid-mode labels, polygon-clipped block-up, the numeric
// rotation field, and concept-layout persistence on sim settle.
import './helpers/dom.js'; // MUST be first — sets up window/document for react-dom
import { fetchCalls, flushFrames } from './helpers/dom.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.React = React; // classic JSX transform under tsx (see components.test.js)

import BubbleTab from '../src/components/BubbleTab.jsx';
import { parsePoly, outlinePoints, polygonArea, pointInPolygon, normalizePolygon, regularPolygon } from '../src/geometry.js';

const act = React.act ?? React.unstable_act;

const project = { id: 1, name: 'P', client: '', stage: 'Concept', units: 'm2', tolerance: 0.05, view_x: 0, view_y: 0, north_deg: 0 };
const building = { id: 1, kind: 'building', name: 'Main', parent_id: null, target_area: 0, count: 1, department: 'Building' };
const lobby = { id: 2, kind: 'space', name: 'Lobby', parent_id: 1, department: 'Public', count: 1, target_area: 100 };
const office = { id: 3, kind: 'space', name: 'Office', parent_id: 1, department: 'Staff', count: 1, target_area: 50 };
const store = { id: 4, kind: 'space', name: 'Store', parent_id: 1, department: 'Staff', count: 1, target_area: 30 };
const spaces = [building, lobby, office, store];
const adjacencies = [{ id: 1, project_id: 1, space_a: 2, space_b: 3, strength: 'desired' }];

beforeEach(() => {
  fetchCalls.length = 0;
});

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(h(BubbleTab, { project, spaces, adjacencies, images: [], onChanged() {}, ...props }));
  });
  const svg = container.querySelector('svg.bubble-svg');
  if (svg) {
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, width: 900, height: 620, right: 900, bottom: 620 });
  }
  return {
    container,
    svg,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const ev = (type, opts) => new window.MouseEvent(type, { bubbles: true, button: 0, ...opts });
const key = (k, opts = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
const posOf = (el) => {
  const m = /translate\((-?[\d.]+),\s*(-?[\d.]+)\)/.exec(el.getAttribute('transform'));
  return { x: Number(m[1]), y: Number(m[2]) };
};

test('link tool: dragging from one room to another creates the relationship', async () => {
  const { container, svg, unmount } = mount();
  try {
    await act(async () => key('l')); // Link tool
    const from = posOf(container.querySelector('g.bubble[data-space-id="2"]'));
    const to = posOf(container.querySelector('g.bubble[data-space-id="4"]')); // 2↔4 has no link yet
    const bubble = container.querySelector('g.bubble[data-space-id="2"]');
    await act(async () => {
      bubble.dispatchEvent(ev('pointerdown', { clientX: from.x, clientY: from.y }));
      svg.dispatchEvent(ev('pointermove', { clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 }));
    });
    assert.ok(container.querySelector('.link-preview'), 'rubber band renders mid-drag');
    await act(async () => {
      svg.dispatchEvent(ev('pointerup', { clientX: to.x, clientY: to.y }));
    });
    const post = fetchCalls.find((c) => c.url === '/api/projects/1/adjacencies' && c.options?.method === 'POST');
    assert.ok(post, 'release over the target created the adjacency');
    const body = JSON.parse(post.options.body);
    assert.deepEqual([body.space_a, body.space_b].sort(), [2, 4]);
    // The room did NOT move (link mode never drags geometry).
    const after = posOf(container.querySelector('g.bubble[data-space-id="2"]'));
    assert.equal(Math.round(after.x), Math.round(from.x));
  } finally {
    unmount();
  }
});

test('adjacency matrix grades pairs against the current layout', async () => {
  const { container, unmount } = mount();
  try {
    const more = [...container.querySelectorAll('.ctrl-btn')].find((b) => b.textContent === '⋯');
    await act(async () => more.dispatchEvent(ev('click')));
    const matrixBtn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Adjacency matrix'));
    await act(async () => matrixBtn.dispatchEvent(ev('click')));
    const graded = container.querySelector('.mcell.met, .mcell.unmet');
    assert.ok(graded, 'the declared pair carries a met/unmet grade');
    assert.match(container.querySelector('.matrix-modal').textContent, /graded against the current layout/);
  } finally {
    unmount();
  }
});

test('adjacency badge opens the unmet-links popover', async () => {
  const { container, unmount } = mount();
  try {
    const badge = container.querySelector('.adj-badge');
    assert.ok(badge, 'score badge renders in Concept');
    await act(async () => badge.dispatchEvent(ev('click')));
    const pop = container.querySelector('.gaps-popover');
    assert.ok(pop, 'popover opens with the highlight toggle');
    assert.match(pop.textContent, /unmet relationship|satisfied/);
  } finally {
    unmount();
  }
});

// ---- Building fixtures (two levels, blocked rooms at known positions) ------

const blockedLobby = { ...lobby, level: 'Ground', block_json: JSON.stringify({ 0: { x: 100, y: 100 } }) };
const blockedOffice = { ...office, level: 'Level 1', block_json: JSON.stringify({ 0: { x: 320, y: 300 } }) };

test('vertical-adjacency badge jumps to the partner floor with it selected', async () => {
  const { container, unmount } = mount({
    project: { ...project, diagram_env: 'building' },
    spaces: [building, blockedLobby, blockedOffice],
  });
  try {
    const floors = [...container.querySelectorAll('.ctrl-field')].find((f) => f.textContent.includes('Floors')).querySelector('select');
    assert.equal(floors.value, 'Ground', 'Building lands on the ground floor');
    const badge = container.querySelector('.vlink-badge');
    assert.ok(badge, 'the interfloor link shows a badge on the visible room');
    assert.match(badge.querySelector('title').textContent, /Office/, 'the badge names the partner');
    await act(async () => badge.dispatchEvent(ev('click')));
    assert.equal(floors.value, 'Level 1', 'clicking jumped to the partner floor');
    assert.match(container.querySelector('.action-bar').textContent, /Office/, 'the partner is selected');
  } finally {
    unmount();
  }
});

test('overlaid stacked mode drops text labels but keeps room tooltips', async () => {
  const { container, unmount } = mount({
    project: { ...project, diagram_env: 'building' },
    spaces: [building, blockedLobby, blockedOffice],
  });
  try {
    const floors = [...container.querySelectorAll('.ctrl-field')].find((f) => f.textContent.includes('Floors')).querySelector('select');
    await act(async () => {
      floors.value = 'overlaid';
      floors.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    const rooms = [...container.querySelectorAll('.stack-room')];
    assert.equal(rooms.length, 2, 'both storeys render on the shared plane');
    assert.equal(container.querySelectorAll('g.bubble.stacked').length, 0, 'no superimposed text labels');
    assert.ok(rooms.every((r) => r.querySelector('title')), 'every room keeps a tooltip');
    // Offset mode keeps its labels.
    await act(async () => {
      floors.value = 'offset';
      floors.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.ok(container.querySelectorAll('g.bubble.stacked').length >= 2, 'offset mode labels every room');
  } finally {
    unmount();
  }
});

test('block-up packs the rooms inside the envelope outline', async () => {
  const shapeJson = JSON.stringify(normalizePolygon(regularPolygon(6)));
  const scaled = { ...project, id: 7, diagram_env: 'building', display_scale: 0.1323 }; // 1:500
  const envelope = {
    ...building,
    plan_json: JSON.stringify({ 0: { x: 450, y: 310, a: 900 } }),
    shape: 'poly',
    shape_json: shapeJson,
  };
  const rooms = [
    { ...lobby, target_area: 60 },
    { ...office, target_area: 40 },
    { ...store, target_area: 30 },
  ];
  const { container, unmount } = mount({ project: scaled, spaces: [envelope, ...rooms] });
  try {
    const tray = container.querySelector('.place-tray');
    assert.ok(tray && /Block up/.test(tray.textContent), 'un-blocked rooms wait in the tray');
    const btn = [...tray.querySelectorAll('button')].find((b) => b.textContent.includes('Main'));
    await act(async () => btn.dispatchEvent(ev('click')));
    // Rebuild the envelope boundary exactly as the app renders it (outline
    // points scaled so the drawn area equals the envelope's areaUnits).
    const slot = { x: 450, y: 310 };
    const areaU = 900 / (0.1323 * 0.1323); // 900 m² at 1:500, in diagram units²
    const pts = outlinePoints(parsePoly({ shape: 'poly', shape_json: shapeJson }), 14);
    const f = Math.sqrt(areaU / polygonArea(pts));
    const boundary = pts.map((p) => ({ x: slot.x + p.x * f, y: slot.y + p.y * f }));
    for (const id of [2, 3, 4]) {
      const p = posOf(container.querySelector(`g.bubble[data-space-id="${id}"]`));
      assert.ok(pointInPolygon(boundary, p), `room ${id} landed inside the outline (${p.x.toFixed(0)},${p.y.toFixed(0)})`);
    }
    const puts = fetchCalls.filter((c) => c.options?.method === 'PUT' && c.options.body?.includes('block_json'));
    assert.ok(puts.length >= 3, 'placements persisted to block_json');
  } finally {
    unmount();
  }
});

test('master plan action bar takes an exact rotation in degrees', async () => {
  const shapeJson = JSON.stringify(normalizePolygon(regularPolygon(6)));
  const envelope = {
    ...building,
    plan_json: JSON.stringify({ 0: { x: 450, y: 310, a: 600 } }),
    shape: 'poly',
    shape_json: shapeJson,
  };
  const { container, unmount } = mount({
    project: { ...project, diagram_env: 'masterplan' },
    spaces: [envelope, lobby, office],
  });
  try {
    const g = container.querySelector('g.bubble[data-space-id="1"]');
    await act(async () => {
      g.dispatchEvent(ev('pointerdown', { clientX: 450, clientY: 310 }));
      g.dispatchEvent(ev('pointerup', { clientX: 450, clientY: 310 }));
    });
    const rotInput = container.querySelector('.action-rot input');
    assert.ok(rotInput, 'rotation field shows for a drawn footprint');
    await act(async () => {
      rotInput.value = '45';
      rotInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const put = fetchCalls.find(
      (c) => c.url === '/api/spaces/1' && c.options?.method === 'PUT' && JSON.parse(c.options.body).plan_json?.includes('"rot":45')
    );
    assert.ok(put, 'the exact rotation persisted to plan_json');
  } finally {
    unmount();
  }
});

test('concept layout persists to pin_json when the sim settles', async () => {
  const { container, unmount } = mount();
  try {
    fetchCalls.length = 0;
    await act(async () => key('a')); // momentary auto-layout pass
    // Pump the manual rAF queue until the pass cools and fires onSettle.
    await act(async () => flushFrames(400));
    await new Promise((r) => setTimeout(r, 0)); // let the async saves flush
    const saves = fetchCalls.filter((c) => c.options?.method === 'PUT' && c.options.body?.includes('pin_json'));
    assert.ok(saves.length >= 3, `settled positions saved for the rooms (got ${saves.length})`);
    assert.ok(saves.every((c) => !JSON.parse(c.options.body).pin_json.includes('locked')), 'saved unlocked — not pinned');
  } finally {
    unmount();
  }
});
