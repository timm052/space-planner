// Tiny shared UI primitives. One place to change error/empty markup for the
// whole app (App shell, tabs, rail, popovers).

export function Banner({ kind = 'error', children }) {
  return (
    <div className={`banner ${kind}`} role="alert">
      {children}
    </div>
  );
}

// `action` = optional { label, onClick } — empty states should lead somewhere,
// not dead-end on a sentence that names a button on another tab.
export function Empty({ small = false, action = null, children }) {
  return (
    <div className={`empty${small ? ' small' : ''}`}>
      {children}
      {action && (
        <div className="empty-action">
          <button className="btn small primary" type="button" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}

// Modal shell shared by the Brief/Design dialogs (overwrite preview, import,
// options, revisions…). Click outside or ✕ closes.
export function Overlay({ title, wide = false, children, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-card${wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn small ghost" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
