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

export default function Dashboard({ project, spaces, snapshots }) {
  const [groupBy, setGroupBy] = useState('department');
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

  const rollup = latest ? rollupBy(spaces, latest, project.tolerance, groupBy) : [];
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

      {latest && (
        <div className="two-col">
          <div className="card">
            <div className="card-head-row">
              <h3>By {groupBy} · {latest.label}</h3>
              {hasBuildings && (
                <div className="seg">
                  <button
                    className={`seg-btn ${groupBy === 'department' ? 'active' : ''}`}
                    onClick={() => setGroupBy('department')}
                  >
                    Department
                  </button>
                  <button
                    className={`seg-btn ${groupBy === 'building' ? 'active' : ''}`}
                    onClick={() => setGroupBy('building')}
                  >
                    Building
                  </button>
                </div>
              )}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{groupBy === 'building' ? 'Building' : 'Department'}</th>
                  <th className="num">Target</th>
                  <th className="num">Designed</th>
                  <th className="num">Δ</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((d) => (
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
