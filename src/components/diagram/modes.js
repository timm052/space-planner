// The diagram's pointer mode machine — pure geometry, no React.
//
// A pointer gesture on the canvas can mean eight different things, and which
// one it means is decided by an ORDERED arbitration (see MODE_ORDER). Most of
// those modes already live in their own hooks; what was left inline in
// BubbleTab was the hardest part to reason about and the only part with no
// tests: the snap resolution that turns a raw cursor position into a placed
// position plus its alignment guides.
//
// Everything here is pure. Callers pass the world state they have (nodes,
// instances, the active grid) and get back values; nothing reads React state,
// mutates a ref, or touches the DOM. That is what makes it testable — see
// test/modes.test.js.
//
// Units: every coordinate and length in this module is in DIAGRAM UNITS
// (1 unit ≈ 0.2646 mm of paper ≈ 1 CSS px at 96 dpi), never metres and never
// screen pixels. Converting screen → diagram is the caller's job (toSvgCoords).
// Mixing the two silently misplaces geometry — see ARCHITECTURE §6.1.

/**
 * @typedef {number} DiagramUnits A length or coordinate in diagram units.
 * @typedef {{ x: DiagramUnits, y: DiagramUnits }} Pt
 * @typedef {{ x: DiagramUnits, y: DiagramUnits }} Half Half-extents of a footprint.
 * @typedef {{ at: DiagramUnits, c: DiagramUnits, h: DiagramUnits }} SnapCand
 *   A snap target: `at` is the line to latch onto on this axis, `c`/`h` are the
 *   neighbour's centre and half-extent on the PERPENDICULAR axis, so a guide can
 *   be drawn as a short segment spanning just the two boxes rather than the
 *   whole canvas.
 * @typedef {{ x: SnapCand[], y: SnapCand[] }} SnapCands
 * @typedef {{ step: DiagramUnits, minorStep: DiagramUnits }} Grid
 */

/** How close (diagram units) an edge must come before it latches. */
export const SNAP_TOL = 8;

/**
 * The order in which a pointer event is offered to the modes. The FIRST mode
 * that claims the event owns the rest of the gesture. This list is the
 * arbitration contract — the handlers in BubbleTab dispatch in exactly this
 * sequence, and reordering it changes which gesture wins a contested press.
 *
 * The first five are owned by hooks (usePolyEditing, useImageLayers and the
 * rotate/resize/seed handlers); the last three were the inline refs.
 */
export const MODE_ORDER = Object.freeze([
  'poly', // vertex drag on a custom shape
  'rotate', // rotating a placed footprint
  'resize', // area-locked corner resize of a building box
  'seed', // dragging a Voronoi interior seed
  'layer', // moving / rotating / calibrating an image layer
  'link', // rubber-band link drag out of a room
  'pan', // right-drag, space-held, or pan tool
  'marquee', // empty-canvas drag select
  'drag', // moving a room (or the whole multi-selection)
]);

/**
 * Snap a coordinate to the placement grid. Coarse (major cell) by default;
 * `fine` (Alt held) snaps to the subdivision. Identity when there is no grid.
 * @param {DiagramUnits} v
 * @param {boolean} fine
 * @param {Grid|null} grid
 * @returns {DiagramUnits}
 */
export function snapToGrid(v, fine, grid) {
  if (!grid) return v;
  const s = fine ? grid.minorStep : grid.step;
  return Math.round(v / s) * s;
}

/**
 * World-space half-extents of a footprint AS RENDERED — the real box dimensions
 * in the Building massing model (rescaled to the target area, honouring 90°
 * orientation), else the circle radius. Snapping uses these so boxes align
 * edge-to-edge and corner-to-corner rather than by a phantom radius.
 *
 * @param {object} space
 * @param {{w?: number, h?: number, rot?: number}|null} node
 * @param {{ isBuilding: boolean, areaUnits: (s: object) => number, radiusOf: (s: object) => number }} ctx
 * @returns {Half}
 */
export function footHalf(space, node, { isBuilding, areaUnits, radiusOf }) {
  if (isBuilding) {
    const target = areaUnits(space);
    let hw, hh;
    if (node && node.w && node.h) {
      const aspect = node.w / node.h;
      const bh = Math.sqrt(target / aspect);
      hh = bh / 2;
      hw = (aspect * bh) / 2;
    } else {
      hw = hh = Math.sqrt(target) / 2;
    }
    // An odd number of quarter-turns swaps the axes.
    return Math.round((node?.rot || 0) / 90) % 2 ? { x: hh, y: hw } : { x: hw, y: hh };
  }
  const r = radiusOf(space);
  return { x: r, y: r };
}

/**
 * Snap targets per axis: every other visible footprint's two edges plus its
 * centre.
 *
 * @param {string} dragKey Instance key being dragged (excluded from its own targets).
 * @param {{ instances: Array<{key: string, s: object}>, nodeOf: (k: string) => object|undefined,
 *          levelVisible: (s: object) => boolean, halfOf: (s: object, n: object) => Half }} ctx
 * @returns {SnapCands}
 */
