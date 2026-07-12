// Interaction tests for the Building-tab UX pass: right-drag pan, move-to-floor
// (context menu + action-bar selects), floor onion-skin, and the category-
// segmented stacking bars.
import './helpers/dom.js'; // MUST be first — sets up window/document for react-dom
import { fetchCalls } from './helpers/dom.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.React = React; // classic JSX transform under tsx (see components.test.js)

import BubbleTab from '../src/components/BubbleTab.jsx';

const act = React.act ?? React.unstable_act;

const project = { id: 1, name: 'P', client: '', stage: 'Concept', units: 'm2', tolerance: 0.05, view_x: 0, view_y: 0, north_deg: 0 };
const building = { id: 1, kind: 'building', name: 'Main', parent_id: null, target_area: 0, count: 1, department: 'Building' };
const lobby = { id: 2, kind: 'space', name: 'Lobby', parent_id: 1, department: 'Public', count: 1, target_area: 100 };
const office = { id: 3, kind: 'space', name: 'Office', parent_id: 1, department: 'Staff', count: 1, target_area: 50 };
const blockedLobby = { ...lobby, level: 'Ground', block_json: JSON.stringify({ 0: { x: 100, y: 100 } }) };
const blockedOffice = { ...office, level: 'Level 1', block_json: JSON.stringify({ 0: { x: 320, y: 300 } }) };
const adjacencies = [{ id: 1, project_id: 1, space_a: 2, space_b: 3, strength: 'desired' }];

beforeEach(() => {
  fetchCalls.length = 0;
  window.localStorage.clear();
});

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(h(BubbleTab, { project, spaces: [building, lobby, office], adjacencies, images: [], onChanged() {}, ...props }));
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

const mountBuilding = () => mount({ project: { ...project, diagram_env: 'building' }, spaces: [building, blockedLobby, blockedOffice] });

const ev = (type, opts) => new window.MouseEvent(type, { bubbles: true, cancelable: true, ...opts });
const pev = (type, opts) => new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, ...opts });

test('holding the right button pans; a stationary right-click still opens the menu', async () => {
  const { container, svg, unmount } = mount();
  try {
    const vbBefore = svg.getAttribute('viewBox');
    await act(async () => {
      svg.dispatchEvent(pev('pointerdown', { button: 2, buttons: 2, clientX: 400, clientY: 300 }));
      svg.dispatchEvent(pev('pointermove', { buttons: 2, clientX: 340, clientY: 260 }));
    });
    assert.notEqual(svg.getAttribute('viewBox'), vbBefore, 'right-drag panned the view');
    await act(async () => {
      svg.dispatchEvent(pev('pointerup', { button: 2, clientX: 340, clientY: 260 }));
    });
    // The contextmenu that follows a pan drag is swallowed…
    const bubble = container.querySelector('g.bubble');
    await act(async () => bubble.dispatchEvent(ev('contextmenu', { clientX: 340, clientY: 260 })));
    assert.equal(container.querySelector('.ctx-menu'), null, 'no menu after a pan drag');
    // …but a plain right-click (no drag) opens it.
    await act(async () => bubble.dispatchEvent(ev('contextmenu', { clientX: 340, clientY: 260 })));
    assert.ok(container.querySelector('.ctx-menu'), 'stationary right-click opens the menu');
    // The canvas never shows the browser's own menu.
    const allowed = svg.dispatchEvent(ev('contextmenu', { clientX: 200, clientY: 200 }));
    assert.equal(allowed, false, 'default context menu is prevented over the canvas');
  } finally {
    unmount();
  }
});

test('context menu moves a room to another floor (one undoable step)', async () => {
  const { container, unmount } = mountBuilding();
  try {
    const room = container.querySelector('g.bubble[data-space-id="2"]'); // Lobby, Ground
    await act(async () => room.dispatchEvent(ev('contextmenu', { clientX: 120, clientY: 120 })));
    const move = [...container.querySelectorAll('.ctx-item')].find((b) => b.textContent.includes('Move to Level 1'));
    assert.ok(move, 'the other storey is offered');
    await act(async () => move.dispatchEvent(ev('click')));
    const put = fetchCalls.find((c) => c.url === '/api/spaces/2' && c.options?.method === 'PUT');
    assert.ok(put && JSON.parse(put.options.body).level === 'Level 1', 'level persisted');
    assert.match(container.querySelector('.stage-toast')?.textContent ?? '', /Lobby → Level 1/, 'toast confirms the move');
  } finally {
    unmount();
  }
});

test('action bar offers the floor selector for a selected Building room', async () => {
  const { container, unmount } = mountBuilding();
  try {
    // Select the visible Ground room via the rail.
    const row = container.querySelector('.split-row');
    await act(async () => row.dispatchEvent(ev('click')));
    const sel = container.querySelector('.action-level select');
    assert.ok(sel, 'floor selector renders in the action bar');
    assert.equal(sel.value, 'Ground');
    await act(async () => {
      sel.value = 'Level 1';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    const put = fetchCalls.find((c) => c.url === '/api/spaces/2' && c.options?.method === 'PUT');
    assert.ok(put && JSON.parse(put.options.body).level === 'Level 1', 'level persisted from the action bar');
  } finally {
    unmount();
  }
});

test('onion skin ghosts the adjacent storey under the edited floor', async () => {
  const { container, unmount } = mountBuilding();
  try {
    assert.equal(container.querySelectorAll('.onion').length, 0, 'off by default');
    const btn = [...container.querySelectorAll('.tool-btn')].find((b) => /Onion skin/.test(b.title));
    assert.ok(btn, 'onion-skin toggle shows in the dock on a single floor');
    await act(async () => btn.dispatchEvent(ev('click')));
    const ghosts = [...container.querySelectorAll('.onion')];
    assert.equal(ghosts.length, 1, 'the Level 1 room ghosts under Ground');
    assert.ok(ghosts[0].classList.contains('above'), 'marked as the storey above');
    await act(async () => btn.dispatchEvent(ev('click')));
    assert.equal(container.querySelectorAll('.onion').length, 0, 'toggles back off');
  } finally {
    unmount();
  }
});

test('stacking rail bars are segmented by the active colour grouping', async () => {
  const { container, unmount } = mountBuilding();
  try {
    const seg = [...container.querySelectorAll('.stack-bar')].find((b) => /Public/.test(b.title || ''));
    assert.ok(seg, 'a bar segment carries its group label');
  } finally {
    unmount();
  }
});
