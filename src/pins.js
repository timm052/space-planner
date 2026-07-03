import { pinsOf } from './geometry.js';

/**
 * Build the { before, after } field patch that rewrites some of a space's
 * per-instance pins (positions persisted in `pin_json`, legacy `pin_x/pin_y`
 * always cleared). This is the boilerplate every pin action shares —
 * drag-save, pin/unpin, pin-all, multi-pin and group-move differ only in what
 * the next pin for an instance should be, so that is a callback:
 *
 *   nextPin(i, prev) → pin object ({ x, y, locked? }) to set, or null to clear.
 *
 * Returns { before, after, touched } where `touched` maps instance index →
 * the new pin (or null), for optimistic pinOverride updates.
 */
export function pinPatch(space, idxs, nextPin) {
  const pins = { ...pinsOf(space) };
  const touched = {};
  for (const i of idxs) {
    const np = nextPin(i, pins[i] ?? null);
    if (np) pins[i] = np;
    else delete pins[i];
    touched[i] = np;
  }
  return {
    before: { pin_json: space.pin_json ?? null, pin_x: space.pin_x ?? null, pin_y: space.pin_y ?? null },
    after: { pin_json: JSON.stringify(pins), pin_x: null, pin_y: null },
    touched,
  };
}