export function neighbourEdges(dragKey, { instances, nodeOf, levelVisible, halfOf }) {
  const x = [];
  const y = [];
  for (const o of instances) {
    if (o.key === dragKey || !levelVisible(o.s)) continue;
    const nn = nodeOf(o.key);
    if (!nn) continue;
    const h = halfOf(o.s, nn);
    for (const at of [nn.x - h.x, nn.x, nn.x + h.x]) x.push({ at, c: nn.y, h: h.y });
    for (const at of [nn.y - h.y, nn.y, nn.y + h.y]) y.push({ at, c: nn.x, h: h.x });
  }
  return { x, y };
}

/**
 * Resolve one axis. With object snap on, edge/corner alignment is tried first —
 * the dragged box's own near edge, centre and far edge each look for a
 * neighbour line within SNAP_TOL, nearest wins. Otherwise (or when nothing
 * aligns) fall back to the metric grid if grid snap is on.
 *
 * @param {DiagramUnits} center Proposed centre on this axis.
 * @param {DiagramUnits} half Dragged half-extent on this axis (0 = a point).
 * @param {SnapCand[]} cands
 * @param {boolean} fine Alt held — snap to the grid subdivision.
 * @param {boolean} useEdges
 * @param {boolean} useGrid
 * @param {Grid|null} grid
 * @returns {{ val: DiagramUnits, cand: SnapCand|null }}
 */
export function resolveAxis(center, half, cands, fine, useEdges, useGrid, grid) {
  if (useEdges) {
    let best = null;
    for (const off of [-half, 0, half]) {
      for (const cand of cands) {
        const d = cand.at - (center + off);
        if (Math.abs(d) <= SNAP_TOL && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, cand };
      }
    }
    if (best) return { val: center + best.d, cand: best.cand };
  }
  return { val: useGrid ? snapToGrid(center, fine, grid) : center, cand: null };
}

/**
 * The whole snap step for a dragged room: raw cursor position in, placed
 * position plus alignment guides out.
 *
 * Guides are BOUNDED segments — a vertical guide spans only from the dragged
 * box to its matched neighbour, not the full canvas height — which is why each
 * candidate carries the neighbour's perpendicular centre and half-extent.
 *
 * @param {{ raw: Pt, half: Half, neighbours: SnapCands, fine: boolean,
 *          useEdges: boolean, useGrid: boolean, grid: Grid|null }} args
 * @returns {{ x: DiagramUnits, y: DiagramUnits, guides: Array<object> }}
 */
export function resolveDrag({ raw, half, neighbours, fine, useEdges, useGrid, grid }) {
  const gx = resolveAxis(raw.x, half.x, neighbours.x, fine, useEdges, useGrid, grid);
  const gy = resolveAxis(raw.y, half.y, neighbours.y, fine, useEdges, useGrid, grid);
  const x = gx.val;
  const y = gy.val;
  const guides = [];
  if (gx.cand) {
    guides.push({
      x: gx.cand.at,
      y0: Math.min(y - half.y, gx.cand.c - gx.cand.h),
      y1: Math.max(y + half.y, gx.cand.c + gx.cand.h),
    });
  }
  if (gy.cand) {
    guides.push({
      y: gy.cand.at,
      x0: Math.min(x - half.x, gy.cand.c - gy.cand.h),
      x1: Math.max(x + half.x, gy.cand.c + gy.cand.h),
    });
  }
  return { x, y, guides };
}

/**
 * Pan: the view offset after dragging from the press point to `client`.
 * The view moves OPPOSITE the cursor, and the screen→diagram ratio is applied
 * per axis so panning tracks the cursor exactly at any zoom or container size.
 *
 * @param {{ sx: number, sy: number, vx: DiagramUnits, vy: DiagramUnits }} pan Press state.
 * @param {{ clientX: number, clientY: number }} client Current pointer position.
 * @param {{ w: DiagramUnits, h: DiagramUnits }} vbz Visible world size (zoom applied).
 * @param {{ width: number, height: number }} rect Canvas client rect.
 * @returns {Pt} The new view offset.
 */
export function panTo(pan, client, vbz, rect) {
  return {
    x: pan.vx - ((client.clientX - pan.sx) * vbz.w) / rect.width,
    y: pan.vy - ((client.clientY - pan.sy) * vbz.h) / rect.height,
  };
}

/** Did this pan gesture actually move, or was it a stationary press? */
export function panMoved(pan, client, tol = 4) {
  return Math.abs(client.clientX - pan.sx) + Math.abs(client.clientY - pan.sy) > tol;
}

/**
 * Grow a marquee box to the current point. The origin corner is fixed; only the
 * trailing corner follows, so the box may be inverted in either axis (callers
 * normalise when hit-testing).
 * @param {{x0: DiagramUnits, y0: DiagramUnits}} box
 * @param {Pt} p
 */
export function marqueeBoxAt(box, p) {
  return { ...box, x1: p.x, y1: p.y };
}
