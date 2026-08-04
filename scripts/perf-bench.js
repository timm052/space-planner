// Viewport interaction benchmark — the Phase 0 baseline for docs/viewport-interaction-plan.md.
//
// Measures the WORK PER GESTURE on the diagram's pointer hot path, not wall-clock
// frame time. jsdom has no layout or paint and its requestAnimationFrame is a
// manual queue (test/helpers/dom.js), so timings here are not frame timings.
// What it does measure is deterministic and is exactly what Phase 1 changes:
//
//   rectCalls   getBoundingClientRect() calls per gesture — each one is a forced
//               synchronous layout in a real browser, on the hot path.
//   ms          synchronous JS work for the whole gesture. Not a frame time, but
//               it is the work the main thread actually does, so coalescing moves
//               to one frame should cut it at high room counts.
//
// Both should fall once pointer moves are coalesced to one frame and the client
// rect is cached on pointer-down. Re-run after Phase 1 and compare.
//
//   node --import tsx scripts/perf-bench.js [rooms=50,150,400] [moves=60]

import '../test/helpers/dom.js';
import { flushFrames } from '../test/helpers/dom.js';
import React, { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.React = React; // classic JSX transform under tsx

// jsdom has no 2-D canvas without the optional `canvas` package; textfit.js
// already falls back to its character heuristic when getContext returns falsy.
// Stub it so the run isn't buried in "Not implemented" noise.
window.HTMLCanvasElement.prototype.getContext = () => null;

const BubbleTab = (await import('../src/components/BubbleTab.jsx')).default;
const act = React.act ?? React.unstable_act;

const DEPTS = ['Public', 'Staff', 'Clinical', 'Support', 'Plant'];

// Pointer events per animation frame — a 250 Hz pointer against a 60 Hz display.
const FLUSH_EVERY = 4;

function makeSpaces(rooms) {
  const spaces = [
    { id: 1, kind: 'building', name: 'Main', parent_id: null, target_area: 0, count: 1, department: 'Building' },
  ];
  for (let i = 0; i < rooms; i++) {
    spaces.push({
      id: i + 2,
      kind: 'space',
      name: `Room ${i + 1}`,
      parent_id: 1,
      department: DEPTS[i % DEPTS.length],
      count: 1,
      target_area: 20 + (i % 7) * 15,
    });
  }
  return spaces;
}

// Link roughly a third of the rooms so the adjacency springs and link rendering
// are exercised the way a real project would.
function makeAdjacencies(spaces) {
  const leaves = spaces.filter((s) => s.kind === 'space');
  const out = [];
  for (let i = 0; i + 1 < leaves.length; i += 3) {
    out.push({
      id: out.length + 1,
      project_id: 1,
      space_a: leaves[i].id,
      space_b: leaves[i + 1].id,
      strength: i % 2 ? 'required' : 'desired',
    });
  }
  return out;
}

const project = {
  id: 1, name: 'Bench', client: '', stage: 'Concept', units: 'm2',
  tolerance: 0.05, view_x: 0, view_y: 0, north_deg: 0,
};

function run(rooms, moves) {
  const spaces = makeSpaces(rooms);
  const adjacencies = makeAdjacencies(spaces);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(h(BubbleTab, { project, spaces, adjacencies, images: [], onChanged() {} }));
  });

  const svg = container.querySelector('svg.bubble-svg');
  if (!svg) throw new Error('no diagram canvas mounted');

  // Count rect reads. The stub matches the interaction tests: a 900x620 rect at
  // the origin, so client coordinates == diagram coordinates.
  let rectCalls = 0;
  svg.getBoundingClientRect = () => {
    rectCalls++;
    return { left: 0, top: 0, x: 0, y: 0, width: 900, height: 620, right: 900, bottom: 620 };
  };

  const bubble = container.querySelector('g.bubble[data-space-id="2"]');
  if (!bubble) throw new Error('no bubble to drag');
  const m = /translate\((-?[\d.]+),\s*(-?[\d.]+)\)/.exec(bubble.getAttribute('transform'));
  const start = { x: Number(m[1]), y: Number(m[2]) };

  const ev = (type, opts) => new window.MouseEvent(type, { bubbles: true, button: 0, ...opts });

  const t0 = performance.now();
  act(() => {
    bubble.dispatchEvent(ev('pointerdown', { clientX: start.x, clientY: start.y }));
    // A sustained drag: `moves` pointermove events, as a high-report-rate mouse
    // or a trackpad delivers. jsdom's requestAnimationFrame is a manual queue
    // (test/helpers/dom.js), so drive a frame every FLUSH_EVERY events —
    // roughly the ratio of a 250 Hz pointer to a 60 Hz display. Without this the
    // coalesced build would simply never do the work, and `ms` would compare a
    // full run against nothing.
    for (let i = 1; i <= moves; i++) {
      svg.dispatchEvent(ev('pointermove', { clientX: start.x + i, clientY: start.y + i * 0.6 }));
      if (i % FLUSH_EVERY === 0) flushFrames(1);
    }
    svg.dispatchEvent(ev('pointerup', { clientX: start.x + moves, clientY: start.y + moves * 0.6 }));
  });
  const elapsed = performance.now() - t0;

  act(() => root.unmount());
  container.remove();

  return { rooms, moves, rectCalls, elapsed };
}

const rooms = (process.argv[2] || '50,150,400').split(',').map(Number);
const moves = Number(process.argv[3] || 60);

console.log(`\nViewport gesture benchmark — ${moves} pointermoves per drag\n`);
console.log('  rooms   rectCalls   rect/move     ms');
console.log('  -----   ---------   ---------   ----');
for (const n of rooms) {
  const r = run(n, moves);
  console.log(
    `  ${String(r.rooms).padStart(5)}   ${String(r.rectCalls).padStart(9)}   ` +
    `${(r.rectCalls / r.moves).toFixed(2).padStart(9)}   ${r.elapsed.toFixed(0).padStart(4)}`
  );
}
console.log('\n  rect/move is the headline number: it should approach 0 after Phase 1.\n');
