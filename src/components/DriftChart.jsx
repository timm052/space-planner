import { briefNet, snapshotNet } from '../compute.js';

// SVG line chart: designed net area per milestone vs. brief target band (± tolerance).
export default function DriftChart({ project, spaces, snapshots }) {
  const W = 760;
  const H = 240;
  const PAD = { top: 16, right: 24, bottom: 36, left: 64 };

  const target = briefNet(spaces);
  const points = snapshots.map((sn, i) => ({ label: sn.label, date: sn.taken_at, net: snapshotNet(sn, spaces), i }));

  const values = [target, ...points.map((p) => p.net)];
  const min = Math.min(...values) * 0.92;
  const max = Math.max(...values) * 1.08;

  const x = (i) =>
    points.length === 1
      ? (PAD.left + W - PAD.right) / 2
      : PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

  const tolTop = y(target * (1 + project.tolerance));
  const tolBottom = y(target * (1 - project.tolerance));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.net)}`).join(' ');

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, k) => min + (k / ticks) * (max - min));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Net area drift chart">
      {/* tolerance band */}
      <rect
        x={PAD.left}
        y={tolTop}
        width={W - PAD.left - PAD.right}
        height={Math.max(0, tolBottom - tolTop)}
        className="chart-band"
      />
      {/* target line */}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} className="chart-target" />
      <text x={W - PAD.right} y={y(target) - 6} textAnchor="end" className="chart-label">
        brief target
      </text>

      {/* y axis */}
      {yTicks.map((v, k) => (
        <g key={k}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
          <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="chart-label">
            {Math.round(v).toLocaleString()}
          </text>
        </g>
      ))}

      {/* series */}
      {points.length > 1 && <path d={path} className="chart-line" />}
      {points.map((p) => (
        <g key={p.i}>
          <circle cx={x(p.i)} cy={y(p.net)} r="5" className="chart-dot" />
          <text x={x(p.i)} y={H - PAD.bottom + 18} textAnchor="middle" className="chart-label">
            {p.label}
          </text>
          <text x={x(p.i)} y={H - PAD.bottom + 32} textAnchor="middle" className="chart-label dim">
            {p.date}
          </text>
        </g>
      ))}
    </svg>
  );
}
