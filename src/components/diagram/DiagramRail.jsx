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
  grouping, // 'category' | 'building' — follows the topbar Colour control
  stackData,
  stackLevels,
  levelHeightOf,
  onLevelHeight,
  floorMode,
  onPickFloor,
  focusBuilding,
  onFocusBuilding,
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
  linkStates, // Map "loId:hiId" → 'met' | 'unmet' (null when ungradable)
  onJumpLink, // pan the canvas to the pair + select the link
  isContainerId, // container spaces get the 🏢 prefix so they read as buildings
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
          {/* Grouping follows the topbar Colour control — one switch drives
              both the canvas colouring and this schedule's grouping. */}
          {hasBuildings && <span className="muted mono rail-head-count">by {grouping}</span>}
        </div>
        <div className="split-rows">
          {grouping === 'building' && hasBuildings
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

      {stackData && stackData.length > 0 && (
        <section className="rail-section stacking">
          <div className="rail-head">
            <div className="sec-head">
              <span className="sec-tag">A·02</span>
              <span className="sec-title">Stacking</span>
            </div>
            <span className="muted mono rail-head-count">gross / floor</span>
          </div>
          {/* Storey heights — project-wide per level label (all buildings).
              Feeds the 3-D massing; a space's own height overrides its
              storey's (set it in the Brief). */}
          {stackLevels && stackLevels.length > 0 && onLevelHeight && (
            <div className="stack-heights">
              {stackLevels.map((lv) => (
                <label key={lv} className="stack-height" title={`Floor-to-floor height of “${lv}” in metres — applies across buildings`}>
                  <span className="stack-height-name">{lv}</span>
                  <input
                    type="number"
                    min="2"
                    max="20"
                    step="0.1"
                    defaultValue={levelHeightOf(lv)}
                    onChange={(e) => onLevelHeight(lv, e.target.value)}
                  />
                  <span className="stack-height-unit muted">m</span>
                </label>
              ))}
            </div>
          )}
          {stackData.map(({ building, rootId, rows, total, envelope }) => {
            const max = Math.max(...rows.map((r) => r.area), 1);
            const focused = focusBuilding != null && focusBuilding === rootId;
            return (
              <div key={building} className={`stack-building ${focused ? 'focused' : ''}`}>
                <button
                  className="stack-b-head"
                  onClick={() => rootId != null && onFocusBuilding?.(rootId)}
                  title={focused ? 'Unfocus — show every building' : 'Focus this building on the canvas'}
                >
                  <span className="stack-b-name">{focused ? '◉' : '🏢'} {building}</span>
                  {envelope && (
                    <span
                      className={`stack-env mono ${envelope.over ? 'bad' : ''}`}
                      title={envelope.over
                        ? 'The biggest storey (plus circulation) exceeds the master-plan envelope — enlarge the envelope or move rooms up/down'
                        : 'Master-plan envelope footprint'}
                    >
                      ▱ {fmtArea(envelope.drawn, units)}
                    </span>
                  )}
                  {envelope && envelope.circ > 0 && (
                    <span
                      className="stack-env stack-circ mono"
                      title={`Circulation — ${Math.round(envelope.circ * 100)}% of gross, ≈ ${fmtArea(envelope.drawn * envelope.circ, units)} of this envelope. Set per building in the Master plan's action bar.`}
                    >
                      ⤨ {fmtArea(envelope.drawn * envelope.circ, units)}
                    </span>
                  )}
                  <span className="stack-b-total">{fmtArea(total, units)}</span>
                </button>
                <div className="stack-levels">
                  {rows.map((r) => (
                    <button
                      key={r.lvl}
                      className={`stack-level ${floorMode === r.raw ? 'active' : ''}`}
                      onClick={() => onPickFloor(r.raw)}
                      title={`Edit ${r.lvl}`}
                    >
                      <span className="stack-level-name" title={r.lvl}>{r.lvl}</span>
                      <span className="stack-bar-wrap">
                        {(r.segs ?? [{ area: r.area, color: undefined, label: null }]).map((sg, si) => (
                          <span
                            key={si}
                            className="stack-bar"
                            style={{ width: `${(sg.area / max) * 100}%`, background: sg.color }}
                            title={sg.label ? `${sg.label} — ${fmtArea(sg.area, units)}` : undefined}
                          />
                        ))}
                      </span>
                      <span className="stack-level-area mono">{fmtArea(r.area, units)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="rail-section rel">
        <div className="rail-head">
          <div className="sec-head">
            {/* Numbered after Stacking when that section is present. */}
            <span className="sec-tag t-accent2">{stackData && stackData.length > 0 ? 'A·03' : 'A·02'}</span>
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
              {(() => {
                const stateOf = (l) => {
                  if (!linkStates) return null;
                  const key = l.space_a < l.space_b ? `${l.space_a}:${l.space_b}` : `${l.space_b}:${l.space_a}`;
                  return linkStates.get(key) ?? null;
                };
                // Unmet first — the schedule doubles as the fix-it list.
                const rank = (l) => (stateOf(l) === 'unmet' ? 0 : stateOf(l) === 'met' ? 1 : 2);
                const rows = [...relList].sort((a, b) => rank(a) - rank(b));
                return rows.map((l) => {
                  const a = byId.get(l.space_a);
                  const b = byId.get(l.space_b);
                  if (!a || !b) return null;
                  const state = stateOf(l);
                  const nameOf = (s) => `${isContainerId?.(s.id) ? '🏢 ' : ''}${s.name}`;
                  return (
                    <tr key={l.id} className={state ? `rel-${state}` : ''}>
                      <td className="rel-glyph">
                        <span
                          className={`rel-dot ${state ?? 'ungraded'}`}
                          title={state === 'met' ? 'Satisfied in the current layout' : state === 'unmet' ? 'Not satisfied in the current layout' : 'Not graded — set a scale (or arrange the Concept view)'}
                        />
                        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
                          <line x1="2" y1="5" x2="20" y2="5" stroke="var(--text)" strokeWidth={l.strength === 'required' ? 1.6 : 1.2} strokeDasharray={l.strength === 'required' ? undefined : '1 3'} strokeLinecap="round" />
                          {l.strength === 'required' && <><circle cx="2" cy="5" r="1.8" fill="var(--text)" /><circle cx="20" cy="5" r="1.8" fill="var(--text)" /></>}
                        </svg>
                      </td>
                      <td className="rel-pair">
                        <button className="rel-jump" onClick={() => onJumpLink?.(l)} title="Go to this pair on the diagram">
                          <b>{nameOf(a)}</b> ↔ <b>{nameOf(b)}</b>
                        </button>
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
                });
              })()}
            </tbody>
          </table>
        )}
      </section>
    </aside>
  );
}
