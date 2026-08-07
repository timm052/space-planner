import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { DEFAULT_PEN, NO_MARKUP, parseStroke, roundPoints, simplify } from '../markup.js';

/**
 * Redline markup for the 2-D viewport: the pen state, the in-flight stroke, and
 * the three pointer delegates that plug into BubbleTab's switchyard.
 *
 * Markup is deliberately inert with respect to the programme. It never reads a
 * space, never writes one, and nothing here can move an area — a redline is a
 * comment on the drawing, not a change to it. Strokes live in their own table
 * scoped by environment and storey (see server/db.js).
 *
 * Coordinates are DIAGRAM UNITS throughout, produced by the shell's shared
 * toSvgCoords, which is what keeps ink on the thing it was drawn over through
 * pan, zoom and a drawing-scale change.
 *
 * @param {object} params
 * @param {object}   params.project    - Current project (id).
 * @param {Array}    params.markups    - Raw markup rows from the project payload.
 * @param {string}   params.env        - Active environment ('concept'|'masterplan'|'building').
 * @param {string}   params.level      - Active storey label ('' = not level-scoped).
 * @param {boolean}  params.active     - Is the Markup tool selected?
 * @param {function} params.toSvgCoords- Screen → diagram units.
 * @param {function} params.onChanged  - Refetch trigger after a write.
 * @param {function} params.setError   - Error-message state setter.
 * @param {function} params.setTick    - Canvas re-render trigger.
 * @param {object}   params.history    - The shell's undo stack.
 */
