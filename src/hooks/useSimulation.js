import { useEffect, useRef } from 'react';
import { W, H } from './useViewport.js';

/**
 * Runs the force-directed bubble simulation in a requestAnimationFrame loop.
 *
 * The sim writes directly into `nodesRef` (mutable map of instance key →
 * {x, y, vx, vy}) and calls `setTick` to trigger a re-render. It never
 * returns any React state — all animation state lives in refs.
 *
 * Forces applied each frame:
 *   1. Centroid gravity — pulls each bubble toward its group centroid.
 *   2. World gravity    — weak pull toward the canvas centre.
 *   3. Sibling springs  — keeps instances of the same space near each other.
 *   4. Adjacency springs — pulls closest instance pair for each declared link.
 *   5. Collision        — separates overlapping bubbles.
 *   6. Pin / hold       — fixed-point override for dragged / pinned nodes.
 *
 * Staleness strategy: `radiusOf`, `groupKey`, and `instPin` change every
 * render (they close over `drafts` and `colorBy`). Rather than adding them to
 * the effect deps (which would restart the RAF loop far too often), we wrap
 * them in refs that are updated on every render. The RAF loop always reads the
 * ref's `.current`, so it is never stale.
 *
 * @param {object} params
 * @param {Array}         params.instances   - [{s, i, key}] leaf space instances.
 * @param {Array}         params.leaves      - Leaf space objects (for sibling springs).
 * @param {Array}         params.adjacencies - Declared adjacency links.
 * @param {Map}           params.byId        - Map<spaceId, space> for adjacency lookup.
 * @param {boolean}       params.simEnabled  - Master on/off switch.
 * @param {number|null}   params.effScale    - Metres per diagram unit; affects collision gap.
 * @param {React.MutableRefObject} params.nodesRef   - The node-position map.
 * @param {React.MutableRefObject} params.alphaRef   - Simulation cooling parameter (0..1).
 * @param {React.MutableRefObject} params.dragRef    - Current drag state (null when idle).
 * @param {function}      params.radiusOf    - (space) → radius in diagram units.
 * @param {function}      params.instPin     - (space, idx) → {x,y} | null.
 * @param {function}      params.groupKey    - (space) → group label string.
 * @param {function}      params.setTick     - Re-render trigger.
 */
