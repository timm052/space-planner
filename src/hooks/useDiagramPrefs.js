import { useRef, useState } from 'react';
import { prefs } from '../prefs.js';

// View preferences of the diagram — how it's displayed, never what it shows.
// One state object replaces what used to be ~14 separate useState atoms in
// BubbleTab. Keys listed here round-trip through the prefs store (localStorage)
// under their historical storage names; everything else is per-session.
const PERSISTED = {
  split: 'split',
  hulls: 'hulls',
  hullPad: 'hullpad',
  railW: 'railw',
  nodeForce: 'nodeforce',
  buildingForce: 'buildingforce',
  snapEdges: 'snapedges',
  snapGrid: 'snapgrid',
  interior: 'interior',
};

/** Initial view-pref values, reading persisted keys from the store. */
export function initialDiagramPrefs(store = prefs) {
  return {
    split: store.getBool('split', true), // Areas/Relationships rail visible
    colorBy: 'department', // 'department' | 'building'
    hulls: store.getBool('hulls', false), // category hulls overlay
    hullPad: store.getNum('hullpad', 0) || 26, // hull padding around bubbles
    railW: store.getNum('railw', 0) || 340, // rail width (px)
    areaMode: 'category', // Areas panel grouping
    collapsed: new Set(), // collapsed Areas groups
    floorView: 'all', // 'all' | <level label> | 'offset' | 'overlaid' | '3d'
    floorGap: 0.6, // floor spacing as a fraction of plate height
    stackCam: 'iso', // stacked-SVG camera preset (CAMERAS in floors.js)
    stackImages: true, // show warped site images in the stacked view
    cam3d: 'persp', // WebGL 3-D camera preset (Stacked3D)
    nodeForce: store.getNum('nodeforce', 1), // auto-layout force: rooms
    buildingForce: store.getNum('buildingforce', 0.5), // auto-layout force: buildings
    snapEdges: store.getBool('snapedges', true), // snap to neighbour edges/corners
    snapGrid: store.getBool('snapgrid', true), // snap to the metric grid
    interior: store.getBool('interior', true), // Voronoi room sketch inside envelopes
  };
}

/**
 * The diagram's view preferences as one object plus a keyed setter.
 * `setPref(key, value)` also persists keys in PERSISTED; pass
 * `{ persist: false }` for high-frequency intermediate values (e.g. each
 * pointermove of the rail resize) and persist once on the final value.
 */
export function useDiagramPrefs(store = prefs) {
  const [view, setView] = useState(() => initialDiagramPrefs(store));
  // Eagerly-updated ref so handlers registered once (window listeners) can
  // apply back-to-back updates without stale reads.
  const ref = useRef(view);
  ref.current = view;
  function setPref(key, value, { persist = true } = {}) {
    const next = { ...ref.current, [key]: value };
    ref.current = next;
    setView(next);
    if (persist && PERSISTED[key]) store.set(PERSISTED[key], value);
  }
  return { view, setPref };
}
