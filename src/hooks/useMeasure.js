import { useRef, useState } from 'react';
import { metersToDist, distUnit } from '../compute.js';

/**
 * The measure / dimension tool: drag two points, read the distance.
 *
 * There was no way to check anything on the drawing — not a setback, not a
 * frontage, not a road width. On a scaled Master plan that is a basic
 * expectation, and its absence meant every dimension had to be taken on trust
 * or re-derived in CAD.
 *
 * Nothing here writes: a measurement is a question about the drawing, not a
 * change to it, so it never touches a space, an area or a total. The last
 * measurement stays on screen until the next one or Escape, because reading a
 * number off a drawing usually means looking at it and then looking away.
 *
 * Coordinates are DIAGRAM UNITS from the shell's toSvgCoords; `effScale` is
 * metres per unit, so the readout is real length at the drawing's scale. With
 * no scale set (Concept) there is no true length to report and the tool says
 * so rather than inventing one.
 */
export function useMeasure({ active, toSvgCoords, effScale, units, setTick }) {
  // A ref, not state: a drag emits a point per pointermove and the whole shell
  // must not re-render on each. The canvas re-reads it through the tick, the
  // same as every other live gesture here.
  const liveRef = useRef(null);
  const [committed, setCommitted] = useState(null);
  // Mirrored, because the shell's keyboard effect captures cancelGesture() once
  // and does not re-run per render: reading `committed` from the state closure
  // there sees whatever it was when the effect last ran, so the first Escape
  // after a measurement did nothing and the second cleared it. Every other
  // gesture in this canvas resolves through a ref for the same reason.
  const committedRef = useRef(null);
  committedRef.current = committed;

  /** Distance between two diagram-unit points, formatted for the readout. */
  const label = (a, b) => {
    const du = Math.hypot(b.x - a.x, b.y - a.y);
    if (!effScale) return { text: `${Math.round(du)} u`, exact: false };
    const metres = du * effScale;
    const v = metersToDist(metres, units);
    // Below 10 the second decimal is the difference between 4.2 and 4.25 m —
    // which is the difference between a corridor that works and one that does
    // not. Above it, centimetres are noise on a site plan.
    const text = v < 10 ? `${v.toFixed(2)} ${distUnit(units)}` : `${v.toFixed(1)} ${distUnit(units)}`;
    return { text, exact: true };
  };

  function measurePointerDown(e) {
    if (!active || e.button !== 0) return false;
    const p = toSvgCoords(e);
    liveRef.current = { a: p, b: p, shift: e.shiftKey };
    setCommitted(null);
    setTick((t) => t + 1);
    return true;
  }

  function measurePointerMove(e) {
    const m = liveRef.current;
    if (!m) return false;
    const p = toSvgCoords(e);
    // Shift constrains to the dominant axis — the drafting convention, and what
    // you want for a setback or a frontage.
    if (e.shiftKey) {
      const dx = Math.abs(p.x - m.a.x);
      const dy = Math.abs(p.y - m.a.y);
      m.b = dx >= dy ? { x: p.x, y: m.a.y } : { x: m.a.x, y: p.y };
    } else {
      m.b = p;
    }
    setTick((t) => t + 1);
    return true;
  }

  function measurePointerUp() {
    const m = liveRef.current;
    if (!m) return false;
    liveRef.current = null;
    // A tap is not a measurement; drop it rather than leave a zero on screen.
    const moved = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) > 1e-6;
    const next = moved ? { a: m.a, b: m.b } : null;
    committedRef.current = next;
    setCommitted(next);
    setTick((t) => t + 1);
    return true;
  }

  /** Escape: drop the in-flight drag, or clear the last reading. */
  function measureCancel() {
    if (liveRef.current) {
      liveRef.current = null;
      setTick((t) => t + 1);
      return true;
    }
    if (committedRef.current) {
      committedRef.current = null;
      setCommitted(null);
      setTick((t) => t + 1);
      return true;
    }
    return false;
  }

  return { liveRef, committed, setCommitted, measureLabel: label, measurePointerDown, measurePointerMove, measurePointerUp, measureCancel };
}
