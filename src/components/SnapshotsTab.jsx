import { useState } from 'react';
import { api } from '../api.js';
import { briefNet, snapshotNet, leafSpaces, fmtArea, fmtPct } from '../compute.js';
import { categoryColor, statusColor } from '../viz.js';

const statusOf = (pct, tol) => (pct > tol ? 'over' : pct < -tol ? 'under' : 'on');
const fmtNum = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString());

// Change schedule (M·02): which spaces grew/shrank between the two most recent milestones.
function ChangeSchedule({ project, spaces, snapshots }) {
  if (snapshots.length < 2) return null;
  const a = snapshots[snapshots.length - 2];
  const b = snapshots[snapshots.length - 1];
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
        <span className="sec-title">Change · {a.label} → {b.label}</span>
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
          <div className="empty small">No measured spaces changed between these milestones.</div>
        ) : (
          rows.map(({ s, va, vb, delta }) => {
            const grew = delta > 0;
            return (
              <div className="dl-row" key={s.id}>
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

export default function SnapshotsTab({ project, spaces, snapshots, onChanged }) {
  const [editing, setEditing] = useState(null); // null | 'new' | snapshot id
  const [error, setError] = useState(null);

  async function remove(sn) {
    if (!window.confirm(`Delete milestone "${sn.label}"?`)) return;
    await api.deleteSnapshot(sn.id);
    onChanged();
  }

  if (spaces.length === 0) {
    return <div className="empty">Define the brief first — milestones record designed areas against it.</div>;
  }

  if (editing != null) {
    return (
      <div className="screen narrow">
        {error && <div className="banner error">{error}</div>}
        <SnapshotEditor
          project={project}
          spaces={spaces}
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

  const target = briefNet(spaces);
  const latestId = snapshots.length ? snapshots[snapshots.length - 1].id : null;

  return (
    <div className="screen narrow">
      {error && <div className="banner error">{error}</div>}

      <div className="sec-head">
        <span className="sec-tag">M·01</span>
        <span className="sec-title">Recorded milestones</span>
        <button className="btn primary small" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}>
          + Record milestone
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div className="empty">No milestones yet. Record one after each design review or stage issue.</div>
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
                  <span className="kpi-tag">M·0{i + 1}</span>
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

      <ChangeSchedule project={project} spaces={spaces} snapshots={snapshots} />
    </div>
  );
}

function SnapshotEditor({ project, spaces, snapshot, onDone, onCancel, onError }) {
  const [label, setLabel] = useState(snapshot?.label ?? '');
  const [takenAt, setTakenAt] = useState(snapshot?.taken_at ?? new Date().toISOString().slice(0, 10));
  const [gross, setGross] = useState(snapshot?.gross_area || '');
  const [areas, setAreas] = useState(() => {
    const init = {};
    for (const s of spaces) init[s.id] = snapshot?.areas?.[s.id] ?? '';
    return init;
  });
  const [busy, setBusy] = useState(false);

  const unitLabel = project.units === 'ft2' ? 'ft²' : 'm²';
  const netSoFar = spaces.reduce((sum, s) => sum + (Number(areas[s.id]) || 0), 0);

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

      <table className="table">
        <thead>
          <tr>
            <th>Space</th>
            <th className="num">Brief target</th>
            <th className="num">Designed area ({unitLabel})</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {spaces.map((s) => {
            const target = (s.count || 1) * s.target_area;
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
