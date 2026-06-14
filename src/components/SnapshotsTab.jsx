import { useState } from 'react';
import { api } from '../api.js';
import { snapshotNet, spaceStatus, fmtArea, fmtPct } from '../compute.js';

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

  return (
    <div>
      {error && <div className="banner error">{error}</div>}

      {editing != null ? (
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
      ) : (
        <>
          <div className="page-head">
            <p className="sub">
              Record the measured net areas from your model or drawings at each design milestone.
            </p>
            <button className="btn primary" onClick={() => setEditing('new')}>
              + Record milestone
            </button>
          </div>

          {snapshots.length === 0 ? (
            <div className="empty">No milestones yet. Record one after each design review or stage issue.</div>
          ) : (
            <div className="snapshot-list">
              {[...snapshots].reverse().map((sn) => {
                const net = snapshotNet(sn, spaces);
                const flagged = spaces.filter((s) => {
                  const st = spaceStatus(s, sn, project.tolerance).status;
                  return st === 'over' || st === 'under';
                }).length;
                return (
                  <div key={sn.id} className="card snapshot-card">
                    <div>
                      <h3>{sn.label}</h3>
                      <div className="muted">{sn.taken_at}</div>
                    </div>
                    <div className="snapshot-stats">
                      <span>
                        Net <strong>{fmtArea(net, project.units)}</strong>
                      </span>
                      <span>
                        Gross <strong>{sn.gross_area ? fmtArea(sn.gross_area, project.units) : '—'}</strong>
                      </span>
                      <span className={flagged ? 'warn-text' : 'ok-text'}>
                        {flagged ? `${flagged} space${flagged > 1 ? 's' : ''} out of tolerance` : 'All in tolerance'}
                      </span>
                    </div>
                    <div className="row-actions">
                      <button className="btn small" onClick={() => setEditing(sn.id)}>
                        Edit areas
                      </button>
                      <button className="btn small ghost danger" onClick={() => remove(sn)}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
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
