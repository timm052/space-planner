import { useState } from 'react';
import {
  briefNet,
  snapshotNet,
  spaceStatus,
  rollup as rollupBy,
  leafSpaces,
  fmtArea,
  fmtPct,
} from '../compute.js';
import DriftChart from './DriftChart.jsx';

const STATUS_LABEL = { on: 'On target', over: 'Over', under: 'Under', missing: 'Not measured' };

// Target vs designed rollup table, grouped by category or building.
function RollupTable({ title, head, rows, project }) {
  return (
    <>
      <h3>{title}</h3>
      <table className="table">
        <thead>
          <tr>
            <th>{head}</th>
            <th className="num">Target</th>
            <th className="num">Designed</th>
            <th className="num">Δ</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.department}>
              <td>{d.department}</td>
              <td className="num">{fmtArea(d.target, project.units)}</td>
              <td className="num">{d.hasActual ? fmtArea(d.actual, project.units) : '—'}</td>
              <td className="num">{d.pct != null ? fmtPct(d.pct) : '—'}</td>
              <td>
                <span className={`badge ${d.status}`}>{STATUS_LABEL[d.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// Overlay two milestones to see which spaces grew or shrank between them.
function SnapshotDiff({ project, spaces, snapshots }) {
  const leaves = leafSpaces(spaces);
  const [aId, setAId] = useState(snapshots[snapshots.length - 2].id);
  const [bId, setBId] = useState(snapshots[snapshots.length - 1].id);
  const a = snapshots.find((s) => s.id === Number(aId));
  const b = snapshots.find((s) => s.id === Number(bId));
  if (!a || !b) return null;

  const rows = leaves
    .map((s) => {
      const va = a.areas[s.id] ?? null;
      const vb = b.areas[s.id] ?? null;
      const delta = va != null && vb != null ? vb - va : null;
      const pct = delta != null && va > 0 ? delta / va : null;
      return { s, va, vb, delta, pct };
    })
    .filter((r) => r.delta != null && Math.abs(r.delta) > 1e-6)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const netDelta = snapshotNet(b, spaces) - snapshotNet(a, spaces);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));
  const opts = snapshots.map((sn) => (
    <option key={sn.id} value={sn.id}>
      {sn.label} · {sn.taken_at}
    </option>
  ));

  return (
    <div className="card">
      <div className="card-head-row">
        <h3>Milestone comparison</h3>
        <div className="diff-picker">
          <select value={aId} onChange={(e) => setAId(e.target.value)}>{opts}</select>
          <span className="diff-arrow">→</span>
          <select value={bId} onChange={(e) => setBId(e.target.value)}>{opts}</select>
        </div>
      </div>
      {a.id === b.id ? (
        <div className="empty small">Pick two different milestones to compare.</div>
      ) : rows.length === 0 ? (
        <div className="empty small">No measured spaces changed between these milestones.</div>
      ) : (
        <>
          <div className="diff-summary">
            Net change{' '}
            <strong className={netDelta > 0 ? 'warn-text' : netDelta < 0 ? 'ok-text' : ''}>
              {netDelta > 0 ? '+' : ''}
              {fmtArea(netDelta, project.units)}
            </strong>{' '}
            across {rows.length} space{rows.length > 1 ? 's' : ''}.
          </div>
          <table className="table diff-table">
            <thead>
              <tr>
                <th>Space</th>
                <th className="num">{a.label}</th>
                <th className="num">{b.label}</th>
                <th className="num">Δ</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, va, vb, delta, pct }) => {
                const grew = delta > 0;
                const frac = Math.abs(delta) / maxAbs;
                return (
                  <tr key={s.id}>
                    <td>
                      {s.name}
                      <span className="muted"> · {s.department}</span>
                    </td>
                    <td className="num">{va != null ? fmtArea(va, project.units) : '—'}</td>
                    <td className="num">{vb != null ? fmtArea(vb, project.units) : '—'}</td>
                    <td className={`num ${grew ? 'warn-text' : 'ok-text'}`}>
                      {grew ? '+' : ''}
                      {fmtArea(delta, project.units)}
                      {pct != null ? ` (${fmtPct(pct)})` : ''}
                    </td>
                    <td>
                      <span className="diff-bar-wrap">
                        <span className={`diff-bar ${grew ? 'grew' : 'shrank'}`} style={{ width: `${Math.round(frac * 100)}%` }} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default function Dashboard({ project, spaces, snapshots }) {
  if (spaces.length === 0) {
    return <div className="empty">Define the brief first — add spaces in the Brief tab.</div>;
  }

  const leaves = leafSpaces(spaces);
  const hasBuildings = spaces.some((s) => s.kind === 'building' || s.kind === 'group');
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const target = briefNet(spaces);
  const actual = latest ? snapshotNet(latest, spaces) : null;
  const variance = actual != null && target > 0 ? (actual - target) / target : null;
  const efficiency = latest && latest.gross_area > 0 ? snapshotNet(latest, spaces) / latest.gross_area : null;

  const catRollup = latest ? rollupBy(spaces, latest, project.tolerance, 'department') : [];
  const bldRollup = latest && hasBuildings ? rollupBy(spaces, latest, project.tolerance, 'building') : [];
  const statuses = latest ? leaves.map((s) => ({ space: s, ...spaceStatus(s, latest, project.tolerance) })) : [];
  const flagged = statuses.filter((s) => s.status === 'over' || s.status === 'under');

  return (
    <div className="dashboard">
      <div className="stat-row">
        <div className="card stat">
          <div className="stat-label">Brief net target</div>
          <div className="stat-value">{fmtArea(target, project.units)}</div>
          <div className="stat-foot">{leaves.length} spaces in program</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Designed net {latest ? `· ${latest.label}` : ''}</div>
          <div className="stat-value">{actual != null ? fmtArea(actual, project.units) : '—'}</div>
          <div className="stat-foot">{latest ? latest.taken_at : 'No milestones recorded yet'}</div>
        </div>
        <div className={`card stat ${variance == null ? '' : Math.abs(variance) <= project.tolerance ? 'good' : 'bad'}`}>
          <div className="stat-label">Program variance</div>
          <div className="stat-value">{fmtPct(variance)}</div>
          <div className="stat-foot">tolerance ±{Math.round(project.tolerance * 100)}%</div>
        </div>
        <div
          className={`card stat ${efficiency == null ? '' : efficiency >= project.grossing_target ? 'good' : 'bad'}`}
        >
          <div className="stat-label">Net : gross efficiency</div>
          <div className="stat-value">{efficiency != null ? fmtPct(efficiency, { signed: false }) : '—'}</div>
          <div className="stat-foot">target ≥ {Math.round(project.grossing_target * 100)}%</div>
        </div>
      </div>

      {snapshots.length > 0 && (
        <div className="card">
          <h3>Net area drift across milestones</h3>
          <DriftChart project={project} spaces={spaces} snapshots={snapshots} />
        </div>
      )}

      {snapshots.length >= 2 && <SnapshotDiff project={project} spaces={spaces} snapshots={snapshots} />}

      {latest && hasBuildings && (
        <div className="card">
          <RollupTable title={`By building · ${latest.label}`} head="Building" rows={bldRollup} project={project} />
        </div>
      )}

      {latest && (
        <div className="two-col">
          <div className="card">
            <RollupTable title={`By category · ${latest.label}`} head="Category" rows={catRollup} project={project} />
          </div>

          <div className="card">
            <h3>
              Flagged spaces · {latest.label}{' '}
              <span className="muted">({flagged.length} outside tolerance)</span>
            </h3>
            {flagged.length === 0 ? (
              <div className="empty small">Every space is within tolerance. 🎉</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Space</th>
                    <th className="num">Target</th>
                    <th className="num">Designed</th>
                    <th className="num">Δ</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {flagged
                    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
                    .map(({ space, target, actual, pct, status }) => (
                      <tr key={space.id}>
                        <td>
                          {space.name}
                          <span className="muted"> · {space.department}</span>
                        </td>
                        <td className="num">{fmtArea(target, project.units)}</td>
                        <td className="num">{fmtArea(actual, project.units)}</td>
                        <td className="num">{fmtPct(pct)}</td>
                        <td>
                          <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
