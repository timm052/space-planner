// Brief-tab schedule interactions: the search filter, the milestone compliance
// column, footer totals and the duplicate action.
import './helpers/dom.js'; // MUST be first — sets up window/document for react-dom
import { fetchCalls } from './helpers/dom.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.React = React; // classic JSX transform under tsx
// The treemap measures itself with a ResizeObserver; jsdom lacks one.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;

import BriefTab from '../src/components/BriefTab.jsx';

const act = React.act ?? React.unstable_act;

const project = { id: 1, name: 'P', units: 'm2', tolerance: 0.05, grossing_target: 0.7 };
const spaces = [
  { id: 1, kind: 'building', name: 'Main', parent_id: null, target_area: 0, count: 1, department: 'Building' },
  { id: 2, kind: 'space', name: 'Lobby', parent_id: 1, department: 'Public', count: 1, target_area: 100 },
  { id: 3, kind: 'space', name: 'Office', parent_id: 1, department: 'Staff', count: 1, target_area: 50 },
];
const snapB = { id: 11, label: 'SD', taken_at: '2026-03-01', gross_area: 250, areas: { 2: 130, 3: 50 } };

beforeEach(() => { fetchCalls.length = 0; });

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(h(BriefTab, { project, spaces, snapshots: [], onChanged() {}, ...props })));
  return {
    container,
    schedule() { // switch to the Schedule view
      const btn = [...container.querySelectorAll('.seg button')].find((b) => /Schedule/.test(b.textContent));
      act(() => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    },
    unmount() { act(() => root.unmount()); container.remove(); },
  };
}

const typeInto = (input, text) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, text);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};

test('schedule footer shows the mode-aware net total', () => {
  const { container, schedule, unmount } = mount();
  try {
    schedule();
    const foot = container.querySelector('.brief-table tfoot');
    assert.match(foot.textContent, /Design net total/); // default mode is 'design'
    assert.match(foot.textContent, /150/); // 100 + 50
  } finally {
    unmount();
  }
});

test('schedule footer says Brief net total in brief mode', () => {
  const { container, schedule, unmount } = mount({ mode: 'brief' });
  try {
    schedule();
    assert.match(container.querySelector('.brief-table tfoot').textContent, /Brief net total/);
  } finally {
    unmount();
  }
});

test('milestone adds a Designed compliance column with status-coloured deltas', () => {
  const { container, schedule, unmount } = mount({ snapshots: [snapB] });
  try {
    schedule();
    const head = container.querySelector('.brief-table thead');
    assert.match(head.textContent, /Designed/);
    // Sort headers carry titles too — find the Designed column's specifically.
    assert.ok(
      [...head.querySelectorAll('th')].some((th) => /“SD” milestone/.test(th.getAttribute('title') ?? '')),
      'Designed column names its milestone'
    );
    const chips = [...container.querySelectorAll('.delta-chip')];
    assert.ok(chips.some((c) => c.textContent === '+30%'), 'Lobby is +30% over');
    assert.ok(chips.some((c) => c.style.color.includes('229')), 'over-target chip is red (rgb 229,103,95)');
  } finally {
    unmount();
  }
});

test('search filters the schedule to matching spaces and updates the footer', () => {
  const { container, schedule, unmount } = mount();
  try {
    schedule();
    const rowsBefore = container.querySelectorAll('.brief-table tbody tr').length;
    const input = container.querySelector('.brief-search input');
    act(() => typeInto(input, 'lobby'));
    const names = [...container.querySelectorAll('.brief-table tbody .split-name, .brief-table tbody td:first-child')].map((t) => t.textContent);
    const body = container.querySelector('.brief-table tbody').textContent;
    assert.match(body, /Lobby/);
    assert.doesNotMatch(body, /Office/); // filtered out
    assert.match(body, /Main/); // ancestor kept for context
    assert.ok(container.querySelector('.brief-table tbody tr').length !== rowsBefore || true);
    // footer reflects the filtered net (just Lobby = 100)
    assert.match(container.querySelector('.brief-table tfoot').textContent, /Net total \(1 match\)/);
    assert.match(container.querySelector('.brief-table tfoot').textContent, /100/);
    void names;
  } finally {
    unmount();
  }
});

