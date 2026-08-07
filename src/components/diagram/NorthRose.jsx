import { useRef, useState } from 'react';

// Wrap any bearing into [0, 360).
const wrap = (d) => ((d % 360) + 360) % 360;

/**
 * Compass rose. North is ANCHORED to the site imagery: a retrieved satellite
 * image is north-up, so the needle tracks the image (project north follows the
 * image if the layer is rotated). With site imagery present ("design mode"),
 * dragging the rose rotates the DESIGN rigidly about the site centre — the
 * image and the needle stay put, the scheme turns onto the site. Without site
 * imagery it falls back to plain north annotation. The padlock freezes north
 * entirely: the rose goes inert and nothing may move the bearing.
 *
 * @param {number}   deg          - North bearing in degrees (clockwise from up).
 * @param {boolean}  designMode   - Site imagery present: drag rotates the design.
 * @param {boolean}  locked       - North is locked: all rose gestures disabled.
 * @param {function} onToggleLock - Padlock clicked — flip the lock.
 * @param {function} onSet        - Annotation fallback: set north directly while dragging.
 * @param {function} onDragStart  - Design mode: a rotation gesture begins.
 * @param {function} onDragRotate - Design mode: incremental delta (degrees) while dragging.
 * @param {function} onDragEnd    - Design mode: gesture released — commit the turn.
 */
export default function NorthRose({ deg, designMode = false, locked = false, onToggleLock, onSet, onDragStart, onDragRotate, onDragEnd }) {
  const ref = useRef(null);
  const dragging = useRef(null); // { lastAng } | null
  const [live, setLive] = useState(null); // annotation mode: needle follows the drag
  const [turn, setTurn] = useState(null); // design mode: cumulative turn readout
  const shown = wrap(live ?? deg ?? 0);
  // Round for display, then wrap again so 359.7° reads 0°, never 360°.
  const shownDeg = Math.round(shown) % 360;

  function angleFrom(e) {
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return wrap((Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180) / Math.PI);
  }

  const title = locked
    ? `North is locked at ${shownDeg}°. Click the padlock to unlock.`
    : designMode
      ? `North is anchored to the site image (${shownDeg}°). Drag to rotate the DESIGN about the site centre — the image stays put, the scheme turns onto it.`
      : `Project north — drag to set (currently ${shownDeg}°). Double-click to reset to up.`;

  return (
    <div
      ref={ref}
      className={`north-rose${locked ? ' locked' : ''}`}
      title={title}
      onPointerDown={(e) => {
        if (locked) return;
        const ang = angleFrom(e);
        dragging.current = { lastAng: ang };
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
        if (designMode) {
          setTurn(0);
          onDragStart?.();
        }
        // Deliberately NOT setting north here. Calling onSet on press snapped
        // north to wherever the dial happened to be clicked, so a stray click
        // rotated the project before the user had dragged anything. The first
        // move commits.
      }}
      onPointerMove={(e) => {
        const d = dragging.current;
        if (!d) return;
        const ang = angleFrom(e);
        if (designMode) {
          // Incremental, shortest-way delta so crossing 0° never jumps 360.
          let delta = ang - d.lastAng;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          d.lastAng = ang;
          setTurn((t) => (t ?? 0) + delta);
          onDragRotate?.(delta);
        } else {
          setLive(ang);
          onSet?.(ang);
        }
      }}
      onPointerUp={() => {
        if (!dragging.current) return;
        dragging.current = null;
        setLive(null);
        if (designMode) {
          setTurn(null);
          onDragEnd?.();
        }
      }}
      onDoubleClick={() => {
        if (locked || designMode) return; // anchored/locked north has nothing to reset
        setLive(0);
        onSet?.(0);
      }}
    >
      <svg viewBox="-22 -22 44 44">
        <circle r="20" className="rose-bg" />
        <g transform={`rotate(${shown.toFixed(2)})`}>
          <polygon points="0,-16 5,4 0,0 -5,4" className="rose-needle-n" />
          <polygon points="0,16 5,0 0,4 -5,0" className="rose-needle-s" />
          <text y="-11" className="rose-n">N</text>
        </g>
      </svg>
      {onToggleLock && (
        <button
          type="button"
          className="rose-lock"
          title={locked ? 'Unlock north' : 'Lock north (freeze the bearing and the rose)'}
          aria-label={locked ? 'Unlock north' : 'Lock north'}
          aria-pressed={locked}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
        >
          {locked ? '🔒' : '🔓'}
        </button>
      )}
      <span className="rose-deg">
        {turn != null ? `${turn >= 0 ? '+' : ''}${Math.round(turn)}°` : `${shownDeg}°`}
      </span>
    </div>
  );
}
