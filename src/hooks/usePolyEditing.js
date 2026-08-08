import { useEffect, useRef, useState } from 'react';
import {
  parsePoly, normalizePolygon, polygonCentroid, polygonPath, regularPolygon,
  polygonArea, outlinePoints, solveAreaLockedVertex, cornerOf,
} from '../geometry.js';
import { DRAG_SLOP_PX } from '../components/diagram/modes.js';
import { pinPatch } from '../pins.js';

// Polygons render as smooth, bubble-like blobs (a dense sampled curve through
// the corners) — straight edges are reserved for box mode.
const SMOOTH_SEG = 14;

/**
 * Custom-shape (polygon) geometry + editing for the diagram. Owns vertex-edit
 * mode, the live/optimistic outline, the area-locked render geometry, and the
 * pointer flow for dragging a vertex handle. Extracted verbatim from BubbleTab
 * — no behaviour change. `shapeOf`/`areaUnits` stay in the shell as shared
 * geometry primitives and are passed in.
 *
 * The pointer flow integrates with the shell's onMove/onUp switchyard via
 * polyPointerMove(e)/polyPointerUp(), which return true when they handled the
 * event (a vertex is being dragged) so the shell can early-return.
 *
 * @param {object} params
 * @param {object}   params.project     - Current project (for the id-change reset).
 * @param {React.MutableRefObject} params.nodesRef    - Live node-position map.
 * @param {React.MutableRefObject} params.pinOverride - Optimistic pin overrides (shared shell ref).
 * @param {object}   params.history     - useHistory() command stack.
 * @param {function} params.applySpace  - Persist a space field patch.
 * @param {function} params.commitSpace - Commit + undo a single space change.
 * @param {function} params.setError    - Error-message state setter.
 * @param {function} params.setTick     - Canvas re-render trigger.
 * @param {function} params.toSvgCoords - Map a pointer event to diagram coords.
 * @param {function} params.shapeOf     - (space) → 'bubble' | 'box' | 'poly'.
 * @param {function} params.areaUnits   - (space) → on-screen area in diagram-units².
 * @param {number}   params.selected      - Selected space id (for the edit anchor).
 * @param {number}   params.selectedInst  - Selected instance index.
 */
