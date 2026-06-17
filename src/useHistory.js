import { useCallback, useRef, useState } from 'react';

// A tiny command-stack for undo/redo. Each entry is { label, undo, redo } where
// undo/redo are (possibly async) functions that re-apply state through the
// normal API + refetch path. Recording a new action clears the redo stack.
//
// Closures should resolve mutable state (e.g. the current adjacency for a pair)
// at call time via refs, not capture stale snapshots — see BubbleTab's setPair.
export function useHistory(limit = 60) {
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const busy = useRef(false);
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);

  const record = useCallback(
    (entry) => {
      undoStack.current.push(entry);
      if (undoStack.current.length > limit) undoStack.current.shift();
      redoStack.current = [];
      bump();
    },
    [limit]
  );

  const undo = useCallback(async () => {
    if (busy.current) return;
    const entry = undoStack.current.pop();
    if (!entry) return;
    busy.current = true;
    bump();
    try {
      await entry.undo();
      redoStack.current.push(entry);
    } catch {
      // The recorded state is no longer applicable (e.g. a space was deleted).
      // Drop the entry rather than wedge the stack.
    } finally {
      busy.current = false;
      bump();
    }
  }, []);

  const redo = useCallback(async () => {
    if (busy.current) return;
    const entry = redoStack.current.pop();
    if (!entry) return;
    busy.current = true;
    bump();
    try {
      await entry.redo();
      undoStack.current.push(entry);
    } catch {
      /* entry no longer applicable */
    } finally {
      busy.current = false;
      bump();
    }
  }, []);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    bump();
  }, []);

  return {
    record,
    undo,
    redo,
    clear,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undoLabel: undoStack.current[undoStack.current.length - 1]?.label,
    redoLabel: redoStack.current[redoStack.current.length - 1]?.label,
  };
}
