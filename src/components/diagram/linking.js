// Link-mode transitions for the diagram's selection state (see selection.js
// for the state shape and the `{ sel, fx }` convention). Covers the Link tool
// flow (pick a first room, pick a second → create), link selection, and the
// tool switch semantics.

import { notify } from './selection.js';

const done = (sel, fx = []) => ({ sel, fx });

/**
 * Link-mode click on a bubble. First click arms `linkFrom`; clicking the same
 * room disarms; a second room requests a link (the component creates it only
 * if the pair doesn't already exist — hence `maybeCreateLink`).
 */
export function linkClick(sel, spaceId) {
  const base = { ...sel, selLink: null };
  if (sel.linkFrom == null) return done({ ...base, linkFrom: spaceId });
  if (sel.linkFrom === spaceId) return done({ ...base, linkFrom: null });
  return done({ ...base, linkFrom: null }, [
    { type: 'maybeCreateLink', a: sel.linkFrom, b: spaceId, kind: sel.linkKind },
  ]);
}

/** Clicking a drawn link selects it (opens the link action bar). */
export function selectLink(sel, link) {
  return done(
    {
      ...sel,
      selected: null,
      multi: new Set(),
      linkFrom: null,
      selLink: { space_a: link.space_a, space_b: link.space_b },
    },
    [notify(null)]
  );
}

/** After the selected link is removed via the action bar. */
export function clearSelLink(sel) {
  return done({ ...sel, selLink: null });
}

/** The relationship type new links get (Desired | Required segmented buttons). */
export function setLinkKind(sel, kind) {
  return done({ ...sel, linkKind: kind });
}

/**
 * Switch tools (V / L, tool dock). Entering Link mode drops the room + link
 * selection but — deliberately — does NOT notify the shared Brief selection
 * (the Brief keeps its highlight; only Escape/explicit deselects clear it).
 * Returning to Select disarms a half-made link.
 */
export function setTool(sel, tool) {
  if (tool === 'link') return done({ ...sel, tool: 'link', selected: null, selLink: null });
  return done({ ...sel, tool: 'select', linkFrom: null });
}
