import {
  briefNet,
  snapshotNet,
  spaceStatus,
  rollup as rollupBy,
  leafSpaces,
  fmtPct,
} from '../compute.js';
import { categoryColor, statusColor } from '../viz.js';
import DriftChart from './DriftChart.jsx';
import { Empty } from './ui.jsx';

const unitSuffix = (units) => (units === 'ft2' ? 'ft²' : 'm²');
const fmtNum = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString());

// One flat KPI card: 3px status accent bar, mono tag + uppercase label, big value.
function Kpi({ tag, label, value, unit, foot, tone }) {
  const barColor = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--border)';
  const valColor = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--text)';
  return (
    <div className="flat-card kpi">
      <span className="accent-bar" style={{ background: barColor }} />
      <div className="kpi-tagline">
        <span className="kpi-tag">{tag}</span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value" style={{ color: valColor }}>
        {value}
        {unit ? <span className="unit"> {unit}</span> : null}
      </div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}

export default function Dashboard({ project, spaces, snapshots }) {
  if (spaces.length === 0) {
    return <Empty>Define the brief first — add spaces in the Brief tab.</Empty>;
  }

  const leaves = leafSpaces(spaces);
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const units = project.units;
  const suffix = unitSuffix(units);

  const target = briefNet(spaces);
  const actual = latest ? snapshotNet(latest, spaces) : null;
  const variance = actual != null && target > 0 ? (actual - target) / target : null;
  const efficiency = latest && latest.gross_area > 0 ? snapshotNet(latest, spaces) / latest.gross_area : null;
  const varOk = variance != null && Math.abs(variance) <= project.tolerance;
  const effOk = efficiency != null && efficiency >= project.grossing_target;

  const catRollup = latest ? rollupBy(spaces, latest, project.tolerance, 'department') : [];
  const statuses = latest ? leaves.map((s) => ({ space: s, ...spaceStatus(s, latest, project.tolerance) })) : [];
  const flagged = statuses
    .filter((s) => s.status === 'over' || s.status === 'under')
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  return (
    <div className="screen">
      {/* KPI row */}
      <div className="kpi-grid">
        <Kpi tag="D·01" label="Brief net target" value={fmtNum(target)} unit={suffix} foot={`${leaves.length} spaces in programme`} tone="neutral" />
        <Kpi
          tag="D·02"
          label={`Designed net${latest ? ` · ${latest.label}` : ''}`}
          value={fmtNum(actual)}
          unit={actual != null ? suffix : ''}
          foot={latest ? latest.taken_at : 'No milestones recorded yet'}
          tone="neutral"
        />
        <Kpi
          tag="D·03"
          label="Programme variance"
          value={fmtPct(variance)}
          foot={`tolerance ±${Math.round(project.tolerance * 100)}%`}
          tone={variance == null ? 'neutral' : varOk ? 'good' : 'bad'}
        />
        <Kpi
          tag="D·04"
          label="Net : gross efficiency"
          value={efficiency != null ? fmtPct(efficiency, { signed: false }) : '—'}
          foot={`target ≥ ${Math.round(project.grossing_target * 100)}%`}
          tone={efficiency == null ? 'neutral' : effOk ? 'good' : 'bad'}
        />
      </div>

      {/* Drift chart */}
      {snapshots.length > 0 && (
        <div className="flat-card drift-card">
          <div className="sec-head">
            <span className="sec-tag">D·05</span>
            <span className="sec-title">Net area drift</span>
            <span className="sec-meta">designed net per milestone vs. brief target ±{Math.round(project.tolerance * 100)}%</span>
          </div>
          <div className="drift-wrap">
            <DriftChart project={project} spaces={spaces} snapshots={snapshots} />
          </div>
        </div>
      )}

      {/* Category rollup + flagged */}
      {latest && (
        <div className="two-grid">
          <div className="flat-card">
            <div className="sec-head">
              <span className="sec-tag t-accent2">D·06</span>
              <span className="sec-title">By category · {latest.label}</span>
            </div>
            <div className="rollup-head">
              <div>Category</div>
              <div className="r">Target</div>
              <div className="r">Designed</div>
              <div className="r">Δ</div>
            </div>
            {catRollup.map((r, i) => (
              <div className="rollup-row" key={r.department}>
                <div className="rollup-name">
                  <span className="swatch" style={{ background: categoryColor(r.department, i) }} />
                  {r.department}
                </div>
                <div className="rollup-cell" style={{ color: 'var(--muted)' }}>{fmtNum(r.target)}</div>
                <div className="rollup-cell">{r.hasActual ? fmtNum(r.actual) : '—'}</div>
                <div className="rollup-cell" style={{ fontWeight: 600, color: statusColor(r.status) }}>
                  {r.pct != null ? fmtPct(r.pct) : '—'}
                </div>
              </div>
            ))}
          </div>

          <div className="flat-card">
            <div className="sec-head">
              <span className="sec-tag t-bad">D·07</span>
              <span className="sec-title">Flagged spaces</span>
              <span className="sec-meta right mono">{flagged.length} outside ±{Math.round(project.tolerance * 100)}%</span>
            </div>
            {flagged.length === 0 ? (
              <Empty small>Every space is within tolerance.</Empty>
            ) : (
              flagged.map(({ space, target: t, actual: a, pct, status }) => (
                <div className="dl-row" key={space.id}>
                  <span className="swatch" style={{ background: categoryColor(space.department) }} />
                  <span className="dl-name" style={{ maxWidth: '46%', flex: 'none' }}>{space.name}</span>
                  <span className="dl-lead" />
                  <span className="dl-val">{fmtNum(t)} → {fmtNum(a)} {suffix}</span>
                  <span className="dl-val strong" style={{ color: statusColor(status), width: 56, textAlign: 'right' }}>
                    {fmtPct(pct)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
