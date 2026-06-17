// Pure geometry & rendering helpers for the bubble diagram. No React or DOM, so
// they're unit-testable in isolation (see test/geometry.test.js).

// Andrew's monotone-chain convex hull (counter-clockwise, no collinear points).
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// A soft, rounded closed path through a polygon's points (midpoint quadratics).
export function smoothHullPath(pts) {
  const n = pts.length;
  if (n < 3) return '';
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M ${mid(pts[n - 1], pts[0]).x} ${mid(pts[n - 1], pts[0]).y} `;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const m = mid(cur, pts[(i + 1) % n]);
    d += `Q ${cur.x} ${cur.y} ${m.x} ${m.y} `;
  }
  return d + 'Z';
}

// Resolve a space's per-instance pins into a { instanceIndex: {x,y} } map.
// Prefers the current pin_json; falls back to the legacy single pin_x/pin_y
// (read as instance 0); tolerates malformed JSON.
export function pinsOf(s) {
  if (s.pin_json) {
    try {
      return JSON.parse(s.pin_json) || {};
    } catch {
      return {};
    }
  }
  if (s.pin_x != null) return { 0: { x: s.pin_x, y: s.pin_y } };
  return {};
}

// Diagrammatic image filter presets (applied as CSS filters on screen and baked
// into the PDF via canvas ctx.filter). [value, label].
export const IMAGE_FILTERS = [
  ['', 'None'],
  ['grayscale', 'Grayscale'],
  ['blueprint', 'Blueprint'],
  ['faded', 'Faded'],
  ['contrast', 'High contrast'],
  ['ink', 'Ink / line'],
];

export function filterCss(f) {
  return (
    {
      grayscale: 'grayscale(1) contrast(1.1)',
      blueprint: 'grayscale(1) brightness(0.85) sepia(1) hue-rotate(175deg) saturate(5) contrast(1.1)',
      faded: 'saturate(0.5) contrast(0.82) brightness(1.1)',
      contrast: 'contrast(1.6) brightness(1.05)',
      ink: 'grayscale(1) contrast(2.2) brightness(1.15)',
    }[f] || 'none'
  );
}
