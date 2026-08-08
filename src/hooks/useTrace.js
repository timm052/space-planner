import { useCallback, useMemo, useRef, useState } from 'react';
import { traceCandidates, pickCandidate, areaFromRing } from '../trace.js';
import { M2_PER_FT2 } from '../compute.js';

/**
 * The Trace tool: promote an enclosed path in an imported drawing into a room
 * the schedule counts.
 *
 * An import lands as reference geometry that never touches a total, which is
 * the right default — the app cannot know what an imported circle means. But
 * the rooms are already drawn on the file you imported, and re-typing their
 * areas into the schedule is exactly the hand work the import was meant to
 * remove. This is the bridge: click a ring, and it stops being reference and
 * starts being programme.
 *
 * Selection, hit-testing and the arithmetic live in trace.js (pure, tested).
 * This hook owns the tool's STATE — what is under the cursor, what the click
 * targets — and delegates the write to the shell, which is where the knowledge
 * of layout columns and undo entries already lives.
 *
 * @param {object}   params
 * @param {Array}    params.strokes     Parsed strokes for the current scope.
 * @param {boolean}  params.active      Is the Trace tool selected?
 * @param {number}   params.effScale    Metres per diagram unit; null = no scale.
 * @param {string}   params.units       Project area units.
 * @param {function} params.toSvgCoords Screen → diagram units.
 * @param {function} params.onTrace     (candidate, areaPU) → Promise; the write.
 * @param {function} params.setTick     Canvas re-render trigger.
 */
export function useTrace({ strokes, active, effScale, units, toSvgCoords, onTrace, setTick }) {
  // Which ring the cursor is over. A ref as well as state: the canvas reads it
  // through the tick like every other live gesture, while the tray reads the
  // state to show the area you are about to commit to.
  const hoverRef = useRef(null);
  const [hover, setHover] = useState(null);

  /**
   * Every enclosed imported ring in scope, smallest first.
   *
   * Computed whether or not the tool is active, because whether there is
   * anything to trace is what decides if the tool is OFFERED at all — gating
   * this on `active` makes the button appear only once you have pressed it.
   * Memoised on the stroke set, so a large import pays for this once per
   * change rather than once per render.
   */
  const candidates = useMemo(() => traceCandidates(strokes), [strokes]);

  /** What a ring would be worth, in project units. Null without a scale — an
   *  area needs real units, and guessing one is worse than refusing. */
  const areaOf = useCallback(
    (cand) => (cand && effScale > 0 ? areaFromRing(cand.ring, effScale, units, M2_PER_FT2) : null),
    [effScale, units]
  );

  const setHoverTo = useCallback((cand) => {
    const id = cand?.id ?? null;
    if ((hoverRef.current?.id ?? null) === id) return;
    hoverRef.current = cand;
    setHover(cand);
    setTick((t) => t + 1);
  }, [setTick]);

  /**
   * Claim the press. Returns true whenever the tool is live — including on
   * open ground, where the answer is "nothing here". A modal tool that let a
   * miss fall through to the marquee would start rubber-banding a selection
   * the tool has no use for.
   */
  function tracePointerDown(e) {
    if (!active || e.button !== 0) return false;
    const cand = pickCandidate(candidates, toSvgCoords(e));
    if (cand) onTrace(cand, areaOf(cand));
    return true;
  }

  /** Track what is under the cursor. Never claims the event: with no drag in
   *  flight there is nothing to own, and hovering must not block a pan. */
  function tracePointerMove(e) {
    if (!active) return false;
    setHoverTo(pickCandidate(candidates, toSvgCoords(e)));
    return false;
  }

  /** Drop the highlight — leaving the canvas, or leaving the tool. */
  function traceCancel() {
    if (!hoverRef.current) return false;
    setHoverTo(null);
    return true;
  }

  return {
    candidates,
    hover,
    hoverRef,
    hoverArea: areaOf(hover),
    areaOf,
    tracePointerDown,
    tracePointerMove,
    traceCancel,
    /** Is there anything here to trace? Drives whether the tool is offered. */
    hasTraceable: candidates.length > 0,
  };
}
