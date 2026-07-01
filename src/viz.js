// Visual helpers shared across the redesigned screens (Diagram, Brief, Dashboard).

// Darken a hex color toward black by `amt` (0..1) → "rgb(r,g,b)".
// Used for poché keylines (amt .4) and ink/text on filled shapes (amt .62).
export function darkHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.round(r * (1 - amt));
  g = Math.round(g * (1 - amt));
  b = Math.round(b * (1 - amt));
  return `rgb(${r},${g},${b})`;
}

// Squarified treemap (Bruls et al.). items: [{id, value>0}] → [{id,x,y,w,h}].
// Pass items already sorted by value descending for best aspect ratios.
export function squarify(items, W, H) {
  const total = items.reduce((s, d) => s + d.value, 0) || 1;
  const scale = (W * H) / total;
  const data = items.map((d) => ({ id: d.id, area: d.value * scale }));
  const result = [];
  let rect = { x: 0, y: 0, w: W, h: H };
  let row = [];
  const worst = (rw, side) => {
    if (!rw.length) return Infinity;
    let sum = 0;
    let mx = -Infinity;
    let mn = Infinity;
    rw.forEach((d) => {
      sum += d.area;
      if (d.area > mx) mx = d.area;
      if (d.area < mn) mn = d.area;
    });
    const s2 = sum * sum;
    const w2 = side * side;
    return Math.max((w2 * mx) / s2, s2 / (w2 * mn));
  };
  const layout = () => {
    const side = Math.min(rect.w, rect.h);
    const sum = row.reduce((s, d) => s + d.area, 0);
    const thick = sum / side;
    if (rect.w <= rect.h) {
      // band spans width
      let cx = rect.x;
      row.forEach((d) => {
        const cw = d.area / thick;
        result.push({ id: d.id, x: cx, y: rect.y, w: cw, h: thick });
        cx += cw;
      });
      rect = { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
    } else {
      // band spans height
      let cy = rect.y;
      row.forEach((d) => {
        const ch = d.area / thick;
        result.push({ id: d.id, x: rect.x, y: cy, w: thick, h: ch });
        cy += ch;
      });
      rect = { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h };
    }
    row = [];
  };
  let i = 0;
  while (i < data.length) {
    const d = data[i];
    const side = Math.min(rect.w, rect.h);
    if (row.length === 0 || worst(row.concat(d), side) <= worst(row, side)) {
      row.push(d);
      i++;
    } else {
      layout();
    }
  }
  if (row.length) layout();
  return result;
}

// Category (department) colors — same in both themes.
export const CATEGORY_COLORS = {
  Public: '#f0b53f',
  Staff: '#5b9dd9',
  Support: '#4cc38a',
  Community: '#c678dd',
};

// Building colors.
export const BUILDING_COLORS = {
  'Main Library': '#f0b53f',
  'Community Pavilion': '#57c7d4',
};

// Status (drift / compliance) → CSS color variable.
// On target green, over = amber warn, under = cyan, missing = faint.
export const STATUS_COLOR = {
  on: 'var(--good)',
  over: 'var(--warn)',
  under: 'var(--accent2)',
  missing: 'var(--faint)',
};

export function statusColor(status) {
  return STATUS_COLOR[status] || 'var(--muted)';
}

const CATEGORY_FALLBACK = ['#f0b53f', '#5b9dd9', '#4cc38a', '#c678dd', '#e5675f', '#57c7d4'];

// Stable color for a category name, falling back to a palette cycle for
// categories not in the seed set.
export function categoryColor(name, index = 0) {
  return CATEGORY_COLORS[name] || CATEGORY_FALLBACK[index % CATEGORY_FALLBACK.length];
}
