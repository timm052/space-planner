import { api } from '../../api.js';
import { fmtArea } from '../../compute.js';
import { Empty } from '../ui.jsx';

/**
 * The diagram's right rail: A·01 Areas (grouped, live-editable targets with a
 * Σ medallion) and A·02 Adjacency (the relationship schedule). Chrome-only —
 * it re-renders on real state changes, never on sim ticks.
 */
export default function DiagramRail({
  units,
  leaves,
  byId,
  hasBuildings,
  groups,
  groupKey,
  areaTree,
  areaMode,
  setAreaMode,
  collapsed,
  toggleCollapse,
  colorForLabel,
  colorOf,
  ea,
  drafts,
  onAreaDraft,
  anyPinned,
  selected,
  selectedSpace,
  pickSpace,
  clearPick,
  relList,
  reqCount,
  desCount,
  onChanged,
  toggleSplit,
  startRailResize,
}) {
  const areaRow = (s) => (
    <div key={s.id} className={`split-row ${selected === s.id ? 'selected' : ''}`} onClick={() => (selected === s.id ? clearPick() : pickSpace(s.id))}>
      <span className="swatch" style={{ background: colorOf(s) }} />
      <span className="split-name" title={s.name}>
        {anyPinned(s) && <span className="split-pin">◉</span>}
        {s.name}
        {s.count > 1 ? ` ×${s.count}` : ''}
      </span>
      <span className="split-lead" />
      <input type="number" min="0.1" step="any" value={drafts[s.id] ?? s.target_area} onChange={(e) => onAreaDraft(s, e.target.value)} onClick={(e) => e.stopPropagation()} />
    </div>
  );

  return (
    <aside className="diagram-rail">
      <button className="rail-close" onClick={toggleSplit} title="Close panel">▾ Close panel</button>
      <div className="rail-resizer" onPointerDown={startRailResize} title="Drag to resize the panel" />
      <section className="rail-section areas">
        <div className="rail-head">
          <div className="sec-head">
            <span className="sec-tag">A·01</span>
            <span className="sec-title">Areas</span>
          </div>
          {hasBuildings && (
            <div className="seg small">
              <button className={`seg-btn ${areaMode === 'category' ? 'active' : ''}`} onClick={() => setAreaMode('category')}>Category</button>
              <button className={`seg-btn ${areaMode === 'building' ? 'active' : ''}`} onClick={() => setAreaMode('building')}>Building</button>
            </div>
          )}
        </div>
        <div className="split-rows">
          {areaMode === 'building' && hasBuildings
            ? [...areaTree.entries()].map(([b, levels]) => {
                const bKey = `b:${b}`;
                const open = !collapsed.has(bKey);
                const bSpaces = [...levels.values()].flat();
                const bTotal = bSpaces.reduce((t, s) => t + (s.count || 1) * ea(s), 0);
                const multiLevel = levels.size > 1 || ![...levels.keys()].every((k) => k === '');
                return (
                  <div key={bKey} className="split-group">
                    <div className="split-dept building" onClick={() => toggleCollapse(bKey)}>
                      <span className="collapse-caret">{open ? '▾' : '▸'}</span>
                      <span className="legend-dot" style={{ background: colorForLabel(b) }} />
                      🏢 {b}
                      <span className="split-grouptotal">{fmtArea(bTotal, units)}</span>
                    </div>
                    {open &&
                      [...levels.entries()].map(([lvl, list]) => (
                        <div key={lvl} className="split-level-group">
                          {multiLevel && <div className="split-level">{lvl || 'Unassigned level'}</div>}
                          {list.map((s) => areaRow(s))}
                        </div>
                      ))}
                  </div>
                );
              })
            : groups.map((g) => {
                const gKey = `c:${g}`;
                const open = !collapsed.has(gKey);
                const list = leaves.filter((s) => groupKey(s) === g);
                const gTotal = list.reduce((t, s) => t + (s.count || 1) * ea(s), 0);
                return (
                  <div key={gKey} className="split-group">
                    <div className="split-dept" onClick={() => toggleCollapse(gKey)}>
                      <span className="collapse-caret">{open ? '▾' : '▸'}</span>
                      <span className="legend-dot" style={{ background: colorForLabel(g) }} />
                      {g}
                      <span className="split-grouptotal">{fmtArea(gTotal, units)}</span>
                    </div>
                    {open && list.map((s) => areaRow(s))}
                  </div>
                );
              })}
        </div>
        <div className="rail-medallion">
          <svg className="medallion-rings" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
            {[16, 30, 44, 58].map((r) => (
              <circle key={r} cx="60" cy="60" r={r} fill="none" stroke="var(--contour)" strokeWidth="1" />
            ))}
          </svg>
          <div className="rail-medallion-label mono">Σ Net total</div>
          <div className="rail-medallion-value">
            {Math.round(leaves.reduce((t, s) => t + (s.count || 1) * ea(s), 0)).toLocaleString()} <span className="unit">{units === 'ft2' ? 'ft²' : 'm²'}</span>
          </div>
        </div>
      </section>

      <section className="rail-section rel">
        <div className="rail-head">
          <div className="sec-head">
            <span className="sec-tag t-accent2">A·02</span>
            <span className="sec-title">Adjacency</span>
          </div>
          <span className="muted mono rail-head-count">
            {selectedSpace ? `${relList.length} · ${selectedSpace.name}` : `${reqCount} req · ${desCount} des`}
          </span>
        </div>
        {selectedSpace && (
          <div className="rel-filter">
            Showing links for <strong>{selectedSpace.name}</strong>
            <button className="btn small ghost" onClick={clearPick}>show all</button>
          </div>
        )}
        {relList.length === 0 ? (
          <Empty small>{selectedSpace ? 'No links for this space yet — use the Link tool (L) to connect it.' : 'Use the Link tool (L), then click two rooms to connect them.'}</Empty>
        ) : (
          <table className="rail-rel">
            <tbody>
              {relList.map((l) => {
                const a = byId.get(l.space_a);
                const b = byId.get(l.space_b);
                if (!a || !b) return null;
                return (
                  <tr key={l.id}>
                    <td className="rel-glyph">
                      <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
                        <line x1="2" y1="5" x2="20" y2="5" stroke="var(--text)" strokeWidth={l.strength === 'required' ? 1.6 : 1.2} strokeDasharray={l.strength === 'required' ? undefined : '1 3'} strokeLinecap="round" />
                        {l.strength === 'required' && <><circle cx="2" cy="5" r="1.8" fill="var(--text)" /><circle cx="20" cy="5" r="1.8" fill="var(--text)" /></>}
                      </svg>
                    </td>
                    <td className="rel-pair">
                      <b>{a.name}</b> ↔ <b>{b.name}</b>
                    </td>
                    <td className="rel-strength">
                      <select value={l.strength} onChange={async (e) => ((await api.updateAdjacency(l.id, { strength: e.target.value })), onChanged())} className="strength-select">
                        <option value="required">Required</option>
                        <option value="desired">Desired</option>
                      </select>
                    </td>
                    <td className="row-actions rel-remove">
                      <button className="btn small ghost danger" onClick={async () => ((await api.deleteAdjacency(l.id)), onChanged())}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </aside>
  );
}
