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

// Isometric projection geometry for the stacked view.
//  kx, ky    — horizontal / vertical foreshortening of the tilted floor plane
//  lift      — screen rise per floor (the gap between stacked slabs)
//  thickness — drawn slab depth, giving each floor solidity
export const ISO = { kx: 0.82, ky: 0.46, lift: 250, thickness: 18 };

// Project a plan point onto floor `k`'s isometric plane. The plan is tilted
// about `anchor` (which maps to itself, keeping the scene centred): rotated 45°
// and vertically foreshortened, then each floor is raised by k × lift so the
// floors stack with real height between them.
export function isoProject(p, k = 0, anchor = { x: 0, y: 0 }, opts = ISO) {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  return {
    x: anchor.x + (dx - dy) * opts.kx,
    y: anchor.y + (dx + dy) * opts.ky - k * opts.lift,
  };
}
