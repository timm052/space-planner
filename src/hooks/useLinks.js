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
  // correct after a refetch reassigns adjacency ids.
  const findPair = (a, b) =>
    adjRef.current.find((l) => (l.space_a === a && l.space_b === b) || (l.space_a === b && l.space_b === a));

  // Drive a pair to a target strength: null (none) | 'desired' | 'required'.
  async function setPair(a, b, target) {
    const existing = findPair(a, b);
    if (target == null) {
      if (existing) await api.deleteAdjacency(existing.id);
    } else if (!existing) {
      await api.createAdjacency(project.id, { space_a: a, space_b: b, strength: target });
    } else if (existing.strength !== target) {
      await api.updateAdjacency(existing.id, { strength: target });
    }
    onChanged();
  }

  async function cyclePair(a, b) {
    const cur = findPair(a, b)?.strength ?? null;
    const next = cur == null ? 'desired' : cur === 'desired' ? 'required' : null;
    history.record({ label: 'link', undo: () => setPair(a, b, cur), redo: () => setPair(a, b, next) });
    setError(null);
    try {
      await setPair(a, b, next);
    } catch (err) {
      setError(err.message);
    }
  }

  // Create or set a pair to a strength (undoable). Used by Link mode + action bar.
  async function setLinkStrength(a, b, strength) {
    const cur = findPair(a, b)?.strength ?? null;
    if (cur === strength) return;
    history.record({ label: strength ? 'link' : 'remove link', undo: () => setPair(a, b, cur), redo: () => setPair(a, b, strength) });
    setError(null);
    try {
      await setPair(a, b, strength);
    } catch (err) {
      setError(err.message);
    }
  }
  const createLink = (a, b, strength = 'desired') => setLinkStrength(a, b, strength);
  return { findPair, setPair, cyclePair, setLinkStrength, createLink };
}
