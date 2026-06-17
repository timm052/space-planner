import { useEffect, useRef, useState } from 'react';

// Logical world anchor — spawn origin, gravity centre, image centring.
// Exported so BubbleTab and its sub-components share the same constant.
export const W = 900;
export const H = 620;

/**
 * Tracks the SVG container size (ResizeObserver → vb) and manages the pan
 * offset (view). Provides a stable ref for the view so pointer handlers always
 * read the latest value without stale-closure issues.
 *
 * @param {object} project  - Project row; used to seed the initial view and
 *                            reset when the project changes.
 * @param {React.RefObject} stageRef - Ref attached to the SVG container element.
 * @returns {{ vb, view, viewRef, setView }}
 */
export function useViewport(project, stageRef) {
  const [view, setViewState] = useState({ x: project.view_x || 0, y: project.view_y || 0 });
  const viewRef = useRef(view);

  const setView = (v) => {
    viewRef.current = v;
    setViewState(v);
  };

  // Reset pan when switching projects.
  useEffect(() => {
    const v = { x: project.view_x || 0, y: project.view_y || 0 };
    setView(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const [vb, setVb] = useState({ w: W, h: H });

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 1 && r.height > 1) {
        setVb((prev) =>
          Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
            ? prev
            : { w: Math.round(r.width), h: Math.round(r.height) }
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { vb, view, viewRef, setView };
}
