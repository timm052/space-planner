import { useEffect, useRef, useState } from 'react';

/**
 * The diagram's chrome along the top and left edge: the responsive top bar
 * (view controls left, actions right), the ⋯ "more options" popover, and the
 * tool dock (Select / Link / Auto-layout / Recentre). Chrome-only — none of
 * it re-renders on sim ticks.
 */

/**
 * The toolbar's adjacency-compliance badge. The score depends on live node
 * positions, so instead of computing it on every chrome render (or worse,
 * every sim frame), it subscribes to the tick store and recomputes at most
 * every 300 ms — plus immediately when the underlying data changes.
 */
function AdjacencyBadge({ store, compute, dataKey, active, onToggle }) {
  const computeRef = useRef(compute);
  computeRef.current = compute;
  const [result, setResult] = useState(() => compute());
  const lastRef = useRef(0);
  useEffect(() => {
    setResult(computeRef.current());
  }, [dataKey]);
  useEffect(
    () =>
      store.subscribe(() => {
        const now = performance.now();
        if (now - lastRef.current < 300) return;
        lastRef.current = now;
        setResult(computeRef.current());
      }),
    [store]
  );
  return (
    <button
      className={`adj-badge ${active ? 'active' : ''}`}
      onClick={onToggle}
      title={`${result.met}/${result.total} relationships satisfied — click to highlight the ${result.unmet.length} unmet`}
    >
      <span className="adj-dot" /> {result.score == null ? '—' : `${Math.round(result.score * 100)}%`} adjacency
    </button>
  );
}

// The environment switcher: which stage of the design pipeline is active.
// Each segment carries a live progress sub-status (envStatus) so the switcher
// reads as brief → site → massing progression, not three parallel tabs.
const ENVS = [
  ['concept', '◯ Concept', 'Bubbles & relationships — what relates to what'],
  ['masterplan', '▱ Master plan', 'Building envelopes on the scaled site — what fits where'],
  ['building', '▤ Building', 'Boxes, floors & massing — what stacks inside each building'],
];

