// Instance-level adjacency: dragging a link out of a SPECIFIC instance of a
// count>1 space records that instance (inst_a/inst_b), and instances are
// lettered A/B/C in the labels.
import './helpers/dom.js'; // MUST be first — sets up window/document for react-dom
import { fetchCalls } from './helpers/dom.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.React = React; // classic JSX transform under tsx

import BubbleTab from '../src/components/BubbleTab.jsx';
import { instanceLabel, instanceName } from '../src/compute.js';

const act = React.act ?? React.unstable_act;

const project = { id: 1, name: 'P', client: '', stage: 'Concept', units: 'm2', tolerance: 0.05, view_x: 0, view_y: 0, north_deg: 0 };
const building = { id: 1, kind: 'building', name: 'Main', parent_id: null, target_area: 0, count: 1, department: 'Building' };
// A count-3 space (three lettered rooms) and a single hall.
const meeting = { id: 2, kind: 'space', name: 'Meeting Rooms', parent_id: 1, department: 'Community', count: 3, target_area: 28 };
const hall = { id: 3, kind: 'space', name: 'Hall', parent_id: 1, department: 'Community', count: 1, target_area: 180 };
const spaces = [building, meeting, hall];

beforeEach(() => {
  fetchCalls.length = 0;
  window.localStorage.clear();
});

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(h(BubbleTab, { project, spaces, adjacencies: [], images: [], onChanged() {} }));
  });
  const svg = container.querySelector('svg.bubble-svg');
  if (svg) svg.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, width: 900, height: 620, right: 900, bottom: 620 });
  return { container, svg, unmount() { act(() => root.unmount()); container.remove(); } };
}

const ev = (type, opts) => new window.MouseEvent(type, { bubbles: true, button: 0, ...opts });
const key = (k, opts = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
const posOf = (el) => {
  const m = /translate\((-?[\d.]+),\s*(-?[\d.]+)\)/.exec(el.getAttribute('transform'));
  return { x: Number(m[1]), y: Number(m[2]) };
};

test('instanceLabel/instanceName letter the copies of a count>1 space', () => {
  assert.equal(instanceLabel(0), 'A');
  assert.equal(instanceLabel(2), 'C');
  assert.equal(instanceLabel(26), 'AA');
  assert.equal(instanceName(meeting, 1), 'Meeting Rooms B');
  assert.equal(instanceName(hall, 0), 'Hall'); // count 1 → no letter
});

test('count>1 bubbles are lettered (aria-label / instance)', () => {
  const { container, unmount } = mount();
  try {
    // Each instance renders its own group with a lettered accessible name.
    const labels = [...container.querySelectorAll('g.bubble[data-space-id="2"]')].map((g) => g.getAttribute('aria-label'));
    assert.ok(labels.some((l) => /Meeting Rooms A of 3/.test(l)), 'instance A labelled');
    assert.ok(labels.some((l) => /Meeting Rooms C of 3/.test(l)), 'instance C labelled');
    const hallLabel = container.querySelector('g.bubble[data-space-id="3"]').getAttribute('aria-label');
    assert.ok(/^Hall —/.test(hallLabel), 'count-1 space has no letter');
  } finally {
    unmount();
  }
});

test('dragging a link out of instance C records inst_a = 2', async () => {
  const { container, svg, unmount } = mount();
  try {
    await act(async () => key('l')); // Link tool
    const fromEl = container.querySelector('g.bubble[data-space-id="2"][data-instance="2"]'); // Meeting Rooms C
    const toEl = container.querySelector('g.bubble[data-space-id="3"][data-instance="0"]'); // Hall
    const from = posOf(fromEl), to = posOf(toEl);
    await act(async () => {
      fromEl.dispatchEvent(ev('pointerdown', { clientX: from.x, clientY: from.y }));
      svg.dispatchEvent(ev('pointermove', { clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 }));
    });
    await act(async () => svg.dispatchEvent(ev('pointerup', { clientX: to.x, clientY: to.y })));
    const post = fetchCalls.find((c) => c.url === '/api/projects/1/adjacencies' && c.options?.method === 'POST');
    assert.ok(post, 'link created');
    const body = JSON.parse(post.options.body);
    assert.equal(body.space_a, 2);
    assert.equal(body.inst_a, 2, 'the dragged instance C (index 2) is recorded');
    assert.equal(body.space_b, 3);
    assert.equal(body.inst_b, 0);
  } finally {
    unmount();
  }
});
