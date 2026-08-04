import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  briefNet,
  briefTargetsFor,
  snapshotNet,
  spaceStatus,
  rollup as rollupBy,
  leafSpaces,
  fmtPct,
} from '../compute.js';
import { categoryColor, statusColor, STATUS_LABEL, STATUS_COLOR, STATUS_ORDER } from '../viz.js';
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

// D·08 — recent programme changes (the server-side change log): "when did the
// Foyer grow?" answered without archaeology. Geometry edits are never logged.
function HistoryCard({ project, spaces, briefSpaces }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    api.changes(project.id, 12).then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
    return () => { alive = false; };
    // The arrays get new identities on every refetch, so edits refresh this too.
  }, [project.id, spaces, briefSpaces]);
  if (!rows || rows.length === 0) return null;
  const what = (c) => {
    if (c.field === 'created') return `added${c.new ? ` (${c.new})` : ''}`;
    if (c.field === 'removed') return 'removed';
    return `${c.field} ${c.old ?? '—'} → ${c.new ?? '—'}`;
  };
  return (
    <div className="flat-card history-card">
      <div className="sec-head">
        <span className="sec-tag">D·08</span>
        <span className="sec-title">Recent changes</span>
        <span className="sec-meta right">programme edits only — geometry moves are not logged</span>
      </div>
      {rows.map((c) => (
        <div className="dl-row" key={c.id}>
          <span className="hist-date mono">{(c.at || '').slice(0, 16).replace('T', ' ')}</span>
          <span className={`hist-tree ${c.tree}`}>{c.tree === 'brief' ? 'Brief' : 'Design'}</span>
          <span className="dl-name" style={{ flex: 'none', maxWidth: '30%' }}>{c.name}</span>
          <span className="dl-lead" />
          <span className="dl-val">{what(c)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ project, spaces, briefSpaces = [], snapshots, selectedSpaceId = null, onGoToDiagram }) {
  if (spaces.length === 0) {
    return <Empty>No design yet — build the programme in the Brief tab, then use “⇄ Send to Design” to start the design.</Empty>;
  }

  const leaves = leafSpaces(spaces);
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const units = project.units;
  const suffix = unitSuffix(units);

  // The reference is the BRIEF (the agreed programme) whenever one exists;
  // rooms match by path. Without a Brief, the design's own targets stand in.
  const hasBrief = briefSpaces.length > 0;
  const targets = briefTargetsFor(spaces, briefSpaces);
  const target = hasBrief ? briefNet(briefSpaces) : briefNet(spaces);
  const briefLeafCount = hasBrief ? leafSpaces(briefSpaces).length : 0;
  const unmatched = hasBrief ? leaves.filter((s) => !targets.has(s.id)).length : 0;

  const actual = latest ? snapshotNet(latest, spaces) : null;
  const variance = actual != null && target > 0 ? (actual - target) / target : null;
  const efficiency = latest && latest.gross_area > 0 ? snapshotNet(latest, spaces) / latest.gross_area : null;
  const varOk = variance != null && Math.abs(variance) <= project.tolerance;
  const effOk = efficiency != null && efficiency >= project.grossing_target;

  const catRollup = latest ? rollupBy(spaces, latest, project.tolerance, 'department', targets) : [];
  const statuses = latest ? leaves.map((s) => ({ space: s, ...spaceStatus(s, latest, project.tolerance, targets) })) : [];
  const flagged = statuses
    .filter((s) => s.status === 'over' || s.status === 'under')
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  // Compliance mix across the programme — the segmented bar that echoes the
  // diagram's colour-by-status lens and the Building stacking bars.
  const statusCounts = STATUS_ORDER.map((k) => ({
    k,
    n: latest ? statuses.filter((s) => s.status === k).length : 0,
  })).filter((s) => s.n > 0);
  const goTo = onGoToDiagram || (() => {});

  return (
    <div className="screen">
      {/* KPI row */}
      <div className="kpi-grid">
        <Kpi
          tag="D·01"
          label={hasBrief ? 'Brief net target' : 'Design net (no Brief)'}
          value={fmtNum(target)}
          unit={suffix}
          foot={
            (hasBrief
              ? `${briefLeafCount} spaces in the Brief${unmatched > 0 ? ` · ${unmatched} design room${unmatched === 1 ? '' : 's'} not in it` : ''}`
              : 'No Brief yet — design areas stand in as the target') +
            (project.circulation != null && target > 0
              ? ` · est. gross ≈ ${fmtNum(target * (1 + project.circulation))} ${suffix}`
              : '')
          }
          tone="neutral"
        />
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
            <span className="sec-meta">designed net per milestone vs. {hasBrief ? 'the Brief' : 'design'} target ±{Math.round(project.tolerance * 100)}%</span>
          </div>
          <div className="drift-wrap">
            <DriftChart project={project} spaces={spaces} snapshots={snapshots} target={target} />
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
            {/* Compliance mix — the same status palette and segmented-bar
                vocabulary the diagram's colour-by-status lens uses. */}
            {statusCounts.length > 0 && (
              <div className="status-mix">
                <div className="status-bar">
                  {statusCounts.map((s) => (
                    <span
                      key={s.k}
                      style={{ width: `${(s.n / leaves.length) * 100}%`, background: STATUS_COLOR[s.k] }}
                      title={`${STATUS_LABEL[s.k]} — ${s.n} space${s.n === 1 ? '' : 's'}`}
                    />
                  ))}
                </div>
                <div className="status-legend">
                  {statusCounts.map((s) => (
                    <span className="status-legend-item" key={s.k}>
                      <span className="swatch" style={{ background: STATUS_COLOR[s.k] }} />
                      {STATUS_LABEL[s.k]} <span className="mono">{s.n}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
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
              <span className="sec-meta right mono">{flagged.length} outside ±{Math.round(project.tolerance * 100)}%{flagged.length > 0 ? ' · click to locate' : ''}</span>
            </div>
            {flagged.length === 0 ? (
              <Empty small>Every space is within tolerance.</Empty>
            ) : (
              flagged.map(({ space, target: t, actual: a, pct, status }) => (
                <div
                  className={`dl-row clickable ${selectedSpaceId === space.id ? 'sel' : ''}`}
                  key={space.id}
                  role="button"
                  tabIndex={0}
                  title={`Show ${space.name} on the diagram`}
                  onClick={() => goTo(space.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(space.id); } }}
                >
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

      <HistoryCard project={project} spaces={spaces} briefSpaces={briefSpaces} />
    </div>
  );
}
