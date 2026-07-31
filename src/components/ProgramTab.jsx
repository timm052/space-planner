import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtArea, fmtPct, briefNet, leafSpaces, pathKeyMap, targetTotal } from '../compute.js';
import { benchValue, benchFormula, effectiveBenchmarks, parseBenchmarks } from '../benchmarks.js';
import BriefTab from './BriefTab.jsx';
import { Overlay } from './ui.jsx';

// The "Brief" tab: the independent agreed programme (its own room tree,
// `brief_spaces`), reusing the schedule/treemap editor via a store adapter.
// Adds the Brief-only actions: import a pasted schedule, bootstrap from the
// design, overwrite the diagram (with a preview), snapshot the programme as a
// milestone — plus the sidebar cards: grossing allowance, adjacency
// requirements, dated revisions and planning benchmarks.
const briefStore = {
  create: api.createBriefSpace,
  update: api.updateBriefSpace,
  remove: api.deleteBriefSpace,
};

export default function ProgramTab({
  project, briefSpaces = [], designCount = 0, designSpaces = [],
  designAdjacencies = [], briefAdjacencies = [], onChanged,
}) {
  const [dialog, setDialog] = useState(null); // null | 'overwrite' | 'milestone' | 'seed' | 'import' | { revision }
  const empty = briefSpaces.length === 0;
  // "Start from design" is only a fallback: a project that already has a design
  // but no brief yet. Once the brief has rooms, it disappears.
  const canSeed = empty && designCount > 0;

  const actions = (
    <>
      <button className="btn small" type="button" onClick={() => setDialog('import')} title="Paste a schedule from a spreadsheet (name, category, count, area)">
        ⇪ Import
      </button>
      {canSeed && (
        <button className="btn small ghost" type="button" onClick={() => setDialog('seed')} title="Copy the current diagram rooms into the Brief as a starting point">
          ⧉ Start from design
        </button>
      )}
      <button className="btn small" type="button" disabled={empty} onClick={() => setDialog('milestone')} title="Record the Brief's areas as a milestone">
        ◷ Milestone
      </button>
      <button className="btn small primary" type="button" disabled={empty} onClick={() => setDialog('overwrite')} title="Push the Brief onto the Design tab and diagram (preview first)">
        ⇄ Send to Design
      </button>
    </>
  );

  const sidebar = (
    <>
      <GrossingCard project={project} briefSpaces={briefSpaces} onChanged={onChanged} />
      <RequirementsCard
        project={project}
        briefSpaces={briefSpaces}
        briefAdjacencies={briefAdjacencies}
        designSpaces={designSpaces}
        designAdjacencies={designAdjacencies}
        onChanged={onChanged}
      />
      <RevisionsCard project={project} briefSpaces={briefSpaces} onDiff={(revision) => setDialog({ revision })} />
      <BenchmarksCard project={project} onChanged={onChanged} />
    </>
  );

  return (
    <>
      <BriefTab
        project={project}
        spaces={briefSpaces}
        snapshots={[]}          /* no milestone comparison in the independent Brief */
        store={briefStore}
        mode="brief"
        programActions={actions}
        extraSidebar={sidebar}
        onChanged={onChanged}
      />
      {dialog === 'seed' && <SeedDialog project={project} empty={empty} onDone={onChanged} onClose={() => setDialog(null)} />}
      {dialog === 'overwrite' && <OverwriteDialog project={project} designCount={designCount} onDone={onChanged} onClose={() => setDialog(null)} />}
      {dialog === 'milestone' && <MilestoneDialog project={project} onDone={onChanged} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog project={project} onDone={onChanged} onClose={() => setDialog(null)} />}
      {dialog?.revision && (
        <RevisionDiffDialog project={project} revision={dialog.revision} briefSpaces={briefSpaces} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function SeedDialog({ project, empty, onDone, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run() {
    setBusy(true); setError(null);
    try { await api.briefFromDesign(project.id); onDone(); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Overlay title="Start the Brief from the current design" onClose={onClose}>
      <p className="modal-body">
        Copies every room from the diagram into the Brief as a starting point (names, categories,
        counts, areas and formulas). {empty ? '' : 'This replaces the current Brief.'}
      </p>
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={run}>
          {busy ? 'Copying…' : empty ? 'Copy design into Brief' : 'Replace Brief with design'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

function OverwriteDialog({ project, designCount = 0, onDone, onClose }) {
  const [diff, setDiff] = useState(null);
  // Per-row selection sets (path keys). Adds/updates default ON, deletes OFF.
  const [sel, setSel] = useState({ adds: new Set(), updates: new Set(), deletes: new Set() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Load the preview once, then pre-select adds + updates (not deletes).
  useEffect(() => {
    let alive = true;
    api.briefDiff(project.id).then((d) => {
      if (!alive) return;
      setDiff(d);
      setSel({
        adds: new Set(d.adds.map((r) => r.path)),
        updates: new Set(d.updates.map((r) => r.path)),
        deletes: new Set(),
      });
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [project.id]);

  const unit = project.units;
  const toggle = (group, key) => setSel((s) => {
    const next = new Set(s[group]);
    next.has(key) ? next.delete(key) : next.add(key);
    return { ...s, [group]: next };
  });
  const setAll = (group, keys, on) => setSel((s) => ({ ...s, [group]: new Set(on ? keys : []) }));
  const selectedCount = sel.adds.size + sel.updates.size + sel.deletes.size;

  async function apply() {
    setBusy(true); setError(null);
    try {
      await api.applyBrief(project.id, {
        addKeys: [...sel.adds], updateKeys: [...sel.updates], deleteKeys: [...sel.deletes],
      });
      onDone(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }
  // A render helper (not a component) — avoids creating components during render.
  const section = (group, label, rows, tone, render) => (
    rows.length === 0 ? null : (
      <div className="diff-section">
        <div className={`diff-head ${tone}`}>
          {label} · {rows.length}
          <button
            className="diff-all"
            type="button"
            onClick={() => setAll(group, rows.map((r) => r.path), sel[group].size < rows.length)}
          >
            {sel[group].size < rows.length ? 'all' : 'none'}
          </button>
        </div>
        {rows.map((r) => (
          <label className="diff-row" key={r.path}>
            <input type="checkbox" checked={sel[group].has(r.path)} onChange={() => toggle(group, r.path)} />
            <span className="diff-name">{r.path}</span>
            <span className="diff-val">{render(r)}</span>
          </label>
        ))}
      </div>
    )
  );

  return (
    <Overlay title="Send the Brief to Design" onClose={onClose}>
      {designCount > 0 && (
        <p className="modal-warn">
          ⚠ The design already has {designCount} room{designCount === 1 ? '' : 's'} — the ticked changes
          below overwrite it. Matched rooms keep their diagram placement; deletes are off unless ticked.
        </p>
      )}
      {error && <p className="modal-error">{error}</p>}
      {!diff ? (
        <p className="modal-body">Comparing…</p>
      ) : (diff.adds.length + diff.updates.length + diff.deletes.length === 0) ? (
        <p className="modal-body">The diagram already matches the Brief — nothing to change.</p>
      ) : (
        <div className="diff-list">
          {section('adds', 'Add', diff.adds, 'good', (r) => `+ ${fmtArea(r.area, unit)}`)}
          {section('updates', 'Update', diff.updates, 'warn', (r) => `${fmtArea(r.from, unit)} → ${fmtArea(r.to, unit)}`)}
          {section('deletes', 'Delete — on the diagram but not the Brief', diff.deletes, 'bad', (r) => fmtArea(r.area, unit))}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn primary" type="button" disabled={busy || !diff || selectedCount === 0} onClick={apply}>
          {busy ? 'Applying…' : `Apply ${selectedCount || ''} change${selectedCount === 1 ? '' : 's'}`.trim()}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
      <p className="modal-note">Tick the changes to apply. Matched rooms keep their diagram placement; matching is by name and parent.</p>
    </Overlay>
  );
}

function MilestoneDialog({ project, onDone, onClose }) {
  const [label, setLabel] = useState('Brief');
  const [takenAt, setTakenAt] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await api.briefMilestone(project.id, { label, taken_at: takenAt });
      onDone();
      if (r.unmatched && r.unmatched.length) setResult(r);
      else onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }
  if (result) {
    return (
      <Overlay title="Milestone recorded" onClose={onClose}>
        <p className="modal-body">
          Recorded, but {result.unmatched.length} Brief room{result.unmatched.length === 1 ? '' : 's'} had no
          matching diagram room and {result.unmatched.length === 1 ? 'was' : 'were'} skipped:
        </p>
        <p className="modal-note">{result.unmatched.join(', ')}</p>
        <div className="modal-actions"><button className="btn primary" type="button" onClick={onClose}>Done</button></div>
      </Overlay>
    );
  }
  return (
    <Overlay title="Record a milestone from the Brief" onClose={onClose}>
      <p className="modal-body">Snapshots the Brief&rsquo;s resolved areas as a milestone, matched to the diagram rooms by name.</p>
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-fields">
        <label className="fld"><span>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Agreed brief" /></label>
        <label className="fld"><span>Date</span>
          <input type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} /></label>
      </div>
      <div className="modal-actions">
        <button className="btn primary" type="button" disabled={busy || !label.trim()} onClick={run}>
          {busy ? 'Recording…' : 'Record milestone'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

// ---------- Import (paste from a spreadsheet) ----------

function splitLine(line, delim) {
  if (delim === '\t') return line.split('\t').map((s) => s.trim());
  // Naive quoted-CSV split — enough for schedules pasted from Excel/Sheets.
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// Parse pasted TSV/CSV into brief rows. Recognises a header line (name/area
// column labels) and maps columns from it; otherwise assumes positional
// [name, category?, count?, area]. Area may be a number or an =formula.
export function parseImport(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return null;
  const delim = lines[0].includes('\t') ? '\t' : ',';
  let rows = lines.map((l) => splitLine(l, delim));

  let idx = null;
  const head = rows[0].map((c) => c.toLowerCase());
  const findIdx = (re) => head.findIndex((c) => re.test(c));
  if (head.some((c) => /name|space|room/.test(c)) && head.some((c) => /area/.test(c))) {
    idx = {
      name: findIdx(/name|space|room/),
      cat: findIdx(/categ|dept|department/),
      count: findIdx(/count|qty|quantity|^no\.?$/),
      area: findIdx(/area/),
    };
    rows = rows.slice(1);
  }

  const items = rows.map((cells, i) => {
    let name, cat, count, area;
    if (idx) {
      name = cells[idx.name];
      cat = idx.cat >= 0 ? cells[idx.cat] : '';
      count = idx.count >= 0 ? cells[idx.count] : '';
      area = cells[idx.area];
    } else if (cells.length === 2) [name, area] = cells;
    else if (cells.length === 3) [name, cat, area] = cells;
    else [name, cat, count, area] = cells;
    const isFormula = String(area ?? '').trim().startsWith('=');
    const areaNum = Number(String(area ?? '').replace(/[, ]/g, ''));
    const ok = !!(name && name.trim()) && (isFormula || areaNum > 0);
    return {
      line: i + 1,
      name: (name || '').trim(),
      category: (cat || '').trim() || 'General',
      count: Math.max(1, Math.trunc(Number(count) || 1)),
      area: isFormula ? String(area).trim() : areaNum,
      isFormula,
      ok,
    };
  });
  return { items, good: items.filter((r) => r.ok), bad: items.filter((r) => !r.ok) };
}

function ImportDialog({ project, onDone, onClose }) {
  const [text, setText] = useState('');
  const [group, setGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const parsed = useMemo(() => parseImport(text), [text]);
  const unit = project.units === 'ft2' ? 'ft²' : 'm²';

  async function run() {
    if (!parsed || parsed.good.length === 0) return;
    setBusy(true); setError(null);
    try {
      // Optional grouping: one zone container per category, children inside.
      const parentByCat = new Map();
      if (group) {
        for (const cat of [...new Set(parsed.good.map((r) => r.category))]) {
          const c = await api.createBriefSpace(project.id, { kind: 'group', name: cat, department: 'General', target_area: 0 });
          parentByCat.set(cat, c.id);
        }
      }
      for (const r of parsed.good) {
        await api.createBriefSpace(project.id, {
          kind: 'space',
          parent_id: group ? parentByCat.get(r.category) ?? null : null,
          department: r.category,
          name: r.name,
          count: r.count,
          target_area: r.isFormula ? 0 : r.area,
          area_formula: r.isFormula ? r.area : null,
        });
      }
      onDone(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Overlay title="Import a schedule into the Brief" wide onClose={onClose}>
      <p className="modal-body">
        Paste rows from Excel / Sheets / CSV. Columns: <b>name</b>, category, count, <b>area ({unit})</b> —
        a header row is recognised, and the area may be an <code>=formula</code>.
      </p>
      <div className="modal-fields" style={{ flexDirection: 'column' }}>
        <textarea
          className="import-paste"
          rows={7}
          placeholder={'Entrance Foyer\tPublic\t1\t110\nMeeting Rooms\tCommunity\t3\t28'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <label className="import-group">
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />
          Group rooms into zones by category
        </label>
      </div>
      {parsed && parsed.good.length > 0 && (
        <div className="import-preview">
          <div className="import-preview-head">
            {parsed.good.length} room{parsed.good.length === 1 ? '' : 's'} ready
            {parsed.bad.length > 0 ? ` · ${parsed.bad.length} line${parsed.bad.length === 1 ? '' : 's'} skipped (no name or area)` : ''}
          </div>
          {parsed.good.slice(0, 8).map((r) => (
            <div className="diff-row" key={r.line} style={{ cursor: 'default' }}>
              <span className="diff-name">{r.name} <span className="muted">· {r.category}{r.count > 1 ? ` · ×${r.count}` : ''}</span></span>
              <span className="diff-val">{r.isFormula ? r.area : fmtArea(r.count * r.area, project.units)}</span>
            </div>
          ))}
          {parsed.good.length > 8 && <p className="modal-note" style={{ padding: '4px 0 0' }}>…and {parsed.good.length - 8} more.</p>}
        </div>
      )}
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn primary" type="button" disabled={busy || !parsed || parsed.good.length === 0} onClick={run}>
          {busy ? 'Importing…' : `Import ${parsed?.good.length || 0} room${parsed?.good.length === 1 ? '' : 's'}`}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

// ---------- Sidebar cards ----------

// B·05 — circulation / grossing allowance: net × (1 + c) ≈ gross.
function GrossingCard({ project, briefSpaces, onChanged }) {
  const [error, setError] = useState(null);
  const circ = project.circulation; // fraction | null
  const net = briefNet(briefSpaces);
  async function save(raw) {
    const v = String(raw).trim();
    const next = v === '' ? null : Math.min(60, Math.max(0, Number(v) || 0)) / 100;
    if (next === circ) return;
    setError(null);
    try { await api.updateProject(project.id, { circulation: next }); onChanged(); }
    catch (e) { setError(e.message); }
  }
  return (
    <div className="flat-card vars-card">
      <div className="sec-head">
        <span className="sec-tag t-accent2">B·05</span>
        <span className="sec-title" style={{ fontSize: 12.5, letterSpacing: '0.12em' }}>Grossing</span>
      </div>
      <div className="var-row">
        <span className="var-name" title="Circulation, structure and services allowance added on top of net area">circulation</span>
        <input
          className="var-val"
          type="number"
          min="0"
          max="60"
          step="1"
          placeholder="e.g. 35"
          defaultValue={circ != null ? Math.round(circ * 100) : ''}
          key={circ ?? 'off'}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(e.target.value); } }}
        />
        <span className="muted">%</span>
      </div>
      {circ != null && net > 0 ? (
        <p className="vars-empty" style={{ marginTop: 6 }}>
          Est. gross ≈ <b>{fmtArea(net * (1 + circ), project.units)}</b> (net × {(1 + circ).toFixed(2)})
        </p>
      ) : (
        <p className="vars-empty" style={{ marginTop: 6 }}>Set an allowance to estimate gross from net.</p>
      )}
      {error && <p className="modal-error" style={{ padding: 0 }}>{error}</p>}
    </div>
  );
}

// B·06 — adjacency requirements: "A must adjoin B", scored against the
// diagram's actual links (rooms matched by path).
function RequirementsCard({ project, briefSpaces, briefAdjacencies, designSpaces, designAdjacencies, onChanged }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState(null);
  const briefLeaves = useMemo(() => leafSpaces(briefSpaces), [briefSpaces]);
  const byId = useMemo(() => new Map(briefSpaces.map((s) => [s.id, s])), [briefSpaces]);

  // Brief room → matching design room, by path.
  const designMatch = useMemo(() => {
    const briefKeys = pathKeyMap(briefSpaces);
    const designKeys = pathKeyMap(designSpaces);
    const designByKey = new Map(designSpaces.map((s) => [designKeys.get(s.id), s]));
    const m = new Map();
    for (const s of briefSpaces) {
      const d = designByKey.get(briefKeys.get(s.id));
      if (d) m.set(s.id, d);
    }
    return m;
  }, [briefSpaces, designSpaces]);
  const linked = (da, db_) =>
    designAdjacencies.some(
      (l) => (l.space_a === da.id && l.space_b === db_.id) || (l.space_a === db_.id && l.space_b === da.id)
    );

  const rows = briefAdjacencies.map((req) => {
    const ra = byId.get(req.a_id);
    const rb = byId.get(req.b_id);
    const da = designMatch.get(req.a_id);
    const db_ = designMatch.get(req.b_id);
    const state = !ra || !rb ? 'gone' : !da || !db_ ? 'missing' : linked(da, db_) ? 'met' : 'unmet';
    return { req, nameA: ra?.name ?? '?', nameB: rb?.name ?? '?', state };
  });
  const scored = rows.filter((r) => r.state === 'met' || r.state === 'unmet');
  const met = rows.filter((r) => r.state === 'met').length;

  async function add() {
    if (!a || !b || a === b) return;
    setError(null);
    try { await api.createBriefAdjacency(project.id, { a_id: Number(a), b_id: Number(b) }); setA(''); setB(''); onChanged(); }
    catch (e) { setError(e.message); }
  }
  async function remove(id) {
    setError(null);
    try { await api.deleteBriefAdjacency(id); onChanged(); }
    catch (e) { setError(e.message); }
  }
  const MARK = { met: ['✓', 'var(--good)', 'Linked on the diagram'], unmet: ['✕', 'var(--bad)', 'No link between these rooms on the diagram'], missing: ['–', 'var(--faint)', 'One of the rooms is not in the design yet'], gone: ['–', 'var(--faint)', 'Room removed from the Brief'] };

  return (
    <div className="flat-card vars-card">
      <div className="sec-head">
        <span className="sec-tag t-accent2">B·06</span>
        <span className="sec-title" style={{ fontSize: 12.5, letterSpacing: '0.12em' }}>Required adjacencies</span>
        {scored.length > 0 && (
          <span className="sec-meta right mono" style={{ color: met === scored.length ? 'var(--good)' : 'var(--warn)' }}>
            {met}/{scored.length} met
          </span>
        )}
      </div>
      {rows.length === 0 && (
        <p className="vars-empty">None yet. Declare which rooms the brief says must adjoin — the diagram&rsquo;s links are checked against them.</p>
      )}
      {rows.map(({ req, nameA, nameB, state }) => (
        <div className="var-row" key={req.id}>
          <span className="req-mark" style={{ color: MARK[state][1] }} title={MARK[state][2]}>{MARK[state][0]}</span>
          <span className="req-pair" title={`${nameA} — ${nameB}`}>{nameA} — {nameB}</span>
          <button className="row-btn danger" type="button" title="Remove requirement" onClick={() => remove(req.id)}>✕</button>
        </div>
      ))}
      {briefLeaves.length >= 2 && (
        <div className="req-add">
          <select value={a} onChange={(e) => setA(e.target.value)} aria-label="First room">
            <option value="">Room…</option>
            {briefLeaves.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Second room">
            <option value="">must adjoin…</option>
            {briefLeaves.filter((s) => String(s.id) !== a).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn small" type="button" onClick={add} disabled={!a || !b} title="Add requirement">＋</button>
        </div>
      )}
      {error && <p className="modal-error" style={{ padding: 0 }}>{error}</p>}
    </div>
  );
}

// B·07 — dated Brief revisions (Rev A / B / C).
function RevisionsCard({ project, briefSpaces, onDiff }) {
  const [revs, setRevs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    api.briefRevisions(project.id).then((r) => alive && setRevs(r)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
    // Refetch after any brief edit (the rows array is refetched → new identity).
  }, [project.id, briefSpaces]);

  async function save() {
    setBusy(true); setError(null);
    const label = `Rev ${String.fromCharCode(65 + Math.min(25, revs?.length || 0))}`;
    try {
      await api.saveBriefRevision(project.id, { label });
      setRevs(await api.briefRevisions(project.id));
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function remove(rev) {
    if (!window.confirm(`Delete revision "${rev.label}"?`)) return;
    setError(null);
    try { await api.deleteBriefRevision(rev.id); setRevs(await api.briefRevisions(project.id)); }
    catch (e) { setError(e.message); }
  }

  return (
    <div className="flat-card vars-card">
      <div className="sec-head">
        <span className="sec-tag t-accent2">B·07</span>
        <span className="sec-title" style={{ fontSize: 12.5, letterSpacing: '0.12em' }}>Revisions</span>
        <button
          className="btn small ghost"
          style={{ marginLeft: 'auto' }}
          type="button"
          disabled={busy || briefSpaces.length === 0}
          onClick={save}
          title="Record the current Brief as a dated revision"
        >
          ✎ Save
        </button>
      </div>
      {(!revs || revs.length === 0) && (
        <p className="vars-empty">No revisions yet. Save one whenever the brief is re-agreed — each is a dated copy you can diff against later.</p>
      )}
      {revs?.map((rev) => (
        <div className="var-row" key={rev.id}>
          <span className="var-name">{rev.label}</span>
          <span className="rev-meta mono">{rev.taken_at} · {fmtArea(rev.net, project.units)}</span>
          <button className="row-btn" type="button" title="What changed since this revision" onClick={() => onDiff(rev)}>⇆</button>
          <button className="row-btn danger" type="button" title="Delete revision" onClick={() => remove(rev)}>✕</button>
        </div>
      ))}
      {error && <p className="modal-error" style={{ padding: 0 }}>{error}</p>}
    </div>
  );
}

// What changed in the Brief since a saved revision (leaves matched by path).
function RevisionDiffDialog({ project, revision, briefSpaces, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    api.briefRevision(revision.id).then((r) => alive && setData(r.data)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [revision.id]);

  const diff = useMemo(() => {
    if (!data) return null;
    const revLeaves = leafSpaces(data);
    const curLeaves = leafSpaces(briefSpaces);
    const revKeys = pathKeyMap(data);
    const curKeys = pathKeyMap(briefSpaces);
    const revByKey = new Map(revLeaves.map((s) => [revKeys.get(s.id), s]));
    const curByKey = new Map(curLeaves.map((s) => [curKeys.get(s.id), s]));
    const added = curLeaves.filter((s) => !revByKey.has(curKeys.get(s.id)));
    const removed = revLeaves.filter((s) => !curByKey.has(revKeys.get(s.id)));
    const changed = curLeaves
      .map((s) => ({ cur: s, was: revByKey.get(curKeys.get(s.id)) }))
      .filter((p) => p.was && Math.abs(targetTotal(p.was) - targetTotal(p.cur)) > 1e-6);
    return { added, removed, changed, netFrom: revision.net, netTo: briefNet(briefSpaces) };
  }, [data, briefSpaces, revision.net]);

  const unit = project.units;
  return (
    <Overlay title={`Since ${revision.label} (${revision.taken_at})`} onClose={onClose}>
      {error && <p className="modal-error">{error}</p>}
      {!diff ? (
        <p className="modal-body">Comparing…</p>
      ) : diff.added.length + diff.removed.length + diff.changed.length === 0 ? (
        <p className="modal-body">The Brief is unchanged since this revision.</p>
      ) : (
        <>
          <p className="modal-body">
            Net {fmtArea(diff.netFrom, unit)} → <b>{fmtArea(diff.netTo, unit)}</b>{' '}
            ({diff.netFrom > 0 ? fmtPct((diff.netTo - diff.netFrom) / diff.netFrom) : '—'})
          </p>
          <div className="diff-list">
            {diff.changed.length > 0 && (
              <div className="diff-section">
                <div className="diff-head warn">Changed · {diff.changed.length}</div>
                {diff.changed.map(({ cur, was }) => (
                  <div className="diff-row" key={cur.id} style={{ cursor: 'default' }}>
                    <span className="diff-name">{cur.name}</span>
                    <span className="diff-val">{fmtArea(targetTotal(was), unit)} → {fmtArea(targetTotal(cur), unit)}</span>
                  </div>
                ))}
              </div>
            )}
            {diff.added.length > 0 && (
              <div className="diff-section">
                <div className="diff-head good">Added since · {diff.added.length}</div>
                {diff.added.map((s) => (
                  <div className="diff-row" key={s.id} style={{ cursor: 'default' }}>
                    <span className="diff-name">{s.name}</span>
                    <span className="diff-val">+ {fmtArea(targetTotal(s), unit)}</span>
                  </div>
                ))}
              </div>
            )}
            {diff.removed.length > 0 && (
              <div className="diff-section">
                <div className="diff-head bad">Removed since · {diff.removed.length}</div>
                {diff.removed.map((s) => (
                  <div className="diff-row" key={s.id} style={{ cursor: 'default' }}>
                    <span className="diff-name">{s.name}</span>
                    <span className="diff-val">− {fmtArea(targetTotal(s), unit)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <div className="modal-actions">
        <button className="btn primary" type="button" onClick={onClose}>Done</button>
      </div>
    </Overlay>
  );
}

// B·08 — planning benchmarks: typical allowances by building type, with a
// ready-to-paste formula per line.
function BenchmarksCard({ project, onChanged }) {
  const units = project.units;
  const [appLib, setAppLib] = useState(null); // settings-level library JSON (raw text)
  const [copied, setCopied] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null); // working copy while editing
  const [busy, setBusy] = useState(false);

  // The app-settings library only matters when the project has no override.
  useEffect(() => {
    let alive = true;
    api.getSettings().then((s) => alive && setAppLib(s.benchmarks || '')).catch(() => {});
    return () => { alive = false; };
  }, []);

  const lib = useMemo(
    () => effectiveBenchmarks(project.benchmarks, appLib),
    [project.benchmarks, appLib]
  );
  const hasOverride = !!parseBenchmarks(project.benchmarks);
  const [type, setType] = useState(lib[0].type);
  const shown = editing ? draft : lib;
  const group = shown.find((g) => g.type === type) || shown[0];
  const unit = units === 'ft2' ? 'ft²' : 'm²';

  function copy(item) {
    const f = benchFormula(item, units);
    navigator.clipboard?.writeText(f).catch(() => {});
    setCopied(item.label);
    setTimeout(() => setCopied((c) => (c === item.label ? null : c)), 1400);
  }

  // ---- per-project override editing ----
  const cloneLib = (l) => l.map((g) => ({ type: g.type, items: g.items.map((it) => ({ ...it })) }));
  const startEdit = () => { setDraft(cloneLib(lib)); setEditing(true); };
  const editDraft = (fn) => setDraft((cur) => { const next = cloneLib(cur); fn(next); return next; });
  const setItem = (ix, field, value) =>
    editDraft((next) => { const g = next.find((x) => x.type === group.type); if (g) g.items[ix][field] = value; });
  const addItem = () =>
    editDraft((next) => { const g = next.find((x) => x.type === group.type); if (g) g.items.push({ label: '', m2: 10, per: 'unit', v: null }); });
  const removeItem = (ix) =>
    editDraft((next) => { const g = next.find((x) => x.type === group.type); if (g) g.items.splice(ix, 1); });
  const addType = () => {
    const name = window.prompt('New building type');
    if (!name || !name.trim()) return;
    const t = name.trim();
    editDraft((next) => { if (!next.some((g) => g.type.toLowerCase() === t.toLowerCase())) next.push({ type: t, items: [{ label: '', m2: 10, per: 'unit', v: null }] }); });
    setType(t);
  };
  async function saveDraft() {
    setBusy(true);
    try {
      const cleaned = draft
        .map((g) => ({ ...g, items: g.items.filter((it) => it.label.trim() && Number(it.m2) > 0) }))
        .filter((g) => g.type.trim() && g.items.length > 0);
      await api.updateProject(project.id, { benchmarks: JSON.stringify(cleaned) });
      setEditing(false);
      onChanged?.();
    } finally { setBusy(false); }
  }
  async function clearOverride() {
    if (!window.confirm('Remove this project’s custom benchmarks and use the application defaults?')) return;
    setBusy(true);
    try {
      await api.updateProject(project.id, { benchmarks: null });
      setEditing(false);
      onChanged?.();
    } finally { setBusy(false); }
  }

  return (
    <div className="flat-card vars-card">
      <div className="sec-head">
        <span className="sec-tag t-accent2">B·08</span>
        <span className="sec-title" style={{ fontSize: 12.5, letterSpacing: '0.12em' }} title={hasOverride ? 'This project uses its own benchmark library' : 'Application benchmark library'}>Benchmarks</span>
        <select className="bench-type" value={group.type} onChange={(e) => setType(e.target.value)} aria-label="Building type">
          {shown.map((g) => <option key={g.type} value={g.type}>{g.type}</option>)}
        </select>
        {!editing && (
          <button className="row-btn" type="button" title="Customise the benchmarks for this project" onClick={startEdit}>✎</button>
        )}
      </div>
      {!editing && group.items.map((item) => (
        <div className="var-row" key={item.label}>
          <span className="req-pair" title={`${item.label} — typically ${benchValue(item, units)} ${unit} per ${item.per}`}>{item.label}</span>
          <span className="rev-meta mono">{benchValue(item, units)}/{item.per}</span>
          <button
            className="row-btn"
            type="button"
            title={`Copy formula ${benchFormula(item, units)}${item.v ? ` (uses ${item.v} — add it under Variables)` : ''}`}
            onClick={() => copy(item)}
          >
            {copied === item.label ? '✓' : 'ƒ'}
          </button>
        </div>
      ))}
      {editing && (
        <>
          {group.items.map((it, ix) => (
            <div className="bench-edit-row" key={ix}>
              <input value={it.label} placeholder="Allowance" onChange={(e) => setItem(ix, 'label', e.target.value)} />
              <input type="number" min="0.01" step="any" value={it.m2} title="m²" onChange={(e) => setItem(ix, 'm2', Number(e.target.value))} />
              <input value={it.per} placeholder="per" title="per what" onChange={(e) => setItem(ix, 'per', e.target.value)} />
              <input value={it.v || ''} placeholder="@var" title="Driving @variable (optional)" onChange={(e) => setItem(ix, 'v', e.target.value.trim() ? (e.target.value.trim().startsWith('@') ? e.target.value.trim() : `@${e.target.value.trim()}`) : null)} />
              <button className="row-btn danger" type="button" title="Remove" onClick={() => removeItem(ix)}>✕</button>
            </div>
          ))}
          <div className="bench-edit-actions">
            <button className="btn small ghost" type="button" onClick={addItem}>＋ Row</button>
            <button className="btn small ghost" type="button" onClick={addType}>＋ Type</button>
            <span style={{ flex: 1 }} />
            {hasOverride && <button className="btn small ghost" type="button" disabled={busy} onClick={clearOverride} title="Back to the application defaults">↺</button>}
            <button className="btn small ghost" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn small primary" type="button" disabled={busy} onClick={saveDraft}>{busy ? '…' : 'Save'}</button>
          </div>
        </>
      )}
      {!editing && (
        <p className="vars-empty" style={{ marginTop: 6 }}>ƒ copies a formula to paste into an area cell. Indicative planning figures, not code minima.{hasOverride ? ' This project uses its own library.' : ''}</p>
      )}
    </div>
  );
}
