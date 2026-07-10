// Pure scene builders for the stacked (axonometric SVG) and WebGL 3-D floor
// views. No React, no refs — everything arrives as arguments, so both are
// unit-testable and rebuild cheaply inside the canvas TickLayer each frame.
import { ISO } from '../../floors.js';
import { closestInstancePair } from '../../adjacency.js';
import { W, H } from '../../hooks/useViewport.js';

/**
 * Build the stacked axonometric scene — a fixed isometric camera (the WebGL
 * 3-D view owns free cameras and elevations; this is THE clean axon diagram).
 *
 * World coordinate system: x/y = plan (same as the simulation), z = height
 * (z increases upward; z=0 = ground floor).
 *
 * Because the camera is orthographic, every constant-z floor plane maps to
 * the screen by ONE affine transform — each floor exposes it as
 * `planeTransform` (an SVG matrix string), so plates and room footprints
 * drawn in PLAN coordinates inside that group foreshorten exactly onto the
 * plane: circles become ellipses, boxes parallelograms, outlines true plan
 * shapes. Labels should stay OUTSIDE the group (screen space) — the shear
 * would distort text.
 *
 * Camera centering: the mid-floor anchor (W/2, H/2) maps to screen centre.
 *
 * @param {object} p
 * @param {Map}      p.nodes      instance key → {x, y} (live sim positions)
 * @param {Array}    p.instances  [{s, i, key}]
 * @param {string[]} p.levels     storey labels, ground → up
 * @param {Map}      p.levelRank  level label → rank (0 = ground)
 * @param {function} p.radiusOf   (space) → radius in diagram units
 * @param {function} p.levelOf    (space) → its level label
 * @param {string}   p.floorMode  'offset' | 'overlaid'
 * @param {number}   p.floorGap   spacing as a fraction of plate height
 * @param {string[]} p.palette    floor plate colours by rank
 */
