// The diagram's selection state machine — pure transitions, no React.
//
// One object holds every piece of "what is selected / which tool is active"
// state (single room + instance, multi-set, selected link, link-in-progress,
// tool, link kind). Each transition takes the current state plus an event and
// returns `{ sel, fx }`: the next state and a list of side-effect descriptors
// for the component to run. Keeping effects DECLARED rather than performed is
// what makes the tricky notify semantics testable — e.g. entering Link mode
// clears the canvas selection but deliberately does NOT notify the shared
// Brief selection, while Escape clears and notifies.
//
// fx types:
//   { type: 'notify', id }                  → onSelectSpace?.(id)  (Diagram → Brief sync)
//   { type: 'maybeCreateLink', a, b, kind } → create the adjacency unless the pair exists
//
// Link-mode transitions live in linking.js; both operate on this state shape.

export const initialSelection = Object.freeze({
  tool: 'select', // 'select' | 'link'
  selected: null, // selected space id (single-select)
  selectedInst: 0, // which instance of the selected space
  multi: new Set(), // instance keys ("id:i") in the multi-selection
  selLink: null, // { space_a, space_b } of the selected link
  linkFrom: null, // first room picked in Link mode
  linkKind: 'desired', // relationship type new links get in Link mode
});

export const notify = (id) => ({ type: 'notify', id });

const done = (sel, fx = []) => ({ sel, fx });

/** Select-mode click on a bubble: select / retarget instance / deselect. */
export function selectClick(sel, spaceId, idx = 0) {
  const base = { ...sel, selLink: null }; // a bubble click always drops the link selection
  if (sel.selected == null) return done({ ...base, selected: spaceId, selectedInst: idx }, [notify(spaceId)]);
  if (sel.selected === spaceId) {
    if (sel.selectedInst !== idx) return done({ ...base, selectedInst: idx });
    return done({ ...base, selected: null }, [notify(null)]); // click again → deselect
  }
  return done({ ...base, selected: spaceId, selectedInst: idx }, [notify(spaceId)]);
}

/** Shift-click on a bubble: toggle it in the multi-selection (drops single + link). */
export function shiftToggle(sel, key) {
  const multi = new Set(sel.multi);
  multi.has(key) ? multi.delete(key) : multi.add(key);
  return done({ ...sel, selected: null, selLink: null, multi }, [notify(null)]);
}

/** Programmatic single-select (rail row, Brief tile → canvas). */
export function pick(sel, id, inst = 0) {
  return done({ ...sel, selected: id, selectedInst: inst }, [notify(id)]);
}

/** Programmatic deselect (rail row toggle). */
export function clearPick(sel) {
  return done({ ...sel, selected: null }, [notify(null)]);
}

/** Inbound shared-selection sync (Brief → Diagram). Never notifies back. */
export function applyExternal(sel, id) {
  return done({ ...sel, selected: id, selectedInst: 0 });
}

/** Escape: clear every kind of selection. */
export function escape(sel) {
  return done(
    { ...sel, multi: new Set(), selected: null, selLink: null, linkFrom: null },
    [notify(null)]
  );
}

/**
 * Marquee finished over a real area. `hits` are the instance keys inside the
 * box; additive (shift) merges them into the existing multi-selection. The
 * multi-set is REPLACED even when nothing was hit (a plain marquee over empty
 * canvas clears the previous multi-selection).
 */
export function marqueeEnd(sel, hits, additive) {
  const multi = new Set(additive ? sel.multi : []);
  for (const k of hits) multi.add(k);
  if (multi.size) return done({ ...sel, multi, selected: null, selLink: null }, [notify(null)]);
  return done({ ...sel, multi });
}

/** A near-zero marquee = click on empty canvas → clear all (unless additive). */
export function emptyCanvasClick(sel, additive) {
  if (additive) return done(sel);
  return done(
    { ...sel, multi: new Set(), selected: null, selLink: null, linkFrom: null },
    [notify(null)]
  );
}

/** After deleting the selected space (single-room ⌫). Intentionally silent. */
export function afterRemoveSelected(sel) {
  return done({ ...sel, selected: null });
}

/** After deleting the multi-selection. */
export function afterMultiDelete(sel) {
  return done({ ...sel, multi: new Set() });
}

/** Instance keys whose node position falls inside a marquee box. */
export function hitsInBox(instances, getPos, box) {
  const minX = Math.min(box.x0, box.x1);
  const maxX = Math.max(box.x0, box.x1);
  const minY = Math.min(box.y0, box.y1);
  const maxY = Math.max(box.y0, box.y1);
  const hits = [];
  for (const o of instances) {
    const n = getPos(o.key);
    if (n && n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) hits.push(o.key);
  }
  return hits;
}

/** A marquee box is a "click" when it never grew past a few pixels. */
export const isClickBox = (box) =>
  Math.abs(box.x1 - box.x0) < 4 && Math.abs(box.y1 - box.y0) < 4;
