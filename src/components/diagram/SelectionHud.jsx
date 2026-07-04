import { fmtArea } from '../../compute.js';

const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
);

const LinkGlyph = () => (
  <span className="action-glyph">
    <svg width="15" height="15" viewBox="0 0 24 24" style={{ color: 'var(--accent2)' }}><circle cx="6" cy="17" r="3" fill="currentColor" /><circle cx="18" cy="7" r="3" fill="currentColor" /><line x1="8" y1="15" x2="16" y2="9" stroke="currentColor" strokeWidth="2" /></svg>
  </span>
);

/**
 * The one contextual action bar at the bottom-centre of the stage — link
 * form, link-mode form, multi form or single-room form depending on the
 * current selection — plus the contextual hint shown when nothing is
 * selected. Pure chrome: every decision is driven by props.
 */
export default function SelectionHud({
  // link selected
  selLink,
  byId,
  findPair,
  onSetLinkStrength,
  onRemoveLink,
  // link mode
  tool,
  linkFrom,
  linkKind,
  onLinkKind,
  // multi selection
  multi,
  onMultiPin,
  onMultiShape,
  onMultiCustomShape,
  catDraft,
  setCatDraft,
  onMultiSetCategory,
  onMultiDelete,
  departments,
  // single room
  selectedSpace,
  selectedInst,
  instPin,
  shapeOf,
  editShape,
  colorOf,
  ea,
  units,
  onPin,
  onToggleShape,
  onEditShape,
  onSetCategory,
  onRemoveSpace,
  // hint
  rotateLayer,
  moveLayer,
  panActive,
  effScale,
  scaleLabelFor,
}) {
  const bar = (() => {
    // Link selected → link form.
    if (selLink) {
      const a = byId.get(selLink.space_a);
      const b = byId.get(selLink.space_b);
      const cur = findPair(selLink.space_a, selLink.space_b)?.strength ?? null;
      return (
        <div className="action-bar" onClick={(e) => e.stopPropagation()}>
          <LinkGlyph />
          <span className="action-name">{a?.name} — {b?.name}</span>
          <span className="seg seg-sm">
            <button className={cur === 'desired' ? 'active' : ''} onClick={() => onSetLinkStrength(selLink.space_a, selLink.space_b, 'desired')}>Desired</button>
            <button className={cur === 'required' ? 'active' : ''} onClick={() => onSetLinkStrength(selLink.space_a, selLink.space_b, 'required')}>Required</button>
          </span>
          <button className="action-btn danger" onClick={onRemoveLink} title="Remove link">Remove</button>
        </div>
      );
    }
    // Link mode (no link selected) → choose the type new links get.
    if (tool === 'link') {
      return (
        <div className="action-bar" onClick={(e) => e.stopPropagation()}>
          <LinkGlyph />
          <span className="action-name">{linkFrom != null ? 'Pick the second room' : 'New link'}</span>
          <span className="seg seg-sm">
            <button className={linkKind === 'desired' ? 'active' : ''} onClick={() => onLinkKind('desired')}>Desired</button>
            <button className={linkKind === 'required' ? 'active' : ''} onClick={() => onLinkKind('required')}>Required</button>
          </span>
        </div>
      );
    }
    // Multiple rooms → batch form.
    if (multi.size > 1) {
      return (
        <div className="action-bar" onClick={(e) => e.stopPropagation()}>
          <span className="action-count">{multi.size}</span>
          <span className="action-name">rooms selected</span>
          <button className="action-btn" onClick={() => onMultiPin(true)} title="Pin all — P">📌 Pin all</button>
          <button className="action-btn" onClick={() => onMultiShape('box')} title="Box all — B">▢ Box all</button>
          <button className="action-btn" onClick={onMultiCustomShape} title="Freeform shape all — S">✎ Shape all</button>
          <input
            className="action-cat"
            list="diagram-categories"
            placeholder="Category…"
            value={catDraft}
            onChange={(e) => setCatDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onMultiSetCategory(catDraft); }}
          />
          <datalist id="diagram-categories">
            {departments.map((d) => <option key={d} value={d} />)}
          </datalist>
          <button className="action-btn icon danger" onClick={onMultiDelete} title="Remove all (Del)" aria-label="Remove all">
            <TrashIcon />
          </button>
        </div>
      );
    }
    // Single room → room form.
    const sel = selectedSpace;
    if (!sel) return null;
    const selCount = Math.max(1, sel.count || 1);
    const selInstPinned = !!instPin(sel, selectedInst);
    const selBox = shapeOf(sel) === 'box';
    const editingSel = editShape === sel.id;
    return (
      <div className="action-bar" onClick={(e) => e.stopPropagation()}>
        <span className="swatch" style={{ background: colorOf(sel) }} />
        <span className="action-name">{sel.name}{selCount > 1 ? ` ${selectedInst + 1}` : ''}</span>
        <span className="action-area mono">{fmtArea(ea(sel), units)}</span>
        <button className={`action-btn ${selInstPinned ? 'active' : ''}`} onClick={() => onPin(sel, selectedInst, !selInstPinned)} title="Pin — P">📌 {selInstPinned ? 'Unpin' : 'Pin'}</button>
        <button className={`action-btn ${selBox ? 'active' : ''}`} onClick={() => onToggleShape(sel)} title="Box — B">{selBox ? '○ Bubble' : '▢ Box'}</button>
        <button className={`action-btn ${editingSel ? 'active' : ''}`} onClick={() => onEditShape(sel)} title="Freeform shape — S">✎ {editingSel ? 'Done' : 'Shape'}</button>
        <input
          className="action-cat"
          list="diagram-categories"
          placeholder="Category"
          defaultValue={sel.department || ''}
          key={sel.id + ':' + (sel.department || '')}
          onKeyDown={(e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v && v !== sel.department) onSetCategory(sel, v); } }}
          title="Reassign category (Enter to apply)"
        />
        <datalist id="diagram-categories">
          {departments.map((d) => <option key={d} value={d} />)}
        </datalist>
        <button className="action-btn icon danger" onClick={() => onRemoveSpace(sel)} title="Remove (Del)" aria-label="Remove">
          <TrashIcon />
        </button>
      </div>
    );
  })();

  if (bar) return bar;

  // Contextual hint — hidden while an action bar is showing.
  if (!(multi.size === 0 && tool !== 'link')) return null;
  return (
    <div className="stage-hint">
      {rotateLayer
        ? 'Rotating image — drag the canvas to turn it. Toggle Rotate off when done.'
        : moveLayer
        ? 'Moving image layer — drag the canvas to reposition it.'
        : panActive
        ? 'Pan — drag the canvas. Release Space (or toggle Pan off) to edit.'
        : 'Click a room to select · drag to move · Shift-click for several · hold Space to pan · press ? for shortcuts' +
          (effScale ? ` · ${scaleLabelFor(effScale)}` : '')}
    </div>
  );
}
