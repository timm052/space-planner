import { useState } from 'react';
import { api } from '../api.js';
import { briefNet, briefTargetsFor, effectiveTarget, snapshotNet, leafSpaces, targetTotal, fmtArea, fmtPct } from '../compute.js';
import { categoryColor, statusColor } from '../viz.js';
import { Banner, Empty } from './ui.jsx';
import { confirmDialog } from './ConfirmDialog.jsx';

const statusOf = (pct, tol) => (pct > tol ? 'over' : pct < -tol ? 'under' : 'on');
const fmtNum = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString());

// Change schedule (M·02): which spaces grew/shrank between two milestones.
// Defaults to the two most recent; either end can be re-picked.
function ChangeSchedule({ project, spaces, snapshots, selectedSpaceId, onGoToDiagram }) {
  const [fromId, setFromId] = useState(null); // null = second-latest
  const [toId, setToId] = useState(null); // null = latest
  if (snapshots.length < 2) return null;
  const a = snapshots.find((s) => s.id === fromId) ?? snapshots[snapshots.length - 2];
  const b = snapshots.find((s) => s.id === toId) ?? snapshots[snapshots.length - 1];
  const leaves = leafSpaces(spaces);
  const suffix = project.units === 'ft2' ? 'ft²' : 'm²';

  const rows = leaves
    .map((s) => {
      const va = a.areas[s.id] ?? null;
      const vb = b.areas[s.id] ?? null;
      const delta = va != null && vb != null ? vb - va : null;
      return { s, va, vb, delta };
    })
    .filter((r) => r.delta != null && Math.abs(r.delta) > 1e-6)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const netDelta = snapshotNet(b, spaces) - snapshotNet(a, spaces);
  const netColor = netDelta > 0 ? 'var(--warn)' : netDelta < 0 ? 'var(--accent2)' : 'var(--muted)';

  return (
    <>
      <div className="sec-head">
        <span className="sec-tag t-accent2">M·02</span>
        <span className="sec-title">Change</span>
        <span className="ms-compare" role="group" aria-label="Milestones to compare">
          <select value={a.id} onChange={(e) => setFromId(Number(e.target.value))} aria-label="Compare from">
            {snapshots.map((sn) => <option key={sn.id} value={sn.id}>{sn.label}</option>)}
          </select>
          <span className="muted">→</span>
          <select value={b.id} onChange={(e) => setToId(Number(e.target.value))} aria-label="Compare to">
            {snapshots.map((sn) => <option key={sn.id} value={sn.id}>{sn.label}</option>)}
          </select>
        </span>
        <span className="sec-meta right">
          Net change{' '}
          <span className="mono" style={{ fontWeight: 700, color: netColor }}>
            {netDelta > 0 ? '+' : ''}{fmtNum(netDelta)} {suffix}
          </span>{' '}
          across {rows.length} space{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flat-card" style={{ padding: '8px 20px' }}>
        {rows.length === 0 ? (
          <Empty small>No measured spaces changed between these milestones.</Empty>
        ) : (
          rows.map(({ s, va, vb, delta }) => {
            const grew = delta > 0;
            return (
              <div
                className={`dl-row ${onGoToDiagram ? 'clickable' : ''} ${selectedSpaceId === s.id ? 'sel' : ''}`}
                key={s.id}
                role={onGoToDiagram ? 'button' : undefined}
                tabIndex={onGoToDiagram ? 0 : undefined}
                title={onGoToDiagram ? `Show ${s.name} on the diagram` : undefined}
                onClick={onGoToDiagram ? () => onGoToDiagram(s.id) : undefined}
                onKeyDown={onGoToDiagram ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoToDiagram(s.id); } } : undefined}
              >
                <span className="swatch" style={{ background: categoryColor(s.department) }} />
                <span className="dl-name" style={{ flex: 'none', minWidth: 160 }}>{s.name}</span>
                <span className="dl-dept">{s.department}</span>
                <span className="dl-lead" />
                <span className="dl-val">{fmtNum(va)} → {fmtNum(vb)}</span>
                <span className="dl-val strong" style={{ color: grew ? 'var(--warn)' : 'var(--accent2)', width: 64, textAlign: 'right' }}>
                  {grew ? '▲' : '▼'} {grew ? '+' : ''}{fmtNum(delta)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

export default function SnapshotsTab({ project, spaces, briefSpaces = [], snapshots, onChanged, selectedSpaceId = null, onGoToDiagram, onGoTab = null }) {
  const [editing, setEditing] = useState(null); // null | 'new' | snapshot id
  const [error, setError] = useState(null);

  async function remove(sn) {
    if (!(await confirmDialog({
      title: `Delete milestone "${sn.label}"?`,
      body: 'Its recorded areas are removed from the drift history.',
    }))) return;
    await api.deleteSnapshot(sn.id);
    onChanged();
  }

  if (spaces.length === 0) {
    return (
      <Empty action={onGoTab ? { label: 'Open the Brief', onClick: () => onGoTab('Brief') } : null}>
        No design yet — milestones record the design’s measured areas against the Brief.
      </Empty>
    );
  }

  // Measure against the Brief when one exists (rooms matched by path);
  // otherwise the design's own targets stand in.
  const hasBrief = briefSpaces.length > 0;
  const targets = briefTargetsFor(spaces, briefSpaces);

  if (editing != null) {
    return (
      <div className="screen narrow">
        {error && <Banner>{error}</Banner>}
        <SnapshotEditor
          project={project}
          spaces={spaces}
          targets={targets}
          hasBrief={hasBrief}
          snapshot={editing === 'new' ? null : snapshots.find((s) => s.id === editing)}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
          onCancel={() => setEditing(null)}
          onError={setError}
        />
      </div>
    );
  }

  const target = hasBrief ? briefNet(briefSpaces) : briefNet(spaces);
  const latestId = snapshots.length ? snapshots[snapshots.length - 1].id : null;

  return (
    <div className="screen narrow">
      {error && <Banner>{error}</Banner>}

      <div className="sec-head">
        <span className="sec-tag">M·01</span>
        <span className="sec-title">Recorded milestones</span>
        <button className="btn primary small" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}>
          + Record milestone
        </button>
      </div>

      {snapshots.length === 0 ? (
        <Empty>No milestones yet. Record one after each design review or stage issue.</Empty>
      ) : (
        <div className="ms-grid">
          {snapshots.map((sn, i) => {
            const net = snapshotNet(sn, spaces);
            const variance = target > 0 ? (net - target) / target : 0;
            const status = statusOf(variance, project.tolerance);
            const sc = statusColor(status);
            const eff = sn.gross_area > 0 ? net / sn.gross_area : null;
            const isLatest = sn.id === latestId;
            return (
              <div key={sn.id} className={`flat-card ms-card ${isLatest ? 'latest' : ''}`}>
                <span className="accent-bar" style={{ background: sc }} />
                <div className="ms-card-top">
                  {/* Plain ordinal — the M· prefix belongs to the SECTION tags
                      (M·01 Recorded milestones / M·02 Change), which these
                      cards were colliding with. Also fixes "M·010" at ten. */}
                  <span className="kpi-tag">{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ flex: 1 }} />
                  <span className="ms-var" style={{ color: sc }}>{fmtPct(variance)}</span>
                </div>
                <div className="ms-label">{sn.label}</div>
                <div className="ms-date">{sn.taken_at}</div>
                <div className="ms-net">
                  {fmtNum(net)} <span className="unit">{project.units === 'ft2' ? 'ft²' : 'm²'} net</span>
                </div>
                <div className="ms-ministats">
                  <div>
                    <div className="ms-ministat-label">Gross</div>
                    <div className="ms-ministat-val">{sn.gross_area ? fmtNum(sn.gross_area) : '—'}</div>
                  </div>
                  <div>
                    <div className="ms-ministat-label">Efficiency</div>
                    <div className="ms-ministat-val">{eff != null ? fmtPct(eff, { signed: false }) : '—'}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <button className="btn small ghost" onClick={() => setEditing(sn.id)} title="Edit areas">Edit</button>
                    <button className="btn small ghost danger" onClick={() => remove(sn)} title="Delete milestone">✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ChangeSchedule project={project} spaces={spaces} snapshots={snapshots} selectedSpaceId={selectedSpaceId} onGoToDiagram={onGoToDiagram} />
    </div>
  );
}

function SnapshotEditor({ project, spaces, targets = null, hasBrief = false, snapshot, onDone, onCancel, onError }) {
  const [label, setLabel] = useState(snapshot?.label ?? '');
  const [takenAt, setTakenAt] = useState(snapshot?.taken_at ?? new Date().toISOString().slice(0, 10));
  const [gross, setGross] = useState(snapshot?.gross_area || '');
  // Only leaves carry measured areas — containers roll up.
  const leaves = leafSpaces(spaces);
  const [areas, setAreas] = useState(() => {
    const init = {};
    for (const s of leaves) init[s.id] = snapshot?.areas?.[s.id] ?? '';
    return init;
  });
  const [busy, setBusy] = useState(false);

  const unitLabel = project.units === 'ft2' ? 'ft²' : 'm²';
  const netSoFar = leaves.reduce((sum, s) => sum + (Number(areas[s.id]) || 0), 0);

  // One-click capture: the Design tab's current areas ARE the designed areas
  // at this milestone — no retyping.
  function prefillFromDesign() {
    const next = {};
    for (const s of leaves) next[s.id] = targetTotal(s) || '';
    setAreas(next);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    const payload = {
      label,
      taken_at: takenAt,
      gross_area: Number(gross) || 0,
      areas: Object.fromEntries(
        Object.entries(areas).filter(([, v]) => v !== '' && Number.isFinite(Number(v)))
      ),
    };
    try {
      if (snapshot) await api.updateSnapshot(snapshot.id, payload);
      else await api.createSnapshot(project.id, payload);
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <h3>{snapshot ? `Edit milestone — ${snapshot.label}` : 'Record milestone'}</h3>
      <div className="add-row">
        <input
          placeholder="Milestone label (e.g. Schematic Design)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <input type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} required />
        <input
          type="number"
          min="0"
          step="any"
          placeholder={`Gross floor area (${unitLabel}, optional)`}
          value={gross}
          onChange={(e) => setGross(e.target.value)}
        />
      </div>
      <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn small" type="button" onClick={prefillFromDesign} title="Fill every space with its current area from the Design tab">
          ⤓ Use current design areas
        </button>
        {project.circulation != null && (
          <button
            className="btn small ghost"
            type="button"
            onClick={() => setGross(Math.round(netSoFar * (1 + project.circulation)))}
            disabled={netSoFar <= 0}
            title={`Estimate gross from the entered net × ${(1 + project.circulation).toFixed(2)} (the project's circulation allowance)`}
          >
            ≈ Estimate gross
          </button>
        )}
        <span>…then adjust any space measured differently.</span>
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Space</th>
            <th className="num" title={hasBrief ? 'The agreed Brief target (matched by room path)' : 'The design target (no Brief yet)'}>
              {hasBrief ? 'Brief target' : 'Design target'}
            </th>
            <th className="num">Designed area ({unitLabel})</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map((s) => {
            const target = effectiveTarget(s, targets);
            const v = Number(areas[s.id]);
            const pct = areas[s.id] !== '' && target > 0 ? (v - target) / target : null;
            const cls =
              pct == null ? '' : Math.abs(pct) <= project.tolerance ? 'ok-text' : 'warn-text';
            return (
              <tr key={s.id}>
                <td>
                  {s.name}
                  <span className="muted"> · {s.department}{s.count > 1 ? ` · ×${s.count}` : ''}</span>
                </td>
                <td className="num">{fmtArea(target, project.units)}</td>
                <td className="num">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="area-input"
                    value={areas[s.id]}
                    onChange={(e) => setAreas({ ...areas, [s.id]: e.target.value })}
                  />
                </td>
                <td className={`num ${cls}`}>{pct != null ? fmtPct(pct) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Net total</td>
            <td></td>
            <td className="num strong">{fmtArea(netSoFar, project.units)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div className="form-actions">
        <button className="btn primary" disabled={busy}>
          {snapshot ? 'Save changes' : 'Save milestone'}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
