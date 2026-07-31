import { api } from '../api.js';

/**
 * Adjacency (relationship link) editing for the diagram.
 *
 * `findPair` reads the latest adjacencies via a ref so undo closures stay
 * correct after a refetch reassigns adjacency ids. Extracted verbatim from
 * BubbleTab — no behaviour change. Selection-coupled actions (onLinkClick,
 * removeSelLink) stay in the shell and call setLinkStrength here.
 *
 * @param {object} params
 * @param {object}   params.project   - Current project (for id).
 * @param {React.MutableRefObject} params.adjRef - Latest adjacencies, for history closures.
 * @param {object}   params.history   - useHistory() command stack.
 * @param {function} params.onChanged - Refetch trigger after a write.
 * @param {function} params.setError  - Error-message state setter.
 */
export function useLinks({ project, adjRef, history, onChanged, setError }) {
  // findPair reads the latest adjacencies via a ref so history closures stay
  // correct after a refetch reassigns adjacency ids. Instance-aware: a link
  // targets a specific instance of each space (ia/ib, default 0 = the first/
  // only room). count=1 spaces are always instance 0, so 2-arg callers (matrix,
  // click-then-click) keep working unchanged.
  const iOf = (l, side) => (side === 'a' ? l.inst_a ?? 0 : l.inst_b ?? 0);
  const findPair = (a, b, ia = 0, ib = 0) =>
    adjRef.current.find(
      (l) =>
        (l.space_a === a && l.space_b === b && iOf(l, 'a') === ia && iOf(l, 'b') === ib) ||
        (l.space_a === b && l.space_b === a && iOf(l, 'a') === ib && iOf(l, 'b') === ia)
    );

  // Drive a specific instance pair to a target strength: null | 'desired' | 'required'.
  async function setPair(a, b, target, ia = 0, ib = 0) {
    const existing = findPair(a, b, ia, ib);
    if (target == null) {
      if (existing) await api.deleteAdjacency(existing.id);
    } else if (!existing) {
      await api.createAdjacency(project.id, { space_a: a, space_b: b, inst_a: ia, inst_b: ib, strength: target });
    } else if (existing.strength !== target) {
      await api.updateAdjacency(existing.id, { strength: target });
    }
    onChanged();
  }

  async function cyclePair(a, b, ia = 0, ib = 0) {
    const cur = findPair(a, b, ia, ib)?.strength ?? null;
    const next = cur == null ? 'desired' : cur === 'desired' ? 'required' : null;
    history.record({ label: 'link', undo: () => setPair(a, b, cur, ia, ib), redo: () => setPair(a, b, next, ia, ib) });
    setError(null);
    try {
      await setPair(a, b, next, ia, ib);
    } catch (err) {
      setError(err.message);
    }
  }

  // Create or set an instance pair to a strength (undoable). Link mode + action bar.
  async function setLinkStrength(a, b, strength, ia = 0, ib = 0) {
    const cur = findPair(a, b, ia, ib)?.strength ?? null;
    if (cur === strength) return;
    history.record({ label: strength ? 'link' : 'remove link', undo: () => setPair(a, b, cur, ia, ib), redo: () => setPair(a, b, strength, ia, ib) });
    setError(null);
    try {
      await setPair(a, b, strength, ia, ib);
    } catch (err) {
      setError(err.message);
    }
  }
  const createLink = (a, b, strength = 'desired', ia = 0, ib = 0) => setLinkStrength(a, b, strength, ia, ib);
  return { findPair, setPair, cyclePair, setLinkStrength, createLink };
}
