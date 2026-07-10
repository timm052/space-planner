// Characterization smoke tests for the diagram's interactive shell.
// Unlike components.test.js (static SSR of prop-driven views), BubbleTab only
// draws bubbles after its effects run — node positions are seeded in a
// [spaces] effect that bumps the tick store — so these tests really mount it
// under jsdom. This is the safety net for the BubbleTab decomposition.
import './helpers/dom.js'; // MUST be first — sets up window/document for react-dom
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

// tsx transforms JSX with the classic runtime (bare React.createElement); the
// components only reference React at render time, so a global is enough.
globalThis.React = React;

import BubbleTab from '../src/components/BubbleTab.jsx';

const act = React.act ?? React.unstable_act;

// Shared fixture, same shape as components.test.js: one building containing a
// Public (Lobby) and a Staff (Office) leaf, with one desired adjacency.
const project = {
  id: 1,
  name: 'P',
  client: '',
  stage: 'Concept',
  units: 'm2',
  tolerance: 0.05,
  view_x: 0,
  view_y: 0,
  north_deg: 0,
  display_scale: null,
  bubble_style: null,
  bubble_opacity: null,
  category_colors: null,
};
const building = { id: 1, kind: 'building', name: 'Main', parent_id: null, target_area: 0, count: 1, department: 'Building' };
const lobby = { id: 2, kind: 'space', name: 'Lobby', parent_id: 1, department: 'Public', count: 1, target_area: 100 };
const office = { id: 3, kind: 'space', name: 'Office', parent_id: 1, department: 'Staff', count: 1, target_area: 50 };
const spaces = [building, lobby, office];
const adjacencies = [{ id: 1, project_id: 1, space_a: 2, space_b: 3, strength: 'desired' }];

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      h(BubbleTab, {
        project,
        spaces,
        adjacencies,
        images: [],
        onChanged() {},
        ...props,
      })
    );
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('BubbleTab mounts with toolbar, canvas, bubbles and rail', () => {
  const { container, unmount } = mount();
  try {
    // Toolbar: control cluster + actions cluster.
    assert.ok(container.querySelector('.stage-topbar'), 'stage top bar renders');
    assert.ok(container.querySelector('.stage-controls .seg-env'), 'environment switcher renders');
    // Concept is scale-free — the metric Scale control belongs to Master plan /
    // Building, so it is NOT shown here (default env is Concept).
    assert.ok(!container.querySelector('.stage-controls select.ctrl-select'), 'no scale select in Concept');
    const actions = [...container.querySelectorAll('.stage-actions button')].map((b) => b.textContent);
    assert.ok(actions.some((t) => t.includes('PNG')), 'PNG export button present');
    assert.ok(actions.some((t) => t.includes('PDF')), 'PDF export button present');

    // Canvas: the [spaces] seeding effect placed one bubble per leaf instance.
    // (.bubble-svg specifically — the stage also contains small icon SVGs.)
    const svg = container.querySelector('svg.bubble-svg');
    assert.ok(svg, 'diagram SVG renders');
    const bubbles = [...svg.querySelectorAll('g.bubble')];
    assert.equal(bubbles.length, 2, 'one bubble per leaf space');
    const ids = bubbles.map((b) => b.getAttribute('data-space-id')).sort();
    assert.deepEqual(ids, ['2', '3']);
    // Every bubble got a real seeded position, not the default 0,0 origin.
    for (const b of bubbles) assert.match(b.getAttribute('transform'), /translate\(-?\d/);
    const names = [...svg.querySelectorAll('.bubble-name')].map((t) => t.textContent);
    assert.ok(names.some((n) => n.includes('Lobby')), 'Lobby bubble is labelled');
    assert.ok(names.some((n) => n.includes('Office')), 'Office bubble is labelled');

    // Rail: split view defaults on, listing the leaves with editable areas.
    const rail = container.querySelector('aside.diagram-rail');
    assert.ok(rail, 'areas/relationships rail renders');
    assert.match(rail.textContent, /Lobby/);
    assert.match(rail.textContent, /Office/);
  } finally {
    unmount();
  }
});

test('BubbleTab draws one bubble per instance for counted rooms', () => {
  const meeting = { id: 4, kind: 'space', name: 'Meeting', parent_id: 1, department: 'Staff', count: 3, target_area: 20 };
  const { container, unmount } = mount({ spaces: [building, lobby, meeting] });
  try {
    const bubbles = [...container.querySelectorAll('g.bubble')];
    assert.equal(bubbles.length, 4, 'Lobby + 3 Meeting instances');
    const meetings = bubbles.filter((b) => b.getAttribute('data-space-id') === '4');
    assert.equal(meetings.length, 3);
    const instances = meetings.map((b) => b.getAttribute('data-instance')).sort();
    assert.deepEqual(instances, ['0', '1', '2']);
  } finally {
    unmount();
  }
});

test('BubbleTab clicking a bubble opens the room action bar', async () => {
  const { container, unmount } = mount();
  try {
    const lobbyBubble = container.querySelector('g.bubble[data-space-id="2"]');
    assert.ok(lobbyBubble);
    // A click is pointerdown on the bubble (sets dragRef) then pointerup
    // bubbling to the svg's onPointerUp, which selects when moved < 6px.
    // onUp is async, so use an async act to flush its continuation.
    await act(async () => {
      lobbyBubble.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      lobbyBubble.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });
    const bar = container.querySelector('.action-bar');
    assert.ok(bar, 'action bar appears for the selected room');
    assert.match(bar.textContent, /Lobby/);
    assert.match(bar.textContent, /Pin/);
  } finally {
    unmount();
  }
});

test('Master plan with buildings draws building envelopes, not rooms', () => {
  const { container, unmount } = mount({ project: { ...project, diagram_env: 'masterplan' } });
  try {
    const bubbles = [...container.querySelectorAll('g.bubble')];
    assert.equal(bubbles.length, 1, 'one unit per building — rooms stay in Building/Concept');
    assert.equal(bubbles[0].getAttribute('data-space-id'), '1', 'the unit is the container row');
    // Un-placed building → ghost + the placement tray offers it.
    assert.ok(bubbles[0].classList.contains('ghost'), 'unplaced envelope renders as a ghost');
    const tray = container.querySelector('.place-tray');
    assert.ok(tray, 'placement tray shows');
    assert.match(tray.textContent, /Main/);
    assert.match(tray.textContent, /Place all/);
  } finally {
    unmount();
  }
});

test('Voronoi interior: cells render, click one to select its ROOM (no shape tools)', async () => {
  const { normalizePolygon, regularPolygon } = await import('../src/geometry.js');
  // A PLACED envelope (plan_json slot + poly outline) with pinned rooms —
  // everything the interior sketch needs to draw cells.
  const placedBuilding = {
    ...building,
    plan_json: JSON.stringify({ 0: { x: 300, y: 300, a: 600 } }),
    shape: 'poly',
    shape_json: JSON.stringify(normalizePolygon(regularPolygon(6))),
  };
  const pinnedLobby = { ...lobby, level: 'Ground', pin_json: JSON.stringify({ 0: { x: 280, y: 290 } }) };
  const pinnedOffice = { ...office, level: 'Level 1', pin_json: JSON.stringify({ 0: { x: 330, y: 315 } }) };
  const { container, unmount } = mount({
    project: { ...project, diagram_env: 'masterplan' },
    spaces: [placedBuilding, pinnedLobby, pinnedOffice],
  });
  try {
    // A multi-level program shows ONE storey at a time (ground by default) —
    // there is no "all floors" overlay for a single floor plate.
    let cells = [...container.querySelectorAll('.voronoi-cell')];
    assert.equal(cells.length, 1, 'ground storey only by default');
    assert.match(cells[0].textContent, /Lobby/);
    const interiorField = [...container.querySelectorAll('.ctrl-field')].find((f) => f.textContent.includes('Interior'));
    assert.ok(interiorField, 'interior storey selector renders');
    const opts = [...interiorField.querySelectorAll('option')].map((o) => o.textContent);
    assert.deepEqual(opts, ['Ground', 'Level 1'], 'no All-floors option');
    // Clicking a cell selects the ROOM it stands for, not the building —
    // and interior rooms get no outline editing (they aren't drawn here).
    const fill = cells[0].querySelector('.voronoi-fill');
    await act(async () => {
      fill.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      fill.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });
    const bar = container.querySelector('.action-bar');
    assert.ok(bar, 'action bar appears');
    assert.match(bar.textContent, /Lobby/, 'the ROOM is selected, not the building');
    assert.doesNotMatch(bar.textContent, /Shape/, 'no outline editing for an interior room');
    // Switching storeys swaps which room's cell shows.
    const select = interiorField.querySelector('select');
    await act(async () => {
      select.value = 'Level 1';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    cells = [...container.querySelectorAll('.voronoi-cell')];
    assert.equal(cells.length, 1);
    assert.match(cells[0].textContent, /Office/, 'Level 1 shows the Office cell');
  } finally {
    unmount();
  }
});

test('Voronoi interior: rooms without a Concept position still get a cell', async () => {
  const { normalizePolygon, regularPolygon } = await import('../src/geometry.js');
  const placedBuilding = {
    ...building,
    plan_json: JSON.stringify({ 0: { x: 300, y: 300, a: 600 } }),
    shape: 'poly',
    shape_json: JSON.stringify(normalizePolygon(regularPolygon(6))),
  };
  // Neither room has a pin and the Concept view was never opened — the
  // fallback spiral must still give every room a cell.
  const { container, unmount } = mount({
    project: { ...project, diagram_env: 'masterplan' },
    spaces: [placedBuilding, lobby, office],
  });
  try {
    const cells = [...container.querySelectorAll('.voronoi-cell')];
    assert.equal(cells.length, 2, 'every room gets a cell without concept data');
  } finally {
    unmount();
  }
});

test('area-true cells: a room with triple the target gets the bigger cell', async () => {
  const { normalizePolygon, regularPolygon, polygonArea } = await import('../src/geometry.js');
  const placedBuilding = {
    ...building,
    plan_json: JSON.stringify({ 0: { x: 300, y: 300, a: 600 } }),
    shape: 'poly',
    shape_json: JSON.stringify(normalizePolygon(regularPolygon(6))),
  };
  const big = { ...lobby, target_area: 150, pin_json: JSON.stringify({ 0: { x: 290, y: 295 } }) };
  const small = { ...office, target_area: 50, pin_json: JSON.stringify({ 0: { x: 315, y: 305 } }) };
  // A real drawing scale makes cell areas exactly proportional (the scale-free
  // relative radii carry a base offset that compresses ratios).
  const { container, unmount } = mount({
    project: { ...project, diagram_env: 'masterplan', display_scale: 0.1323 },
    spaces: [placedBuilding, big, small],
  });
  try {
    const areaOf = (name) => {
      const cell = [...container.querySelectorAll('.voronoi-cell')].find((c) => c.textContent.includes(name));
      const d = cell.querySelector('.voronoi-fill').getAttribute('d');
      const pts = [...d.matchAll(/([ML]) ?(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[2]), y: Number(m[3]) }));
      return Math.abs(polygonArea(pts));
    };
    const ratio = areaOf('Lobby') / areaOf('Office');
    assert.ok(ratio > 2.2 && ratio < 4, `cell areas track the 3:1 target ratio (got ${ratio.toFixed(2)}:1)`);
  } finally {
    unmount();
  }
});

test('BubbleTab shows the empty state when the brief has no spaces', () => {
  const { container, unmount } = mount({ spaces: [] });
  try {
    assert.match(container.textContent, /Define the brief first/);
    assert.ok(!container.querySelector('svg.bubble-svg'), 'no canvas without spaces');
  } finally {
    unmount();
  }
});

test('BubbleTab prompts for leaf spaces when the brief only has containers', () => {
  const { container, unmount } = mount({ spaces: [building] });
  try {
    assert.match(container.textContent, /only has containers/);
  } finally {
    unmount();
  }
});