export function useMarkup({
  project, markups = NO_MARKUP, env, level = '', active,
  toSvgCoords, onChanged, setError, setTick, history,
}) {
  const [pen, setPen] = useState(DEFAULT_PEN);
  // The stroke being drawn right now. A ref, not state: a freehand drag emits a
  // point per pointermove and re-rendering the whole shell on each one would
  // drop the frame rate exactly when the line needs to feel attached to the
  // cursor. The canvas re-reads it through setTick, the same as every other
  // live gesture on this canvas.
  const inkRef = useRef(null);
  const penRef = useRef(pen);
  penRef.current = pen;
  // Strokes created or removed since the last refetch, so a fresh mark stays on
  // screen through the round trip instead of blinking out and back. STATE, not
  // refs: committing a stroke has to re-render (it is once per stroke, not per
  // pointermove — the in-flight line is the ref above, drawn via the tick).
  const [pendingAdds, setPendingAdds] = useState([]);
  const [pendingRemovals, setPendingRemovals] = useState(() => new Set());

  const scope = useMemo(() => ({ env, level: level || '' }), [env, level]);

  /** Strokes to draw: the persisted set for this scope, plus optimistic ones. */
  const strokes = useMemo(() => {
    const inThisScope = (s) => s.env === scope.env && (s.level || '') === scope.level;
    const persisted = (markups || [])
      .map(parseStroke)
      .filter((s) => s && inThisScope(s) && !pendingRemovals.has(s.id));
    const known = new Set(persisted.map((s) => s.id));
    return [...persisted, ...pendingAdds.filter((s) => inThisScope(s) && !known.has(s.id))];
  }, [markups, scope.env, scope.level, pendingAdds, pendingRemovals]);

  // Drop optimistic copies the refetch has now confirmed, so the lists can't
  // grow without bound over a long markup session. This is the "adjust state
  // when a prop changes" pattern rather than an effect: it runs during the same
  // render as the new data instead of scheduling a second one.
  // Both updaters return `prev` untouched when nothing needs dropping, so React
  // bails out instead of scheduling a render for an identical value — the guard
  // above is the fast path, this is what makes a spurious trigger harmless.
  const [seenMarkups, setSeenMarkups] = useState(markups);
  if (markups !== seenMarkups) {
    setSeenMarkups(markups);
    const live = new Set((markups || []).map((m) => m.id));
    setPendingAdds((prev) => (prev.some((s) => live.has(s.id)) ? prev.filter((s) => !live.has(s.id)) : prev));
    setPendingRemovals((prev) =>
      [...prev].every((id) => live.has(id)) ? prev : new Set([...prev].filter((id) => live.has(id)))
    );
  }

  const refresh = useCallback(async () => {
    try { await onChanged(); } catch { /* the shell surfaces fetch errors */ }
  }, [onChanged]);

  // ---------- writes ----------

  const addStroke = useCallback(
    async (points, style) => {
      // Simplify at a fraction of the pen width: below that the deleted samples
      // are inside the line itself, so this is invisible but roughly an order of
      // magnitude fewer points to store, path and print.
      const pts = roundPoints(simplify(points, Math.max(0.4, style.width * 0.25)), 2);
      const tmpId = `tmp:${Date.now()}`;
      const optimistic = { id: tmpId, ...scope, ...style, points: pts, pending: true };
      setPendingAdds((prev) => [...prev, optimistic]);
      try {
        const row = await api.createMarkup(project.id, { ...scope, ...style, points: pts });
        const saved = parseStroke(row);
        // Swap the optimistic copy for the persisted one before the refetch, so
        // the stroke never flickers.
        setPendingAdds((prev) => [...prev.filter((s) => s.id !== tmpId), ...(saved ? [saved] : [])]);
        history.record({
          label: 'markup',
          undo: async () => {
            setPendingRemovals((prev) => new Set(prev).add(row.id));
            setPendingAdds((prev) => prev.filter((s) => s.id !== row.id));
            await api.deleteMarkup(row.id);
            await refresh();
          },
          redo: async () => {
            await api.restoreMarkups(project.id, { markups: [row] });
            setPendingRemovals((prev) => {
              const next = new Set(prev);
              next.delete(row.id);
              return next;
            });
            await refresh();
          },
        });
        await refresh();
      } catch (e) {
        setPendingAdds((prev) => prev.filter((s) => s.id !== tmpId));
        setError(e.message);
      }
    },
    [project.id, scope, history, refresh, setError]
  );

  /** Remove every stroke in the current scope, as one undoable step. */
  const clearScope = useCallback(async () => {
    try {
      const { markups: removed } = await api.clearMarkups(project.id, scope);
      if (!removed?.length) return;
      const ids = removed.map((r) => r.id);
      const forget = () => setPendingRemovals((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      const remember = () => setPendingRemovals((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      remember();
      setPendingAdds((prev) => prev.filter((s) => !ids.includes(s.id)));
      history.record({
        label: 'clear markup',
        undo: async () => {
          await api.restoreMarkups(project.id, { markups: removed });
          forget();
          await refresh();
        },
        redo: async () => {
          await api.clearMarkups(project.id, scope);
          remember();
          await refresh();
        },
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }, [project.id, scope, history, refresh, setError]);

  // ---------- pointer delegates (called by the shell switchyard) ----------

  /**
   * Begin a stroke. Returns true when the ink tool owns this press — which it
   * only ever does while the Markup tool is selected, so pan, marquee, drag and
   * every other gesture arbitrate exactly as before when it is off.
   */
  function markupPointerDown(e) {
    if (!active || e.button !== 0) return false;
    const p = toSvgCoords(e);
    inkRef.current = { ...penRef.current, points: [[p.x, p.y]] };
    setTick((t) => t + 1);
    return true;
  }

  /** Extend the stroke. Returns true while one is in flight. */
  function markupPointerMove(e) {
    const ink = inkRef.current;
    if (!ink) return false;
    const p = toSvgCoords(e);
    const last = ink.points[ink.points.length - 1];
    // Drop samples the pointer barely moved through — freehand hardware emits
    // duplicates when the hand pauses, and they add nothing but path length.
    if (last && Math.abs(p.x - last[0]) < 0.35 && Math.abs(p.y - last[1]) < 0.35) return true;
    ink.points.push([p.x, p.y]);
    setTick((t) => t + 1);
    return true;
  }

  /** Commit the stroke. Returns true when one was in flight. */
  function markupPointerUp() {
    const ink = inkRef.current;
    if (!ink) return false;
    inkRef.current = null;
    setTick((t) => t + 1);
    if (ink.points.length) addStroke(ink.points, { color: ink.color, width: ink.width });
    return true;
  }

  /** Abandon the stroke without committing it — Escape, or a pointercancel. */
  function markupCancel() {
    if (!inkRef.current) return false;
    inkRef.current = null;
    setTick((t) => t + 1);
    return true;
  }

  /**
   * Re-anchor every stroke through a drawing-SCALE change. The shell zooms all
   * persisted layouts about the viewport centre; ink has to ride along or it
   * silently drifts off the plan the first time someone switches 1:500 → 1:1000.
   *
   * @param {(stroke: object) => object} tx Applies scaleStroke for this change.
   */
  const rescaleAll = useCallback(
    async (tx) => {
      const rows = (markups || []).map(parseStroke).filter(Boolean);
      if (!rows.length) return;
      await Promise.all(
        rows.map((s) => {
          const next = tx(s);
          return api
            .updateMarkup(s.id, { points: roundPoints(next.points, 2), width: next.width, color: next.color })
            .catch(() => null); // a failed stroke must not abort the scale change
        })
      );
    },
    [markups]
  );

  return {
    pen, setPen, strokes, inkRef,
    markupPointerDown, markupPointerMove, markupPointerUp, markupCancel,
    clearScope, rescaleAll,
    hasMarkup: strokes.length > 0,
  };
}
