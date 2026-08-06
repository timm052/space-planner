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

// Lighten a hex color toward white by `amt` (0..1) → "rgb(r,g,b)".
export function lightHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.round(r + (255 - r) * amt);
  g = Math.round(g + (255 - g) * amt);
  b = Math.round(b + (255 - b) * amt);
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Colour-vision maths. Lives here so the palette guard, the legend's colour
// picker and the regression test all share ONE implementation — the defect
// this exists to prevent was two palettes drifting apart unnoticed.
// ---------------------------------------------------------------------------

const srgbToLinear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const linearToSrgb = (v) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Simulate dichromatic vision (Viénot, Brettel & Mollon 1999). */
export function simulateCvd(rgb, type = 'deutan') {
  const [r, g, b] = rgb.map(srgbToLinear);
  const L = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  const M = 3.45565 * r + 27.1554 * g + 3.86714 * b;
  const S = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  const L2 = type === 'protan' ? 2.02344 * M - 2.52581 * S : L;
  const M2 = type === 'deutan' ? 0.494207 * L + 1.24827 * S : M;
  return [
    linearToSrgb(0.080944 * L2 - 0.130504 * M2 + 0.116721 * S),
    linearToSrgb(-0.0102485 * L2 + 0.0540194 * M2 - 0.113615 * S),
    linearToSrgb(-0.000365294 * L2 - 0.00412163 * M2 + 0.693513 * S),
  ];
}