export function buildStackScene({ nodes, instances, levels, levelRank, radiusOf, levelOf, floorMode, floorGap, palette }) {
  const anchor = { x: W / 2, y: H / 2 };

  // Per-floor content bounding box (raw node coords).
  const PAD = 48;
  const fb = new Map();
  for (const o of instances) {
    const lv = levelOf(o.s);
    if (!levels.includes(lv)) continue;
    const n = nodes.get(o.key);
    if (!n) continue;
    const r = radiusOf(o.s);
    const b = fb.get(lv) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    b.minX = Math.min(b.minX, n.x - r);  b.maxX = Math.max(b.maxX, n.x + r);
    b.minY = Math.min(b.minY, n.y - r);  b.maxY = Math.max(b.maxY, n.y + r);
    fb.set(lv, b);
  }
  // Shared footprint centred on the anchor; per-floor offset aligns each
  // floor's content within it.
  let maxW = 1, maxH = 1;
  for (const b of fb.values()) {
    maxW = Math.max(maxW, b.maxX - b.minX);
    maxH = Math.max(maxH, b.maxY - b.minY);
  }
  maxW += 2 * PAD;  maxH += 2 * PAD;
  const foot = { x: anchor.x - maxW / 2, y: anchor.y - maxH / 2, w: maxW, h: maxH };
  const offOf = (lv) => {
    const b = fb.get(lv);
    if (!b) return { x: 0, y: 0 };
    return { x: anchor.x - (b.minX + b.maxX) / 2, y: anchor.y - (b.minY + b.maxY) / 2 };
  };

  // The classic isometric affine (the approved look): plan rotated 45° and
  // vertically foreshortened, x' = kx·(x − y), y' = ky·(x + y) − z. It keeps
  // the plan's orientation (larger plan y = nearer/lower on screen) — the
  // previous azimuth/elevation camera drew the axon with plan-north flipped
  // and warped the site image with DIFFERENT foreshortening constants, so
  // images never sat true under the plates.
  const kx = ISO.kx, ky = ISO.ky;
  const isoProjH = ky * (foot.w + foot.h); // projected footprint height
  const lift = floorMode === 'offset' ? Math.max(24, isoProjH * floorGap) : 0;

  // Screen rise per floor, and the slab's visual thickness (screen px).
  const FLOOR_Z = lift;
  const SLAB_Z  = 14;
  const midZ = ((levels.length - 1) / 2) * FLOOR_Z;

  // Anchor at mid-floor maps to itself, keeping the scene centred.
  const e0 = anchor.x - kx * (anchor.x - anchor.y);
  const f0 = anchor.y - ky * (anchor.x + anchor.y) + midZ;
  const proj = (wx, wy, wz) => ({ x: e0 + kx * (wx - wy), y: f0 + ky * (wx + wy) - wz });
  // The same projection restricted to one floor plane (constant z), as an SVG
  // affine — identical numbers to proj(), so screen-space overlays (links,
  // labels, guides) line up exactly with the plane's content.
  const planeMatrix = (z) => `matrix(${kx} ${ky} ${-kx} ${ky} ${e0} ${f0 - z})`;

  // Screen position of every instance.
  const screenPos = new Map();
  for (const o of instances) {
    const lv = levelOf(o.s);
    if (!levels.includes(lv)) continue;
    const n = nodes.get(o.key);
    if (!n) continue;
    const off = offOf(lv);
    const k = levelRank.get(lv) ?? 0;
    const s = proj(n.x + off.x, n.y + off.y, k * FLOOR_Z);
    screenPos.set(o.key, { x: s.x, y: s.y, r: radiusOf(o.s), o });
  }

  const closestPairScreen = (sa, sb) => closestInstancePair(screenPos, sa, sb);

  const ptsStr = (arr) => arr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const floors = levels.map((label) => {
    const k = levelRank.get(label) ?? 0;
    const z = k * FLOOR_Z;
    // Plate corners — shared footprint (no per-floor offset; bubbles offset separately).
    const TL = proj(foot.x,          foot.y,          z);
    const TR = proj(foot.x + foot.w, foot.y,          z);
    const BR = proj(foot.x + foot.w, foot.y + foot.h, z);
    const BL = proj(foot.x,          foot.y + foot.h, z);
    // Slab-thickness faces (bottom of each edge, offset by SLAB_Z in world-Z).
    const BL_b = proj(foot.x,          foot.y + foot.h, z - SLAB_Z);
    const BR_b = proj(foot.x + foot.w, foot.y + foot.h, z - SLAB_Z);
    const TR_b = proj(foot.x + foot.w, foot.y,          z - SLAB_Z);
    const frontY = Math.max(BL.y, BR.y, BL_b.y, BR_b.y);
    return {
      k, label,
      color: palette[k % palette.length],
      off: offOf(label),
      bubbles: instances.filter((o) => levelOf(o.s) === label),
      planeTransform: planeMatrix(z),
      platePts:  ptsStr([TL, TR, BR, BL]),
      slabFront: ptsStr([BL, BR, BR_b, BL_b]),
      slabRight: ptsStr([BR, TR, TR_b, BR_b]),
      labelPos: { x: (BL.x + BR.x) / 2, y: frontY + 18 },
    };
  });

  // Corner guides: true 3-D lines from ground to top at each plan corner.
  const planCorners = [
    [foot.x, foot.y], [foot.x + foot.w, foot.y],
    [foot.x + foot.w, foot.y + foot.h], [foot.x, foot.y + foot.h],
  ];
  const guides = lift > 0
    ? planCorners.map(([px, py]) => {
        const top = proj(px, py, (levels.length - 1) * FLOOR_Z);
        const bot = proj(px, py, 0);
        return { x1: top.x, y1: top.y, x2: bot.x, y2: bot.y };
      })
    : [];

  // Ground image transform — warps the site image onto the ground plane with
  // the SAME affine as the plates and rooms (the old ISO-constant warp used a
  // different foreshortening, so the image sat misaligned under the plates).
  const groundOff = offOf(levels[0]);
  const groundTransform = `${planeMatrix(0)} translate(${groundOff.x} ${groundOff.y})`;

  const ordered = instances
    .filter((o) => levels.includes(levelOf(o.s)))
    .sort((a, b) => (levelRank.get(levelOf(a.s)) ?? 0) - (levelRank.get(levelOf(b.s)) ?? 0));

  return { foot, floors, screenPos, closestPairScreen, guides, groundTransform, ordered };
}

