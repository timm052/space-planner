import { useRef, useState } from 'react';

/**
 * Draggable compass rose for setting project north.
 * Drag to rotate, double-click to reset to 0°.
 *
 * @param {number}   deg   - Current north angle in degrees (clockwise from up).
 * @param {function} onSet - Called with the new angle as the user drags.
 */
export default function NorthRose({ deg, onSet }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const [live, setLive] = useState(null);
  const shown = live ?? deg;

  function angleFrom(e) {
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const a = (Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180) / Math.PI;
    const norm = ((a % 360) + 360) % 360;
    setLive(norm);
    onSet(norm);
  }

  const rotate = (shown * 1).toFixed(2);
  return (
    <div
      ref={ref}
      className="north-rose"
      title={`Project north — drag to set (currently ${Math.round(shown)}°). Double-click to reset to up.`}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        angleFrom(e);
      }}
      onPointerMove={(e) => dragging.current && angleFrom(e)}
      onPointerUp={() => {
        dragging.current = false;
        setLive(null);
      }}
      onDoubleClick={() => {
        setLive(0);
        onSet(0);
      }}
    >
      <svg viewBox="-22 -22 44 44">
        <circle r="20" className="rose-bg" />
        <g transform={`rotate(${rotate})`}>
          <polygon points="0,-16 5,4 0,0 -5,4" className="rose-needle-n" />
          <polygon points="0,16 5,0 0,4 -5,0" className="rose-needle-s" />
          <text y="-11" className="rose-n">N</text>
        </g>
      </svg>
      <span className="rose-deg">{Math.round(shown)}°</span>
    </div>
  );
}
