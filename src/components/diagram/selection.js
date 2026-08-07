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
  // A non-additive marquee that caught nothing is still "select these rooms:
  // none". It used to clear only the multi-set, leaving a single selection and
  // a selected link standing — so a CLICK on empty canvas deselected but a DRAG
  // across empty canvas did not, which is an arbitrary distinction to be on the
  // receiving end of.
  if (additive) return done({ ...sel, multi });
  return done({ ...sel, multi, selected: null, selLink: null }, [notify(null)]);
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

/**
 * Instance keys a marquee catches, using the CAD window/crossing convention:
 *
 *   left → right  ("window")   selects only footprints ENTIRELY inside the box
 *   right → left  ("crossing") selects anything the box TOUCHES
 *
 * Testing the node centre alone — which is what this did — meant a room whose
 * centre happened to fall inside was selected even when it was mostly outside,
 * while a large building envelope you had visibly boxed three-quarters of was
 * missed. `getHalf` returns the footprint's world half-extents; without it the
 * function degrades to the old centre test.
 */
export function hitsInBox(instances, getPos, box, getHalf = null) {
  const minX = Math.min(box.x0, box.x1);
  const maxX = Math.max(box.x0, box.x1);
  const minY = Math.min(box.y0, box.y1);
  const maxY = Math.max(box.y0, box.y1);
  const crossing = box.x1 < box.x0; // dragged leftwards
  const hits = [];
  for (const o of instances) {
    const n = getPos(o.key);
    if (!n) continue;
    const h = getHalf ? getHalf(o) : null;
    if (!h) {
      if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) hits.push(o.key);
      continue;
    }
    const inside = n.x - h.x >= minX && n.x + h.x <= maxX && n.y - h.y >= minY && n.y + h.y <= maxY;
    const touches = n.x + h.x >= minX && n.x - h.x <= maxX && n.y + h.y >= minY && n.y - h.y <= maxY;
    if (crossing ? touches : inside) hits.push(o.key);
  }
  return hits;
}

/**
 * A marquee box is a "click" when it never grew past a few SCREEN pixels.
 *
 * The box is in diagram units, so a fixed threshold swung across the zoom range:
 * at 0.2× four units was 0.8px and hand tremor turned a click into a marquee
 * that cleared the selection; at 6× it was 24px of dead travel.
 */
export const isClickBox = (box, slopUnits = 4) =>
  Math.abs(box.x1 - box.x0) < slopUnits && Math.abs(box.y1 - box.y0) < slopUnits;