/**
 * Plain data for the WebGL 3-D view. Each floor's content is re-centred to a
 * shared footprint so the storeys stack into one aligned building; Stacked3D
 * maps plan x/y → world X/Z and floor rank → world Y (height).
 *
 * Beyond the stacked-scene inputs this needs the program's links and shape
 * helpers, plus the (already resolved) ground image rect:
 * @param {Array}       p.adjacencies
 * @param {Map}         p.byId       spaceId → space
 * @param {function}    p.rankOf     (space) → floor rank
 * @param {function}    p.shapeOf    (space) → 'bubble' | 'box' | 'poly'
 * @param {function}    p.polyVertsOf (space) → dense outline verts or null
 * @param {function}    p.colorOf    (space) → fill colour
 * @param {object|null} p.groundImage { href, x, y, w, h } in diagram units
 */
export function build3DScene({
  nodes, instances, levels, levelRank, radiusOf, levelOf, palette,
  adjacencies, byId, rankOf, shapeOf, polyVertsOf, colorOf, groundImage,
  envelopes = null, // [{ x, y, rot, verts, name, focused }] in world units
  mToU = null, // metres → diagram units (1/effScale); null = no scale
  levelHeightM = null, // (level label) → storey height in metres
  roomHeightM = null, // (space) → clear height in metres (own or storey's)
}) {
  const PAD = 36;
  // Real storey heights, in DIAGRAM UNITS so they scale exactly like plan
  // distances. Each level's base = the sum of the storeys below it, so the
  // massing stacks contiguously; a room's own height can span several storeys.
  // Without a calibrated scale there is no metre↔unit relation — `metric` is
  // false and the 3-D view keeps its legacy uniform gap/slab heights.
  const metric = !!(mToU && levelHeightM);
  const levelHU = new Map(); // label → storey height (units)
  const levelBaseU = new Map(); // label → base elevation (units)
  if (metric) {
    let base = 0;
    for (const label of levels) { // ordered ground → up
      const h = levelHeightM(label) * mToU;
      levelHU.set(label, h);
      levelBaseU.set(label, base);
      base += h;
    }
  }
  const baseOf = (s) => (metric ? levelBaseU.get(levelOf(s)) ?? 0 : 0);
  const heightOf = (s) =>
    metric ? (roomHeightM ? roomHeightM(s) : levelHeightM(levelOf(s))) * mToU : 0;
  // Per-floor bounding box + centre (raw node coords).
  const fb = new Map();
  for (const o of instances) {
    const lv = levelOf(o.s);
    if (!levels.includes(lv)) continue;
    const n = nodes.get(o.key); if (!n) continue;
    const r = radiusOf(o.s) + PAD;
    const b = fb.get(lv) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    b.minX = Math.min(b.minX, n.x - r); b.maxX = Math.max(b.maxX, n.x + r);
    b.minY = Math.min(b.minY, n.y - r); b.maxY = Math.max(b.maxY, n.y + r);
    fb.set(lv, b);
  }
  const centreOf = (lv) => {
    const b = fb.get(lv);
    return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: W / 2, y: H / 2 };
  };
  // Shared footprint = the largest floor, centred at the origin.
  let maxW = 1, maxH = 1;
  for (const b of fb.values()) { maxW = Math.max(maxW, b.maxX - b.minX); maxH = Math.max(maxH, b.maxY - b.minY); }
  const foot = { x0: -maxW / 2, y0: -maxH / 2, x1: maxW / 2, y1: maxH / 2, w: maxW, h: maxH };
  const center = { x: 0, y: 0 };

  const rooms = instances
    .filter((o) => levels.includes(levelOf(o.s)) && nodes.get(o.key))
    .map((o) => {
      const n = nodes.get(o.key);
      const c = centreOf(levelOf(o.s));
      const kind = shapeOf(o.s);
      const r = radiusOf(o.s);
      // Boxes keep their authored plan rectangle: the node's aspect rescaled
      // to the room's live target area (same lock as the plan view), plus its
      // 90° orientation — not the old equal-area square/cube.
      let w = r * Math.sqrt(Math.PI), h = w;
      if (kind === 'box' && n.w > 0 && n.h > 0) {
        const aspect = n.w / n.h;
        h = Math.sqrt((Math.PI * r * r) / aspect);
        w = aspect * h;
      }
      return {
        key: o.key,
        x: n.x - c.x, y: n.y - c.y, // re-centred onto the shared footprint
        rank: rankOf(o.s),
        r,
        w, h, rot: n.rot || 0,
        baseU: baseOf(o.s), hU: heightOf(o.s), // real elevation + clear height (units)
        box: kind === 'box',
        poly: kind === 'poly' ? polyVertsOf(o.s) : null, // scaled verts, centred at origin
        color: colorOf(o.s),
        name: `${o.s.name}${Math.max(1, o.s.count || 1) > 1 ? ` ${o.i + 1}` : ''}`,
      };
    });

  // Only link rooms that are actually in the scene (instances may be a
  // focused-building subset).
  const inScene = new Set(instances.map((o) => o.s.id));
  const links = [];
  for (const l of adjacencies) {
    const sa = byId.get(l.space_a), sb = byId.get(l.space_b);
    if (!sa || !sb || !inScene.has(sa.id) || !inScene.has(sb.id)) continue;
    if (!levels.includes(levelOf(sa)) || !levels.includes(levelOf(sb))) continue;
    const ca = centreOf(levelOf(sa)), cb = centreOf(levelOf(sb));
    const best = closestInstancePair(nodes, sa, sb);
    if (best) {
      const ra = radiusOf(sa), rb = radiusOf(sb);
      const boxA = shapeOf(sa) === 'box', boxB = shapeOf(sb) === 'box';
      links.push({
        a: [best.a.x - ca.x, best.a.y - ca.y, rankOf(sa), ra, boxA, baseOf(sa), heightOf(sa)],
        b: [best.b.x - cb.x, best.b.y - cb.y, rankOf(sb), rb, boxB, baseOf(sb), heightOf(sb)],
        strength: l.strength,
      });
    }
  }

  let image = null;
  if (groundImage && Number.isFinite(groundImage.w) && Number.isFinite(groundImage.h) && groundImage.w > 0 && groundImage.h > 0) {
    const c0 = centreOf(levels[0]);
    image = {
      href: groundImage.href,
      cx: groundImage.x + groundImage.w / 2 - c0.x,
      cy: groundImage.y + groundImage.h / 2 - c0.y,
      w: groundImage.w,
      h: groundImage.h,
    };
  }

  const floors = levels.map((label) => ({
    label,
    rank: levelRank.get(label),
    color: palette[levelRank.get(label) % palette.length],
    baseU: metric ? levelBaseU.get(label) : 0,
    heightU: metric ? levelHU.get(label) : 0,
    minX: foot.x0, minY: foot.y0, maxX: foot.x1, maxY: foot.y1,
  }));

  // Master-plan building envelopes as ground-plane outlines: each outline's
  // verts rotated + translated to their site position, then re-centred like
  // the ground image so they line up with the ground floor's rooms.
  let envelopeLoops = null;
  if (envelopes && envelopes.length) {
    const c0 = centreOf(levels[0]);
    envelopeLoops = envelopes.map((e) => {
      const a = ((e.rot || 0) * Math.PI) / 180;
      const cos = Math.cos(a), sin = Math.sin(a);
      return {
        name: e.name,
        focused: !!e.focused,
        pts: e.verts.map((p) => ({
          x: e.x + p.x * cos - p.y * sin - c0.x,
          y: e.y + p.x * sin + p.y * cos - c0.y,
        })),
      };
    });
  }

  return { center, foot, floors, rooms, links, image, envelopes: envelopeLoops, floorCount: levels.length, metric };
}
