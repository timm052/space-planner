// Pure scene builders for the stacked (axonometric SVG) and WebGL 3-D floor
// views. No React, no refs — everything arrives as arguments, so both are
// unit-testable and rebuild cheaply inside the canvas TickLayer each frame.
import { ISO, CAMERAS } from '../../floors.js';
import { closestInstancePair } from '../../adjacency.js';
import { W, H } from '../../hooks/useViewport.js';

/**
 * Build the stacked axonometric scene using an orthographic camera.
 *
 * World coordinate system: x/y = plan (same as the simulation), z = height
 * (z increases upward; z=0 = ground floor). The camera is parameterised by
 * azimuth (rotation around world-Z) and elevation (tilt above horizontal).
 * At elevation=0 we see a pure side elevation; at elevation=90 a plan view.
 *
 * Camera centering: the mid-floor anchor (W/2, H/2) always maps to screen
 * centre regardless of the chosen camera angle.
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
 * @param {string}   p.stackCam   CAMERAS preset key
 * @param {string[]} p.palette    floor plate colours by rank
 */
export function buildStackScene({ nodes, instances, levels, levelRank, radiusOf, levelOf, floorMode, floorGap, stackCam, palette }) {
  const cam = CAMERAS[stackCam] ?? CAMERAS.iso;
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

  // Projected footprint height in the ISO preset — drives the spacing slider
  // (we keep it ISO-based so the slider feels the same regardless of camera).
  const kx = ISO.kx, ky = ISO.ky;
  const e_iso = anchor.x - kx * anchor.x + kx * anchor.y;
  const f_iso = anchor.y - ky * anchor.x - ky * anchor.y;
  const isoXY = (px, py) => ({ x: kx * px - kx * py + e_iso, y: ky * px + ky * py + f_iso });
  const isoProjH = (() => {
    const cs = [[foot.x, foot.y], [foot.x + foot.w, foot.y], [foot.x + foot.w, foot.y + foot.h], [foot.x, foot.y + foot.h]]
      .map(([x, y]) => isoXY(x, y));
    return Math.max(...cs.map((c) => c.y)) - Math.min(...cs.map((c) => c.y));
  })();
  const lift = floorMode === 'offset' ? Math.max(24, isoProjH * floorGap) : 0;

  // World-Z per floor. Using lift directly as world units keeps scale=1 and
  // makes the slider feel natural across all camera angles.
  const FLOOR_Z = lift;
  const SLAB_Z  = 14;
  const midZ = ((levels.length - 1) / 2) * FLOOR_Z;

  // Orthographic projection: world (wx,wy,wz) → screen (sx,sy).
  // Centre is computed so the anchor at mid-floor maps to the screen anchor.
  const az = (cam.azimuth   * Math.PI) / 180;
  const el = (cam.elevation * Math.PI) / 180;
  const cosAz = Math.cos(az), sinAz = Math.sin(az);
  const sinEl = Math.sin(el), cosEl = Math.cos(el);
  const rx0 = anchor.x * cosAz - anchor.y * sinAz;
  const ry0 = anchor.x * sinAz + anchor.y * cosAz;
  const pcx = anchor.x - rx0;
  const pcy = anchor.y + (ry0 * sinEl + midZ * cosEl);
  const proj = (wx, wy, wz) => {
    const rx = wx * cosAz - wy * sinAz;
    const ry = wx * sinAz + wy * cosAz;
    return { x: pcx + rx, y: pcy - (ry * sinEl + wz * cosEl) };
  };

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

  // Ground image transform — only meaningful in ISO mode (affine in 2-D);
  // null for elevation views.
  const groundOff = offOf(levels[0]);
  const groundTransform = stackCam === 'iso'
    ? `translate(0 ${((levels.length - 1) / 2) * lift}) matrix(${kx} ${ky} ${-kx} ${ky} ${e_iso} ${f_iso}) translate(${groundOff.x} ${groundOff.y})`
    : null;

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
}) {
  const PAD = 36;
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
      return {
        key: o.key,
        x: n.x - c.x, y: n.y - c.y, // re-centred onto the shared footprint
        rank: rankOf(o.s),
        r: radiusOf(o.s),
        box: kind === 'box',
        poly: kind === 'poly' ? polyVertsOf(o.s) : null, // scaled verts, centred at origin
        color: colorOf(o.s),
        name: `${o.s.name}${Math.max(1, o.s.count || 1) > 1 ? ` ${o.i + 1}` : ''}`,
      };
    });

  const links = [];
  for (const l of adjacencies) {
    const sa = byId.get(l.space_a), sb = byId.get(l.space_b);
    if (!sa || !sb || !levels.includes(levelOf(sa)) || !levels.includes(levelOf(sb))) continue;
    const ca = centreOf(levelOf(sa)), cb = centreOf(levelOf(sb));
    const best = closestInstancePair(nodes, sa, sb);
    if (best) {
      const ra = radiusOf(sa), rb = radiusOf(sb);
      const boxA = shapeOf(sa) === 'box', boxB = shapeOf(sb) === 'box';
      links.push({
        a: [best.a.x - ca.x, best.a.y - ca.y, rankOf(sa), ra, boxA],
        b: [best.b.x - cb.x, best.b.y - cb.y, rankOf(sb), rb, boxB],
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
    minX: foot.x0, minY: foot.y0, maxX: foot.x1, maxY: foot.y1,
  }));

  return { center, foot, floors, rooms, links, image, floorCount: levels.length };
}
