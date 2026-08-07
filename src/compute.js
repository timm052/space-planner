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

// Letter label for one instance of a count>1 space: 0→A, 1→B … 25→Z, then AA,
// AB, … So "Meeting Rooms" with count 3 reads as A / B / C. Distinct copies of
// a room are lettered so relationships can name the specific one.
export function instanceLabel(i) {
  const n = Math.max(0, Math.trunc(i || 0));
  if (n < 26) return String.fromCharCode(65 + n);
  return String.fromCharCode(64 + Math.floor(n / 26)) + String.fromCharCode(65 + (n % 26));
}

// Display name for a space instance — appends the instance letter only when the
// space has more than one room (count>1). count=1 spaces read as just the name.
export function instanceName(space, inst) {
  return Math.max(1, space?.count || 1) > 1 ? `${space.name} ${instanceLabel(inst)}` : space.name;
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
// `cmp` (optional) reorders siblings — a display sort that leaves the
// persisted sort_order untouched.
export function orderedTree(spaces, cmp = null) {
  const byParent = new Map();
  for (const s of spaces) {
    const key = s.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(s);
  }
  for (const list of byParent.values()) list.sort(cmp || ((a, b) => a.sort_order - b.sort_order || a.id - b.id));
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

// ---------- Brief matching ----------
// The Brief (brief_spaces) and the Design (spaces) are independent trees;
// rooms correspond by PATH — name plus ancestor names, case-insensitive —
// the same rule the server uses for overwrite/pull reconciliation.

// Siblings that share a name would collide, so duplicates take ' #2', ' #3', …
// in (sort_order, id) order — the n-th duplicate in one tree matches the n-th
// in the other. The server's pathKeys (server/brief.js) must stay identical.
export function pathKeyMap(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Siblings grouped per parent; a parent missing from `rows` counts as root.
  const kids = new Map();
  for (const r of rows) {
    const pid = r.parent_id != null && byId.has(r.parent_id) ? r.parent_id : null;
    if (!kids.has(pid)) kids.set(pid, []);
    kids.get(pid).push(r);
  }
  const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0);
  const keys = new Map();
  // Top-down, so each key extends its parent's already-disambiguated key.
  const stack = [[null, '']];
  while (stack.length) {
    const [pid, parentKey] = stack.pop();
    const group = kids.get(pid);
    if (!group) continue;
    const used = new Set();
    for (const r of group.sort(bySort)) {
      const base = (r.name || '').trim().toLowerCase();
      let name = base;
      for (let n = 2; used.has(name); n++) name = `${base} #${n}`;
      used.add(name);
      const key = parentKey ? `${parentKey} / ${name}` : name;
      keys.set(r.id, key);
      stack.push([r.id, key]);
    }
  }
  // Rows inside a parent cycle are unreachable from any root (the API rejects
  // cycles, but stay total on bad data): key them by their raw name walk.
  for (const r of rows) {
    if (keys.has(r.id)) continue;
    const parts = [];
    const seen = new Set();
    for (let cur = r; cur && !seen.has(cur.id); cur = cur.parent_id != null ? byId.get(cur.parent_id) : null) {
      seen.add(cur.id);
      parts.push((cur.name || '').trim().toLowerCase());
    }
    keys.set(r.id, parts.reverse().join(' / '));
  }
  return keys;
}

// Map each Design leaf id → the matching Brief room's total target area.
// Null when the Brief is empty (callers fall back to design targets).
export function briefTargetsFor(spaces, briefSpaces) {
  if (!briefSpaces || briefSpaces.length === 0) return null;
  const designKeys = pathKeyMap(spaces);
  const briefKeys = pathKeyMap(briefSpaces);
  const briefByKey = new Map(leafSpaces(briefSpaces).map((b) => [briefKeys.get(b.id), b]));
  const m = new Map();
  for (const s of leafSpaces(spaces)) {
    const b = briefByKey.get(designKeys.get(s.id));
    if (b) m.set(s.id, targetTotal(b));
  }
  return m;
}

// The target a Design space is measured against: its Brief match when one
// exists, else its own design target.
export function effectiveTarget(space, targets) {
  return targets && targets.has(space.id) ? targets.get(space.id) : targetTotal(space);
}

/**
 * WHERE that target came from — the distinction the compliance figures depend on.
 *
 *   'brief'     matched to a Brief room; the agreed figure
 *   'own'       no Brief exists at all, so the design's own target is the only
 *               one there is. A legitimate fallback.
 *   'unmatched' a Brief EXISTS but this room has no counterpart in it.
 *
 * The last case must never quietly fall back to the design's own target: doing
 * so measures the design against itself and reports 0% — an on-target reading
 * for a room nobody agreed. Callers render it as unmatched instead.
 */
export function targetSource(space, targets) {
  if (!targets) return 'own';
  return targets.has(space.id) ? 'brief' : 'unmatched';
}

// ---------- Compliance ----------

export function briefNet(spaces) {
  return leafSpaces(spaces).reduce((sum, s) => sum + targetTotal(s), 0);
}

export function snapshotNet(snapshot, spaces) {
  return leafSpaces(spaces).reduce((sum, s) => sum + (snapshot.areas[s.id] ?? 0), 0);
}

// Status of one space in one snapshot relative to its target & tolerance.
// `targets` (optional Map from briefTargetsFor) overrides the design target
// with the Brief's, so drift is measured against the agreed programme.
export function spaceStatus(space, snapshot, tolerance, targets = null) {
  const source = targetSource(space, targets);
  const target = effectiveTarget(space, targets);
  const actual = snapshot.areas[space.id];
  if (actual == null) return { status: 'missing', source, target, actual: null, delta: null, pct: null };
  // No agreed figure to measure against — report that, not a variance.
  if (source === 'unmatched') return { status: 'unmatched', source, target: null, actual, delta: null, pct: null };
  const delta = actual - target;
  const pct = target > 0 ? delta / target : 0;
  let status = 'on';
  if (pct > tolerance) status = 'over';
  else if (pct < -tolerance) status = 'under';
  return { status, source, target, actual, delta, pct };
}

// Roll up leaves by a grouping key ('department' or 'building').
// `targets` (optional) measures against Brief targets, as in spaceStatus.
export function rollup(spaces, snapshot, tolerance, by = 'department', targets = null) {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const leaves = leafSpaces(spaces);
  const groups = new Map();
  for (const s of leaves) {
    let key = s.department || 'General';
    if (by === 'building') {
      const root = rootContainer(s, byId);
      key = root ? root.name : 'Unassigned';
    }
    const g = groups.get(key) || { key, target: 0, actual: 0, hasActual: false, unmatched: 0 };
    // A room with no Brief counterpart contributes no agreed target. Folding
    // its own design figure in would inflate the group's target to exactly its
    // actual and report the group as on-target — so it is counted, not summed.
    if (targetSource(s, targets) === 'unmatched') g.unmatched++;
    else g.target += effectiveTarget(s, targets);
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

export function buildCsv(project, spaces, snapshots, briefSpaces = []) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const leaves = leafSpaces(spaces);
  // Brief columns appear once a Brief exists: the agreed target per room
  // (matched by path) and the design's variance against it.
  const hasBrief = briefSpaces.length > 0;
  const targets = briefTargetsFor(spaces, briefSpaces);
  const header = [
    'Building',
    'Department',
    'Space',
    'Count',
    'Unit Target',
    'Total Target',
    ...(hasBrief ? ['Brief Target', 'vs Brief %'] : []),
    ...snapshots.map((sn) => `${sn.label} (${sn.taken_at})`),
  ];
  const rows = leaves.map((s) => {
    const root = rootContainer(s, byId);
    // MATCHED is `targets.has(id)`, never truthiness of the value: a room whose
    // agreed target is legitimately 0 is matched, and reporting it as unmatched
    // sends the reader hunting for a Brief row that is right there.
    const matched = !!targets && targets.has(s.id);
    const bt = matched ? targets.get(s.id) : null;
    // An unmatched room gets the word, not an empty cell. Blank reads as "no
    // data yet"; this room has data and no agreed figure to measure it against,
    // which is a different — and more urgent — thing for a reader to know.
    const briefCols = hasBrief
      ? [matched ? bt : '', matched ? (bt > 0 ? Math.round(((targetTotal(s) - bt) / bt) * 1000) / 10 : '') : 'unmatched']
      : [];
    return [
      root ? root.name : '',
      s.department,
      s.name,
      s.count,
      s.target_area,
      targetTotal(s),
      ...briefCols,
      ...snapshots.map((sn) => sn.areas[s.id] ?? ''),
    ];
  });
  // Brief rooms with no matching design room yet — still part of the programme.
  if (hasBrief) {
    const designKeySet = new Set(pathKeyMap(spaces).values());
    const briefKeys = pathKeyMap(briefSpaces);
    for (const b of leafSpaces(briefSpaces)) {
      if (designKeySet.has(briefKeys.get(b.id))) continue;
      rows.push(['', b.department, `${b.name} (Brief only)`, b.count, b.target_area, '', targetTotal(b), '', ...snapshots.map(() => '')]);
    }
  }
  const totals = [
    '',
    '',
    'NET TOTAL',
    '',
    '',
    briefNet(spaces),
    ...(hasBrief ? [briefNet(briefSpaces), ''] : []),
    ...snapshots.map((sn) => snapshotNet(sn, spaces)),
  ];
  const gross = ['', '', 'GROSS (GIA)', '', '', '', ...(hasBrief ? ['', ''] : []), ...snapshots.map((sn) => sn.gross_area || '')];
  return [header, ...rows, totals, gross].map((r) => r.map(esc).join(',')).join('\n');
}
