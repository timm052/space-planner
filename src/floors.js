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

// Vertical gap left between stacked floor plates in the "offset" arrangement.
export const FLOOR_GAP = 56;

// Screen offset for a floor at height-rank `k`, keeping each floor a flat 2D
// plan (no projection/rotation):
//   'offset'   → floors separate vertically by `spacing`, ground at the bottom,
//                centred about the origin (top floor up, ground floor down).
//   'overlaid' → every floor shares the same position (drawn translucently, on
//                top of one another) so footprints can be compared.
export function floorOffset(k, mode, spacing, levelCount = 1) {
  if (mode !== 'offset') return { x: 0, y: 0 };
  const recenter = ((levelCount - 1) * spacing) / 2;
  return { x: 0, y: recenter - k * spacing };
}
