import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  briefNet,
  briefTargetsFor,
  targetTotal,
  subtreeArea,
  orderedTree,
  isContainerKind,
  isPureContainer,
  childIdSet,
  leafSpaces,
  rootContainer,
  spaceStatus,
  fmtArea,
  fmtPct,
} from '../compute.js';
import { squarify, darkHex, categoryColor, BUILDING_COLORS, STATUS_HEX, STATUS_LABEL, STATUS_ORDER, pocheInk } from '../viz.js';
import { orderedLevels } from '../floors.js';
import { evalFormula, referencedSpaces } from '../formula.js';
import { Banner, Empty, Overlay } from './ui.jsx';
import { confirmDialog } from './ConfirmDialog.jsx';

const BUILDING_FALLBACK = ['#f0b53f', '#57c7d4', '#4cc38a', '#c678dd'];

const NEW = { kind: 'space', department: '', name: '', count: 1, target_area: '' };
const CHILD_MODE_LABEL = { group: 'Group', within: 'Within', attached: 'Attached' };

// Crisp line icons for the schedule row actions — a consistent set reads far
// more finished than the old mix of text ghost-buttons.
const svg = (children, extra = {}) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...extra}>{children}</svg>
);
const IconPlus = () => svg(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>);
const IconNotes = () => svg(<><path d="M4 4h13l3 3v13H4z" /><line x1="8" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="14" y2="14" /></>);
const IconEdit = () => svg(<><path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17z" /><line x1="14" y1="7" x2="17" y2="10" /></>);
const IconCopy = () => svg(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>);
const IconTrash = () => svg(<><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13h10l1-13" /></>);
const IconPullBrief = () => svg(<><path d="M4 12h10" /><path d="M11 8l4 4-4 4" /><path d="M19 4v16" /></>);

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

// Project variables — plain numbers referenced by formulas as @name.
// `usedVars` lists names this tree's formulas reference, to guard deletion.
function VariablesCard({ variables, onSave, usedVars = null }) {
  const [name, setName] = useState('');
  const [val, setVal] = useState('');
  const entries = Object.entries(variables);
  const add = () => {
    const key = name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    const n = Number(val);
    if (!Number.isFinite(n)) return;
    onSave({ ...variables, [key]: n });
    setName('');
    setVal('');
  };
  const remove = async (k) => {
    if (usedVars?.has(k) && !(await confirmDialog({
      title: `Remove @${k}?`,
      body: `Formulas reference @${k} and will break without it.`,
      confirmLabel: 'Remove anyway',
    }))) return;
    const next = { ...variables };
    delete next[k];
    onSave(next);
  };
  const update = (k, v) => { const n = Number(v); if (Number.isFinite(n)) onSave({ ...variables, [k]: n }); };
  return (
    <div className="flat-card vars-card">
      <div className="sec-head">
        <span className="sec-tag t-accent2">B·04</span>
        <span className="sec-title" style={{ fontSize: 12.5, letterSpacing: '0.12em' }}>Variables</span>
      </div>
      {entries.length === 0 && (
        <p className="vars-empty">None yet. Add one, then use <code>@name</code> in an area formula.</p>
      )}
      {entries.map(([k, v]) => (
        <div className="var-row" key={k}>
          <span className="var-name">@{k}</span>
          <input className="var-val" type="number" step="any" defaultValue={v} onBlur={(e) => update(k, e.target.value)} />
          <button className="row-btn danger" type="button" title={`Remove @${k}`} onClick={() => remove(k)}>✕</button>
        </div>
      ))}
      <div className="var-add">
        <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <input placeholder="value" type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button className="btn small" type="button" onClick={add} title="Add variable">＋</button>
      </div>
    </div>
  );
}

// Area input with formula autocomplete: once the value starts with '=', typing
// `@` suggests project variables and `[` suggests space names; Enter/Tab or a
// click inserts. Plain numbers behave like a normal input.
function FormulaInput({ value, onCommit, variables, spaceNames, className = '', ...rest }) {
  const [sug, setSug] = useState(null); // { items: [..], start: caretIndexOfToken } | null
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);

  function computeSug(text, caret) {
    if (!String(text).trim().startsWith('=')) return null;
    const before = String(text).slice(0, caret);
    const varM = /@([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
    if (varM) {
      const part = (varM[1] || '').toLowerCase();
      const items = Object.keys(variables || {})
        .filter((v) => v.toLowerCase().startsWith(part))
        .slice(0, 8)
        .map((v) => ({ label: `@${v} = ${variables[v]}`, insert: `@${v}` }));
      return items.length ? { items, start: caret - varM[0].length } : null;
    }
    const spM = /\[([^\]]*)$/.exec(before);
    if (spM) {
      const part = spM[1].toLowerCase();
      const items = (spaceNames || [])
        .filter((n) => n.toLowerCase().includes(part))
        .slice(0, 8)
        .map((n) => ({ label: `[${n}]`, insert: `[${n}]` }));
      return items.length ? { items, start: caret - spM[0].length } : null;
    }
    return null;
  }
  function refresh(el) {
    setSug(computeSug(el.value, el.selectionStart ?? el.value.length));
    setHi(0);
  }
  function apply(item) {
    const el = inputRef.current;
    if (!el || !sug) return;
    const caret = el.selectionStart ?? el.value.length;
    const next = el.value.slice(0, sug.start) + item.insert + el.value.slice(caret);
    onCommit(next);
    setSug(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = sug.start + item.insert.length;
      el.setSelectionRange(pos, pos);
    });
  }
  function onKeyDown(e) {
    if (!sug) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % sug.items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + sug.items.length) % sug.items.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); apply(sug.items[hi]); }
    else if (e.key === 'Escape') { setSug(null); }
  }
  return (
    <span className="formula-input-wrap">
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className={`${className} ${String(value).trim().startsWith('=') ? 'is-formula' : ''}`}
        value={value}
        onChange={(e) => { onCommit(e.target.value); refresh(e.target); }}
        onKeyDown={onKeyDown}
        onClick={(e) => refresh(e.target)}
        onBlur={() => setSug(null)}
      />
      {sug && (
        <ul className="formula-suggest" role="listbox">
          {sug.items.map((it, i) => (
            <li
              key={it.insert + i}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? 'hi' : ''}
              onMouseDown={(e) => { e.preventDefault(); apply(it); }}
            >
              {it.label}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

// "All fields" space creation — the quick add row's big sibling. One dialog
// with every input the edit form has (level, parent, notes included), so a
// room can be authored completely in one go.
function AddSpaceDialog({
  isBrief, unit, departments, containers, variables, spaceNames, levelNames,
  groundLevel, defaultParent, formulaHint, onCreate, onClose,
}) {
  const [f, setF] = useState({
    kind: 'space', name: '', department: '', count: 1, target_area: '',
    level: groundLevel, parent_id: defaultParent ?? '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const isContainer = f.kind !== 'space';
  const set = (k) => (v) => setF((cur) => ({ ...cur, [k]: v }));

  async function submit(another) {
    setErr(null);
    if (!f.name.trim()) { setErr('A name is required'); return; }
    const raw = String(f.target_area).trim();
    const asFormula = raw.startsWith('=');
    if (!isContainer && !asFormula && !(Number(raw) > 0)) { setErr('Area must be positive — or a =formula'); return; }
    setBusy(true);
    try {
      await onCreate({
        kind: f.kind,
        name: f.name.trim(),
        parent_id: f.parent_id ? Number(f.parent_id) : null,
        department: isContainer ? 'Building' : f.department.trim() || 'General',
        count: isContainer ? 1 : Number(f.count) || 1,
        target_area: isContainer || asFormula ? 0 : Number(raw),
        area_formula: !isContainer && asFormula ? raw : null,
        level: isContainer ? '' : f.level,
        notes: f.notes,
      });
      if (another) setF((cur) => ({ ...cur, name: '', target_area: '', notes: '' }));
      else onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Keyboard submit for rapid programme entry: Enter adds & closes,
  // Ctrl/Cmd+Enter adds & keeps the dialog open for the next room. The
  // formula suggestion list preventDefaults its own Enter (to apply the
  // highlighted item), and the notes textarea keeps Enter for newlines.
  function onDialogKey(e) {
    if (e.key !== 'Enter' || e.defaultPrevented || busy) return;
    if (e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    submit(e.ctrlKey || e.metaKey);
  }

  return (
    <Overlay title={isBrief ? 'Add to the Brief' : 'Add to the design'} onClose={onClose}>
      <div className="space-dialog-grid" onKeyDown={onDialogKey}>
        <label>
          Kind
          <select value={f.kind} onChange={(e) => set('kind')(e.target.value)}>
            <option value="space">Space</option>
            <option value="building">Building / zone</option>
            <option value="group">Group</option>
          </select>
        </label>
        <label>
          Name
          <input
            autoFocus
            value={f.name}
            placeholder={isContainer ? 'e.g. Main Building' : 'e.g. Reading Room'}
            onChange={(e) => set('name')(e.target.value)}
          />
        </label>
        {!isContainer && (
          <label>
            Category
            <CategorySelect value={f.department} options={departments} onChange={set('department')} />
          </label>
        )}
        {!isContainer && (
          <label>
            Count
            <input type="number" min="1" value={f.count} title="Number of rooms of this type" onChange={(e) => set('count')(e.target.value)} />
          </label>
        )}
        {!isContainer && (
          <label className="span2">
            Area each ({unit})
            <FormulaInput
              placeholder="A number — or =formula"
              value={f.target_area}
              onCommit={set('target_area')}
              variables={variables}
              spaceNames={spaceNames}
            />
            {formulaHint(f.target_area)}
          </label>
        )}
        {!isContainer && (
          <label>
            Level
            <input
              value={f.level}
              placeholder="Ground"
              list="add-dialog-levels"
              title="Building storey — new rooms default to the ground floor"
              onChange={(e) => set('level')(e.target.value)}
            />
            <datalist id="add-dialog-levels">
              {levelNames.map((l) => <option key={l} value={l} />)}
            </datalist>
          </label>
        )}
        <label>
          Inside
          <select value={f.parent_id} onChange={(e) => set('parent_id')(e.target.value)}>
            <option value="">Top level</option>
            {containers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="span2">
          Notes
          <textarea rows={2} value={f.notes} placeholder="Requirements, finishes, occupancy…" onChange={(e) => set('notes')(e.target.value)} />
        </label>
      </div>
      {err && <p className="modal-error">{err}</p>}
      <div className="modal-actions">
        <button className="btn primary" type="button" disabled={busy} title="Enter" onClick={() => submit(false)}>
          {busy ? 'Adding…' : '+ Add'}
        </button>
        <button className="btn" type="button" disabled={busy} title="Ctrl+Enter" onClick={() => submit(true)}>
          + Add &amp; another
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

// Squarified treemap: every leaf space is a tile sized to its programme area,
// coloured by the active lens (category / building / compliance status).
function BriefTreemap({ spaces, units, selIds, onSelect, onClear, hexForSpace, legend, dimUnmatched }) {
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
          const color = hexForSpace(sp);
          const ink = pocheInk(color);
          const sel = selIds.includes(sp.id);
          const dim = dimUnmatched && !dimUnmatched(sp);
          const showName = c.w > 46 && c.h > 24;
          const showMeta = c.w > 66 && c.h > 50;
          const pct = Math.round((targetTotal(sp) / total) * 100);
          return (
            <div
              key={c.id}
              className={`treemap-tile ${sel ? 'sel' : ''} ${dim ? 'dim' : ''}`}
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
        {legend.map((l) => (
          <span className="treemap-legend-item" key={l.label}>
            <span className="swatch" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
        <span className="treemap-legend-total mono">
          tile area ∝ programme area · {fmtArea(total, units)} total
        </span>
      </div>
    </div>
  );
}

// Serves BOTH the Design tab (diagram `spaces`) and the independent Brief tab
// (`brief_spaces`). The caller passes `spaces` (the rows to edit) and a `store`
// adapter binding create/update/remove to the right endpoints. `mode` = 'design'
// | 'brief'; `programActions` renders the Brief-only Overwrite/Milestone bar.
export default function BriefTab({
  project, spaces, briefSpaces = [], snapshots = [], onChanged, selectedSpaceId = null, onSelectSpace,
  store, mode = 'design', programActions = null, onPullToBrief = null, extraSidebar = null,
  defaultView = 'schedule', // 'schedule' | 'treemap' — which view opens first
}) {
  const st = store || { create: api.createSpace, update: api.updateSpace, remove: api.deleteSpace };
  const isBrief = mode === 'brief';
  // Mode-aware copy so the Brief and Design tabs read as distinct things.
  const L = isBrief
    ? {
        netLabel: 'Σ Brief net target',
        footTotal: 'Brief net total',
        context: 'The agreed programme — an independent record that does not change the diagram.',
        emptyTitle: 'Start the brief',
        emptyBody: 'Add the client’s required buildings and spaces to build the programme.',
      }
    : {
        netLabel: 'Σ Design net area',
        footTotal: 'Design net total',
        context: 'The live areas that drive the diagram.',
        emptyTitle: 'No spaces yet',
        emptyBody: 'Add the rooms that make up the design.',
      };
  const [addParent, setAddParent] = useState(null); // container id to add under
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState(NEW);
  const [error, setError] = useState(null);
  const [dragId, setDragId] = useState(null);
  const dragLive = useRef(false); // guards the DEFERRED setDragId against a drop that beat it
  const [dropId, setDropId] = useState(null); // 0 = top level
  const [dropPos, setDropPos] = useState(null); // 'before' | 'after' | 'inside'
  const [focusId, setFocusId] = useState(null);
  const [expandedId, setExpandedId] = useState(null); // row whose notes/image panel is open
  const [briefView, setBriefView] = useState(defaultView); // 'treemap' | 'schedule'
  const [colorLens, setColorLens] = useState('category'); // 'category' | 'building' | 'status' — mirrors the diagram Colour control
  const [filter, setFilter] = useState(''); // schedule/treemap search
  const [formulaHelp, setFormulaHelp] = useState(false); // ƒ reference popover
  const [sort, setSort] = useState(null); // { key: 'name'|'category'|'count'|'each'|'total', dir: 1|-1 } | null = manual order
  const [selIds, setSelIds] = useState([]); // selected space ids (treemap + schedule highlight)
  const [showAddDialog, setShowAddDialog] = useState(false); // "All fields" space-creation dialog
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
      await st.update(id, { parent_id: parentId });
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
    dragLive.current = false;
    // The dragged id travels in the payload too — dragId state is DEFERRED at
    // dragstart (a synchronous re-render there aborts Chrome's native drag),
    // so a very fast drop can arrive before the state committed.
    const id = dragId ?? (Number(e.dataTransfer.getData('text/plain')) || null);
    const pos = dropPos ?? dropIntent(e, target);
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
        if (sibs[k].sort_order !== k || sibs[k].id === id) await st.update(sibs[k].id, upd);
      }
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  // Categories are a property of SPACES only — buildings/zones are a separate
  // data type (kind), not a category. Buildings carry a placeholder
  // department ('Building') that must never leak into the category list.
  const departments = [
    ...new Set(spaces.filter((s) => s.kind !== 'building').map((s) => s.department).filter(Boolean)),
  ];
  const containers = spaces.filter((s) => isContainerKind(s));
  // Display sort (A6): reorders siblings only; the persisted sort_order stands.
  const sortCmp = useMemo(() => {
    if (!sort) return null;
    const totals = new Map(spaces.map((s) => [s.id, subtreeArea(s, spaces)]));
    const keyOf = (s) =>
      sort.key === 'name' ? (s.name || '').toLowerCase()
      : sort.key === 'category' ? (s.department || '').toLowerCase()
      : sort.key === 'count' ? (s.count || 1)
      : sort.key === 'each' ? (s.target_area || 0)
      : totals.get(s.id) || 0;
    return (a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      const c = typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb;
      return sort.dir * c || a.sort_order - b.sort_order || a.id - b.id;
    };
  }, [sort, spaces]);
  const cycleSort = (key) =>
    setSort((cur) => (cur?.key !== key ? { key, dir: 1 } : cur.dir === 1 ? { key, dir: -1 } : null));
  const sortMark = (key) => (sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  const tree = useMemo(() => orderedTree(spaces, sortCmp), [spaces, sortCmp]);
  const parents = useMemo(() => childIdSet(spaces), [spaces]);
  const byId = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  // Ground storey label (first level in brief order) — the default for new rooms.
  const groundLevel = useMemo(() => orderedLevels(spaces)[0] || '', [spaces]);
  // Pure containers (buildings/zones and group-mode parents) show rolled-up
  // areas; 'within'/'attached' parents are real spaces with their own area.
  const isContainerRow = (s) => isPureContainer(s, parents);
  const hasChildren = (s) => parents.has(s.id);

  // One-click onboarding: create the first building container and aim the add
  // dialog inside it, so the next spaces nest where they belong.
  async function startWithBuilding() {
    setError(null);
    try {
      const created = await st.create(project.id, {
        kind: 'building', department: 'Building', name: 'Building A', count: 1, target_area: 0,
      });
      if (created?.id) {
        setAddParent(created.id);
        // Open the new building's edit row with the placeholder name selected —
        // naming it is always the very next thing the user wants to do.
        startEdit(created);
      }
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
      // Formula-driven rows edit their formula; literals edit the number.
      target_area: s.area_formula || s.target_area,
      parent_id: s.parent_id,
      child_mode: s.child_mode || 'group',
      level: s.level || '',
      height_m: s.height_m ?? '',
    });
  }

  async function saveEdit(id) {
    setError(null);
    const raw = String(edit.target_area).trim();
    const asFormula = raw.startsWith('=');
    // Renaming a room other formulas reference by [name] would break them —
    // offer to rewrite those formulas to the new name (same tree only).
    const orig = byId.get(id);
    const newName = (edit.name || '').trim();
    if (orig && newName && newName !== (orig.name || '').trim()) {
      const oldLc = (orig.name || '').trim().toLowerCase();
      const refs = spaces.filter(
        (r) => r.id !== id && r.area_formula &&
          referencedSpaces(r.area_formula).some((n) => n.trim().toLowerCase() === oldLc)
      );
      if (refs.length > 0 && await confirmDialog({
        title: 'Update referencing formulas?',
        body: `${refs.length} formula${refs.length === 1 ? '' : 's'} reference [${orig.name}]. Update ${refs.length === 1 ? 'it' : 'them'} to [${newName}]? Keeping the old reference breaks ${refs.length === 1 ? 'that formula' : 'those formulas'}.`,
        confirmLabel: 'Update formulas',
        danger: false,
      })) {
        const pat = new RegExp(`\\[\\s*${orig.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`, 'gi');
        try {
          for (const r of refs) await st.update(r.id, { area_formula: r.area_formula.replace(pat, `[${newName}]`) });
        } catch (err) {
          setError(err.message);
        }
      }
    }
    try {
      await st.update(id, {
        kind: edit.kind,
        department: edit.department,
        name: edit.name,
        count: Number(edit.count) || 1,
        target_area: asFormula ? 0 : Number(raw),
        area_formula: asFormula ? raw : null,
        parent_id: edit.parent_id ? Number(edit.parent_id) : null,
        child_mode: edit.child_mode || 'group',
        level: edit.level || '',
        height_m: Number(edit.height_m) > 0 ? Number(edit.height_m) : null,
      });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(s) {
    const kids = parents.has(s.id);
    const tree = isBrief ? 'Brief' : 'design';
    const ok = await confirmDialog({
      title: kids ? `Delete "${s.name}" and its contents?` : `Delete "${s.name}"?`,
      body: kids
        ? `Everything nested inside it is removed from the ${tree} too.`
        : `Removed from the ${tree}${isBrief ? '' : ' — recorded areas for it will be lost'}.`,
    });
    if (!ok) return;
    await st.remove(s.id);
    if (editingId === s.id) setEditingId(null);
    onChanged();
  }

  // Clone a space — the fast way to add another room like this one (same
  // parent, category, count, area). Milestone measurements aren't copied.
  async function duplicate(s) {
    setError(null);
    try {
      await st.create(project.id, {
        kind: s.kind,
        parent_id: s.parent_id ?? null,
        department: s.department || 'General',
        name: `${s.name} copy`,
        count: s.count || 1,
        target_area: s.target_area || 0,
        level: s.level || '',
      });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
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
        if (reordered[k].sort_order !== k) await st.update(reordered[k].id, { sort_order: k });
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
      await st.update(space.id, { notes: value });
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
        await st.update(space.id, { image: reader.result });
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
      await st.update(space.id, { image: null });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  // Valid parents for the row being edited: any building/zone OR any space that
  // already has children (so a nested room's real parent — e.g. a grouping space —
  // is always offered), excluding the row itself and its descendants to prevent
  // cycles. (Previously this listed only building/group *kinds*, so a room nested
  // under a grouping space showed "Top level" and saving silently un-nested it.)
  const parentOptions = useMemo(() => {
    const banned = new Set(editingId != null ? [editingId] : []);
    if (editingId != null) {
      let added = true;
      while (added) {
        added = false;
        for (const s of spaces) {
          if (s.parent_id != null && banned.has(s.parent_id) && !banned.has(s.id)) {
            banned.add(s.id);
            added = true;
          }
        }
      }
    }
    return spaces.filter((s) => !banned.has(s.id) && (isContainerKind(s) || parents.has(s.id)));
  }, [spaces, editingId, parents]);
  const addingUnder = addParent != null ? byId.get(addParent) : null;
  const unit = project.units === 'ft2' ? 'ft²' : 'm²';

  // ---------- formulas & variables ----------
  const variables = useMemo(() => {
    try { return JSON.parse(project.variables || '{}') || {}; } catch { return {}; }
  }, [project.variables]);
  // Resolved TOTAL area per space name, for live formula previews ([Room] → total).
  const totalByName = useMemo(() => {
    const m = new Map();
    for (const s of spaces) {
      const key = (s.name || '').trim().toLowerCase();
      if (key) m.set(key, isContainerRow(s) ? subtreeArea(s, spaces) : targetTotal(s));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, parents]);
  // Evaluate an unsaved formula against current variables/spaces → { value, error }.
  function previewFormula(src) {
    try {
      const value = evalFormula(src, {
        vars: variables,
        spaceArea: (n) => {
          const t = totalByName.get((n || '').trim().toLowerCase());
          if (t == null) throw new Error(`Unknown space “[${n}]”`);
          return t;
        },
      });
      return { value, error: null };
    } catch (e) {
      return { value: null, error: e.message };
    }
  }
  // A small resolved/error chip shown beside a formula-bearing area input.
  // A render helper (not a component) so it can close over previewFormula.
  const formulaHint = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw.startsWith('=')) return null;
    const { value: v, error } = previewFormula(raw);
    return error
      ? <span className="formula-hint err" title={error}>⚠ {error}</span>
      : <span className="formula-hint ok">= {fmtArea(v, project.units)}</span>;
  };

  async function saveVariables(next) {
    setError(null);
    try {
      await api.updateProject(project.id, { variables: JSON.stringify(next) });
      onChanged();
    } catch (e) { setError(e.message); }
  }
  // Variables this tree's formulas reference — guards deletion in the card.
  const usedVars = useMemo(() => {
    const set = new Set();
    for (const s of spaces) {
      if (!s.area_formula) continue;
      for (const m of s.area_formula.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)) set.add(m[1]);
    }
    return set;
  }, [spaces]);
  // Space names offered by the formula autocomplete ([Room] references).
  const spaceNames = useMemo(
    () => [...new Set(spaces.map((s) => (s.name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [spaces]
  );

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
  // Stable colour maps for the lens — one source so the treemap tiles, the
  // legend and the summary swatches agree (insertion-order index, so non-seed
  // categories/buildings get distinct fallback colours).
  const latestSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const catList = useMemo(() => [...new Set(leaves.map((s) => s.department || 'General'))], [leaves]);
  const bldList = useMemo(
    () => [...new Set(leaves.map((s) => { const r = rootContainer(s, byId); return r ? r.name : 'Unassigned'; }))],
    [leaves, byId]
  );
  const catColor = (dept) => categoryColor(dept, Math.max(0, catList.indexOf(dept)));
  const bldColor = (name) => BUILDING_COLORS[name] || BUILDING_FALLBACK[Math.max(0, bldList.indexOf(name)) % BUILDING_FALLBACK.length];

  const catSummary = useMemo(() => {
    const m = new Map();
    leaves.forEach((s) => {
      const key = s.department || 'General';
      m.set(key, (m.get(key) || 0) + targetTotal(s));
    });
    return [...m.entries()]
      .map(([key, area]) => ({ key, area, color: catColor(key) }))
      .sort((a, b) => b.area - a.area);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaves, catList]);
  const bldSummary = useMemo(() => {
    const m = new Map();
    leaves.forEach((s) => {
      const root = rootContainer(s, byId);
      const key = root ? root.name : 'Unassigned';
      m.set(key, (m.get(key) || 0) + targetTotal(s));
    });
    return [...m.entries()]
      .map(([key, area]) => ({ key, area, color: bldColor(key) }))
      .sort((a, b) => b.area - a.area);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaves, byId, bldList]);
  const medallionFoot = `${leaves.length} spaces · ${buildingNames.size} building${
    buildingNames.size === 1 ? '' : 's'
  }${levelNames.size ? ` · ${levelNames.size} level${levelNames.size === 1 ? '' : 's'}` : ''}`;

  // Designed (measured) area from the latest milestone, per space — leaves read
  // their own recorded area; containers roll up their leaf descendants. Lets the
  // schedule show live drift against the brief, using the shared status palette.
  const designedById = useMemo(() => {
    if (!latestSnapshot) return null;
    const m = new Map();
    for (const l of leaves) {
      const v = latestSnapshot.areas[l.id];
      if (v == null) continue;
      m.set(l.id, v);
      for (let p = l.parent_id; p != null; p = byId.get(p)?.parent_id ?? null) m.set(p, (m.get(p) || 0) + v);
    }
    return m;
  }, [latestSnapshot, leaves, byId]);
  const designedOf = (s) => (designedById ? designedById.get(s.id) ?? null : null);
  const targetOf = (s) => (isContainerRow(s) ? subtreeArea(s, spaces) : targetTotal(s));
  const tol = project.tolerance ?? 0.05;
  const statusFromPct = (pct) => (pct == null ? 'missing' : pct > tol ? 'over' : pct < -tol ? 'under' : 'on');

  // Design mode only: the Brief target per row (matched by path, rolled up to
  // containers) so the Design schedule shows its variance against the agreed
  // programme without opening the Overwrite dialog.
  const briefTargets = useMemo(
    () => (!isBrief && briefSpaces.length > 0 ? briefTargetsFor(spaces, briefSpaces) : null),
    [isBrief, briefSpaces, spaces]
  );
  const briefTargetById = useMemo(() => {
    if (!briefTargets) return null;
    const m = new Map();
    for (const l of leaves) {
      const v = briefTargets.get(l.id);
      if (v == null) continue;
      m.set(l.id, v);
      for (let p = l.parent_id; p != null; p = byId.get(p)?.parent_id ?? null) m.set(p, (m.get(p) || 0) + v);
    }
    return m;
  }, [briefTargets, leaves, byId]);
  const showVsBrief = briefTargetById != null;
  const briefNetTotal = showVsBrief ? briefNet(briefSpaces) : null;
  const vsBriefNetPct = showVsBrief && briefNetTotal > 0 ? (netTotal - briefNetTotal) / briefNetTotal : null;

  // Search: narrow the schedule to matching spaces (name / category), keeping
  // ancestor context and any subtree of a matched container. Null = show all.
  const q = filter.trim().toLowerCase();
  const matchesFilter = (s) => !q || (s.name || '').toLowerCase().includes(q) || (s.department || '').toLowerCase().includes(q);
  const visibleIds = useMemo(() => {
    if (!q) return null;
    const matched = spaces.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.department || '').toLowerCase().includes(q));
    const matchedIds = new Set(matched.map((s) => s.id));
    const ids = new Set(matchedIds);
    for (const s of matched) for (let p = s.parent_id; p != null; p = byId.get(p)?.parent_id ?? null) ids.add(p); // ancestors
    for (const s of spaces) { // descendants of a matched container
      for (let p = s.parent_id; p != null; p = byId.get(p)?.parent_id ?? null) if (matchedIds.has(p)) { ids.add(s.id); break; }
    }
    return { ids, count: matched.length };
  }, [q, spaces, byId]);
  const visibleTree = visibleIds ? tree.filter(({ space }) => visibleIds.ids.has(space.id)) : tree;

  // FLIP: when the ROW ORDER actually changes (drop committed, keyboard
  // reorder, sort toggled), slide each row from where it was to where it is.
  // Gated on the id sequence — animating on every render fed back on itself
  // (getBoundingClientRect reads the mid-animation transform), which turned a
  // drag-over into a jittering animation loop. Never animates while a drag is
  // in flight. (Web Animations API; no-op under jsdom.)
  const prevRowTops = useRef(new Map());
  const prevRowOrder = useRef(null);
  const rowOrder = visibleTree.map((r) => r.space.id).join(',');
  useLayoutEffect(() => {
    const animate = dragId == null && prevRowOrder.current != null && rowOrder !== prevRowOrder.current;
    const tops = new Map();
    for (const [, el] of rowEls.current) {
      // Settle any in-flight slide so the measurement is the true layout position.
      if (typeof el.getAnimations === 'function') el.getAnimations().forEach((a) => a.cancel());
    }
    for (const [id, el] of rowEls.current) tops.set(id, el.getBoundingClientRect().top);
    if (animate) {
      for (const [id, el] of rowEls.current) {
        const prev = prevRowTops.current.get(id);
        const dy = prev != null ? prev - tops.get(id) : 0;
        if (Math.abs(dy) > 2 && typeof el.animate === 'function') {
          el.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
            { duration: 180, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' }
          );
        }
      }
    }
    prevRowOrder.current = rowOrder;
    prevRowTops.current = tops;
  });
  // Net total of the visible leaves (respects the filter) for the schedule foot.
  const visibleLeafTotal = leaves
    .filter((s) => !visibleIds || visibleIds.ids.has(s.id))
    .reduce((t, s) => t + targetTotal(s), 0);
  const cols = 6 + (latestSnapshot ? 1 : 0) + (showVsBrief ? 1 : 0); // schedule column span (optional columns)
  // Category subtotals for the schedule footer (respects the search filter).
  const catSubtotals = useMemo(() => {
    const m = new Map();
    for (const s of leaves) {
      if (visibleIds && !visibleIds.ids.has(s.id)) continue;
      const key = s.department || 'General';
      m.set(key, (m.get(key) || 0) + targetTotal(s));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [leaves, visibleIds]);

  // Colour lens — mirrors the diagram's Colour control (Category / Building /
  // Status). Status uses the latest milestone and the shared status palette; it
  // is only offered once a milestone exists, else the lens falls back to Category.
  const effLens = colorLens === 'status' && !latestSnapshot ? 'category' : colorLens;
  const hexForSpace = (sp) => {
    if (effLens === 'status') return STATUS_HEX[spaceStatus(sp, latestSnapshot, project.tolerance).status];
    if (effLens === 'building') { const r = rootContainer(sp, byId); return bldColor(r ? r.name : 'Unassigned'); }
    return catColor(sp.department || 'General');
  };
  const treemapLegend = (() => {
    if (effLens === 'status') {
      const present = new Set(leaves.map((s) => spaceStatus(s, latestSnapshot, project.tolerance).status));
      return STATUS_ORDER.filter((k) => present.has(k)).map((k) => ({ label: STATUS_LABEL[k], color: STATUS_HEX[k] }));
    }
    if (effLens === 'building') return bldList.map((n) => ({ label: n, color: bldColor(n) }));
    return catList.map((c) => ({ label: c, color: catColor(c) }));
  })();

  const summarySidebar = (
    <aside className="brief-summary">
      <Medallion
        tag="B·01"
        label={L.netLabel}
        value={Math.round(netTotal).toLocaleString()}
        unit={unit}
        foot={
          vsBriefNetPct != null
            ? `${medallionFoot} · vs Brief ${fmtPct(vsBriefNetPct)}`
            : medallionFoot
        }
      />
      <VariablesCard variables={variables} onSave={saveVariables} usedVars={usedVars} />
      <SummaryGroup tag="B·02" title="Area by category" rows={catSummary} units={project.units} />
      {bldSummary.length > 0 && (
        <SummaryGroup tag="B·03" title="By building" rows={bldSummary} units={project.units} />
      )}
      {extraSidebar}
    </aside>
  );

  return (
    <div className="brief-layout">
      <div className="brief-main">
        <div className={`brief-context ${isBrief ? 'is-brief' : 'is-design'}`}>{L.context}</div>
        <div className="brief-viewbar">
          <div className="seg">
            <button className={briefView === 'schedule' ? 'active' : ''} onClick={() => setBriefView('schedule')}>
              ≣ Schedule
            </button>
            <button className={briefView === 'treemap' ? 'active' : ''} onClick={() => setBriefView('treemap')}>
              ▦ Treemap
            </button>
          </div>
          {briefView === 'treemap' && (
            <div className="seg-sm brief-lens" role="group" aria-label="Colour tiles by">
              <button className={effLens === 'category' ? 'active' : ''} onClick={() => setColorLens('category')}>Category</button>
              {bldList.length > 1 && (
                <button className={effLens === 'building' ? 'active' : ''} onClick={() => setColorLens('building')}>Building</button>
              )}
              {latestSnapshot && (
                <button
                  className={effLens === 'status' ? 'active' : ''}
                  onClick={() => setColorLens('status')}
                  title="Colour tiles by compliance with the latest milestone — over / on / under the brief target"
                >Status</button>
              )}
            </div>
          )}
          <label className="brief-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
            <input
              type="text"
              value={filter}
              placeholder="Find a space…"
              aria-label="Find a space by name or category"
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && <button type="button" className="brief-search-clear" onClick={() => setFilter('')} aria-label="Clear search">✕</button>}
          </label>
          <div className="formula-help-wrap">
            <button type="button" className={`formula-help-btn ${formulaHelp ? 'on' : ''}`} onClick={() => setFormulaHelp((v) => !v)} title="Formula reference" aria-expanded={formulaHelp}>
              <span className="fx">ƒ</span> Formulas
            </button>
            {formulaHelp && (
              <div className="formula-help-pop" role="dialog" aria-label="Formula reference">
                <div className="fh-row"><b>Type</b> a number, or start with <code>=</code> for a formula.</div>
                <div className="fh-sec">Variables{Object.keys(variables).length ? '' : ' — none yet'}</div>
                {Object.entries(variables).map(([k, v]) => (
                  <div className="fh-item" key={k}><code>@{k}</code> = {v}</div>
                ))}
                <div className="fh-sec">References</div>
                <div className="fh-item"><code>[Room name]</code> — that room’s total area</div>
                <div className="fh-sec">Functions</div>
                <div className="fh-item"><code>min max round ceil floor abs sum</code></div>
                <div className="fh-sec">Examples</div>
                <div className="fh-item"><code>=@staff * 12</code></div>
                <div className="fh-item"><code>=15% * [Adult Collection]</code></div>
                <div className="fh-item"><code>=max(60, @staff * 3)</code></div>
              </div>
            )}
          </div>
          <span className="brief-viewbar-hint">
            {q
              ? `${visibleIds ? visibleIds.count : 0} match${(visibleIds ? visibleIds.count : 0) === 1 ? '' : 'es'}`
              : briefView === 'treemap'
              ? 'Every space drawn as a tile sized to its area · click to select'
              : sort
              ? 'Sorted view — drag-reorder paused · click the header again to return to manual order'
              : 'Editable area schedule · drag to reorder or nest'}
          </span>
          {programActions && <div className="brief-program-actions">{programActions}</div>}
        </div>

        {/* Net area stacked by category — one bar, click a band to filter. */}
        {spaces.length > 0 && netTotal > 0 && (
          <div className="cat-stack" aria-label="Net area stacked by category">
            {catSummary.map(({ key, area, color }) => {
              const pct = (area / netTotal) * 100;
              const active = filter.trim().toLowerCase() === key.toLowerCase();
              return (
                <button
                  type="button"
                  key={key}
                  className={`cat-stack-seg${active ? ' active' : ''}${q && !active ? ' faded' : ''}`}
                  style={{ width: `${pct}%`, background: color, color: pocheInk(color) }}
                  title={`${key} — ${fmtArea(area, project.units)} · ${Math.round(pct)}% of net · click to ${active ? 'clear the filter' : 'filter'}`}
                  onClick={() => setFilter(active ? '' : key)}
                >
                  {pct > 9 ? <span className="cat-stack-label">{key} · {Math.round(pct)}%</span> : null}
                </button>
              );
            })}
          </div>
        )}

        {briefView === 'treemap' ? (
          spaces.length === 0 ? (
            <Empty>{L.emptyTitle} — switch to Schedule to {isBrief ? 'add the required spaces' : 'add rooms'}.</Empty>
          ) : (
            <BriefTreemap
              spaces={spaces}
              units={project.units}
              selIds={selectedSpaceId != null && !selIds.includes(selectedSpaceId) ? [...selIds, selectedSpaceId] : selIds}
              onSelect={selectSpace}
              onClear={() => { setSelIds([]); onSelectSpace?.(null); }}
              hexForSpace={hexForSpace}
              legend={treemapLegend}
              dimUnmatched={q ? matchesFilter : null}
            />
          )
        ) : (
          <>
      {spaces.length === 0 && (
        <div className="brief-onboard">
          <div className="brief-onboard-copy">
            <b>{isBrief ? 'New Brief' : 'New design'}</b>
            <span>
              {' '}— most programmes start with a building (or zone) to hold the rooms; spaces nest inside it.
              {isBrief ? ' You can also ⇪ Import a schedule from a spreadsheet.' : ''}
            </span>
          </div>
          <button type="button" className="btn small primary" onClick={startWithBuilding}>
            ⊕ Start with a building
          </button>
        </div>
      )}
      {/* One creation flow: the dialog carries every field (kind, name,
          category, count, area/formula, level, parent, notes). */}
      <div className="card brief-add">
        <div className="brief-add-row">
          <button className="btn primary" type="button" onClick={() => setShowAddDialog(true)}>
            + Add space
          </button>
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
        </div>
      </div>
      {error && <Banner>{error}</Banner>}
      {showAddDialog && (
        <AddSpaceDialog
          isBrief={isBrief}
          unit={unit}
          departments={departments}
          containers={containers}
          variables={variables}
          spaceNames={spaceNames}
          levelNames={[...levelNames]}
          groundLevel={groundLevel}
          defaultParent={addParent}
          formulaHint={formulaHint}
          onCreate={async (payload) => { await st.create(project.id, payload); onChanged(); }}
          onClose={() => setShowAddDialog(false)}
        />
      )}

      {spaces.length > 0 && (
        <p className="brief-hint hint">
          Keyboard: click a row, then <kbd>↑</kbd>/<kbd>↓</kbd> move · <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> reorder ·{' '}
          <kbd>Tab</kbd>/<kbd>⇧Tab</kbd> nest/unnest · <kbd>Enter</kbd> edit · <kbd>N</kbd> notes · <kbd>Del</kbd> remove.
        </p>
      )}

      {spaces.length === 0 ? (
        <Empty>{L.emptyBody}{isBrief ? ' Use “+ Add space”, or “⧉ Start from design” if you already have a diagram.' : ''}</Empty>
      ) : (
        <div className="card brief-table-card">
          <table className="table brief-table">
            <thead>
              <tr>
                <th className="th-sort" role="button" tabIndex={0} title="Sort by name (display only — drag order is kept)" onClick={() => cycleSort('name')} onKeyDown={(e) => { if (e.key === 'Enter') cycleSort('name'); }}>Name{sortMark('name')}</th>
                <th className="th-sort" role="button" tabIndex={0} title="Sort by category" onClick={() => cycleSort('category')} onKeyDown={(e) => { if (e.key === 'Enter') cycleSort('category'); }}>Category{sortMark('category')}</th>
                <th className="num th-sort" role="button" tabIndex={0} title="Sort by count" onClick={() => cycleSort('count')} onKeyDown={(e) => { if (e.key === 'Enter') cycleSort('count'); }}>Count{sortMark('count')}</th>
                <th className="num th-sort" role="button" tabIndex={0} title="Sort by unit area" onClick={() => cycleSort('each')} onKeyDown={(e) => { if (e.key === 'Enter') cycleSort('each'); }}>Area each{sortMark('each')}</th>
                <th className="num th-sort" role="button" tabIndex={0} title="Sort by total area" onClick={() => cycleSort('total')} onKeyDown={(e) => { if (e.key === 'Enter') cycleSort('total'); }}>Total{sortMark('total')}</th>
                {showVsBrief && <th className="num" title="Variance of the design against the Brief target (matched by room path)">vs Brief</th>}
                {latestSnapshot && <th className="num" title={`Designed area recorded at the “${latestSnapshot.label}” milestone`}>Designed</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dragId != null && (
                <tr
                  className={`toplevel-drop ${dropId === 0 ? 'drop-target' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDropId(0); }}
                  onDrop={(e) => { e.preventDefault(); dragLive.current = false; const id = dragId ?? (Number(e.dataTransfer.getData('text/plain')) || null); setDragId(null); setDropId(null); if (id) reparent(id, null); }}
                >
                  <td colSpan={cols}>↥ Drop here to move to top level (ungroup)</td>
                </tr>
              )}
              {visibleTree.length === 0 && (
                <tr><td colSpan={cols} className="brief-noresults">No spaces match “{filter}”.</td></tr>
              )}
              {visibleTree.map(({ space: s, depth }) =>
                editingId === s.id ? (
                  <tr key={s.id} className="editing">
                    <td colSpan={cols} style={{ paddingLeft: 10 + depth * 20 }}>
                      <div className="edit-form">
                        <div className="edit-form-head">
                          <span className="edit-form-title">
                            Editing <strong>{s.kind === 'building' ? '🏢 ' : ''}{s.name || 'space'}</strong>
                          </span>
                          <span className={`kind-badge ${s.kind}`}>
                            {s.kind === 'building' ? 'Building' : isContainerRow(s) ? 'Zone' : 'Space'}
                          </span>
                        </div>
                        <div className="edit-grid">
                          <label className="fld wide">
                            <span>Name</span>
                            <input
                              // Focus AND select on mount (a ref, not autoFocus —
                              // autoFocus can land before the onFocus handler is
                              // live, leaving the caret at the end): the name is
                              // usually replaced wholesale, e.g. the fresh
                              // "Building A" from ⊕ Start with a building.
                              ref={(el) => { if (el && el.dataset.init !== '1') { el.dataset.init = '1'; el.focus(); el.select(); } }}
                              value={edit.name}
                              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                            />
                          </label>
                          {edit.kind !== 'building' && (
                            <label className="fld">
                              <span>Category</span>
                              <CategorySelect value={edit.department} options={departments} onChange={(v) => setEdit({ ...edit, department: v })} />
                            </label>
                          )}
                          {edit.kind !== 'building' && (
                            <label className="fld sm">
                              <span>Count</span>
                              <input type="number" min="1" value={edit.count} onChange={(e) => setEdit({ ...edit, count: e.target.value })} />
                            </label>
                          )}
                          {edit.kind !== 'building' && (
                            <label className="fld" title="A number, or a formula starting with = (e.g. =@staff * 12, =15% * [Adult Collection]) — @ and [ suggest as you type">
                              <span>Area each ({project.units === 'ft2' ? 'ft²' : 'm²'}) · or =formula</span>
                              <FormulaInput
                                value={edit.target_area}
                                onCommit={(v) => setEdit({ ...edit, target_area: v })}
                                variables={variables}
                                spaceNames={spaceNames}
                              />
                              {formulaHint(edit.target_area)}
                            </label>
                          )}
                          <label className="fld">
                            <span>Parent</span>
                            <select value={edit.parent_id || ''} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })}>
                              <option value="">Top level</option>
                              {parentOptions.map((c) => (
                                <option key={c.id} value={c.id}>in {c.name}</option>
                              ))}
                            </select>
                          </label>
                          {edit.kind !== 'building' && (
                            <label className="fld">
                              <span>Level / storey</span>
                              <input placeholder="e.g. Ground" value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value })} />
                            </label>
                          )}
                          {edit.kind !== 'building' && (
                            <label className="fld sm" title="Clear height in metres. Leave empty to use the floor's height; taller than the storey = a double-height / multi-floor volume.">
                              <span>Height (m)</span>
                              <input type="number" min="1" max="50" step="0.1" placeholder="floor" value={edit.height_m} onChange={(e) => setEdit({ ...edit, height_m: e.target.value })} />
                            </label>
                          )}
                          {edit.kind !== 'building' && hasChildren(s) && (
                            <label className="fld wide">
                              <span>Nested spaces</span>
                              <select value={edit.child_mode} onChange={(e) => setEdit({ ...edit, child_mode: e.target.value })}>
                                <option value="group">Grouped — sum of children</option>
                                <option value="within">Within its own area</option>
                                <option value="attached">Attached — move together</option>
                              </select>
                            </label>
                          )}
                        </div>
                        <div className="edit-form-actions">
                          <button className="btn small primary" onClick={() => saveEdit(s.id)} type="button">Save</button>
                          <button className="btn small ghost" onClick={() => setEditingId(null)} type="button">Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <Fragment key={s.id}>
                    <tr
                      ref={(el) => (el ? rowEls.current.set(s.id, el) : rowEls.current.delete(s.id))}
                      tabIndex={0}
                      className={`${isContainerRow(s) ? 'container-row' : ''} ${s.kind === 'building' ? 'building-row' : ''} ${dragId === s.id ? 'dragging' : ''} ${dropId === s.id ? `drop-${dropPos}` : ''} ${focusId === s.id ? 'kb-focus' : ''} ${selIds.includes(s.id) || s.id === selectedSpaceId ? 'sel-row' : ''}`}
                      draggable={sort == null}
                      onFocus={() => setFocusId(s.id)}
                      onKeyDown={(e) => onTreeKey(e, s)}
                      onDragStart={(e) => {
                        // Firefox refuses to start a drag without payload data.
                        e.dataTransfer.setData('text/plain', String(s.id));
                        e.dataTransfer.effectAllowed = 'move';
                        // DEFER the state flip: re-rendering synchronously here
                        // (the drop-to-top-level row appears) mutates the table
                        // while Chrome is still initiating the drag, which
                        // aborts it — dragstart fired, dragend followed
                        // immediately, and no row could ever be dropped.
                        dragLive.current = true;
                        setTimeout(() => { if (dragLive.current) setDragId(s.id); }, 0);
                      }}
                      onDragEnd={() => (dragLive.current = false, setDragId(null), setDropId(null), setDropPos(null))}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const pos = dropIntent(e, s); if (dropId !== s.id || dropPos !== pos) { setDropId(s.id); setDropPos(pos); } }}
                      onDrop={(e) => onRowDrop(e, s)}
                    >
                      <td style={{ paddingLeft: 10 + depth * 20 }}>
                        <span className="drag-grip" title={sort ? 'Sorted view — click the sorted column header until the ▲/▼ clears to drag-reorder' : 'Drag to move / nest'}>⠿</span>
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
                          <span className="cat-chip">
                            <span className="swatch" style={{ background: catColor(s.department || 'General') }} />
                            {s.department || 'General'}
                          </span>
                        )}
                      </td>
                      <td className="num">{isContainerRow(s) ? <span className="cell-empty">–</span> : (s.count > 1 ? `×${s.count}` : s.count)}</td>
                      <td className="num">
                        {isContainerRow(s) ? (
                          <span className="cell-empty">–</span>
                        ) : s.area_formula ? (() => {
                          const fp = previewFormula(s.area_formula);
                          return fp.error ? (
                            <span className="formula-cell err" title={`${s.area_formula} — ${fp.error}`}>
                              <span className="fx">ƒ</span> ⚠
                            </span>
                          ) : (
                            <span className="formula-cell" title={`Formula: ${s.area_formula}`}>
                              <span className="fx">ƒ</span> {fmtArea(s.target_area, project.units)}
                            </span>
                          );
                        })() : (
                          fmtArea(s.target_area, project.units)
                        )}
                      </td>
                      <td className="num strong">{fmtArea(targetOf(s), project.units)}</td>
                      {showVsBrief && (() => {
                        const bt = briefTargetById.get(s.id);
                        if (bt == null || bt <= 0) {
                          return <td className="num"><span className="cell-empty" title="No matching room in the Brief">–</span></td>;
                        }
                        const pct = (targetOf(s) - bt) / bt;
                        const status = statusFromPct(pct);
                        return (
                          <td className="num">
                            <span
                              className="delta-chip"
                              style={{ color: STATUS_HEX[status] }}
                              title={`Brief target ${fmtArea(bt, project.units)} — ${STATUS_LABEL[status]}`}
                            >
                              {pct > 0 ? '+' : ''}{Math.round(pct * 100)}%
                            </span>
                          </td>
                        );
                      })()}
                      {latestSnapshot && (() => {
                        const d = designedOf(s);
                        const t = targetOf(s);
                        const pct = d != null && t > 0 ? (d - t) / t : null;
                        const status = statusFromPct(pct);
                        return (
                          <td className="num brief-designed">
                            {d == null ? (
                              <span className="cell-empty">–</span>
                            ) : (
                              <>
                                {fmtArea(d, project.units)}
                                <span className="delta-chip" style={{ color: STATUS_HEX[status] }} title={`${STATUS_LABEL[status]} vs the brief`}>
                                  {pct > 0 ? '+' : ''}{Math.round(pct * 100)}%
                                </span>
                              </>
                            )}
                          </td>
                        );
                      })()}
                      <td className="row-actions">
                        <div className="row-actions-float">
                          {isContainerRow(s) && (
                            <button className="row-btn" onClick={() => { setAddParent(s.id); setShowAddDialog(true); }} type="button" title={`Add a space inside ${s.name}`} aria-label={`Add a space inside ${s.name}`}>
                              <IconPlus />
                            </button>
                          )}
                          {!isContainerKind(s) && (
                            <button className="row-btn" onClick={() => duplicate(s)} type="button" title="Duplicate" aria-label={`Duplicate ${s.name}`}>
                              <IconCopy />
                            </button>
                          )}
                          {onPullToBrief && (
                            <button className="row-btn" onClick={() => onPullToBrief(s.id)} type="button" title="Copy this room into the Brief" aria-label={`Copy ${s.name} into the Brief`}>
                              <IconPullBrief />
                            </button>
                          )}
                          <button className={`row-btn ${expandedId === s.id ? 'on' : ''} ${s.notes || s.image ? 'flagged' : ''}`} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} type="button" title="Notes & reference image (N)" aria-label="Notes & reference image">
                            <IconNotes />
                          </button>
                          <button className="row-btn" onClick={() => startEdit(s)} type="button" title="Edit" aria-label={`Edit ${s.name}`}>
                            <IconEdit />
                          </button>
                          <button className="row-btn danger" onClick={() => remove(s)} type="button" title="Remove" aria-label={`Remove ${s.name}`}>
                            <IconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr className="detail-row">
                        <td colSpan={cols}>
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
              {catSubtotals.length > 1 && catSubtotals.map(([key, area]) => (
                <tr className="cat-subtotal" key={key}>
                  <td colSpan="4">
                    <span className="swatch" style={{ background: catColor(key) }} /> {key}
                  </td>
                  <td className="num">{fmtArea(area, project.units)}</td>
                  {showVsBrief && <td></td>}
                  {latestSnapshot && <td></td>}
                  <td></td>
                </tr>
              ))}
              <tr>
                <td colSpan="4">{visibleIds ? `Net total (${visibleIds.count} match${visibleIds.count === 1 ? '' : 'es'})` : `${L.footTotal} (all rooms)`}</td>
                <td className="num strong">{fmtArea(visibleIds ? visibleLeafTotal : briefNet(spaces), project.units)}</td>
                {showVsBrief && (
                  <td className="num strong">
                    {vsBriefNetPct != null ? (
                      <span className="delta-chip" style={{ color: STATUS_HEX[statusFromPct(vsBriefNetPct)] }} title={`Brief net target ${fmtArea(briefNetTotal, project.units)}`}>
                        {fmtPct(vsBriefNetPct)}
                      </span>
                    ) : ''}
                  </td>
                )}
                {latestSnapshot && (
                  <td className="num strong">
                    {fmtArea(
                      leaves
                        .filter((s) => !visibleIds || visibleIds.ids.has(s.id))
                        .reduce((t, s) => t + (latestSnapshot.areas[s.id] || 0), 0),
                      project.units
                    )}
                  </td>
                )}
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