export function usePolyEditing({
  project, nodesRef, pinOverride, history, applySpace, commitSpace, setError,
  setTick, toSvgCoords, shapeOf, areaUnits, selected, selectedInst,
  // 5b/5c — which way round the area and the outline are related.
  // (space) → true when the typed figure rules (the default, and how the app
  // has always behaved). False means the DRAWING rules: a vertex drag changes
  // what the footprint encloses, and `onAreaFromShape` is handed the new area
  // so the schedule figure can follow it.
  areaLocked = () => true,
  onAreaFromShape = null,
  // Builds the { before, after, touched } patch that persists the anchor
  // node's recentred position. Defaults to pin_json (Concept); the authored
  // environments pass a patcher that writes their own layout column instead.
  posPatch = pinPatch,
  // (space) → default normalized outline for a space whose shape isn't drawn
  // yet (e.g. master-plan building envelopes render a rectangle before they're
  // placed); null keeps the classic parsePoly-or-nothing behaviour.
  defaultOutline = null,
  // Snap a WORLD-space handle position to neighbouring edges / the metric grid,
  // returning { x, y } (and publishing its own guides). Null = no snapping.
  snapVertex = null,
  // Map<spaceId, space> — the keyboard nudge needs to resolve `editShape`.
  spaceById = null,
}) {
  const [editShape, setEditShape] = useState(null); // space id whose polygon is being edited
  const [selVert, setSelVert] = useState(null); // vertex index under keyboard control
  const polyDragRef = useRef(null); // { space, vi } while dragging a polygon vertex handle
  const polyOverride = useRef(new Map()); // space.id → { from, json, verts } outline awaiting refetch
  const nudgedRef = useRef(null); // { space, verts } accumulated keyboard nudges
  const spaceOfEdit = (id) => spaceById?.get(id) ?? null;

  // Drop optimistic outlines when switching projects (matches BubbleTab's
  // project-change reset for history + optimistic colours).
  useEffect(() => polyOverride.current.clear(), [project.id]);
  // Leave shape-edit mode when the selection moves to another space.
  useEffect(() => {
    if (editShape != null && editShape !== selected) setEditShape(null);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  // A vertex selection only means anything inside the shape being edited.
  useEffect(() => setSelVert(null), [editShape]);

  // Normalized verts for a space, preferring (1) the live drag verts, then
  // (2) the just-saved outline until the refetch delivers it — releasing a
  // vertex used to flash the PRE-edit shape for the refetch round-trip, a
  // visible snap back and forth.
  //
  // The override must yield to ANY other writer, not just to its own write
  // landing. Matching only on `json` meant an UNDO — which writes the PRE-edit
  // outline — could never satisfy the check, so the override kept rendering the
  // undone shape for the rest of the session while the database held the
  // reverted one. That divergence reached paper: the PDF sheet builds its
  // outline from parsePoly(space) (BubbleTab.sheetPoly), so the drawing you
  // issued stopped matching the drawing on screen. Recording what the override
  // was derived FROM makes "someone else wrote" detectable.
  const liveNormOf = (s) => {
    const d = polyDragRef.current;
    if (d && d.space.id === s.id) return d.verts;
    const ov = polyOverride.current.get(s.id);
    if (ov) {
      const cur = s.shape_json ?? null;
      if (cur === ov.json) polyOverride.current.delete(s.id); // our write landed
      else if (cur !== ov.from) polyOverride.current.delete(s.id); // undo / another writer wins
      else return ov.verts; // unchanged since we wrote → still in flight
    }
    return parsePoly(s) || (defaultOutline ? defaultOutline(s) : null);
  };
  // Scale factor that makes the *rendered* (curved) outline's area exactly equal
  // areaUnits(s) — the area lock. We divide by the normalized curve's area k so a
  // bulgy curve still encloses the correct footprint regardless of the outline.
  const polyScaleOf = (s) => {
    const np = liveNormOf(s);
    if (!np) return null;
    // An UNLOCKED drag freezes the scale at the value the outline had when the
    // press landed. Without that, re-deriving it from areaUnits every frame is
    // itself the lock: the shape is scaled back to the stated area as fast as
    // the handle enlarges it, and the corner appears not to move.
    const d = polyDragRef.current;
    if (d && d.space.id === s.id && d.frozenScale != null) return d.frozenScale;
    const k = polygonArea(outlinePoints(np, SMOOTH_SEG)) || polygonArea(np) || 1;
    return Math.sqrt(areaUnits(s) / k);
  };
  // Dense, area-locked outline points (corner-style aware) for rendering /
  // extrusion / PDF, centred at origin.
  const polyVertsOf = (s) => {
    const np = liveNormOf(s);
    if (!np) return null;
    const f = polyScaleOf(s);
    return outlinePoints(np, SMOOTH_SEG).map((p) => ({ x: p.x * f, y: p.y * f }));
  };
  // The corner vertices (for edit handles), scaled by the same factor so they sit
  // on the rendered curve's control points. Each carries its corner style `k`.
  const polyHandlesOf = (s) => {
    const np = liveNormOf(s);
    if (!np) return null;
    const f = polyScaleOf(s);
    return np.map((p) => ({ ...p, x: p.x * f, y: p.y * f }));
  };
  // A selection/pin/multi outline that HUGS a custom (poly) room instead of a
  // bounding box: the room's own curve scaled outward by ~pad px about its
  // centroid (≈ origin, since poly verts are centred on the node).
  const polyRingPath = (verts, pad) => {
    let cx = 0, cy = 0;
    for (const p of verts) ((cx += p.x), (cy += p.y));
    cx /= verts.length; cy /= verts.length;
    let avgR = 0;
    for (const p of verts) avgR += Math.hypot(p.x - cx, p.y - cy);
    avgR = avgR / verts.length || 1;
    const f = (avgR + pad) / avgR;
    return polygonPath(verts.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f })));
  };

  // Convert a space to a polygon (seeding a default outline if it has none) and
  // open vertex-edit mode. Toggling off when it's already the edit target.
  function editCustomShape(space) {
    if (editShape === space.id) return setEditShape(null);
    // A space whose 'poly' is only the un-drawn default still needs its
    // outline PERSISTED before vertex-editing, so fall through when the
    // stored shape_json is absent.
    if (shapeOf(space) === 'poly' && parsePoly(space)) return setEditShape(space.id);
    commitSpace(
      space,
      { shape: 'poly', shape_json: JSON.stringify(parsePoly(space) || defaultOutline?.(space) || regularPolygon(6)) },
      'custom shape'
    );
    setEditShape(space.id);
  }
  // The instance node a polygon's edit handles are anchored to.
  const editAnchorInst = (space) => (selected === space.id ? selectedInst : 0);
  // Persist a new normalized outline for a space (undoable).
  //
  // normalizePolygon re-centres the verts about their centroid, which used to
  // visually SNAP the drawn shape back onto the node after editing (and leave
  // the name label off the shape's middle). Compensate by moving the anchor
  // instance's node to the outline's centroid — the geometry on screen stays
  // exactly where the user left it and the label glides to its centre. The
  // position rides in the same undo entry as the shape.
  function savePoly(space, verts, label = 'shape', drawnUnits = null) {
    const norm = normalizePolygon(verts);
    const before = { shape: space.shape, shape_json: space.shape_json ?? null };
    const after = { shape: 'poly', shape_json: JSON.stringify(norm) };
    // 5c — the drawing as the source of truth. `drawnUnits` arrives only from an
    // unlocked reshape, and it is the area the outline WILL render at, so the
    // centroid compensation below has to use it rather than the figure the row
    // still carries. The write itself is applied at the very end: a building
    // envelope keeps its stated area in the same layout column the re-centring
    // rewrites, so a patch built before that runs is simply overwritten.
    const areaAfter = drawnUnits > 0 ? drawnUnits : areaUnits(space);
    // Render the saved outline immediately (liveNormOf) so releasing the
    // handle doesn't flash the pre-edit shape while the refetch is in flight.
    // `from` is the row we derived it from — see liveNormOf for why.
    polyOverride.current.set(space.id, { from: space.shape_json ?? null, json: after.shape_json, verts: norm });
    const c = polygonCentroid(verts);
    const restore = []; // node positions to put back if the write fails
    if (Math.hypot(c.x, c.y) > 1e-6) {
      // Screen shift removed by normalization = centroid × the render scale the
      // outline had during the edit (smoothing is affine, so this is exact).
      const k = polygonArea(outlinePoints(verts, SMOOTH_SEG)) || polygonArea(verts) || 1;
      // The area the outline will render at AFTER this save — which is the new
      // one when the drawing rules, not the figure the row still carries.
      const f = Math.sqrt(areaAfter / k);
      // shape_json belongs to the SPACE, so every instance re-renders with the
      // re-centred outline. Compensating only the edited instance left the
      // others to jump by the centroid delta — and to persist there. Move them
      // all, in the one undo entry.
      const idxs = [];
      for (let i = 0; i < Math.max(1, space.count || 1); i++) {
        const n = nodesRef.current.get(`${space.id}:${i}`);
        if (!n) continue;
        restore.push({ n, x: n.x, y: n.y });
        n.x += c.x * f;
        n.y += c.y * f;
        idxs.push(i);
      }
      if (idxs.length) {
        const patch = posPatch(space, idxs, (i, prev) => {
          const n = nodesRef.current.get(`${space.id}:${i}`);
          const pos = { x: n.x, y: n.y };
          return prev?.locked ? { ...pos, locked: true } : pos;
        });
        Object.assign(before, patch.before);
        Object.assign(after, patch.after);
        for (const [i, p] of Object.entries(patch.touched)) pinOverride.current.set(`${space.id}:${i}`, p);
      }
    }
    // The area, last, over the re-centred node — see areaAfter above. Same
    // patch, so the shape, the positions and the figure are ONE undo entry.
    if (drawnUnits > 0 && onAreaFromShape) {
      const patch = onAreaFromShape(space, drawnUnits);
      if (patch) {
        for (const [k2, v] of Object.entries(patch.before)) if (!(k2 in before)) before[k2] = v;
        Object.assign(after, patch.after);
      }
    }
    history.record({ label, undo: () => applySpace(space.id, before), redo: () => applySpace(space.id, after) });
    setError(null);
    applySpace(space.id, after).catch((e) => {
      // The write lost. Put the geometry back rather than leave the canvas
      // showing an outline (and positions) the database does not have.
      for (const r of restore) ((r.n.x = r.x), (r.n.y = r.y));
      polyOverride.current.delete(space.id);
      setTick((t) => t + 1);
      setError(e.message);
    });
  }
  // Every discrete operation below reads liveNormOf, NOT parsePoly.
  //
  // savePoly does not await its write, so `space` still holds the pre-edit row
  // for the length of the round-trip. Reading parsePoly inside that window
  // applied the change to a stale outline and saved it — silently reverting the
  // edit before it. Users work in exactly that rhythm (drag a corner, release,
  // immediately double-click another), so the window was hit constantly.
  // liveNormOf already resolves drag verts → pending override → persisted, and
  // it also covers an outline that is still only a defaultOutline.

  // Insert a vertex at the midpoint of edge i→i+1 (in normalized space).
  function addPolyVertex(space, edgeIndex) {
    const np = liveNormOf(space);
    if (!np) return;
    const a = np[edgeIndex], b = np[(edgeIndex + 1) % np.length];
    const next = [...np];
    next.splice(edgeIndex + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    savePoly(space, next, 'add vertex');
  }
  // Remove a vertex (keeps at least a triangle).
  function removePolyVertex(space, vi) {
    const np = liveNormOf(space);
    if (!np || np.length <= 3) return;
    savePoly(space, np.filter((_, i) => i !== vi), 'remove vertex');
  }
  // Corner styles: cycle ONE vertex (right-click its handle) curve → fillet →
  // sharp → curve, or set EVERY vertex at once (the HUD buttons). The vertex
  // positions don't move — only how the outline passes through them; the area
  // lock re-scales so the enclosed footprint stays exact.
  function cycleCornerStyle(space, vi) {
    const np = liveNormOf(space);
    if (!np || !np[vi]) return;
    const order = { c: 'f', f: 's', s: 'c' };
    const next = [...np];
    next[vi] = { ...np[vi], k: order[cornerOf(np[vi])] };
    savePoly(space, next, 'corner style');
  }
  function setCornerStyleAll(space, k) {
    const np = liveNormOf(space);
    if (!np) return;
    savePoly(space, np.map((p) => ({ ...p, k })), 'corners');
  }
  function onPolyVertexDown(e, space, vi) {
    // Left button only. Without this a RIGHT press set up a vertex drag as well
    // as firing contextmenu, so one right-click both cycled the corner style and
    // saved a reshape — and right-drag-to-pan turned into a vertex drag whenever
    // the press landed on a handle, which while editing is most of the shape.
    if (e.button !== 0) return;
    e.stopPropagation();
    // currentTarget, not target: capture must sit on the element the handler is
    // bound to, so a re-render that swaps the child glyph can't drop the drag.
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    const np = liveNormOf(space);
    if (!np) return;
    setSelVert(vi); // arrow keys now nudge THIS corner
    polyDragRef.current = {
      space, vi, verts: np.map((p) => ({ ...p })),
      sx: e.clientX, sy: e.clientY, moved: 0, invalid: false,
      // Read BEFORE the ref is set, so it is the pre-drag scale.
      frozenScale: areaLocked(space) ? null : polyScaleOf(space),
    };
  }

  // Pointer delegates for the shell switchyard: return true when a vertex drag
  // is in flight (so the shell early-returns from its own onMove/onUp).
  function polyPointerMove(e) {
    const d = polyDragRef.current;
    if (!d) return false;
    const node = nodesRef.current.get(`${d.space.id}:${editAnchorInst(d.space)}`);
    if (node) {
      const p = toSvgCoords(e);
      // Snap the handle in WORLD space first, so an envelope corner latches to
      // a neighbour's edge or the metric grid exactly as the envelope's own
      // position does. Drawing a footprint to a survey line was freehand while
      // the thing it belonged to snapped.
      const sp = snapVertex ? snapVertex(p, { fine: e.altKey }) : p;
      // The handles are rendered INSIDE the footprint's rotate() group, so a
      // world-space delta means nothing in outline space until it is un-rotated.
      // hitInstanceAt, resizePointerMove and seedPointerUp all do this; the
      // vertex drag was the one that didn't, which sent the handle off at the
      // rotation angle on any turned envelope.
      const rad = ((node.rot || 0) * Math.PI) / 180;
      const dx = sp.x - node.x;
      const dy = sp.y - node.y;
      const target = {
        x: dx * Math.cos(rad) + dy * Math.sin(rad),
        y: -dx * Math.sin(rad) + dy * Math.cos(rad),
      };
      if (d.frozenScale != null) {
        // UNLOCKED: no lock to solve for. The corner simply goes where the
        // cursor is — in normalized space, since that is what verts are — and
        // the footprint encloses whatever that makes it enclose.
        const next = [...d.verts];
        next[d.vi] = { ...next[d.vi], x: target.x / d.frozenScale, y: target.y / d.frozenScale };
        // A ring with no positive area is still refused: it has no measurable
        // footprint, so there is no number for the schedule to follow.
        if (polygonArea(outlinePoints(next, SMOOTH_SEG)) > 0) {
          d.verts = next;
          d.invalid = false;
        } else {
          d.invalid = true;
        }
      } else {
        // Solve the vertex + area-lock scale together (see geometry.js): the
        // dragged handle lands exactly under the cursor, the outline is a
        // smooth deterministic function of it — no cross-frame feedback.
        const solved = solveAreaLockedVertex(d.verts, d.vi, target, areaUnits(d.space), SMOOTH_SEG);
        // A self-intersecting ring has no area for the lock to hold — it solves
        // √(target / ~0) and the footprint balloons. Refuse the frame and keep
        // the last valid outline; the canvas shows the handle as rejected.
        if (solved.ok) {
          d.verts = solved.verts;
          d.invalid = false;
        } else {
          d.invalid = true;
        }
      }
      // Screen-space travel, so the save threshold means the same at every zoom
      // (it counted FRAMES before, so a single sub-pixel jitter wrote an entry).
      d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.sx, e.clientY - d.sy));
      setTick((t) => t + 1);
    }
    return true;
  }
  function polyPointerUp() {
    const d = polyDragRef.current;
    if (!d) return false;
    polyDragRef.current = null;
    if (d.moved >= DRAG_SLOP_PX) {
      // What the outline now encloses, in the same diagram-units² that
      // areaUnits speaks. Only meaningful when the lock was off — with it on
      // the answer is areaUnits by construction.
      const drawnUnits = d.frozenScale != null
        ? polygonArea(outlinePoints(d.verts, SMOOTH_SEG)) * d.frozenScale ** 2
        : null;
      savePoly(d.space, d.verts, 'reshape', drawnUnits);
    } else setTick((t) => t + 1);
    return true;
  }
  /** Abandon a vertex drag without saving (Escape / pointercancel). */
  function polyCancel() {
    if (!polyDragRef.current) return false;
    polyDragRef.current = null;
    setTick((t) => t + 1);
    return true;
  }

  /**
   * Move the SELECTED vertex by a world-space delta — the keyboard route into
   * shape editing, which was pointer-only. Arrow keys used to move the whole
   * footprint even while its outline was being edited, which is the opposite of
   * what the mode implies. Returns false when there is nothing to nudge, so the
   * caller can fall through to moving the room.
   *
   * Persisting is the caller's job (it debounces a key-repeat burst into one
   * undo step, exactly as the room nudge does).
   */
  function nudgeVertex(dx, dy) {
    if (editShape == null || selVert == null) return false;
    const space = spaceOfEdit?.(editShape);
    if (!space) return false;
    const np = liveNormOf(space);
    if (!np || !np[selVert]) return false;
    const node = nodesRef.current.get(`${space.id}:${editAnchorInst(space)}`);
    if (!node) return false;
    // The handle sits on the RENDERED curve, so convert the world delta into
    // normalized outline space through the same scale the render uses, and
    // through the footprint's rotation (as the drag does).
    const f = polyScaleOf(space) || 1;
    const rad = ((node.rot || 0) * Math.PI) / 180;
    const lx = (dx * Math.cos(rad) + dy * Math.sin(rad)) / f;
    const ly = (-dx * Math.sin(rad) + dy * Math.cos(rad)) / f;
    const target = { x: (np[selVert].x + lx) * f, y: (np[selVert].y + ly) * f };
    const solved = solveAreaLockedVertex(np, selVert, target, areaUnits(space), SMOOTH_SEG);
    if (!solved.ok) return true; // refused, but the key was ours — don't move the room
    nudgedRef.current = { space, verts: solved.verts };
    polyOverride.current.set(space.id, {
      from: space.shape_json ?? null,
      json: polyOverride.current.get(space.id)?.json ?? space.shape_json ?? null,
      verts: solved.verts,
    });
    setTick((t) => t + 1);
    return true;
  }
  /** Persist the accumulated keyboard nudges as one undo step. */
  function commitVertexNudge() {
    const n = nudgedRef.current;
    if (!n) return;
    nudgedRef.current = null;
    savePoly(n.space, n.verts, 'nudge vertex');
  }

  return {
    editShape, setEditShape,
    polyVertsOf, polyHandlesOf, polyRingPath,
    editCustomShape, editAnchorInst, addPolyVertex, removePolyVertex,
    cycleCornerStyle, setCornerStyleAll,
    onPolyVertexDown, polyPointerMove, polyPointerUp, polyCancel,
    polyDragRef, // the canvas reads .invalid to mark a refused handle
    // Keyboard vertex placement: which corner is under control, and the nudge.
    selVert, setSelVert, nudgeVertex, commitVertexNudge,
  };
}
