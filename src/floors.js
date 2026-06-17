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

// Isometric geometry for the stacked views. Each floor stays a flat plane (no
// solid thickness); the plane is tilted into an isometric parallelogram and, in
// the offset arrangement, raised by `lift` per storey so the floors stack.
//  kx, ky — horizontal / vertical foreshortening of the tilted plane
//  lift   — screen rise per floor in the offset arrangement
export const ISO = { kx: 0.82, ky: 0.46, lift: 250 };

// Project a plan point onto floor `k`'s isometric plane, tilted about `anchor`
// (which maps to itself, keeping the scene centred): the plan is rotated 45° and
// vertically foreshortened, then the floor is raised by k × lift.
export function isoProject(p, k = 0, anchor = { x: 0, y: 0 }, opts = ISO) {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  return {
    x: anchor.x + (dx - dy) * opts.kx,
    y: anchor.y + (dx + dy) * opts.ky - k * opts.lift,
  };
}

// Camera presets for the stacked 3-D views.
// azimuth: rotation around world Z (degrees). elevation: tilt above horizontal
// (0 = pure side elevation, 90 = straight down). perspective: 0 = orthographic.
export const CAMERAS = {
  iso:   { azimuth: 45,  elevation: 30, label: 'Isometric' },
  side:  { azimuth: 0,   elevation: 5,  label: 'Side elevation' },
  front: { azimuth: 90,  elevation: 5,  label: 'Front elevation' },
};
