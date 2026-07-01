import { briefNet, snapshotNet } from '../compute.js';
import { statusColor } from '../viz.js';

// Flat SVG line chart: designed net area per milestone vs. brief target band (± tolerance).
// Drafting style — amber target line + faint ±tol band, dots colored by status,
// mono value labels above each point and Space Grotesk milestone names below.
export default function DriftChart({ project, spaces, snapshots }) {
  const W = 760;
  const H = 230;
  const PAD = { t: 22, r: 84, b: 40, l: 50 };

  const target = briefNet(spaces);
  const tol = project.tolerance;
  const pts = snapshots.map((sn, i) => {
    const net = snapshotNet(sn, spaces);
    const pct = target > 0 ? (net - target) / target : 0;
    let status = 'on';
    if (pct > tol) status = 'over';
    else if (pct < -tol) status = 'under';
    return { short: sn.label, date: sn.taken_at, net, i, status };
  });

  const vals = [target * (1 - tol), target * (1 + tol), ...pts.map((p) => p.net)];
  const min = Math.min(...vals) - 28;
  const max = Math.max(...vals) + 28;
  const X = (i) => (pts.length === 1 ? (PAD.l + W - PAD.r) / 2 : PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r));
  const Y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);

  const bandTop = Y(target * (1 + tol));
  const bandBottom = Y(target * (1 - tol));
  const yTicks = Array.from({ length: 5 }, (_, k) => min + (k / 4) * (max - min));
  const tolPct = `±${Math.round(tol * 100)}%`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Net area drift chart">
      {/* tolerance band */}
      <rect x={PAD.l} y={bandTop} width={W - PAD.l - PAD.r} height={Math.max(0, bandBottom - bandTop)} fill="var(--accent)" fillOpacity={0.07} />
      <line x1={PAD.l} x2={W - PAD.r} y1={bandTop} y2={bandTop} stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 4" opacity={0.4} />
      <line x1={PAD.l} x2={W - PAD.r} y1={bandBottom} y2={bandBottom} stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 4" opacity={0.4} />
      {/* target line + annotation */}
      <line x1={PAD.l} x2={W - PAD.r} y1={Y(target)} y2={Y(target)} stroke="var(--accent)" strokeWidth={1.5} />
      <text x={PAD.l} y={bandTop - 6} fill="var(--accent)" fontSize={10.5} fontWeight={600} fontFamily="JetBrains Mono, monospace">
        BRIEF TARGET {Math.round(target).toLocaleString()} · {tolPct}
      </text>
      {/* y gridlines + labels */}
      {yTicks.map((v, k) => (
        <g key={k}>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="var(--border-soft)" strokeWidth={1} opacity={0.6} />
          <text x={W - PAD.r + 8} y={Y(v) + 4} fill="var(--faint)" fontSize={10} fontFamily="JetBrains Mono, monospace" opacity={k === 2 ? 0 : 1}>
            {Math.round(v).toLocaleString()}
          </text>
        </g>
      ))}
      {/* series line */}
      {pts.length > 1 && (
        <path className="chart-line" d={pts.map((p, i) => `${i ? 'L' : 'M'} ${X(i)} ${Y(p.net)}`).join(' ')} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" />
      )}
      {/* dots + labels */}
      {pts.map((p) => (
        <g key={p.i}>
          <circle className="chart-dot" cx={X(p.i)} cy={Y(p.net)} r={6} fill="var(--canvas-bg)" stroke={statusColor(p.status)} strokeWidth={3} />
          <text x={X(p.i)} y={Y(p.net) - 14} textAnchor="middle" fill="var(--text)" fontSize={12} fontWeight={700} fontFamily="JetBrains Mono, monospace">
            {Math.round(p.net).toLocaleString()}
          </text>
          <text x={X(p.i)} y={H - PAD.b + 18} textAnchor="middle" fill="var(--text)" fontSize={11.5} fontWeight={600} fontFamily="Space Grotesk, sans-serif">
            {p.short}
          </text>
          <text x={X(p.i)} y={H - PAD.b + 33} textAnchor="middle" fill="var(--faint)" fontSize={10} fontFamily="JetBrains Mono, monospace">
            {p.date}
          </text>
        </g>
      ))}
    </svg>
  );
}
