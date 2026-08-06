// The app's one confirmation dialog — a promise-based replacement for the
// native window.confirm calls that clashed with the design language. Usage:
//
//   if (!(await confirmDialog({ title: 'Delete project', body: '…' }))) return;
//
// <ConfirmHost /> is mounted ONCE in App.jsx; confirmDialog() queues a request
// on it and resolves true (confirm) / false (cancel). Keyboard mirrors the
// native dialog: Enter confirms, Escape cancels. The Cancel button takes
// initial focus — destructive-safe by default.

import { useEffect, useRef, useState } from 'react';
import { Overlay } from './ui.jsx';

let hostRequest = null; // set by ConfirmHost on mount

export function confirmDialog({ title = 'Are you sure?', body = '', confirmLabel = 'Delete', danger = true } = {}) {
  // No host mounted (tests render views standalone) → behave like an accepted
  // native confirm so callers never hang.
  if (!hostRequest) return Promise.resolve(true);
  return hostRequest({ title, body, confirmLabel, danger });
}

export function ConfirmHost() {
  const [req, setReq] = useState(null); // { opts, resolve } | null
  const cancelRef = useRef(null);

  useEffect(() => {
    hostRequest = (opts) =>
      new Promise((resolve) => {
        // A second confirm while one is open cancels the first — cannot happen
        // through the UI (the overlay blocks it), but never leave a promise hanging.
        setReq((cur) => {
          cur?.resolve(false);
          return { opts, resolve };
        });
      });
    return () => { hostRequest = null; };
  }, []);

  // Focus Cancel when the dialog opens; Enter/Escape settle it.
  useEffect(() => {
    if (!req) return;
    cancelRef.current?.focus();
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settle(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); settle(true); }
    }
    // Capture phase so Escape doesn't also dismiss UI layered underneath.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  function settle(ok) {
    req?.resolve(ok);
    setReq(null);
  }

  if (!req) return null;
  const { title, body, confirmLabel, danger } = req.opts;
  return (
    <Overlay title={title} onClose={() => settle(false)}>
      {body && <p className="modal-body">{body}</p>}
      <div className="modal-actions">
        <button className={`btn ${danger ? 'danger solid' : 'primary'}`} type="button" onClick={() => settle(true)}>
          {confirmLabel}
        </button>
        <button className="btn ghost" type="button" ref={cancelRef} onClick={() => settle(false)}>
          Cancel
        </button>
      </div>
    </Overlay>
  );
}
