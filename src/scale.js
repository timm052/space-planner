// Pure scale helpers for the bubble diagram. No React, so they're unit-testable.
//
// A diagram unit is defined as 0.2646 mm of paper (≈ 1 CSS px at 96 dpi). So a
// drawing at scale 1:R means 1 unit = R × M_PER_UNIT_PER_RATIO metres. The app
// stores this metres-per-unit value (display_scale); the ratio R is what the
// user picks (1:200, 1:500, …).
export const M_PER_UNIT_PER_RATIO = 0.0002646;

// Standard drawing scales offered per unit system. [ratio, label].
export const SCALE_PRESETS = {
  m2: [[100, '1:100'], [200, '1:200'], [500, '1:500'], [1000, '1:1000'], [2000, '1:2000']],
  ft2: [[96, '1/8″=1′'], [192, '1/16″=1′'], [240, '1″=20′'], [600, '1″=50′'], [1200, '1″=100′']],
};

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
