import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The components are authored for the automatic JSX runtime (no `import React`),
// but tsx transforms JSX with the classic runtime (bare `React.createElement`).
// They only reference React at render time, so exposing it as a global is enough
// to run them under the classic transform without touching the component source.
globalThis.React = React;

import Dashboard from '../src/components/Dashboard.jsx';
import DriftChart from '../src/components/DriftChart.jsx';
import ProjectList from '../src/components/ProjectList.jsx';
import SnapshotsTab from '../src/components/SnapshotsTab.jsx';

// These are prop-driven, side-effect-free render functions, so static SSR
// markup is enough to assert what the user sees. useEffect (e.g. ProjectList's
// settings fetch) doesn't run under renderToStaticMarkup, so there's no network.
const render = (Comp, props) => renderToStaticMarkup(h(Comp, props));

// Shared fixture: one building with a Public (over) and a Staff (on) leaf.
const project = { id: 1, name: 'P', units: 'm2', tolerance: 0.05, grossing_target: 0.7 };
const spaces = [
  { id: 1, kind: 'building', name: 'Main', parent_id: null, target_area: 0, count: 1, department: 'Building' },
  { id: 2, kind: 'space', name: 'Lobby', parent_id: 1, department: 'Public', count: 1, target_area: 100 },
  { id: 3, kind: 'space', name: 'Office', parent_id: 1, department: 'Staff', count: 1, target_area: 50 },
];
const snapA = { id: 10, label: 'Concept', taken_at: '2026-01-01', gross_area: 250, areas: { 2: 100, 3: 50 } };
const snapB = { id: 11, label: 'SD', taken_at: '2026-03-01', gross_area: 250, areas: { 2: 130, 3: 50 } };

// ---- Dashboard ----------------------------------------------------------

test('Dashboard prompts to define the brief when there are no spaces', () => {
  const html = render(Dashboard, { project, spaces: [], snapshots: [] });
  assert.match(html, /Define the brief first/);
});

test('Dashboard shows the brief net target and designed net KPIs', () => {
  const html = render(Dashboard, { project, spaces, snapshots: [snapB] });
  assert.match(html, /Brief net target/);
  assert.match(html, /150/); // 100 + 50, in the KPI value
  assert.match(html, /Designed net/);
  assert.match(html, /180/); // 130 + 50
});

test('Dashboard flags variance over tolerance with the bad tone', () => {
  // 180 vs 150 = +20% > 5% tolerance → variance KPI uses the --bad color.
  const html = render(Dashboard, { project, spaces, snapshots: [snapB] });
  assert.match(html, /var\(--bad\)/);
  assert.match(html, /\+20\.0%/);
});

test('Dashboard lists spaces outside tolerance in the flagged schedule', () => {
  const html = render(Dashboard, { project, spaces, snapshots: [snapB] });
  assert.match(html, /Flagged spaces/);
  assert.match(html, /dl-row/); // dotted-leader schedule row
  assert.match(html, /Lobby/);
});

test('Dashboard renders the by-category rollup', () => {
  const html = render(Dashboard, { project, spaces, snapshots: [snapB] });
  assert.match(html, /By category/);
  assert.match(html, /Public/); // category as a rollup key
  // Building rollup and milestone comparison moved off the Dashboard.
  assert.doesNotMatch(html, /By building/);
  assert.doesNotMatch(html, /Milestone comparison/);
});

// ---- Milestones (SnapshotsTab) -----------------------------------------

test('Milestones renders a card per recorded snapshot', () => {
  const html = render(SnapshotsTab, { project, spaces, snapshots: [snapA, snapB], onChanged() {} });
  assert.match(html, /Recorded milestones/);
  assert.match(html, /Concept/);
  assert.match(html, /SD/);
});

test('Milestones shows a change schedule between the two latest snapshots', () => {
  const html = render(SnapshotsTab, { project, spaces, snapshots: [snapA, snapB], onChanged() {} });
  assert.match(html, /Change ·/);
  assert.match(html, /Net change/);
  assert.match(html, /Lobby/); // grew 100 → 130
});

// ---- DriftChart ---------------------------------------------------------

test('DriftChart draws a labelled point per milestone and a series line', () => {
  const html = render(DriftChart, { project, spaces, snapshots: [snapA, snapB] });
  assert.match(html, /chart-line/); // a path connects the two points
  assert.equal((html.match(/chart-dot/g) || []).length, 2);
  assert.match(html, /Concept/);
  assert.match(html, /SD/);
  assert.match(html, /aria-label="Net area drift chart"/);
});

test('DriftChart omits the connecting line for a single milestone', () => {
  const html = render(DriftChart, { project, spaces, snapshots: [snapA] });
  assert.doesNotMatch(html, /chart-line/);
  assert.equal((html.match(/chart-dot/g) || []).length, 1);
});

// ---- ProjectList --------------------------------------------------------

test('ProjectList shows a loading state before projects arrive', () => {
  const html = render(ProjectList, { projects: null, onOpen() {}, onChanged() {} });
  assert.match(html, /Loading projects/);
});

test('ProjectList shows an empty state with no projects', () => {
  const html = render(ProjectList, { projects: [], onOpen() {}, onChanged() {} });
  assert.match(html, /No projects yet/);
});

test('ProjectList renders accessible, keyboard-operable project cards', () => {
  const projects = [
    { id: 7, name: 'Clinic', client: '', stage: 'Concept', units: 'm2', space_count: 3, snapshot_count: 1, target_net: 550 },
  ];
  const html = render(ProjectList, { projects, onOpen() {}, onChanged() {} });
  assert.match(html, /Clinic/);
  assert.match(html, /No client set/); // empty client falls back
  assert.match(html, /3 spaces/);
  assert.match(html, /550\s*m²/);
  // a11y affordances added to the clickable card
  assert.match(html, /role="button"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Delete project Clinic"/);
});
