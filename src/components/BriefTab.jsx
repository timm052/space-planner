import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  briefNet,
  targetTotal,
  subtreeArea,
  orderedTree,
  isContainerKind,
  isPureContainer,
  childIdSet,
  leafSpaces,
  rootContainer,
  fmtArea,
} from '../compute.js';
import { squarify, darkHex, categoryColor, BUILDING_COLORS } from '../viz.js';

const BUILDING_FALLBACK = ['#f0b53f', '#57c7d4', '#4cc38a', '#c678dd'];

const NEW = { kind: 'space', department: '', name: '', count: 1, target_area: '' };
const CHILD_MODE_LABEL = { group: 'Group', within: 'Within', attached: 'Attached' };

// Concentric contour rings behind a grand-total numeral (drafting medallion).
function Medallion({ tag, label, value, unit, foot }) {
  return (
    <div className="flat-card medallion">
      <svg className="medallion-rings" width="170" height="170" viewBox="0 0 170 170" aria-hidden="true">
        {[22, 40, 58, 76].map((r) => (
          <circle key={r} cx="85" cy="85" r={r} fill="none" stroke="var(--contour)" strokeWidth="1" />
        ))}
      </svg>
      <div className="medallion-head">
        <span className="sec-tag">{tag}</span>
        <span className="medallion-label">{label}</span>
      </div>
      <div className="medallion-value">
        {value} <span className="unit">{unit}</span>
      </div>
      {foot ? <div className="medallion-foot">{foot}</div> : null}
    </div>
  );
}

