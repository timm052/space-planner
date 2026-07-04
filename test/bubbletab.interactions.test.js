// Interactive-shell tests for the diagram: real pointer flows (drag, marquee,
// link creation, scale calibration) simulated against a jsdom mount. These
// lock in the behavior the BubbleTab decomposition preserved.
//
// Coordinate note: with no ResizeObserver the viewBox is the logical 900×620
// world and the pan starts at 0, so once getBoundingClientRect is stubbed to
// a 900×620 rect at the origin, client coordinates == diagram coordinates.
import './helpers/dom.js'; // MUST be first — sets up window/document for react-dom
import { fetchCalls, flushFrames } from './helpers/dom.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.React = React; // classic JSX transform under tsx (see components.test.js)

import BubbleTab from '../src/components/BubbleTab.jsx';

const act = React.act ?? React.unstable_act;

const project = { id: 1, name: 'P', client: '', stage: 'Concept', units: 'm2', tolerance: 0.05, view_x: 0, view_y: 0, north_deg: 0 };
const spaces = [
  { id: 1, kind: 'building', name: 'Main', parent_id: null, target_area: 0, count: 1, department: 'Building' },
  { id: 2, kind: 'space', name: 'Lobby', parent_id: 1, department: 'Public', count: 1, target_area: 100 },
  { id: 3, kind: 'space', name: 'Office', parent_id: 1, department: 'Staff', count: 1, target_area: 50 },
  { id: 4, kind: 'space', name: 'Store', parent_id: 1, department: 'Staff', count: 1, target_area: 30 },
];
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
const posOf = (el) => {
  const m = /translate\((-?[\d.]+),\s*(-?[\d.]+)\)/.exec(el.getAttribute('transform'));
  return { x: Number(m[1]), y: Number(m[2]) };
};

test('dragging a bubble moves it and persists the dropped position', async () => {
  const { container, svg, unmount } = mount();
  try {
    const bubble = container.querySelector('g.bubble[data-space-id="2"]');
    const start = posOf(bubble);
    await act(async () => {
      bubble.dispatchEvent(ev('pointerdown', { clientX: start.x, clientY: start.y }));
      svg.dispatchEvent(ev('pointermove', { clientX: start.x + 60, clientY: start.y + 40 }));
      svg.dispatchEvent(ev('pointerup', { clientX: start.x + 60, clientY: start.y + 40 }));
    });
    const end = posOf(container.querySelector('g.bubble[data-space-id="2"]'));
    assert.equal(Math.round(end.x), Math.round(start.x + 60), 'bubble followed the cursor in x');
    assert.equal(Math.round(end.y), Math.round(start.y + 40), 'bubble followed the cursor in y');
    // The drop was persisted (position save, not a lock) via PUT /api/spaces/2.
    const save = fetchCalls.find((c) => c.url === '/api/spaces/2' && c.options?.method === 'PUT');
    assert.ok(save, 'dropped position saved to the API');
    const body = JSON.parse(save.options.body);
    assert.ok(body.pin_json.includes('"x"'), 'pin_json carries the position');
    assert.ok(!body.pin_json.includes('locked'), 'a drag saves without locking');
    // No action bar: a real drag (≥6px) is not a click-select.
    assert.equal(container.querySelector('.action-bar'), null);
  } finally {
    unmount();
  }
});

test('a placed bubble pushes neighbours aside — only after the drop', async () => {
  const { container, svg, unmount } = mount();
  try {
    const at = (id) => posOf(container.querySelector(`g.bubble[data-space-id="${id}"]`));
    const a = container.querySelector('g.bubble[data-space-id="2"]');
    const pa = at(2);
    const pb = at(3);
    // Carry Lobby over Office's centre — while it is held, nothing yields.
    await act(async () => a.dispatchEvent(ev('pointerdown', { clientX: pa.x, clientY: pa.y })));
    await act(async () => svg.dispatchEvent(ev('pointermove', { clientX: pb.x, clientY: pb.y })));
    await act(async () => flushFrames(10));
    assert.deepEqual(at(3), pb, 'the neighbour does not move while the bubble is carried');
    // Drop it there: the placed bubble stays put; the neighbour steps aside.
    await act(async () => svg.dispatchEvent(ev('pointerup', { clientX: pb.x, clientY: pb.y })));
    await act(async () => flushFrames(60));
    const aEnd = at(2);
    const bEnd = at(3);
    assert.ok(Math.hypot(aEnd.x - pb.x, aEnd.y - pb.y) < 1, 'the dropped bubble stays exactly where it was placed');
    assert.ok(Math.hypot(bEnd.x - pb.x, bEnd.y - pb.y) > 50, 'the neighbour was pushed aside');
    assert.ok(Math.hypot(aEnd.x - bEnd.x, aEnd.y - bEnd.y) > 100, 'the overlap fully resolved');
  } finally {
    unmount();
  }
});

