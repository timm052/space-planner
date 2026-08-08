// Pure scale helpers for the bubble diagram. No React, so they're unit-testable.
//
// A diagram unit is defined as 0.2646 mm of paper (≈ 1 CSS px at 96 dpi). So a
// drawing at scale 1:R means 1 unit = R × M_PER_UNIT_PER_RATIO metres. The app
// stores this metres-per-unit value (display_scale); the ratio R is what the
// user picks (1:200, 1:500, …).
export const M_PER_UNIT_PER_RATIO = 0.0002646;

// Standard drawing scales offered per unit system. [ratio, label].
// The ladder runs to 1:10000 because it has to carry a site, not just a
// building: at 1:2000 — the old ceiling — a 50 ha structure plan does not fit
// on A1, which put the whole scale control out of reach for the work it
// exists to serve.
export const SCALE_PRESETS = {
  m2: [[100, '1:100'], [200, '1:200'], [500, '1:500'], [1000, '1:1000'], [2000, '1:2000'], [2500, '1:2500'], [5000, '1:5000'], [10000, '1:10000']],
  ft2: [[96, '1/8″=1′'], [192, '1/16″=1′'], [240, '1″=20′'], [600, '1″=50′'], [1200, '1″=100′'], [2400, '1″=200′'], [6000, '1″=500′']],
};

/**
 * The nearest standard ratio to `r`, and whether `r` already is one.
 *
 * "Auto" fits the drawing to the sheet, which lands on ratios like 1:1159 —
 * a sheet nobody can scale off with a rule, and easy to ship precisely
 * because it is the default. Export uses this to say so.
 */
export function nearestPreset(ratio, units = 'm2') {
  const list = SCALE_PRESETS[units] || SCALE_PRESETS.m2;
  let best = list[0];
  for (const p of list) if (Math.abs(p[0] - ratio) < Math.abs(best[0] - ratio)) best = p;
  return { ratio: best[0], label: best[1], isStandard: list.some((p) => p[0] === Math.round(ratio)) };
}

// Ratio (1:R) → metres per diagram unit.
export const ratioToScale = (ratio) => ratio * M_PER_UNIT_PER_RATIO;

// Metres per unit → nearest standard ratio R.
export const scaleToRatio = (scale) => Math.round(scale / M_PER_UNIT_PER_RATIO);

// Uniform "zoom in place" about a fixed anchor: p' = A + (p - A) × f.
// Used on a scale change so bubbles, pins and image layers all rescale together
// about the viewport centre and stay aligned. See docs/ARCHITECTURE.md §6.3.
export function zoomAbout(point, anchor, f) {
  return { x: anchor.x + (point.x - anchor.x) * f, y: anchor.y + (point.y - anchor.y) * f };
}
