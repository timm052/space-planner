import { api } from '../api.js';

/**
 * Write primitives for editing brief data from the diagram: apply a field
 * update to a space (and refetch), commit one change or many changes as a
 * single undoable step, and save project-level fields. Extracted verbatim from
 * BubbleTab so every diagram environment shares the same optimistic + undo
 * plumbing.
 *
 * @param {object} params
 * @param {object}   params.project   - Current project (for id).
 * @param {object}   params.history   - useHistory() command stack.
 * @param {function} params.onChanged - Refetch trigger after a write.
 * @param {function} params.setError  - Error-message state setter.
 */
export function useSpaceEditing({ project, history, onChanged, setError }) {
  // Apply field updates to a space and refetch. Returns a promise.
  async function applySpace(id, fields) {
    await api.updateSpace(id, fields);
    onChanged();
  }
  // Apply now and push an undo/redo entry capturing the previous values.
  async function commitSpace(space, fields, label) {
    const before = {};
    for (const k of Object.keys(fields)) before[k] = space[k] ?? null;
    history.record({ label, undo: () => applySpace(space.id, before), redo: () => applySpace(space.id, fields) });
    setError(null);
    try {
      await applySpace(space.id, fields);
    } catch (e) {
      setError(e.message);
    }
  }
  // Batch the same kind of change across many spaces as one undoable step.
  async function commitMany(changes, label) {
    if (changes.length === 0) return;
    const run = (pick) => async () => {
      for (const c of changes) await api.updateSpace(c.id, pick(c));
      onChanged();
    };
    history.record({ label, undo: run((c) => c.before), redo: run((c) => c.after) });
    setError(null);
    try {
      await run((c) => c.after)();
    } catch (e) {
      setError(e.message);
    }
  }
  async function saveProject(fields, { silent } = {}) {
    if (!silent) setError(null);
    try {
      await api.updateProject(project.id, fields);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }
  return { applySpace, commitSpace, commitMany, saveProject };
}