test('marquee over the canvas multi-selects the enclosed rooms', async () => {
  const { container, svg, unmount } = mount();
  try {
    const bubbles = [...container.querySelectorAll('g.bubble')];
    const xs = bubbles.map((b) => posOf(b).x);
    const ys = bubbles.map((b) => posOf(b).y);
    const box = { x0: Math.min(...xs) - 80, y0: Math.min(...ys) - 80, x1: Math.max(...xs) + 80, y1: Math.max(...ys) + 80 };
    // Each event in its own act(): the live marquee box is React STATE (unlike
    // the drag, which lives in refs), so the up handler only sees the box once
    // the down/move renders have committed — as they do between browser ticks.
    await act(async () => svg.dispatchEvent(ev('pointerdown', { clientX: box.x0, clientY: box.y0 })));
    await act(async () => svg.dispatchEvent(ev('pointermove', { clientX: box.x1, clientY: box.y1 })));
    await act(async () => svg.dispatchEvent(ev('pointerup', { clientX: box.x1, clientY: box.y1 })));
    assert.equal(container.querySelectorAll('.multi-ring').length, 3, 'all three rooms ringed');
    const bar = container.querySelector('.action-bar');
    assert.match(bar.textContent, /3/);
    assert.match(bar.textContent, /rooms selected/);
    // Escape clears the multi-selection.
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(container.querySelectorAll('.multi-ring').length, 0);
  } finally {
    unmount();
  }
});

test('a click-sized marquee on empty canvas clears the selection', async () => {
  const { container, svg, unmount } = mount();
  try {
    const bubble = container.querySelector('g.bubble[data-space-id="2"]');
    const p = posOf(bubble);
    await act(async () => {
      bubble.dispatchEvent(ev('pointerdown', { clientX: p.x, clientY: p.y }));
      bubble.dispatchEvent(ev('pointerup', { clientX: p.x, clientY: p.y }));
    });
    assert.ok(container.querySelector('.action-bar'), 'room selected first');
    // Separate acts: the click-box lives in React state (see the marquee test).
    await act(async () => svg.dispatchEvent(ev('pointerdown', { clientX: 890, clientY: 610 })));
    await act(async () => svg.dispatchEvent(ev('pointerup', { clientX: 890, clientY: 610 })));
    assert.equal(container.querySelector('.action-bar'), null, 'empty-canvas click deselects');
  } finally {
    unmount();
  }
});

test('Link mode: clicking two unlinked rooms creates the adjacency', async () => {
  const { container, unmount } = mount();
  try {
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    });
    assert.match(container.querySelector('.action-bar').textContent, /New link/);
    const click = async (id) => {
      const b = container.querySelector(`g.bubble[data-space-id="${id}"]`);
      const p = posOf(b);
      await act(async () => {
        b.dispatchEvent(ev('pointerdown', { clientX: p.x, clientY: p.y }));
        b.dispatchEvent(ev('pointerup', { clientX: p.x, clientY: p.y }));
      });
    };
    await click(2);
    assert.match(container.querySelector('.action-bar').textContent, /Pick the second room/);
    await click(4);
    const create = fetchCalls.find((c) => c.url === '/api/projects/1/adjacencies' && c.options?.method === 'POST');
    assert.ok(create, 'adjacency POSTed');
    const body = JSON.parse(create.options.body);
    assert.deepEqual({ a: body.space_a, b: body.space_b, s: body.strength }, { a: 2, b: 4, s: 'desired' });
  } finally {
    unmount();
  }
});

test('Link mode: an already-linked pair is not re-created', async () => {
  const { container, unmount } = mount();
  try {
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    });
    for (const id of [2, 3]) {
      const b = container.querySelector(`g.bubble[data-space-id="${id}"]`);
      const p = posOf(b);
      await act(async () => {
        b.dispatchEvent(ev('pointerdown', { clientX: p.x, clientY: p.y }));
        b.dispatchEvent(ev('pointerup', { clientX: p.x, clientY: p.y }));
      });
    }
    assert.equal(
      fetchCalls.filter((c) => c.options?.method === 'POST').length,
      0,
      'no create for an existing pair'
    );
  } finally {
    unmount();
  }
});

test('scale calibration walks two clicks to the distance form and cancels cleanly', async () => {
  // The fixture has no loadable image pixels (jsdom does not decode images),
  // so this covers the interaction flow; the mpp math is unit-tested in
  // layertools.test.js. The panel is driven directly via an image row.
  const image = { id: 9, kind: 'custom', name: 'Site plan', mpp: 0, opacity: 0.6, visible: 1, x: 0, y: 0, rot: 0 };
  const { container, svg, unmount } = mount({ images: [image] });
  try {
    // Open Layers and start calibrating.
    await act(async () => {
      [...container.querySelectorAll('.ctrl-btn')].find((b) => b.title.includes('layers')).click();
    });
    await act(async () => {
      [...container.querySelectorAll('button')].find((b) => b.title?.includes('Calibrate')).click();
    });
    let panel = container.querySelector('.scale-panel');
    assert.match(panel.textContent, /click the first point/);
    // Two clicks on the canvas mark the distance.
    await act(async () => {
      svg.dispatchEvent(ev('pointerdown', { clientX: 200, clientY: 300 }));
      svg.dispatchEvent(ev('pointerup', { clientX: 200, clientY: 300 }));
      svg.dispatchEvent(ev('pointerdown', { clientX: 420, clientY: 300 }));
      svg.dispatchEvent(ev('pointerup', { clientX: 420, clientY: 300 }));
    });
    assert.equal(container.querySelectorAll('.scale-point').length, 2, 'both points marked');
    panel = container.querySelector('.scale-panel');
    assert.ok(panel.querySelector('input[type="number"]'), 'distance input shows');
    // Applying without a measurable image reports the validation error.
    await act(async () => {
      [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click();
    });
    assert.match(container.textContent, /Pick two points and enter a positive distance/);
    // Cancel leaves calibration entirely.
    await act(async () => {
      [...container.querySelector('.scale-panel').querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    });
    assert.equal(container.querySelector('.scale-panel'), null);
    assert.equal(container.querySelectorAll('.scale-point').length, 0);
  } finally {
    unmount();
  }
});
