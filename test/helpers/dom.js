// Boots a jsdom environment so component tests can really MOUNT components
// (effects, refs, event handlers) instead of rendering static SSR markup.
// Import this module FIRST in a test file — react-dom/client reads window and
// document when components mount, and ESM executes imports in declaration
// order, so `import './helpers/dom.js'` must precede the react-dom import.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});

const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
for (const key of [
  'HTMLElement',
  'Element',
  'Node',
  'SVGElement',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'getComputedStyle',
  'localStorage',
]) {
  if (window[key] !== undefined) globalThis[key] = window[key];
}
// Node ships its own read-only `navigator` getter; take jsdom's instead.
try {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
} catch {
  /* keep Node's navigator if the property is not configurable */
}

// Tell React 18 that act() is available so it doesn't warn on updates.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// requestAnimationFrame as a MANUAL queue: nothing fires unless a test calls
// flushFrames(). The force simulation (useSimulation) schedules a frame on
// mount; letting it free-run would mutate node positions outside act() and
// make position-sensitive assertions flaky.
const frameQueue = new Map();
let nextFrameId = 1;
globalThis.requestAnimationFrame = (cb) => {
  const id = nextFrameId++;
  frameQueue.set(id, cb);
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  frameQueue.delete(id);
};
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

/** Fire all currently queued animation-frame callbacks, `n` rounds. */
export function flushFrames(n = 1) {
  for (let round = 0; round < n; round++) {
    const pending = [...frameQueue.entries()];
    frameQueue.clear();
    const now = performance.now();
    for (const [, cb] of pending) cb(now);
  }
}

// Fail-safe fetch stub: components should not hit the network from a bare
// mount. Calls are recorded so tests can assert none (or specific ones)
// happened; the response is a benign 204 so api.js resolves to null.
export const fetchCalls = [];
globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url: String(url), options });
  return { ok: true, status: 204, json: async () => null };
};