// Dotted-leader summary rows (area by category / building).
function SummaryGroup({ tag, title, rows, units }) {
  const total = rows.reduce((s, r) => s + r.area, 0) || 1;
  return (
    <div className="flat-card">
      <div className="sec-head">
        <span className="sec-tag t-accent2">{tag}</span>
        <span className="sec-title" style={{ fontSize: 12.5, letterSpacing: '0.12em' }}>{title}</span>
      </div>
      <div className="split-bar">
        {rows.map((r) => (
          <span key={r.key} style={{ width: `${(r.area / total) * 100}%`, background: r.color }} />
        ))}
      </div>
      {rows.map((r) => (
        <div className="dl-row" key={r.key} style={{ borderBottom: 'none', padding: '5px 0' }}>
          <span className="swatch" style={{ background: r.color }} />
          <span className="dl-name" style={{ flex: 'none' }}>{r.key}</span>
          <span className="dl-lead" />
          <span className="dl-val">{fmtArea(r.area, units)}</span>
          <span className="dl-val" style={{ color: 'var(--faint)', width: 34, textAlign: 'right' }}>
            {Math.round((r.area / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// Squarified treemap: every leaf space is a tile sized to its programme area.
function BriefTreemap({ spaces, units, selIds, onSelect, onClear }) {
  const fieldRef = useRef(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return undefined;
    // Seed from a synchronous measure so the first paint packs even if the
    // ResizeObserver's initial callback is missed (e.g. StrictMode remounts).
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect?.width || 0;
      if (cw) setW(Math.round(cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const leaves = leafSpaces(spaces);
  const total = leaves.reduce((s, sp) => s + targetTotal(sp), 0) || 1;
  const items = leaves
    .map((sp) => ({ id: sp.id, value: targetTotal(sp) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const byId = new Map(leaves.map((sp) => [sp.id, sp]));
  const H = Math.max(420, Math.min(640, Math.round(w * 0.62)));
  const cells = w > 1 ? squarify(items, w, H) : [];

  return (
    <div className="flat-card treemap-card">
      <div className="treemap-field" ref={fieldRef} style={{ height: H }} onClick={onClear}>
        {cells.map((c) => {
          const sp = byId.get(c.id);
          if (!sp) return null;
          const color = categoryColor(sp.department);
          const ink = darkHex(color, 0.62);
          const sel = selIds.includes(sp.id);
          const showName = c.w > 46 && c.h > 24;
          const showMeta = c.w > 66 && c.h > 50;
          const pct = Math.round((targetTotal(sp) / total) * 100);
          return (
            <div
              key={c.id}
              className={`treemap-tile ${sel ? 'sel' : ''}`}
              title={`${sp.name} · ${fmtArea(targetTotal(sp), units)}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h, background: color, color: ink }}
              onClick={(e) => { e.stopPropagation(); onSelect(sp.id, e.shiftKey); }}
            >
              {showName && (
                <>
                  <div className="treemap-name">{sp.name}</div>
                  {showMeta && (
                    <>
                      <div className="treemap-pct">{pct}%</div>
                      <div className="treemap-area">{fmtArea(targetTotal(sp), units)}</div>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="treemap-legend">
        {['Public', 'Staff', 'Support', 'Community'].map((c, i) => (
          <span className="treemap-legend-item" key={c}>
            <span className="swatch" style={{ background: categoryColor(c, i) }} />
            {c}
          </span>
        ))}
        <span className="treemap-legend-total mono">
          tile area ∝ programme area · {fmtArea(total, units)} total
        </span>
      </div>
    </div>
  );
}

export default function BriefTab({ project, spaces, onChanged, selectedSpaceId = null, onSelectSpace }) {
  const [form, setForm] = useState(NEW);
  const [addParent, setAddParent] = useState(null); // container id to add under
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState(NEW);
  const [error, setError] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null); // 0 = top level
  const [dropPos, setDropPos] = useState(null); // 'before' | 'after' | 'inside'
  const [focusId, setFocusId] = useState(null);
  const [expandedId, setExpandedId] = useState(null); // row whose notes/image panel is open
  const [briefView, setBriefView] = useState('treemap'); // 'treemap' | 'schedule'
  const [selIds, setSelIds] = useState([]); // selected space ids (treemap + schedule highlight)
  const rowEls = useRef(new Map());

  function selectSpace(id, additive) {
    if (additive) {
      setSelIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
      return;
    }
    const deselect = selIds.length === 1 && selIds[0] === id;
    setSelIds(deselect ? [] : [id]);
    onSelectSpace?.(deselect ? null : id); // share single selection with the Diagram
  }
  const pendingFocus = useRef(null); // re-focus this row after the next refetch

  // Keep keyboard focus on the row the user just moved/indented, across refetch.
  useEffect(() => {
    if (pendingFocus.current != null) {
      rowEls.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  });

  async function reparent(id, parentId) {
    if (id === parentId) return;
    setError(null);
    try {
      await api.updateSpace(id, { parent_id: parentId });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  // Decide drop intent from the cursor's vertical position within the row:
  // containers nest in the middle and reorder at the edges; leaves only reorder.
  function dropIntent(e, target) {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientY - r.top) / r.height;
    if (isContainerRow(target)) return rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'inside';
    return rel < 0.5 ? 'before' : 'after';
  }
  function onRowDrop(e, target) {
    e.preventDefault();
    const id = dragId;
    const pos = dropPos;
    setDragId(null);
    setDropId(null);
    setDropPos(null);
    if (!id || id === target.id) return;
    if (pos === 'inside') reparent(id, target.id);
    else placeBeside(id, target, pos === 'after');
  }
  // Move `id` to sit just before/after `target`, in the same parent, reassigning
  // sibling sort_order so the new order persists.
  async function placeBeside(id, target, after) {
    const dragSpace = byId.get(id);
    if (!dragSpace) return;
    const parentId = target.parent_id ?? null;
    const sibs = spaces
      .filter((x) => (x.parent_id ?? null) === parentId && x.id !== id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const ti = sibs.findIndex((x) => x.id === target.id);
    sibs.splice(after ? ti + 1 : ti, 0, dragSpace);
    setError(null);
    try {
      for (let k = 0; k < sibs.length; k++) {
        const upd = { sort_order: k };
        if (sibs[k].id === id && (dragSpace.parent_id ?? null) !== parentId) upd.parent_id = parentId;
        if (sibs[k].sort_order !== k || sibs[k].id === id) await api.updateSpace(sibs[k].id, upd);
      }
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  const departments = [...new Set(spaces.map((s) => s.department).filter(Boolean))];
  const containers = spaces.filter((s) => isContainerKind(s));
  const tree = useMemo(() => orderedTree(spaces), [spaces]);
  const parents = useMemo(() => childIdSet(spaces), [spaces]);
  const byId = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  // Pure containers (buildings/zones and group-mode parents) show rolled-up
  // areas; 'within'/'attached' parents are real spaces with their own area.
  const isContainerRow = (s) => isPureContainer(s, parents);
  const hasChildren = (s) => parents.has(s.id);

  async function add(e) {
    e.preventDefault();
    setError(null);
    const isBuilding = form.kind === 'building';
    try {
      await api.createSpace(project.id, {
        kind: form.kind,
        parent_id: addParent,
        department: isBuilding ? 'Building' : form.department.trim() || 'General',
        name: form.name,
        count: isBuilding ? 1 : Number(form.count) || 1,
        target_area: isBuilding ? 0 : Number(form.target_area),
      });
      setForm({ ...NEW, kind: form.kind, department: isBuilding ? '' : form.department });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEdit({
      kind: s.kind,
      department: s.department,
      name: s.name,
      count: s.count,
      target_area: s.target_area,
      parent_id: s.parent_id,
      child_mode: s.child_mode || 'group',
      level: s.level || '',
    });
  }

  async function saveEdit(id) {
    setError(null);
    try {
      await api.updateSpace(id, {
        kind: edit.kind,
        department: edit.department,
        name: edit.name,
        count: Number(edit.count) || 1,
        target_area: Number(edit.target_area),
        parent_id: edit.parent_id ? Number(edit.parent_id) : null,
        child_mode: edit.child_mode || 'group',
        level: edit.level || '',
      });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(s) {
    const kids = parents.has(s.id);
    const msg = kids
      ? `Delete "${s.name}" and everything inside it?`
      : `Remove "${s.name}" from the brief? Recorded areas for it will be lost.`;
    if (!window.confirm(msg)) return;
    await api.deleteSpace(s.id);
    if (editingId === s.id) setEditingId(null);
    onChanged();
  }

  // ---------- keyboard-first editing ----------
  function focusRow(id) {
    setFocusId(id);
    rowEls.current.get(id)?.focus();
  }
  function siblingsOf(space) {
    return spaces
      .filter((x) => (x.parent_id ?? null) === (space.parent_id ?? null))
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }
  async function moveWithin(space, dir) {
    const sibs = siblingsOf(space);
    const i = sibs.findIndex((x) => x.id === space.id);
    const j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    const reordered = [...sibs];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    pendingFocus.current = space.id;
    setError(null);
    try {
      // Normalise sort_order to position so a swap is unambiguous.
      for (let k = 0; k < reordered.length; k++) {
        if (reordered[k].sort_order !== k) await api.updateSpace(reordered[k].id, { sort_order: k });
      }
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  function indent(space) {
    const sibs = siblingsOf(space);
    const i = sibs.findIndex((x) => x.id === space.id);
    if (i <= 0) return; // nothing to nest under
    pendingFocus.current = space.id;
    reparent(space.id, sibs[i - 1].id);
  }
  function outdent(space) {
    if (space.parent_id == null) return;
    const parent = byId.get(space.parent_id);
    pendingFocus.current = space.id;
    reparent(space.id, parent ? parent.parent_id ?? null : null);
  }
  function onTreeKey(e, s) {
    if (editingId != null) return;
    const ids = tree.map((t) => t.space.id);
    const idx = ids.indexOf(s.id);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveWithin(s, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (ids[idx + 1] != null) focusRow(ids[idx + 1]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (ids[idx - 1] != null) focusRow(ids[idx - 1]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.shiftKey ? outdent(s) : indent(s);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      startEdit(s);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      remove(s);
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      setExpandedId(expandedId === s.id ? null : s.id);
    }
  }

  // ---------- per-space notes & reference image ----------
  async function saveNotes(space, value) {
    if (value === (space.notes ?? '')) return;
    setError(null);
    try {
      await api.updateSpace(space.id, { notes: value });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  function onSpaceImage(space, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) return setError('Reference image is too large (6 MB max).');
    const reader = new FileReader();
    reader.onload = async () => {
      setError(null);
      try {
        await api.updateSpace(space.id, { image: reader.result });
        onChanged();
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsDataURL(file);
  }
  async function clearImage(space) {
    setError(null);
    try {
      await api.updateSpace(space.id, { image: null });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  const parentOptions = containers.filter((c) => c.id !== editingId);
  const addingUnder = addParent != null ? byId.get(addParent) : null;
  const unit = project.units === 'ft2' ? 'ft²' : 'm²';

  // ---------- summary sidebar (B·01 / B·02 / B·03) ----------
  const leaves = useMemo(() => leafSpaces(spaces), [spaces]);
  const netTotal = briefNet(spaces);
  const buildingNames = useMemo(
    () => new Set(spaces.filter((s) => s.kind === 'building').map((s) => s.name)),
    [spaces]
  );
  const levelNames = useMemo(
    () => new Set(leaves.map((s) => s.level).filter(Boolean)),
    [leaves]
  );
  const catSummary = useMemo(() => {
    const m = new Map();
    leaves.forEach((s) => {
      const key = s.department || 'General';
      m.set(key, (m.get(key) || 0) + targetTotal(s));
    });
    return [...m.entries()]
      .map(([key, area], i) => ({ key, area, color: categoryColor(key, i) }))
      .sort((a, b) => b.area - a.area);
  }, [leaves]);
  const bldSummary = useMemo(() => {
    const m = new Map();
    leaves.forEach((s) => {
      const root = rootContainer(s, byId);
      const key = root ? root.name : 'Unassigned';
      m.set(key, (m.get(key) || 0) + targetTotal(s));
    });
    return [...m.entries()]
      .map(([key, area], i) => ({ key, area, color: BUILDING_COLORS[key] || BUILDING_FALLBACK[i % BUILDING_FALLBACK.length] }))
      .sort((a, b) => b.area - a.area);
  }, [leaves, byId]);
  const medallionFoot = `${leaves.length} spaces · ${buildingNames.size} building${
    buildingNames.size === 1 ? '' : 's'
  }${levelNames.size ? ` · ${levelNames.size} level${levelNames.size === 1 ? '' : 's'}` : ''}`;

  const summarySidebar = (
    <aside className="brief-summary">
      <Medallion
        tag="B·01"
        label="Σ Brief net target"
        value={Math.round(netTotal).toLocaleString()}
        unit={unit}
        foot={medallionFoot}
      />
      <SummaryGroup tag="B·02" title="Area by category" rows={catSummary} units={project.units} />
      {bldSummary.length > 0 && (
        <SummaryGroup tag="B·03" title="By building" rows={bldSummary} units={project.units} />
      )}
    </aside>
  );

  return (
    <div className="brief-layout">
      <div className="brief-main">
        <div className="brief-viewbar">
          <div className="seg">
            <button className={briefView === 'treemap' ? 'active' : ''} onClick={() => setBriefView('treemap')}>
              ▦ Treemap
            </button>
            <button className={briefView === 'schedule' ? 'active' : ''} onClick={() => setBriefView('schedule')}>
              ≣ Schedule
            </button>
          </div>
          <span className="brief-viewbar-hint">
            {briefView === 'treemap'
              ? 'Every space drawn as a tile sized to its area · click to select'
              : 'Editable area schedule · drag to reorder or nest'}
          </span>
        </div>

        {briefView === 'treemap' ? (
          spaces.length === 0 ? (
            <div className="empty">The brief is empty. Switch to Schedule to add the client's required spaces.</div>
          ) : (
            <BriefTreemap
              spaces={spaces}
              units={project.units}
              selIds={selectedSpaceId != null && !selIds.includes(selectedSpaceId) ? [...selIds, selectedSpaceId] : selIds}
              onSelect={selectSpace}
              onClear={() => { setSelIds([]); onSelectSpace?.(null); }}
            />
          )
        ) : (
          <>
      <form className="card brief-add" onSubmit={add}>
        <div className="brief-add-row">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} title="A building/zone groups spaces; a space carries area">
            <option value="space">Space</option>
            <option value="building">Building / zone</option>
          </select>
          {form.kind !== 'building' && (
            <CategorySelect value={form.department} options={departments} onChange={(v) => setForm({ ...form, department: v })} />
          )}
          <input placeholder={form.kind === 'building' ? 'Building name (e.g. Main Building)' : 'Space name (e.g. Reading Room)'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {form.kind !== 'building' && (
            <>
              <input type="number" min="1" placeholder="Count" title="Number of rooms of this type" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
              <input type="number" min="0.1" step="any" placeholder={`Area each (${unit})`} value={form.target_area} onChange={(e) => setForm({ ...form, target_area: e.target.value })} required />
            </>
          )}
          <button className="btn primary">+ Add</button>
        </div>
        <div className="brief-add-parent">
          {addingUnder ? (
            <span>
              Adding inside <strong>{addingUnder.name}</strong>{' '}
              <button type="button" className="btn small ghost" onClick={() => setAddParent(null)}>
                move to top level
              </button>
            </span>
          ) : (
            <span className="muted">
              Adding at top level
              {containers.length > 0 && ' · use “+ inside” on a building row to nest'}
            </span>
          )}
        </div>
      </form>
      {error && <div className="banner error">{error}</div>}

      {spaces.length > 0 && (
        <p className="brief-hint hint">
          Keyboard: click a row, then <kbd>↑</kbd>/<kbd>↓</kbd> move · <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> reorder ·{' '}
          <kbd>Tab</kbd>/<kbd>⇧Tab</kbd> nest/unnest · <kbd>Enter</kbd> edit · <kbd>N</kbd> notes · <kbd>Del</kbd> remove.
        </p>
      )}

      {spaces.length === 0 ? (
        <div className="empty">The brief is empty. Add a building or the client's required spaces above.</div>
      ) : (
        <div className="card">
          <table className="table brief-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th className="num">Count</th>
                <th className="num">Area each</th>
                <th className="num">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dragId != null && (
                <tr
                  className={`toplevel-drop ${dropId === 0 ? 'drop-target' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDropId(0); }}
                  onDrop={(e) => { e.preventDefault(); const id = dragId; setDragId(null); setDropId(null); reparent(id, null); }}
                >
                  <td colSpan="6">↥ Drop here to move to top level (ungroup)</td>
                </tr>
              )}
              {tree.map(({ space: s, depth }) =>
                editingId === s.id ? (
                  <tr key={s.id} className="editing">
                    <td style={{ paddingLeft: 10 + depth * 20 }}>
                      <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    </td>
                    <td>
                      {edit.kind === 'building' ? (
                        <span className="muted">—</span>
                      ) : (
                        <CategorySelect value={edit.department} options={departments} onChange={(v) => setEdit({ ...edit, department: v })} />
                      )}
                    </td>
                    <td className="num">
                      {edit.kind === 'building' ? <span className="muted">—</span> : <input type="number" min="1" value={edit.count} onChange={(e) => setEdit({ ...edit, count: e.target.value })} />}
                    </td>
                    <td className="num">
                      {edit.kind === 'building' ? <span className="muted">—</span> : <input type="number" min="0.1" step="any" value={edit.target_area} onChange={(e) => setEdit({ ...edit, target_area: e.target.value })} />}
                    </td>
                    <td className="num">
                      <div className="edit-extra">
                        <select className="parent-select" value={edit.parent_id || ''} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })} title="Parent container">
                          <option value="">Top level</option>
                          {parentOptions.map((c) => (
                            <option key={c.id} value={c.id}>
                              in {c.name}
                            </option>
                          ))}
                        </select>
                        {edit.kind !== 'building' && hasChildren(s) && (
                          <select className="mode-select" value={edit.child_mode} onChange={(e) => setEdit({ ...edit, child_mode: e.target.value })} title="How nested spaces relate to this one">
                            <option value="group">Children: grouped (sum)</option>
                            <option value="within">Children: within its area</option>
                            <option value="attached">Children: attached (move together)</option>
                          </select>
                        )}
                        {edit.kind !== 'building' && (
                          <input className="level-input" placeholder="Level (e.g. Ground)" value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value })} title="Building level / storey" />
                        )}
                      </div>
                    </td>
                    <td className="row-actions">
                      <button className="btn small primary" onClick={() => saveEdit(s.id)} type="button">
                        Save
                      </button>
                      <button className="btn small ghost" onClick={() => setEditingId(null)} type="button">
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <Fragment key={s.id}>
                    <tr
                      ref={(el) => (el ? rowEls.current.set(s.id, el) : rowEls.current.delete(s.id))}
                      tabIndex={0}
                      className={`${isContainerRow(s) ? 'container-row' : ''} ${s.kind === 'building' ? 'building-row' : ''} ${dragId === s.id ? 'dragging' : ''} ${dropId === s.id ? `drop-${dropPos}` : ''} ${focusId === s.id ? 'kb-focus' : ''} ${selIds.includes(s.id) || s.id === selectedSpaceId ? 'sel-row' : ''}`}
                      draggable
                      onFocus={() => setFocusId(s.id)}
                      onKeyDown={(e) => onTreeKey(e, s)}
                      onDragStart={() => setDragId(s.id)}
                      onDragEnd={() => (setDragId(null), setDropId(null), setDropPos(null))}
                      onDragOver={(e) => { e.preventDefault(); const pos = dropIntent(e, s); if (dropId !== s.id || dropPos !== pos) { setDropId(s.id); setDropPos(pos); } }}
                      onDrop={(e) => onRowDrop(e, s)}
                    >
                      <td style={{ paddingLeft: 10 + depth * 20 }}>
                        <span className="drag-grip" title="Drag to move / nest">⠿</span>
                        <span className="kind-icon">{s.kind === 'building' ? '🏢' : isContainerRow(s) ? '▦' : '·'}</span>
                        <span className={isContainerRow(s) ? 'container-name' : ''}>{s.name}</span>
                        {s.level ? <span className="row-tag" title="Building level">{s.level}</span> : null}
                        {hasChildren(s) && s.kind === 'space' && (s.child_mode === 'within' || s.child_mode === 'attached') ? (
                          <span className="row-tag mode" title="How nested spaces relate to this one">{CHILD_MODE_LABEL[s.child_mode]}</span>
                        ) : null}
                        {s.notes ? <span className="row-flag" title="Has notes">📝</span> : null}
                        {s.image ? <span className="row-flag" title="Has reference image">🖼</span> : null}
                      </td>
                      <td>
                        {isContainerKind(s) ? (
                          <span className={`kind-badge ${s.kind}`}>{s.kind === 'building' ? 'Building' : 'Zone'}</span>
                        ) : (
                          s.department
                        )}
                      </td>
                      <td className="num">{isContainerRow(s) ? '—' : s.count}</td>
                      <td className="num">{isContainerRow(s) ? '—' : fmtArea(s.target_area, project.units)}</td>
                      <td className="num strong">{fmtArea(isContainerRow(s) ? subtreeArea(s, spaces) : targetTotal(s), project.units)}</td>
                      <td className="row-actions">
                        {isContainerRow(s) && (
                          <button className="btn small ghost" onClick={() => setAddParent(s.id)} type="button" title={`Add a space inside ${s.name}`}>
                            + inside
                          </button>
                        )}
                        <button className={`btn small ghost ${expandedId === s.id ? 'on' : ''}`} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} type="button" title="Notes & reference image (N)">
                          Notes
                        </button>
                        <button className="btn small ghost" onClick={() => startEdit(s)} type="button">
                          Edit
                        </button>
                        <button className="btn small ghost danger" onClick={() => remove(s)} type="button">
                          ✕
                        </button>
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr className="detail-row">
                        <td colSpan="6">
                          <div className="space-detail" style={{ marginLeft: depth * 20 }}>
                            <div className="detail-notes">
                              <label className="detail-label">Notes</label>
                              <textarea
                                defaultValue={s.notes ?? ''}
                                placeholder="Design notes, client requirements, references…"
                                onBlur={(e) => saveNotes(s, e.target.value)}
                              />
                            </div>
                            <div className="detail-image">
                              <label className="detail-label">Reference image</label>
                              {s.image ? (
                                <div className="detail-thumb">
                                  <img src={s.image} alt={`${s.name} reference`} />
                                  <button className="btn small ghost danger" type="button" onClick={() => clearImage(s)}>
                                    Remove
                                  </button>
                                </div>
                              ) : (
                                <label className="btn small">
                                  Upload…
                                  <input type="file" accept="image/*" hidden onChange={(e) => onSpaceImage(s, e)} />
                                </label>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="4">Brief net total (all rooms)</td>
                <td className="num strong">{fmtArea(briefNet(spaces), project.units)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
          </>
        )}
      </div>

      {summarySidebar}
    </div>
  );
}

// A category picker: choose an existing category or create a new one inline.
function CategorySelect({ value, options, onChange }) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (v) onChange(v);
    setCreating(false);
    setDraft('');
  };
  if (creating) {
    return (
      <span className="cat-create">
        <input
          autoFocus
          placeholder="New category"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.preventDefault(), commit());
            else if (e.key === 'Escape') (setCreating(false), setDraft(''));
          }}
        />
        <button type="button" className="btn small" onClick={commit}>Add</button>
        <button type="button" className="btn small ghost" onClick={() => (setCreating(false), setDraft(''))}>✕</button>
      </span>
    );
  }
  return (
    <select
      className="cat-select"
      value={options.includes(value) ? value : value || ''}
      onChange={(e) => (e.target.value === '__new__' ? setCreating(true) : onChange(e.target.value))}
    >
      {!value && <option value="">Category…</option>}
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      <option value="__new__">＋ New category…</option>
    </select>
  );
}