export function toLab(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
/** CIE76 colour difference. */
export const deltaE76 = (a, b) => Math.hypot(...toLab(a).map((v, i) => v - toLab(b)[i]));

/** Below this two categorical fills stop reading as different colours. */
export const CVD_MIN_DE = 30;

/**
 * Why a chosen colour is a poor category colour, or null if it is fine.
 * `others` is [{ label, hex }] for the categories it has to sit beside.
 * Checks normal vision, both common dichromacies, and the status vocabulary —
 * a category that matches "over target" red carries a meaning it should not.
 */
export function categoryColorWarning(hex, others = []) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const c = hexToRgb(hex);
  for (const o of others) {
    if (!o?.hex || !/^#[0-9a-f]{6}$/i.test(o.hex)) continue;
    const oc = hexToRgb(o.hex);
    if (deltaE76(c, oc) < 12) return `Too close to “${o.label}” to tell apart.`;
    for (const [type, name] of [['deutan', 'red-green'], ['protan', 'red-green (protan)']]) {
      if (deltaE76(simulateCvd(c, type), simulateCvd(oc, type)) < CVD_MIN_DE) {
        return `Reads the same as “${o.label}” to ${name} colour blindness.`;
      }
    }
  }
  for (const [key, shex] of Object.entries(STATUS_HEX)) {
    if (deltaE76(c, hexToRgb(shex)) < 15) return `Too close to the “${STATUS_LABEL[key]}” status colour.`;
  }
  return null;
}

// Ink for text sitting ON an opaque fill of `hex` (room labels, treemap tiles).
//
// This used to be a fixed `darkHex(fill, 0.62)`, which silently constrains the
// palette: it only works while every fill is light enough that a 38%-of-fill
// ink still contrasts. That is why the category palette could not use a
// lightness ladder — and lightness is precisely the channel that survives
// colour-vision deficiency, so the constraint was forcing the palette to
// separate by hue alone. Branching on the fill's own luminance removes it:
// light fills take dark ink, dark fills take light ink, and any palette works.
export function pocheInk(hex) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lumOf = ([r, g, b]) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  const parse = (c) => c.match(/\d+/g).map(Number);
  const n = parseInt(hex.slice(1), 16);
  const fill = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const ratio = (a, b) => {
    const [hi, lo] = [lumOf(a), lumOf(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // A single luminance threshold leaves a dead zone: a mid-luminance teal
  // (#3faa9c) is neither light enough for dark ink nor dark enough for light
  // ink, and lands at 4.00:1. Evaluate both directions and take the winner —
  // correct for any fill, including whatever a user picks from the legend.
  // 0.70 / 0.90 is the shallowest pair that clears 4.5:1 across the whole
  // palette: 0.62 left the mid-luminance teal at 4.00, and 0.82 on the light
  // side left the indigo at 4.27. Worst case is now 4.77.
  const dark = darkHex(hex, 0.7);
  const light = lightHex(hex, 0.9);
  return ratio(parse(dark), fill) >= ratio(parse(light), fill) ? dark : light;
}

// Colour-tinted TEXT ink that stays readable against the theme background —
// for labels that sit on the canvas, on floor plates or on translucent fills
// (anything whose effective backdrop is ≈ the theme bg, NOT a solid colour
// fill: text on solid fills keeps plain darkHex ink in both themes). Dark
// theme pushes the hue toward white, light theme toward black.
export function labelInk(hex, theme) {
  return theme === 'light' ? darkHex(hex, 0.55) : lightHex(hex, 0.72);
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
//
// A "warm/cool split": two warm hues (amber, clay) against two cool ones
// (steel, teal). Chosen against three constraints, all pinned by
// test/tokens.contrast.test.js:
//
//  1. Dichromatic separation. The previous palette paired a blue (#5b9dd9)
//     with a purple (#c678dd) — 50.4 ΔE to normal vision but **3.3 ΔE** to a
//     deuteranope, i.e. two departments rendered as one colour for ~1 in 12
//     men. Blue+purple collides in every palette we tried; clay replaces the
//     purple outright. Now: deutan 22.3, protan 27.2.
//  2. No collision with STATUS_HEX. `Support` used to be #4cc38a — the *exact*
//     hex of "on target", so the same green meant two different things
//     depending on which lens was active. Minimum distance is now 15.4 ΔE.
//  3. Mid-luminance (L* 58–77), because labelInk() derives label ink by a
//     fixed offset from the fill rather than by luminance. A dark fill would
//     produce dark-on-dark ink.
//
// Four is the practical ceiling for hue-only encoding: every 5- and 6-colour
// set we measured fell to ΔE 5–6 under simulation. Beyond four, add a second
// channel (hatch) rather than another hue.
// The hues are spread AND stepped in lightness (L* 80 / 64 / 44 / 44 with
// opposed hues at the bottom). Hue alone was not enough: an earlier
// amber/steel/teal/clay set scored an acceptable-looking 22.3 ΔE, but a
// deuteranopia simulation of the actual canvas still read as two families,
// because steel and teal sat at nearly the same lightness (L* 66 vs 68).
// Lightness is the channel that survives colour-vision deficiency, so it is
// now an explicit ladder — which lifts the worst dichromatic pair to 34.7.
export const CATEGORY_COLORS = {
  Public: '#f0c04f',    // amber   L* 80
  Staff: '#3faa9c',     // teal    L* 64
  Support: '#4a63c0',   // indigo  L* 44
  Community: '#a35234', // clay    L* 44, opposed hue
};

// Building colors. Drawn from the same palette so the building lens and the
// category lens read as one system — and, like the categories, kept clear of
// STATUS_HEX (the old '#57c7d4' was the "under target" teal).
export const BUILDING_COLORS = {
  'Main Library': '#f0b53f',
  'Community Pavilion': '#7aa6cc',
};

// Canonical compliance-status vocabulary — ONE source shared by the diagram's
// colour-by-status lens (useCategoryColors), the Brief lens, the Dashboard,
// the drift chart and the milestone cards. Over target reads RED (a designed
// area exceeding the brief is the thing to flag), on target GREEN, under
// target TEAL, no data MUTED. The hexes equal --bad / --good / --accent2 /
// --muted so canvas code (which needs literal colours) and CSS-var code agree.
export const STATUS_LABEL = { over: 'Over target', on: 'On target', under: 'Under target', missing: 'No milestone data' };
export const STATUS_HEX = { over: '#e5675f', on: '#4cc38a', under: '#57c7d4', missing: '#8d96a8' };
// Fixed display order (over → on → under → missing) for legends and swatches.
export const STATUS_ORDER = ['over', 'on', 'under', 'missing'];

// Status → CSS color variable (theme-adaptive form of STATUS_HEX).
export const STATUS_COLOR = {
  on: 'var(--good)',
  over: 'var(--bad)',
  under: 'var(--accent2)',
  missing: 'var(--muted)',
};

export function statusColor(status) {
  return STATUS_COLOR[status] || 'var(--muted)';
}

// Cycle for categories outside the seeded set. The first four are the seeded
// palette; the last two extend it for projects with more departments. Those
// two are NOT dichromat-separable from the rest (nothing is, past four — see
// above), but they are kept clear of STATUS_HEX so no category can be mistaken
// for a compliance state. The old cycle ended in '#e5675f' and '#57c7d4' —
// literally "over target" and "under target".
// The 5th and 6th were originally chosen by eye and measured 14.3 / 18.9 ΔE
// against the seeded four under simulation — the live legend warning flagged
// "Public reads the same as General" on a real five-category project. Re-picked
// under the same constraints as the four (distinct to normal vision AND to both
// dichromacies, clear of the status hues, usable with the ink rule): now 34.3
// and 30.8. Past six, hue is exhausted — the legend warning is the backstop.
export const CATEGORY_FALLBACK = ['#f0c04f', '#3faa9c', '#4a63c0', '#a35234', '#a1b1f2', '#9bd99b'];

// Stable color for a category name, falling back to a palette cycle for
// categories not in the seed set.
export function categoryColor(name, index = 0) {
  return CATEGORY_COLORS[name] || CATEGORY_FALLBACK[index % CATEGORY_FALLBACK.length];
}
