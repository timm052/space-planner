// Link-mode transitions for the diagram's selection state (see selection.js
// for the state shape and the `{ sel, fx }` convention). Covers the Link tool
// flow (pick a first room, pick a second → create), link selection, and the
// tool switch semantics.

import { notify } from './selection.js';

const done = (sel, fx = []) => ({ sel, fx });

/**
 * Link-mode click on a bubble. First click arms `linkFrom` (with the SPECIFIC
 * instance clicked — a count>1 space links the exact room, not always the
 * first); clicking the same room disarms; a second room requests a link (the
 * component creates it only if the pair doesn't already exist — hence
 * `maybeCreateLink`).
 */
export function linkClick(sel, spaceId, inst = 0) {
  const base = { ...sel, selLink: null };
  if (sel.linkFrom == null) return done({ ...base, linkFrom: spaceId, linkFromInst: inst });
  if (sel.linkFrom === spaceId) return done({ ...base, linkFrom: null, linkFromInst: 0 });
  return done({ ...base, linkFrom: null, linkFromInst: 0 }, [
    { type: 'maybeCreateLink', a: sel.linkFrom, b: spaceId, ia: sel.linkFromInst ?? 0, ib: inst, kind: sel.linkKind },
  ]);
}

/** Clicking a drawn link selects it (opens the link action bar). Carries the
 *  instance indices so the action bar edits the SPECIFIC link, not the pair. */
export function selectLink(sel, link) {
  return done(
    {
      ...sel,
      selected: null,
      multi: new Set(),
      linkFrom: null,
      selLink: { space_a: link.space_a, space_b: link.space_b, inst_a: link.inst_a ?? 0, inst_b: link.inst_b ?? 0 },
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
 * Switch tools (V / L / D, tool dock). Entering Link mode drops the room + link
 * selection but — deliberately — does NOT notify the shared Brief selection
 * (the Brief keeps its highlight; only Escape/explicit deselects clear it).
 * Returning to Select disarms a half-made link.
 *
 * Markup is a drawing tool, not a selection tool: it drops the room and link
 * selection too, so the action bars don't hover over ink you are laying down.
 */
export function setTool(sel, tool) {
  if (tool === 'link') return done({ ...sel, tool: 'link', selected: null, selLink: null });
  if (tool === 'markup' || tool === 'measure') {
    return done({ ...sel, tool, selected: null, multi: new Set(), selLink: null, linkFrom: null, linkFromInst: 0 });
  }
  // Trace KEEPS the selection, unlike the other modal tools: which room is
  // selected is what a traced ring is applied to, so clearing it would throw
  // away the choice the moment you picked the tool.
  if (tool === 'trace') {
    return done({ ...sel, tool: 'trace', selLink: null, linkFrom: null, linkFromInst: 0 });
  }
  return done({ ...sel, tool: 'select', linkFrom: null, linkFromInst: 0 });
}
