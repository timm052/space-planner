// Adjacency compliance scoring — pure, React/DOM-free, so it's unit-testable.
//
// The bubble diagram lets the architect declare which spaces SHOULD be near each
// other (the `adjacencies` table, each link `required` or `desired`). This module
// grades how well the CURRENT layout honours those declarations: a link is "met"
// when the two bubbles' edge-to-edge gap is within a threshold, and the score is
// the weighted share of links that are met (required links weigh more).

// Edge-to-edge gap (metres) under which an adjacency counts as satisfied.
export const DEFAULT_THRESHOLDS_M = { required: 2, desired: 12 };

// Concept is scale-free, so its links are graded in diagram units against the
// force sim's own geometry. These are the rest gaps the adjacency springs aim
// at (edge to edge); the collision force separately keeps ALL bubbles ~20u
// apart, which is why "met" can't be "touching" — a settled, fully-honoured
// layout would score 0. A link is met when it sits within its spring's rest
// gap plus a little slack for sim jitter.
export const CONCEPT_REST_GAP_U = { required: 20, desired: 90 };
const CONCEPT_SLACK_U = 8;
export const CONCEPT_THRESHOLDS_U = {
  required: CONCEPT_REST_GAP_U.required + CONCEPT_SLACK_U,
  desired: CONCEPT_REST_GAP_U.desired + CONCEPT_SLACK_U,
};

// Required relationships matter more than desired ones.
export const LINK_WEIGHT = { required: 2, desired: 1 };

// Edge-to-edge gap between two circles, given centre distance and radii (same
// unit). Clamped at 0 so overlapping bubbles read as touching, not negative.
export function edgeGap(centerDist, rA, rB) {
  return Math.max(0, centerDist - rA - rB);
}

// Is a single link satisfied? `gap` and `thresholds` must share a unit (metres).
export function linkSatisfied(strength, gap, thresholds = DEFAULT_THRESHOLDS_M) {
  const t = thresholds[strength] ?? thresholds.desired;
  return gap <= t;
}

// A link's credit falls from 1 to 0 between its threshold and FALLOFF× it.
export const CREDIT_FALLOFF = 3;

// Graded credit for a single link, 0..1. Full credit within the threshold,
// then a smoothstep falloff to zero at CREDIT_FALLOFF × threshold. This makes
// the score respond to progress: nudging a badly-placed pair closer raises the
// score before the pair is fully satisfied, instead of the old all-or-nothing
// step at the threshold.
export function linkCredit(strength, gap, thresholds = DEFAULT_THRESHOLDS_M) {
  const t = thresholds[strength] ?? thresholds.desired;
  if (gap <= t) return 1;
  const limit = t * CREDIT_FALLOFF;
  if (gap >= limit) return 0;
  const x = (gap - t) / (limit - t); // 0 at the threshold → 1 at the limit
  return 1 - x * x * (3 - 2 * x); // 1 − smoothstep(x)
}

// Score a set of links. Each link is `{ strength, gap, ...anything }`; the extra
// fields (e.g. an id) are preserved on the returned `unmet` entries so callers
// can highlight them. Returns:
//   { score: 0..1 | null, met, total, metWeight, totalWeight, unmet: [links] }
// `score` is the weighted mean CREDIT (graded, see linkCredit); `met`/`unmet`
// stay strictly threshold-based so counts and highlighting are unambiguous.
// `metWeight` is the weighted credit sum (fractional when links are partial).
// `score` is null when there are no links to grade.
export function adjacencyScore(links, { thresholds = DEFAULT_THRESHOLDS_M, weight = LINK_WEIGHT } = {}) {
  let totalWeight = 0;
  let metWeight = 0;
  const unmet = [];
  for (const l of links) {
    const w = weight[l.strength] ?? 1;
    totalWeight += w;
    metWeight += w * linkCredit(l.strength, l.gap, thresholds);
    if (!linkSatisfied(l.strength, l.gap, thresholds)) unmet.push(l);
  }
  return {
    score: totalWeight > 0 ? metWeight / totalWeight : null,
    met: links.length - unmet.length,
    total: links.length,
    metWeight,
    totalWeight,
    unmet,
  };
}

// Roll room-to-room links up to their top-level containers. The envelope
// master plan draws buildings, not rooms, so a relationship between rooms in
// DIFFERENT buildings becomes one building-to-building link; same-building
// links disappear (they are an interior concern, graded in Concept/Building).
// `rootIdOf(space)` maps a space to its building root id (null = floating,
// dropped). Returns pseudo-links [{ id: 'agg:a:b', space_a, space_b, strength,
// count }] — strength is the strongest member ('required' wins), count how
// many room links rolled up. The synthetic ids mark them read-only for the UI.
export function aggregateByRoot(adjacencies, byId, rootIdOf) {
  const m = new Map();
  for (const l of adjacencies) {
    const sa = byId.get(l.space_a);
    const sb = byId.get(l.space_b);
    if (!sa || !sb) continue;
    const ra = rootIdOf(sa);
    const rb = rootIdOf(sb);
    if (ra == null || rb == null || ra === rb) continue;
    const [a, b] = ra < rb ? [ra, rb] : [rb, ra];
    const key = `${a}:${b}`;
    const cur = m.get(key);
    if (cur) {
      cur.count++;
      if (l.strength === 'required') cur.strength = 'required';
    } else {
      m.set(key, { id: `agg:${key}`, space_a: a, space_b: b, strength: l.strength, count: 1 });
    }
  }
  return [...m.values()];
}

// UI colour band for a 0..1 score: 'good' | 'warn' | 'bad' | null.
export function scoreBand(score) {
  if (score == null) return null;
  if (score >= 0.9) return 'good';
  if (score >= 0.7) return 'warn';
  return 'bad';
}

// Closest pair of instances between two spaces. `positions` is a Map keyed
// `"${spaceId}:${instanceIndex}"` → { x, y } (the sim's node map, or any
// projected copy of it — e.g. the stacked view's screen positions).
// Returns { a, b, d, ai, bi } or null when either space has no placed instance.
// Adjacency springs, link rendering, PDF links and the stacked view all share
// this one implementation.
export function closestInstancePair(positions, sa, sb) {
  let best = null;
  for (let i = 0; i < Math.max(1, sa.count || 1); i++) {
    const a = positions.get(`${sa.id}:${i}`);
    if (!a) continue;
    for (let j = 0; j < Math.max(1, sb.count || 1); j++) {
      const b = positions.get(`${sb.id}:${j}`);
      if (!b) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (!best || d < best.d) best = { a, b, d, ai: i, bi: j };
    }
  }
  return best;
}
