// Pure helpers for program-compliance math. All areas are in project units.

export function targetTotal(space) {
  return (space.count || 1) * (space.target_area || 0);
}

// ---------- Hierarchy ----------
// Spaces form a forest via parent_id. A "container" is a building/group kind, or
// any space that has children; its area rolls up from its leaf descendants.
// Only leaf spaces carry their own area and appear as bubbles.

export const CONTAINER_KINDS = new Set(['building', 'group']);

export function isContainerKind(space) {
  return CONTAINER_KINDS.has(space.kind);
}

export function childIdSet(spaces) {
  const set = new Set();
  for (const s of spaces) if (s.parent_id != null) set.add(s.parent_id);
  return set;
}

// A pure container groups its children and carries no area of its own:
// buildings/zones, and 'group'-mode spaces that have children.
export function isPureContainer(space, childIds) {
  if (isContainerKind(space)) return true;
  if (childIds && childIds.has(space.id)) return space.child_mode !== 'within' && space.child_mode !== 'attached';
  return false;
}

// True if an ancestor 'within' space already accounts for this space's area
// (so it must not be counted again or drawn as its own bubble).
export function isWithinDescendant(space, byId) {
  let cur = space;
  const seen = new Set();
  while (cur && cur.parent_id != null && byId.has(cur.parent_id) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parent_id);
    if (!isContainerKind(cur) && cur.child_mode === 'within') return true;
  }
  return false;
}

// A "leaf" carries area and draws a bubble: a space that isn't a pure container
// and isn't swallowed by a 'within' ancestor.
export function isLeaf(space, childIds = null, byId = null) {
  if (isPureContainer(space, childIds)) return false;
  if (byId && isWithinDescendant(space, byId)) return false;
  return true;
}

export function leafSpaces(spaces) {
  const childIds = childIdSet(spaces);
  const byId = new Map(spaces.map((s) => [s.id, s]));
  return spaces.filter((s) => isLeaf(s, childIds, byId));
}

export function childrenOf(spaces, parentId) {
  return spaces.filter((s) => (s.parent_id ?? null) === (parentId ?? null));
}

// Depth-first traversal returning { space, depth } from roots down.
export function orderedTree(spaces) {
  const byParent = new Map();
  for (const s of spaces) {
    const key = s.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(s);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const out = [];
  const visit = (parentKey, depth) => {
    for (const s of byParent.get(parentKey) || []) {
      out.push({ space: s, depth });
      visit(s.id, depth + 1);
    }
  };
  visit(null, 0);
  // Orphans (parent missing) fall back to root level.
  if (out.length < spaces.length) {
    const seen = new Set(out.map((o) => o.space.id));
    for (const s of spaces) if (!seen.has(s.id)) out.push({ space: s, depth: 0 });
  }
  return out;
}

// Sum of count*target_area over the area-carrying descendants of a space
// (includes self when it carries area; 'within' children are excluded).
export function subtreeArea(space, spaces) {
  const childIds = childIdSet(spaces);
  const byId = new Map(spaces.map((s) => [s.id, s]));
  let sum = 0;
  const visit = (s) => {
    if (isLeaf(s, childIds, byId)) sum += targetTotal(s);
    for (const c of spaces.filter((x) => x.parent_id === s.id)) visit(c);
  };
  visit(space);
  return sum;
}

// Top-most ancestor (the building) of a space, or null.
export function rootContainer(space, byId) {
  let cur = space;
  let root = null;
  const seen = new Set();
  while (cur && cur.parent_id != null && byId.has(cur.parent_id) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parent_id);
    root = cur;
  }
  return root;
}

// ---------- Compliance ----------

export function briefNet(spaces) {
  return leafSpaces(spaces).reduce((sum, s) => sum + targetTotal(s), 0);
}

export function snapshotNet(snapshot, spaces) {
  return leafSpaces(spaces).reduce((sum, s) => sum + (snapshot.areas[s.id] ?? 0), 0);
}

// Status of one space in one snapshot relative to brief & tolerance.
export function spaceStatus(space, snapshot, tolerance) {
  const target = targetTotal(space);
  const actual = snapshot.areas[space.id];
  if (actual == null) return { status: 'missing', target, actual: null, delta: null, pct: null };
  const delta = actual - target;
  const pct = target > 0 ? delta / target : 0;
  let status = 'on';
  if (pct > tolerance) status = 'over';
  else if (pct < -tolerance) status = 'under';
  return { status, target, actual, delta, pct };
}

// Roll up leaves by a grouping key ('department' or 'building').
export function rollup(spaces, snapshot, tolerance, by = 'department') {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const leaves = leafSpaces(spaces);
  const groups = new Map();
  for (const s of leaves) {
    let key = s.department || 'General';
    if (by === 'building') {
      const root = rootContainer(s, byId);
      key = root ? root.name : 'Unassigned';
    }
    const g = groups.get(key) || { key, target: 0, actual: 0, hasActual: false };
    g.target += targetTotal(s);
    const a = snapshot ? snapshot.areas[s.id] : null;
    if (a != null) {
      g.actual += a;
      g.hasActual = true;
    }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const delta = g.hasActual ? g.actual - g.target : null;
    const pct = g.hasActual && g.target > 0 ? delta / g.target : null;
    let status = 'missing';
    if (pct != null) {
      status = 'on';
      if (pct > tolerance) status = 'over';
      else if (pct < -tolerance) status = 'under';
    }
    return { ...g, department: g.key, delta, pct, status };
  });
}

// Back-compat alias.
export function departmentRollup(spaces, snapshot, tolerance) {
  return rollup(spaces, snapshot, tolerance, 'department');
}

// ---------- Units ----------
// Areas are stored in project units; physical scale math is metric.
export const M2_PER_FT2 = 0.09290304;
export const M_PER_FT = 0.3048;

export function areaToM2(area, units) {
  return units === 'ft2' ? area * M2_PER_FT2 : area;
}

export function distToMeters(d, units) {
  return units === 'ft2' ? d * M_PER_FT : d;
}

export function metersToDist(m, units) {
  return units === 'ft2' ? m / M_PER_FT : m;
}

export function distUnit(units) {
  return units === 'ft2' ? 'ft' : 'm';
}

export function fmtArea(value, units) {
  if (value == null || Number.isNaN(value)) return '—';
  const suffix = units === 'ft2' ? 'ft²' : 'm²';
  return `${Math.round(value).toLocaleString()} ${suffix}`;
}

export function fmtPct(value, { signed = true } = {}) {
  if (value == null || Number.isNaN(value)) return '—';
  const pct = value * 100;
  const sign = signed && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function buildCsv(project, spaces, snapshots) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const leaves = leafSpaces(spaces);
  const header = [
    'Building',
    'Department',
    'Space',
    'Count',
    'Unit Target',
    'Total Target',
    ...snapshots.map((sn) => `${sn.label} (${sn.taken_at})`),
  ];
  const rows = leaves.map((s) => {
    const root = rootContainer(s, byId);
    return [
      root ? root.name : '',
      s.department,
      s.name,
      s.count,
      s.target_area,
      targetTotal(s),
      ...snapshots.map((sn) => sn.areas[s.id] ?? ''),
    ];
  });
  const totals = [
    '',
    '',
    'NET TOTAL',
    '',
    '',
    briefNet(spaces),
    ...snapshots.map((sn) => snapshotNet(sn, spaces)),
  ];
  const gross = ['', '', 'GROSS (GIA)', '', '', '', ...snapshots.map((sn) => sn.gross_area || '')];
  return [header, ...rows, totals, gross].map((r) => r.map(esc).join(',')).join('\n');
}