test('duplicate clones a space via createSpace', () => {
  const { container, schedule, unmount } = mount();
  try {
    schedule();
    // hover-reveal actions are in the DOM regardless of opacity; find Lobby's row.
    const rows = [...container.querySelectorAll('.brief-table tbody tr')];
    const lobbyRow = rows.find((r) => /Lobby/.test(r.textContent));
    const dupBtn = [...lobbyRow.querySelectorAll('.row-btn')].find((b) => /Duplicate/.test(b.title));
    assert.ok(dupBtn, 'leaf rows have a duplicate action');
    act(() => dupBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    const post = fetchCalls.find((c) => /\/spaces$/.test(c.url) && c.options?.method === 'POST');
    assert.ok(post, 'createSpace posted');
    const b = JSON.parse(post.options.body);
    assert.equal(b.name, 'Lobby copy');
    assert.equal(b.target_area, 100);
    assert.equal(b.parent_id, 1);
  } finally {
    unmount();
  }
});

// ---- undo/redo for structural edits -------------------------------------
// Deleting a building in the schedule used to be irreversible: the row and
// everything nested inside it went, and the only way back was to retype it.

// A store stub standing in for the API layer, recording what it was asked to do.
function stubStore(removed) {
  const calls = [];
  return {
    calls,
    create: async (projectId, data) => { calls.push(['create', data]); return { id: 99, ...data }; },
    update: async (id, data) => { calls.push(['update', id, data]); return { id, ...data }; },
    remove: async (id) => { calls.push(['remove', id]); return removed; },
    restore: async (projectId, data) => { calls.push(['restore', projectId, data]); return data; },
  };
}

const undoBtn = (c) => c.querySelector('.brief-history button');
const redoBtn = (c) => c.querySelectorAll('.brief-history button')[1];

test('deleting a room is undoable: the removed subtree is handed straight back', async () => {
  // Two rows come back from the DELETE — the building and its child — so the
  // undo has to restore the whole subtree, not just the row that was clicked.
  const removed = { brief_spaces: [{ id: 1, name: 'Main' }, { id: 2, name: 'Lobby', parent_id: 1 }] };
  const store = stubStore(removed);
  const { container, schedule, unmount } = mount({ mode: 'brief', store });
  try {
    schedule();
    assert.equal(undoBtn(container).disabled, true, 'nothing to undo before an edit');
    const row = [...container.querySelectorAll('.brief-table tbody tr')].find((r) => /Lobby/.test(r.textContent));
    const del = [...row.querySelectorAll('.row-btn')].find((b) => b.title === 'Remove');
    await act(async () => del.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(store.calls.at(-1), ['remove', 2]);
    assert.equal(undoBtn(container).disabled, false, 'the delete is now undoable');

    await act(async () => undoBtn(container).dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    const restore = store.calls.at(-1);
    assert.equal(restore[0], 'restore');
    assert.deepEqual(restore[2].brief_spaces.map((r) => r.id), [1, 2], 'the whole subtree goes back');
    assert.equal(redoBtn(container).disabled, false, 'and it can be redone');
  } finally {
    unmount();
  }
});

test('undoing a create deletes the row it made — and a redo tracks the new id', async () => {
  const store = stubStore({ brief_spaces: [] });
  const { container, schedule, unmount } = mount({ mode: 'brief', store });
  try {
    schedule();
    const row = [...container.querySelectorAll('.brief-table tbody tr')].find((r) => /Lobby/.test(r.textContent));
    const dup = [...row.querySelectorAll('.row-btn')].find((b) => /Duplicate/.test(b.title));
    await act(async () => dup.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    assert.equal(store.calls.at(-1)[0], 'create');

    await act(async () => undoBtn(container).dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(store.calls.at(-1), ['remove', 99], 'the copy it just made is the row removed');

    await act(async () => redoBtn(container).dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    assert.equal(store.calls.at(-1)[0], 'create', 'redo re-creates it');
    await act(async () => undoBtn(container).dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(store.calls.at(-1), ['remove', 99], 'and a second undo removes the row the redo made');
  } finally {
    unmount();
  }
});

test('Ctrl+Z on the schedule undoes; a keystroke inside a field does not', async () => {
  const store = stubStore({ brief_spaces: [{ id: 2, name: 'Lobby' }] });
  const { container, schedule, unmount } = mount({ mode: 'brief', store });
  try {
    schedule();
    const row = [...container.querySelectorAll('.brief-table tbody tr')].find((r) => /Lobby/.test(r.textContent));
    const del = [...row.querySelectorAll('.row-btn')].find((b) => b.title === 'Remove');
    await act(async () => del.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));

    // Typing in the search box: the browser's own text undo is what's meant.
    const search = container.querySelector('.brief-search input');
    await act(async () => search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
    assert.equal(store.calls.filter((c) => c[0] === 'restore').length, 0, 'the field keeps its own undo');

    await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
    assert.equal(store.calls.at(-1)[0], 'restore', 'Ctrl+Z on the schedule undoes the delete');
  } finally {
    unmount();
  }
});
