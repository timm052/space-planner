// Interaction tests for the diagram UX pass: the visible zoom cluster, the
// Ctrl+K quick-select palette, and the legend spotlight.
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
const store = { id: 4, kind: 'space', name: 'Store', parent_id: 1, department: 'Staff', count: 1, target_area: 30 };
const spaces = [building, lobby, office, store];
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

// Type into a React-controlled input: the native value setter bypasses
// React's value tracking so the dispatched input event registers as a change.
function typeInto(input, text) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, text);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('zoom cluster: buttons step the view zoom and shrink the visible viewBox', async () => {
  const { container, svg, unmount } = mount();
  try {
    const cluster = container.querySelector('.zoom-cluster');
    assert.ok(cluster, 'zoom cluster renders');
    const readout = cluster.querySelector('.zoom-readout');
    assert.equal(readout.textContent, '100%');
    assert.equal(svg.getAttribute('viewBox').split(' ')[2], '900');

    const [zoomOut, , zoomIn] = cluster.querySelectorAll('button');
    await act(async () => zoomIn.dispatchEvent(ev('click')));
    assert.equal(readout.textContent, '125%');
    assert.equal(Number(svg.getAttribute('viewBox').split(' ')[2]), 900 / 1.25);

    await act(async () => zoomOut.dispatchEvent(ev('click')));
    assert.equal(readout.textContent, '100%');

    // Keyboard mirrors the buttons.
    await act(async () => key('+'));
    assert.equal(readout.textContent, '125%');
    await act(async () => key('-'));
    assert.equal(readout.textContent, '100%');
  } finally {
    unmount();
  }
});

test('Ctrl+K palette: filters rooms, Enter selects the room and closes', async () => {
  const picked = [];
  const { container, unmount } = mount({ onSelectSpace: (id) => picked.push(id) });
  try {
    assert.equal(container.querySelector('.palette'), null);
    await act(async () => key('k', { ctrlKey: true }));
    const palette = container.querySelector('.palette');
    assert.ok(palette, 'palette opens on Ctrl+K');
    assert.ok(palette.textContent.includes('Switch to'), 'commands are listed');

    const input = palette.querySelector('.palette-input');
    await act(async () => typeInto(input, 'sto'));
    const rows = [...container.querySelectorAll('.palette-row')];
    assert.equal(rows.length, 1, 'query narrows the list to the one matching room');
    assert.ok(rows[0].textContent.includes('Store'));

    await act(async () => {
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    assert.equal(container.querySelector('.palette'), null, 'palette closes after the pick');
    assert.deepEqual(picked, [4], 'the room was selected (shared selection notified)');
  } finally {
    unmount();
  }
});

test('palette commands: switching environment persists the new env', async () => {
  const { container, unmount } = mount();
  try {
    await act(async () => key('k', { ctrlKey: true }));
    const row = [...container.querySelectorAll('.palette-row')].find((r) => r.textContent.includes('Master plan'));
    assert.ok(row, 'env switch command is offered');
    await act(async () => row.dispatchEvent(ev('click')));
    const put = fetchCalls.find((c) => c.url === '/api/projects/1' && c.options?.method === 'PUT');
    assert.ok(put && JSON.parse(put.options.body).diagram_env === 'masterplan', 'diagram_env saved');
  } finally {
    unmount();
  }
});

test('export menu: one ⤓ Export button opens PNG / PDF / drawing-set rows', async () => {
  const { container, unmount } = mount();
  try {
    const btn = [...container.querySelectorAll('.stage-actions button')].find((b) => b.textContent.includes('Export'));
    assert.ok(btn, 'single Export button replaces the three export buttons');
    await act(async () => btn.dispatchEvent(ev('click')));
    const rows = [...container.querySelectorAll('.export-row')].map((r) => r.textContent);
    assert.equal(rows.length, 3);
    assert.ok(rows[0].includes('PNG') && rows[1].includes('PDF') && rows[2].includes('Drawing set'));
  } finally {
    unmount();
  }
});

test('right-click opens the context menu; Pin persists the pin', async () => {
  const { container, unmount } = mount();
  try {
    const bubble = container.querySelector('g.bubble[data-space-id="2"]');
    await act(async () => bubble.dispatchEvent(ev('contextmenu', { clientX: 100, clientY: 100 })));
    const menu = container.querySelector('.ctx-menu');
    assert.ok(menu, 'context menu opens on right-click');
    assert.match(menu.textContent, /Lobby/, 'menu is titled with the room');
    const pin = [...menu.querySelectorAll('.ctx-item')].find((b) => b.textContent.includes('Pin'));
    await act(async () => pin.dispatchEvent(ev('click')));
    assert.equal(container.querySelector('.ctx-menu'), null, 'menu closes after an action');
    const put = fetchCalls.find((c) => c.options?.method === 'PUT' && String(c.options.body).includes('pin_json'));
    assert.ok(put, 'pin persisted');
  } finally {
    unmount();
  }
});

test('Tab cycles the visible rooms once one is selected', async () => {
  const { container, unmount } = mount();
  try {
    // Select via the rail (row click), then Tab through the canvas rooms.
    const row = container.querySelector('.split-row');
    await act(async () => row.dispatchEvent(ev('click')));
    const before = container.querySelector('g.bubble.selected')?.getAttribute('data-space-id');
    assert.ok(before, 'rail click selects a room');
    await act(async () => key('Tab'));
    const after = container.querySelector('g.bubble.selected')?.getAttribute('data-space-id');
    assert.ok(after && after !== before, 'Tab moved the selection to the next room');
  } finally {
    unmount();
  }
});

test('colour-by status appears with a milestone and tints by compliance', async () => {
  const snapshots = [{ id: 1, label: 'DD', taken_at: '2026-01-01', areas: { 2: 100, 3: 70 } }];
  const { container, unmount } = mount({ snapshots });
  try {
    const statusBtn = [...container.querySelectorAll('.seg-sm button')].find((b) => b.textContent === 'Status');
    assert.ok(statusBtn, 'Status colour mode offered once a milestone exists');
    await act(async () => statusBtn.dispatchEvent(ev('click')));
    const labels = [...container.querySelectorAll('.legend-label')].map((b) => b.textContent);
    assert.deepEqual(labels, ['Over target', 'On target', 'No milestone data'], 'legend shows the status scale in fixed order');
  } finally {
    unmount();
  }
});

test('legend spotlight: clicking a group label dims the other rooms and their links', async () => {
  const { container, unmount } = mount();
  try {
    const staffLabel = [...container.querySelectorAll('.legend-label')].find((b) => b.textContent === 'Staff');
    assert.ok(staffLabel, 'legend labels are clickable');
    await act(async () => staffLabel.dispatchEvent(ev('click')));

    assert.ok(container.querySelector('g.bubble[data-space-id="2"]').classList.contains('dim'), 'Public room fades');
    assert.ok(!container.querySelector('g.bubble[data-space-id="3"]').classList.contains('dim'), 'Staff room stays lit');
    assert.ok(container.querySelector('.link-hit.dim'), 'the cross-group link fades with its room');
    assert.ok(container.querySelector('.legend-item.active'), 'the active chip is marked');

    // Esc restores everything (spotlight sits in the Esc cascade).
    await act(async () => key('Escape'));
    assert.equal(container.querySelector('g.bubble.dim'), null, 'Esc clears the spotlight');
  } finally {
    unmount();
  }
});