export function useSimulation({
  instances,
  leaves,
  adjacencies,
  byId,
  simEnabled,
  effScale,
  nodesRef,
  alphaRef,
  dragRef,
  radiusOf,
  instPin,
  groupKey,
  setTick,
}) {
  // Wrap the three render-frequency callbacks in refs so the RAF loop always
  // reads fresh values without those functions being in the effect dep array.
  const radiusOfRef = useRef(radiusOf);
  radiusOfRef.current = radiusOf;
  const instPinRef = useRef(instPin);
  instPinRef.current = instPin;
  const groupKeyRef = useRef(groupKey);
  groupKeyRef.current = groupKey;

  useEffect(() => {
    let raf;

    const held = (key) => {
      const d = dragRef.current;
      return !!d && (d.key === key || (d.groupSet != null && d.groupSet.has(key)));
    };
    const fixedInst = (o) => held(o.key) || !!instPinRef.current(o.s, o.i);

    // Closest instance pair between two spaces (for adjacency springs).
    const closestPair = (sa, sb) => {
      const nodes = nodesRef.current;
      let best = null;
      for (let i = 0; i < Math.max(1, sa.count || 1); i++) {
        const a = nodes.get(`${sa.id}:${i}`);
        if (!a) continue;
        for (let j = 0; j < Math.max(1, sb.count || 1); j++) {
          const b = nodes.get(`${sb.id}:${j}`);
          if (!b) continue;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (!best || d < best.d) best = { a, b, d, ai: i, bi: j };
        }
      }
      return best;
    };

    const simulate = (alpha) => {
      const nodes = nodesRef.current;
      const arr = instances
        .map((o) => ({ ...o, n: nodes.get(o.key), r: radiusOfRef.current(o.s) }))
        .filter((o) => o.n);

      // 1. Centroid gravity + world gravity
      const cents = new Map();
      for (const o of arr) {
        const c = cents.get(groupKeyRef.current(o.s)) || { x: 0, y: 0, n: 0 };
        c.x += o.n.x;
        c.y += o.n.y;
        c.n++;
        cents.set(groupKeyRef.current(o.s), c);
      }
      for (const o of arr) {
        if (fixedInst(o)) continue;
        const c = cents.get(groupKeyRef.current(o.s));
        o.n.vx += (c.x / c.n - o.n.x) * 0.012 * alpha;
        o.n.vy += (c.y / c.n - o.n.y) * 0.012 * alpha;
        o.n.vx += (W / 2 - o.n.x) * 0.006 * alpha;
        o.n.vy += (H / 2 - o.n.y) * 0.006 * alpha;
      }

      // 2. Sibling springs (instances of the same space)
      for (const s of leaves) {
        const count = Math.max(1, s.count || 1);
        if (count < 2) continue;
        const r = radiusOfRef.current(s);
        for (let i = 0; i < count - 1; i++) {
          const a = nodes.get(`${s.id}:${i}`);
          const b = nodes.get(`${s.id}:${i + 1}`);
          if (!a || !b) continue;
          const rest = r * 2 + 10;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const f = ((d - rest) / d) * 0.04 * alpha;
          if (!held(`${s.id}:${i}`) && !instPinRef.current(s, i)) ((a.vx += dx * f), (a.vy += dy * f));
          if (!held(`${s.id}:${i + 1}`) && !instPinRef.current(s, i + 1)) ((b.vx -= dx * f), (b.vy -= dy * f));
        }
      }

      // 3. Adjacency springs
      for (const l of adjacencies) {
        const sa = byId.get(l.space_a);
        const sb = byId.get(l.space_b);
        if (!sa || !sb) continue;
        const pair = closestPair(sa, sb);
        if (!pair) continue;
        const rest = radiusOfRef.current(sa) + radiusOfRef.current(sb) + (l.strength === 'required' ? 14 : 70);
        const k = l.strength === 'required' ? 0.05 : 0.018;
        const dx = pair.b.x - pair.a.x;
        const dy = pair.b.y - pair.a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = ((d - rest) / d) * k * alpha;
        if (!held(`${sa.id}:${pair.ai}`) && !instPinRef.current(sa, pair.ai))
          ((pair.a.vx += dx * f), (pair.a.vy += dy * f));
        if (!held(`${sb.id}:${pair.bi}`) && !instPinRef.current(sb, pair.bi))
          ((pair.b.vx -= dx * f), (pair.b.vy -= dy * f));
      }

      // 4. Collision separation
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          let dx = b.n.x - a.n.x;
          let dy = b.n.y - a.n.y;
          let d = Math.hypot(dx, dy);
          if (d === 0) ((dx = Math.random() - 0.5), (dy = Math.random() - 0.5), (d = Math.hypot(dx, dy)));
          const minD = a.r + b.r + (effScale ? 4 : 12);
          const aF = fixedInst(a);
          const bF = fixedInst(b);
          if (aF && bF) continue;
          if (d < minD) {
            const push = ((minD - d) / d) * 0.45;
            if (!aF) ((a.n.x -= dx * push * (bF ? 2 : 1)), (a.n.y -= dy * push * (bF ? 2 : 1)));
            if (!bF) ((b.n.x += dx * push * (aF ? 2 : 1)), (b.n.y += dy * push * (aF ? 2 : 1)));
          } else if (d < minD + 60) {
            const f = (800 * alpha) / (d * d);
            if (!aF) ((a.n.vx -= (dx / d) * f), (a.n.vy -= (dy / d) * f));
            if (!bF) ((b.n.vx += (dx / d) * f), (b.n.vy += (dy / d) * f));
          }
        }
      }

      // 5. Integrate velocities / apply pins
      for (const o of arr) {
        if (held(o.key)) {
          o.n.vx = 0;
          o.n.vy = 0;
        } else {
          const pin = instPinRef.current(o.s, o.i);
          if (pin) {
            o.n.x = pin.x;
            o.n.y = pin.y;
            o.n.vx = 0;
            o.n.vy = 0;
          } else {
            o.n.vx *= 0.55;
            o.n.vy *= 0.55;
            o.n.x += o.n.vx;
            o.n.y += o.n.vy;
          }
        }
      }
    };

    const step = () => {
      if (simEnabled && (alphaRef.current > 0.012 || dragRef.current)) {
        simulate(Math.max(alphaRef.current, dragRef.current ? 0.3 : 0));
        if (!dragRef.current) alphaRef.current *= 0.99;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, adjacencies, simEnabled, effScale]);
}
