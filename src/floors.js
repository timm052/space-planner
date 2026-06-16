// Floor/level helpers for the bubble diagram's view modes. Pure & DOM-free, so
// they're unit-testable. A "level" is a space's storey label (spaces.level);
// the diagram can show all floors at once, one floor at a time, or stacked.

// Distinct, non-blank level labels among the given spaces, ordered by the
// earliest sort_order they appear at (so brief-authoring order ≈ ground → up),
// ties broken alphabetically.
export function orderedLevels(spaces) {
  const firstAt = new Map();
  for (const s of spaces) {
    const lv = (s.level || '').trim();
    if (!lv) continue;
    const so = s.sort_order ?? 0;
    if (!firstAt.has(lv) || so < firstAt.get(lv)) firstAt.set(lv, so);
  }
  return [...firstAt.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([label]) => label);
}

// label → 0-based height index (ground floor = 0).
export function levelRankMap(levels) {
  return new Map(levels.map((l, i) => [l, i]));
}

// Default stacked-view geometry: each floor lifts up and shifts slightly right.
export const STACK = { lift: 210, shift: 55 };

// Screen-space offset for a level in the stacked view. Ground (rank 0) sits at
// the origin; higher floors lift up (−y) and shift right (+x). Unknown levels
// fall to the ground plane.
export function stackOffset(level, rankMap, opts = STACK) {
  const k = rankMap.get((level || '').trim()) ?? 0;
  const dy = k * opts.lift;
  return { x: k * opts.shift, y: dy === 0 ? 0 : -dy };
}
