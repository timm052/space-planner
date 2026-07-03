import { useRef, useSyncExternalStore } from 'react';

/**
 * A tiny external "tick" store that decouples the animation loop from React
 * state. The force simulation and pointer drags mutate node positions in a
 * ref and then call `bump()`; only components subscribed through <TickLayer>
 * re-render — the rest of the diagram chrome (toolbar, rail, popovers) stays
 * untouched at 60 fps.
 *
 * `bump` accepts (and ignores) an argument so it is a drop-in replacement for
 * the old `setTick((t) => t + 1)` state setter.
 */
export function useTickStore() {
  const ref = useRef(null);
  if (!ref.current) {
    let n = 0;
    const listeners = new Set();
    ref.current = {
      bump: () => {
        n++;
        listeners.forEach((l) => l());
      },
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      getSnapshot: () => n,
    };
  }
  return ref.current;
}

/**
 * Re-renders its children whenever the tick store bumps. `children` is a
 * render function so each invocation re-reads the mutable refs (node
 * positions) while closing over the latest committed React state — the parent
 * re-renders this layer normally on real state changes.
 */
export function TickLayer({ store, children }) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return children();
}
