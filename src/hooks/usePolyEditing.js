import { useEffect, useRef, useState } from 'react';
import {
  parsePoly, normalizePolygon, polygonCentroid, polygonPath, regularPolygon,
  polygonArea, outlinePoints, solveAreaLockedVertex, cornerOf,
} from '../geometry.js';
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
  // Builds the { before, after, touched } patch that persists the anchor
  // node's recentred position. Defaults to pin_json (Concept); the authored
  // environments pass a patcher that writes their own layout column instead.
  posPatch = pinPatch,
}) {
  const [editShape, setEditShape] = useState(null); // space id whose polygon is being edited
  const polyDragRef = useRef(null); // { space, vi } while dragging a polygon vertex handle
  const polyOverride = useRef(new Map()); // space.id → { json, verts } saved outline awaiting refetch

  // Drop optimistic outlines when switching projects (matches BubbleTab's
  // project-change reset for history + optimistic colours).
  useEffect(() => polyOverride.current.clear(), [project.id]);
  // Leave shape-edit mode when the selection moves to another space.
  useEffect(() => {
    if (editShape != null && editShape !== selected) setEditShape(null);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Normalized verts for a space, preferring (1) the live drag verts, then
  // (2) the just-saved outline until the refetch delivers it — releasing a
  // vertex used to flash the PRE-edit shape for the refetch round-trip, a
  // visible snap back and forth. The override drops itself once the space's
  // shape_json catches up.
  const liveNormOf = (s) => {
    const d = polyDragRef.current;
    if (d && d.space.id === s.id) return d.verts;
    const ov = polyOverride.current.get(s.id);
    if (ov) {
      if (s.shape_json === ov.json) polyOverride.current.delete(s.id); // refetch caught up
      else return ov.verts;
    }
    return parsePoly(s);
  };
  // Scale factor that makes the *rendered* (curved) outline's area exactly equal
  // areaUnits(s) — the area lock. We divide by the normalized curve's area k so a
  // bulgy curve still encloses the correct footprint regardless of the outline.
  const polyScaleOf = (s) => {
    const np = liveNormOf(s);
    if (!np) return null;
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
    if (shapeOf(space) === 'poly') return setEditShape(space.id);
    commitSpace(
      space,
      { shape: 'poly', shape_json: JSON.stringify(parsePoly(space) || regularPolygon(6)) },
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
  function savePoly(space, verts, label = 'shape') {
    const norm = normalizePolygon(verts);
    const before = { shape: space.shape, shape_json: space.shape_json ?? null };
    const after = { shape: 'poly', shape_json: JSON.stringify(norm) };
    // Render the saved outline immediately (liveNormOf) so releasing the
    // handle doesn't flash the pre-edit shape while the refetch is in flight.
    polyOverride.current.set(space.id, { json: after.shape_json, verts: norm });
    const idx = editAnchorInst(space);
    const node = nodesRef.current.get(`${space.id}:${idx}`);
    const c = polygonCentroid(verts);
    if (node && Math.hypot(c.x, c.y) > 1e-6) {
      // Screen shift removed by normalization = centroid × the render scale the
      // outline had during the edit (smoothing is affine, so this is exact).
      const k = polygonArea(outlinePoints(verts, SMOOTH_SEG)) || polygonArea(verts) || 1;
      const f = Math.sqrt(areaUnits(space) / k);
      node.x += c.x * f;
      node.y += c.y * f;
      const patch = posPatch(space, [idx], (i, prev) => {
        const pos = { x: node.x, y: node.y };
        return prev?.locked ? { ...pos, locked: true } : pos;
      });
      Object.assign(before, patch.before);
      Object.assign(after, patch.after);
      for (const [i, p] of Object.entries(patch.touched)) pinOverride.current.set(`${space.id}:${i}`, p);
    }
    history.record({ label, undo: () => applySpace(space.id, before), redo: () => applySpace(space.id, after) });
    setError(null);
    applySpace(space.id, after).catch((e) => setError(e.message));
  }
  // Insert a vertex at the midpoint of edge i→i+1 (in normalized space).
  function addPolyVertex(space, edgeIndex) {
    const np = parsePoly(space);
    if (!np) return;
    const a = np[edgeIndex], b = np[(edgeIndex + 1) % np.length];
    const next = [...np];
    next.splice(edgeIndex + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    savePoly(space, next, 'add vertex');
  }
  // Remove a vertex (keeps at least a triangle).
  function removePolyVertex(space, vi) {
    const np = parsePoly(space);
    if (!np || np.length <= 3) return;
    savePoly(space, np.filter((_, i) => i !== vi), 'remove vertex');
  }
  // Corner styles: cycle ONE vertex (right-click its handle) curve → fillet →
  // sharp → curve, or set EVERY vertex at once (the HUD buttons). The vertex
  // positions don't move — only how the outline passes through them; the area
  // lock re-scales so the enclosed footprint stays exact.
  function cycleCornerStyle(space, vi) {
    const np = parsePoly(space);
    if (!np || !np[vi]) return;
    const order = { c: 'f', f: 's', s: 'c' };
    const next = [...np];
    next[vi] = { ...np[vi], k: order[cornerOf(np[vi])] };
    savePoly(space, next, 'corner style');
  }
  function setCornerStyleAll(space, k) {
    const np = parsePoly(space);
    if (!np) return;
    savePoly(space, np.map((p) => ({ ...p, k })), 'corners');
  }
  function onPolyVertexDown(e, space, vi) {
    e.stopPropagation();
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    const np = parsePoly(space);
    if (!np) return;
    polyDragRef.current = { space, vi, verts: np.map((p) => ({ ...p })), moved: 0 };
  }

  // Pointer delegates for the shell switchyard: return true when a vertex drag
  // is in flight (so the shell early-returns from its own onMove/onUp).
  function polyPointerMove(e) {
    const d = polyDragRef.current;
    if (!d) return false;
    const node = nodesRef.current.get(`${d.space.id}:${editAnchorInst(d.space)}`);
    if (node) {
      const { x, y } = toSvgCoords(e);
      // Solve the vertex + area-lock scale together (see geometry.js): the
      // dragged handle lands exactly under the cursor, the outline is a
      // smooth deterministic function of it — no cross-frame feedback.
      d.verts = solveAreaLockedVertex(
        d.verts,
        d.vi,
        { x: x - node.x, y: y - node.y },
        areaUnits(d.space),
        SMOOTH_SEG
      ).verts;
      d.moved += 1;
      setTick((t) => t + 1);
    }
    return true;
  }
  function polyPointerUp() {
    const d = polyDragRef.current;
    if (!d) return false;
    polyDragRef.current = null;
    if (d.moved > 0) savePoly(d.space, d.verts, 'reshape');
    else setTick((t) => t + 1);
    return true;
  }

  return {
    editShape, setEditShape,
    polyVertsOf, polyHandlesOf, polyRingPath,
    editCustomShape, editAnchorInst, addPolyVertex, removePolyVertex,
    cycleCornerStyle, setCornerStyleAll,
    onPolyVertexDown, polyPointerMove, polyPointerUp,
  };
}
