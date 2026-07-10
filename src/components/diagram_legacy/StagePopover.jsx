/**
 * Unified floating surface for the diagram stage (layers panel, satellite
 * form, calibrate bar, extras, errors). One chrome implementation:
 * `.stage-popover` surface + optional `.popover-head` (title + ✕) or, with a
 * close handler but no title, an inline ✕ (single-row popovers like errors).
 */
export default function StagePopover({ className = '', title, onClose, children }) {
  return (
    <div className={`stage-popover ${className}`}>
      {title != null && (
        <div className="popover-head">
          <h3>{title}</h3>
          {onClose && (
            <button className="btn small ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
      )}
      {children}
      {title == null && onClose && (
        <button className="btn small ghost popover-close-inline" onClick={onClose} aria-label="Close">
          ✕
        </button>
      )}
    </div>
  );
}
