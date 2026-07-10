import { pinsOf } from '../geometry.js';
import { pinPatch } from '../pins.js';

/**
 * Room position + pin/lock persistence for the diagram.
 *
 * A room's SAVED position lives in pin_json (seeds the sim node and survives a
 * reload); a LOCKED room additionally carries `locked: true` and is protected
 * from auto-layout. `pinOverride` holds the optimistic value before a refetch.
 * Extracted verbatim from BubbleTab — no behaviour change.
 *
 * @param {object} params
 * @param {React.MutableRefObject} params.nodesRef    - Live node-position map.
 * @param {React.MutableRefObject} params.pinOverride - Optimistic pin overrides.
 * @param {Map}      params.byId       - Map<spaceId, space>.
 * @param {object}   params.history    - useHistory() command stack.
 * @param {function} params.applySpace - Persist a space field patch (from useSpaceEditing).
 * @param {function} params.commitMany - Batch undoable write (from useSpaceEditing).
 * @param {function} params.setError   - Error-message state setter.
 * @param {Set}      params.multi      - Current multi-selection of instance keys.
 */
export function usePins({ nodesRef, pinOverride, byId, history, applySpace, commitMany, setError, multi }) {
  // A room's SAVED position (persists to pin_json, seeds the sim node). Set by
  // dragging; it does NOT lock the room. pinOverride holds the optimistic value
  // before a refetch. An entry may carry `locked: true`.
  const savedOf = (s, i) => {
    const key = `${s.id}:${i}`;
    if (pinOverride.current.has(key)) return pinOverride.current.get(key);
    return pinsOf(s)[i] ?? null;
  };
  // LOCKED = protected from auto-layout + shows the pin marker. Toggled only by
  // the Pin button / P. A saved-but-unlocked room stays where it was dropped but
  // is free to be rearranged by an auto-layout pass.
  const instLocked = (s, i) => !!savedOf(s, i)?.locked;
  // The simulation's fixed point exists only while a room is locked.
  const instPin = (s, i) => (instLocked(s, i) ? savedOf(s, i) : null);
  const anyPinned = (s) =>
    Array.from({ length: Math.max(1, s.count || 1) }, (_, i) => i).some((i) => instLocked(s, i));

  // Fresh position from the sim node, falling back to the previous pin.
  const nodePos = (space, i, prev) => {
    const n = nodesRef.current.get(`${space.id}:${i}`);
    return n ? { x: n.x, y: n.y } : prev ? { x: prev.x, y: prev.y } : null;
  };
  // Apply a pinPatch: optimistic overrides + undoable persist.
  async function commitPinPatch(space, patch, label) {
    for (const [i, p] of Object.entries(patch.touched)) pinOverride.current.set(`${space.id}:${i}`, p);
    history.record({ label, undo: () => applySpace(space.id, patch.before), redo: () => applySpace(space.id, patch.after) });
    setError(null);
    try {
      await applySpace(space.id, patch.after);
    } catch (err) {
      setError(err.message);
    }
  }
  // Persist a room's position after a drag WITHOUT changing its locked state
  // (a locked room dragged stays locked at its new spot; an unlocked one stays
  // unlocked). This is what makes drags survive a reload without pinning.
  async function saveDragPos(space, idx) {
    if (!nodesRef.current.get(`${space.id}:${idx}`)) return;
    const patch = pinPatch(space, [idx], (i, prev) => {
      const pos = nodePos(space, i, prev);
      return instLocked(space, i) ? { ...pos, locked: true } : pos;
    });
    await commitPinPatch(space, patch, 'move');
  }
  // Lock/unlock a single instance (Pin button / P). Locking captures the current
  // position; unlocking keeps the position but frees it for auto-layout.
  async function savePin(space, idx, locked) {
    const patch = pinPatch(space, [idx], (i, prev) => {
      const pos = nodePos(space, i, prev);
      return pos ? (locked ? { ...pos, locked: true } : pos) : null;
    });
    await commitPinPatch(space, patch, locked ? 'pin' : 'unpin');
  }
  // Pin/unpin every instance of a space at once (so a multiplied space stays put).
  async function savePinAll(space, locked) {
    const idxs = Array.from({ length: Math.max(1, space.count || 1) }, (_, i) => i);
    const patch = pinPatch(space, idxs, (i, prev) => {
      const pos = nodePos(space, i, prev);
      return pos ? (locked ? { ...pos, locked: true } : pos) : null;
    });
    await commitPinPatch(space, patch, locked ? 'pin all' : 'unpin all');
  }
  // Group instance keys by space → { space, idxs } (for batch pin edits).
  function groupKeysBySpace(keys) {
    const bySpace = new Map();
    for (const k of keys) {
      const [id, i] = String(k).split(':');
      const space = byId.get(Number(id));
      if (!space) continue;
      if (!bySpace.has(space.id)) bySpace.set(space.id, { space, idxs: [] });
      bySpace.get(space.id).idxs.push(Number(i));
    }
    return [...bySpace.values()];
  }
  async function multiPin(locked) {
    const changes = groupKeysBySpace([...multi]).map(({ space, idxs }) => {
      const patch = pinPatch(space, idxs, (i, prev) => {
        const pos = nodePos(space, i, prev);
        return pos ? (locked ? { ...pos, locked: true } : pos) : null;
      });
      return { id: space.id, before: patch.before, after: patch.after };
    });
    await commitMany(changes, locked ? 'pin selection' : 'unpin selection');
  }
  // Save a set of instance keys at their current positions (group drag),
  // preserving each pin's locked flag, in one undo step.
  async function pinKeys(keys) {
    const changes = groupKeysBySpace(keys).map(({ space, idxs }) => {
      const patch = pinPatch(space, idxs, (i, prev) => {
        const n = nodesRef.current.get(`${space.id}:${i}`);
        if (!n) return prev; // no node → keep the pin as it was
        return prev?.locked ? { x: n.x, y: n.y, locked: true } : { x: n.x, y: n.y };
      });
      return { id: space.id, before: patch.before, after: patch.after };
    });
    await commitMany(changes, 'move group');
  }
  return { savedOf, instLocked, instPin, anyPinned, nodePos, commitPinPatch, saveDragPos, savePin, savePinAll, multiPin, pinKeys };
}