export function StageTopbar({
  env,
  onEnv,
  envStatus,
  showLayers,
  hasBuildings,
  colorBy,
  setPref,
  hasLevels,
  floorMode,
  levels,
  show3DToggle,
  is3D,
  onToggle3D,
  showScale,
  scaleValue,
  presets,
  fitScale,
  onScaleSelect,
  interiorLevels = null, // storey labels for the interior-sketch filter (null = hide)
  interiorLevel = 'all',
  onInteriorLevel,
  panel,
  setPanel,
  history,
  showScore,
  tickStore,
  computeAdjacency,
  adjDataKey,
  highlightGaps,
  onToggleGaps,
  onExportPng,
  onExportPdf,
  onExportSet,
  onHelp,
}) {
  return (
    <div className="stage-topbar">
      {/* Top-left control cluster (glass). The environment switcher is the
          primary control and leads the cluster. */}
      <div className="stage-controls">
        <div className="seg seg-env" role="tablist" aria-label="Diagram environment">
          {ENVS.map(([value, label, title]) => (
            <button
              key={value}
              role="tab"
              aria-selected={env === value}
              className={env === value ? 'active' : ''}
              onClick={() => onEnv(value)}
              title={envStatus?.[value] ? `${title} · ${envStatus[value]}` : title}
            >
              <span className="seg-env-label">{label}</span>
              {envStatus?.[value] && <span className="seg-sub">{envStatus[value]}</span>}
            </button>
          ))}
        </div>
        <div className="ctrl-sep" />
        {hasBuildings && (
          <div className="ctrl-field">
            <span className="ctrl-label">Colour</span>
            <div className="seg seg-sm">
              <button className={colorBy === 'department' ? 'active' : ''} onClick={() => setPref('colorBy', 'department')}>Category</button>
              <button className={colorBy === 'building' ? 'active' : ''} onClick={() => setPref('colorBy', 'building')}>Building</button>
            </div>
          </div>
        )}
        {hasLevels && (
          <label className="ctrl-field">
            <span className="ctrl-label">Floors</span>
            <select className="ctrl-select" value={floorMode} onChange={(e) => setPref('floorView', e.target.value)}>
              <option value="all">All floors</option>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
              <option value="offset">Stacked · offset</option>
              <option value="overlaid">Stacked · overlaid</option>
              <option value="3d">Stacked · 3D</option>
            </select>
          </label>
        )}
        {/* Single-level programs get the 3-D massing view as its own toggle —
            it isn't a floor-stacking mode, it's the model of the massing. */}
        {show3DToggle && (
          <button
            className={`ctrl-btn ${is3D ? 'active' : ''}`}
            onClick={onToggle3D}
            aria-pressed={is3D}
            title="3-D massing view — the blocked-up rooms extruded at their real heights"
          >▲ 3-D</button>
        )}
        {/* Scale is a metric concern — it belongs to Master plan / Building.
            Concept is scale-free (relative bubble sizes). */}
        {showScale && (
          <label className="ctrl-field">
            <span className="ctrl-label">Scale</span>
            <select className="ctrl-select" value={scaleValue} onChange={(e) => onScaleSelect(e.target.value)}>
              <option value="auto">{fitScale ? 'Auto' : 'Relative'}</option>
              {presets.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
              {scaleValue !== 'auto' && !presets.some(([r]) => String(r) === scaleValue) && <option value={scaleValue}>≈ 1:{scaleValue}</option>}
            </select>
          </label>
        )}
        {showLayers && (
          <button className={`ctrl-btn ${panel === 'layers' ? 'active' : ''}`} onClick={() => setPanel(panel === 'layers' ? null : 'layers')} title="Image & satellite layers">⧉ Layers</button>
        )}
        {/* Which storey the envelope interior sketch shows. The envelope is ONE
            floor plate, so the sketch always shows a single storey — there is
            deliberately no "all floors" overlay. */}
        {interiorLevels && (
          <label className="ctrl-field" title="Which storey's rooms the interior sketch shows inside each envelope (unassigned rooms count as ground)">
            <span className="ctrl-label">Interior</span>
            <select className="ctrl-select" value={interiorLevel} onChange={(e) => onInteriorLevel(e.target.value)}>
              {interiorLevels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        <button className={`ctrl-btn ${panel === 'more' ? 'active' : ''}`} onClick={() => setPanel(panel === 'more' ? null : 'more')} title="More options">⋯</button>
      </div>

      {/* Top-right actions cluster (glass). */}
      <div className="stage-actions">
        <button className="act-btn" onClick={history.undo} disabled={!history.canUndo} title={history.canUndo ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}>↶</button>
        <button className="act-btn" onClick={history.redo} disabled={!history.canRedo} title={history.canRedo ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}>↷</button>
        {showScore && (
          <AdjacencyBadge
            store={tickStore}
            compute={computeAdjacency}
            dataKey={adjDataKey}
            active={highlightGaps}
            onToggle={onToggleGaps}
          />
        )}
        <button className="act-btn wide" onClick={onExportPng} title="Export the current view as a PNG image (2×)">↓ PNG</button>
        <button className="act-btn wide" onClick={onExportPdf} title="Export this environment as a sheet — NTS concept diagram, or a scale-accurate drawing">↓ PDF</button>
        {onExportSet && (
          <button className="act-btn wide" onClick={onExportSet} title="Export the drawing set — concept sheet, master plan and per-floor building sheets in one PDF">↓ Set</button>
        )}
        <button className="act-btn" onClick={onHelp} title="Shortcuts & help (?)">?</button>
      </div>
    </div>
  );
}

/** The ⋯ popover — the diagram extras (forces, style, hulls, floor cameras). */
export function MorePopover({
  onMatchHulls = null,
  showForces = true,
  nodeForce,
  buildingForce,
  setPref,
  nudgeLayout,
  bubbleStyle,
  setBubbleStyle,
  hulls,
  toggleHulls,
  hasBuildings,
  hullPad,
  setHullSize,
  showMatrix,
  onShowMatrix,
  split,
  toggleSplit,
  hasLevels,
  floorMode,
  floorGap,
  is3D,
  cam3d,
  stackMode,
  stackImages,
  hasImages,
}) {
  return (
    <div className="stage-popover more-popover">
      {showForces && (
        <>
          <div className="more-section">Auto-layout forces</div>
          <div className="more-row">
            <span className="more-label">Rooms</span>
            <input type="range" min="0" max="1.5" step="0.05" value={nodeForce} onChange={(e) => { setPref('nodeForce', Number(e.target.value)); nudgeLayout(); }} title="How strongly rooms push apart and pull toward their links" />
            <span className="more-val mono">{Math.round(nodeForce * 100)}%</span>
          </div>
          <div className="more-row">
            <span className="more-label">Buildings</span>
            <input type="range" min="0" max="1.5" step="0.05" value={buildingForce} onChange={(e) => { setPref('buildingForce', Number(e.target.value)); nudgeLayout(); }} title="How strongly each building holds its shape and original position (0 = free to drift)" />
            <span className="more-val mono">{Math.round(buildingForce * 100)}%</span>
          </div>
          <div className="more-divider" />
        </>
      )}
      <div className="more-row">
        <span className="more-label">Style</span>
        <select className="ctrl-select" value={bubbleStyle} onChange={(e) => setBubbleStyle(e.target.value)}>
          <option value="solid">Solid (flat)</option>
          <option value="outline">Outline</option>
          <option value="sketch">Sketch</option>
        </select>
      </div>
      <div className="more-row">
        <button className={`btn small ${hulls ? 'on' : ''}`} onClick={toggleHulls}>⬡ Category hulls</button>
      </div>
      {(hulls || hasBuildings) && (
        <div className="more-row">
          <span className="more-label">Hull pad</span>
          <input type="range" min="6" max="80" step="2" value={hullPad} onChange={(e) => setHullSize(Number(e.target.value))} />
        </div>
      )}
      <div className="more-row">
        <button className={`btn small ${showMatrix ? 'on' : ''}`} onClick={onShowMatrix}>▦ Adjacency matrix</button>
        <button className={`btn small ${split ? 'on' : ''}`} onClick={toggleSplit}>◫ Side panel</button>
      </div>
      {onMatchHulls && (
        <div className="more-row">
          <button
            className="btn small"
            onClick={onMatchHulls}
            title="Reshape every building's envelope to match its hull in the Concept view (outlines stay area-locked; one undo step)"
          >⬡ Envelopes from concept hulls</button>
        </div>
      )}
      {((hasLevels && floorMode === 'offset') || is3D) && (
        <div className="more-row">
          <span className="more-label">Floor gap</span>
          <input type="range" min="0.2" max="1.3" step="0.05" value={floorGap} onChange={(e) => setPref('floorGap', Number(e.target.value))} />
        </div>
      )}
      {is3D && (
        <div className="more-row">
          <span className="more-label">3D camera</span>
          <select className="ctrl-select" value={cam3d} onChange={(e) => setPref('cam3d', e.target.value)}>
            <option value="persp">Perspective</option>
            <option value="iso">Isometric</option>
            <option value="ortho">Orthographic</option>
            <option value="top">Top / plan</option>
            <option value="front">Front</option>
            <option value="side">Side</option>
          </select>
        </div>
      )}
      {(stackMode || is3D) && hasImages && (
        <div className="more-row">
          <button className={`btn small ${stackImages ? 'on' : ''}`} onClick={() => setPref('stackImages', !stackImages)}>⊞ Site image on floors</button>
        </div>
      )}
    </div>
  );
}

/** The left tool dock: Select / Link, then Auto-layout and Recentre. */
export function ToolDock({ tool, onTool, autoRunning, onAutoLayout, showAutoLayout = true, showSnap = false, snapEdges = true, snapGrid = true, onToggleSnapEdges, onToggleSnapGrid, showInterior = false, interior = true, onToggleInterior, onRecentre }) {
  return (
    <div className="tool-dock">
      <button
        className={`tool-btn ${tool === 'select' ? 'active' : ''}`}
        onClick={() => onTool('select')}
        title="Select & move — V"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3l7 17 2.5-7L20 11z" /></svg>
        <span className="tool-key">V</span>
      </button>
      <button
        className={`tool-btn ${tool === 'link' ? 'active' : ''}`}
        onClick={() => onTool('link')}
        title="Link adjacency — L"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="17" r="3" /><circle cx="18" cy="7" r="3" /><line x1="8" y1="15" x2="16" y2="9" strokeLinecap="round" /></svg>
        <span className="tool-key">L</span>
      </button>
      <div className="tool-dock-sep" />
      {showAutoLayout && (
        <button
          className={`tool-btn ${autoRunning ? 'active' : ''}`}
          onClick={onAutoLayout}
          title="Auto-layout — run a force pass (A)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="17" r="2.5" /><line x1="7.5" y1="7.8" x2="10.5" y2="15" /><line x1="16.5" y1="7.8" x2="13.5" y2="15" /></svg>
          <span className="tool-key">A</span>
        </button>
      )}
      {showSnap && (
        <>
          <button
            className={`tool-btn ${snapEdges ? 'active' : ''}`}
            onClick={onToggleSnapEdges}
            title={snapEdges ? 'Snap to objects (edges & corners) — on' : 'Snap to objects — off'}
            aria-pressed={snapEdges}
          >
            {/* magnet — object snap */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4v7a6 6 0 0 0 12 0V4" /><line x1="6" y1="4" x2="10" y2="4" /><line x1="14" y1="4" x2="18" y2="4" /><line x1="8" y1="11" x2="8" y2="8" /><line x1="16" y1="11" x2="16" y2="8" /></svg>
          </button>
          <button
            className={`tool-btn ${snapGrid ? 'active' : ''}`}
            onClick={onToggleSnapGrid}
            title={snapGrid ? 'Snap to grid — on' : 'Snap to grid — off'}
            aria-pressed={snapGrid}
          >
            {/* grid — grid snap */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>
          </button>
        </>
      )}
      {showInterior && (
        <button
          className={`tool-btn ${interior ? 'active' : ''}`}
          onClick={onToggleInterior}
          title={interior ? 'Interior sketch — rooms shown inside each envelope (from the Concept layout)' : 'Interior sketch — off'}
          aria-pressed={interior}
        >
          {/* eye — interior visibility */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.5" /></svg>
        </button>
      )}
      <button className="tool-btn" onClick={onRecentre} title="Recentre view">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><line x1="12" y1="2" x2="12" y2="6" strokeLinecap="round" /><line x1="12" y1="18" x2="12" y2="22" strokeLinecap="round" /><line x1="2" y1="12" x2="6" y2="12" strokeLinecap="round" /><line x1="18" y1="12" x2="22" y2="12" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
