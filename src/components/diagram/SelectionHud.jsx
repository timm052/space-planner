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
  // environment — the freeform-polygon control shows only in Master plan (its
  // geometry is a drawn footprint); Building shows a 90° rotate instead and hides
  // Pin (no sim to protect against).
  showShapeTools,
  showRotate90,
  onRotate90,
  // Master plan — numeric rotation for a drawn footprint (the ⟲ drag handle
  // stays for freehand; this is the precise way in).
  showRotateInput,
  rotOf,
  onRotateTo,
  showPin,
  // Building env — per-space clear height (m); empty inherits the storey's.
  showHeight,
  heightOf,
  onHeight,
  // Building env — move the room (or the whole selection) to another floor.
  levelsFor = null, // storey labels | null to hide
  onLevel,
  onMultiLevel,
  // envelope master plan — the selected unit is a building: show its drawn
  // footprint (editable, area-locks the outline) against the required one,
  // plus "shape it like its concept hull".
  envelope,
  onEnvelopeArea,
  onEnvelopeHull,
  onEnvelopeCirc,
  // corner styles while editing a custom shape (curve / fillet / sharp,
  // applied to every corner — right-click a single handle to change just it).
  onSetCorners,
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
  editShape,
  colorOf,
  ea,
  units,
  onPin,
  onEditShape,
  onSetCategory,
  onRemoveSpace,
  // hint
  rotateLayer,
  moveLayer,
  panActive,
  idleHint,
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
          {showPin && <button className="action-btn" onClick={() => onMultiPin(true)} title="Pin all — P">📌 Pin all</button>}
          {showShapeTools && <button className="action-btn" onClick={onMultiCustomShape} title="Freeform shape all — S">✎ Shape all</button>}
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
          {levelsFor && (
            <select
              className="action-level-sel"
              value=""
              onChange={(e) => e.target.value && onMultiLevel(e.target.value)}
              title="Move every selected room to a floor"
            >
              <option value="">▤ Floor…</option>
              {levelsFor.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          <button className="action-btn icon danger" onClick={onMultiDelete} title="Remove all (Del)" aria-label="Remove all">
            <TrashIcon />
          </button>
        </div>
      );
    }
    // Single room (or building envelope) → room form.
    const sel = selectedSpace;
    if (!sel) return null;
    const selCount = Math.max(1, sel.count || 1);
    const selInstPinned = !!instPin(sel, selectedInst);
    const editingSel = editShape === sel.id;
    const envDeficit = envelope && envelope.drawn < envelope.required - 0.5;
    return (
      <div className="action-bar" onClick={(e) => e.stopPropagation()}>
        <span className="swatch" style={{ background: colorOf(sel) }} />
        <span className="action-name">{envelope ? '🏢 ' : ''}{sel.name}{selCount > 1 ? ` ${selectedInst + 1}` : ''}</span>
        {envelope ? (
          <>
            <input
              className="action-env-area"
              type="number"
              min="1"
              step="any"
              key={sel.id + ':' + Math.round(envelope.drawn)}
              defaultValue={Math.round(envelope.drawn)}
              onKeyDown={(e) => { if (e.key === 'Enter') onEnvelopeArea(sel, selectedInst, e.target.value); }}
              onBlur={(e) => { if (Number(e.target.value) !== Math.round(envelope.drawn)) onEnvelopeArea(sel, selectedInst, e.target.value); }}
              title="Envelope footprint area (Enter to apply) — the outline stays area-locked to it"
            />
            <span className={`action-env-req mono ${envDeficit ? 'bad' : ''}`} title="Required GROSS footprint — the building's biggest storey plus its circulation share">
              needs ≥ {fmtArea(envelope.required, units)}
            </span>
            {onEnvelopeCirc && (
              <label className="action-height" title="Circulation share of the gross footprint (%). Empty = the project's net:gross default; 0 = off. Grosses up the required footprint and hatches the spare interior in the room sketch.">
                <span className="muted">⤨</span>
                <input
                  type="number"
                  min="0"
                  max="60"
                  step="1"
                  key={sel.id + ':' + (sel.circ_pct ?? '')}
                  defaultValue={sel.circ_pct != null ? Math.round(sel.circ_pct * 100) : ''}
                  placeholder={String(Math.round(envelope.circ * 100))}
                  onKeyDown={(e) => { if (e.key === 'Enter') onEnvelopeCirc(sel, e.target.value); }}
                  onBlur={(e) => { const cur = sel.circ_pct != null ? String(Math.round(sel.circ_pct * 100)) : ''; if ((e.target.value || '') !== cur) onEnvelopeCirc(sel, e.target.value); }}
                />
                <span className="muted">%</span>
              </label>
            )}
          </>
        ) : (
          <span className="action-area mono">{fmtArea(ea(sel), units)}</span>
        )}
        {levelsFor && !envelope && (
          <label className="action-height action-level" title="Which floor this room belongs to — moving it keeps its plan position">
            <span className="muted">▤</span>
            <select value={(sel.level || '').trim()} onChange={(e) => onLevel(sel, e.target.value)}>
              {(sel.level || '').trim() === '' && <option value="">Unassigned</option>}
              {levelsFor.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        {showHeight && !envelope && (
          <label className="action-height" title="Clear height in metres (Enter to apply). Empty = the floor's height; taller than the storey = a double-height / multi-floor volume.">
            <span className="muted">↥</span>
            <input
              type="number"
              min="1"
              max="50"
              step="0.1"
              key={sel.id + ':' + (sel.height_m ?? '')}
              defaultValue={sel.height_m ?? ''}
              placeholder={String(heightOf(sel))}
              onKeyDown={(e) => { if (e.key === 'Enter') onHeight(sel, e.target.value); }}
              onBlur={(e) => { if ((e.target.value || '') !== String(sel.height_m ?? '')) onHeight(sel, e.target.value); }}
            />
            <span className="muted">m</span>
          </label>
        )}
        {showPin && <button className={`action-btn ${selInstPinned ? 'active' : ''}`} onClick={() => onPin(sel, selectedInst, !selInstPinned)} title="Pin — P">📌 {selInstPinned ? 'Unpin' : 'Pin'}</button>}
        {showShapeTools && <button className={`action-btn ${editingSel ? 'active' : ''}`} onClick={() => onEditShape(sel)} title="Freeform shape — S">✎ {editingSel ? 'Done' : 'Shape'}</button>}
        {envelope && (
          <button
            className="action-btn"
            onClick={() => onEnvelopeHull(sel)}
            title="Reshape this envelope to match its building's hull in the Concept view (the outline stays area-locked)"
          >⬡ Hull</button>
        )}
        {editingSel && onSetCorners && (
          <span className="seg seg-sm" title="Corner style for every corner — right-click a single handle to change just that one">
            <button onClick={() => onSetCorners(sel, 'c')} title="Curves — smooth through every corner">◠ Curve</button>
            <button onClick={() => onSetCorners(sel, 'f')} title="Fillets — tight rounding at every corner">⌒ Fillet</button>
            <button onClick={() => onSetCorners(sel, 's')} title="Sharp — true corners everywhere">∟ Sharp</button>
          </span>
        )}
        {showRotate90 && <button className="action-btn" onClick={() => onRotate90(sel, selectedInst)} title="Rotate 90°">⟲ 90°</button>}
        {showRotateInput && (
          <label className="action-rot" title="Rotation in degrees (Enter to apply) — drag the ⟲ handle for freehand">
            <span className="muted">⟲</span>
            <input
              type="number"
              min="-360"
              max="360"
              step="1"
              key={sel.id + ':' + selectedInst + ':' + Math.round(rotOf(sel, selectedInst))}
              defaultValue={Math.round(rotOf(sel, selectedInst))}
              onKeyDown={(e) => { if (e.key === 'Enter') onRotateTo(sel, selectedInst, e.target.value); }}
              onBlur={(e) => { if (Number(e.target.value) !== Math.round(rotOf(sel, selectedInst))) onRotateTo(sel, selectedInst, e.target.value); }}
            />
            <span className="muted">°</span>
          </label>
        )}
        {!envelope && (
          <input
            className="action-cat"
            list="diagram-categories"
            placeholder="Category"
            defaultValue={sel.department || ''}
            key={sel.id + ':' + (sel.department || '')}
            onKeyDown={(e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v && v !== sel.department) onSetCategory(sel, v); } }}
            title="Reassign category (Enter to apply)"
          />
        )}
        <datalist id="diagram-categories">
          {departments.map((d) => <option key={d} value={d} />)}
        </datalist>
        {!envelope && (
          <button className="action-btn icon danger" onClick={() => onRemoveSpace(sel)} title="Remove (Del)" aria-label="Remove">
            <TrashIcon />
          </button>
        )}
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
        : idleHint || 'Click a room to select · drag to move · Shift-click for several · hold Space to pan · press ? for shortcuts'}
    </div>
  );
}
