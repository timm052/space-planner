import { lazy, memo, Suspense } from 'react';
import { fmtArea, distUnit, rootContainer } from '../../compute.js';
import { edgeGap, linkSatisfied } from '../../adjacency.js';
import { hullOfDiscs, smoothHullPath, filterCss, polygonPath, polyBounds, polygonArea } from '../../geometry.js';
import { darkHex } from '../../viz.js';
import { fitLabel, measureText } from '../../textfit.js';
import { TickLayer } from '../../hooks/useTick.js';

// three.js + react-three-fiber are the bulk of the main bundle; the 3-D view
// is one floor mode, so load it on demand (same pattern as pdfExport).
const Stacked3D = lazy(() => import('./Stacked3D.jsx'));

const EMPTY_SET = new Set();
const EMPTY_MAP = new Map();

/**
 * Renders a bubble's name (and optional area) as word-wrapped SVG text,
 * vertically centred inside a circle of radius `r`.
 *
 * The wrap uses REAL measured text widths with balanced line-breaking, and
 * the font steps down when a name genuinely can't fit (see textfit.js) —
 * lines no longer overflow narrow bubbles or break lopsidedly. Lines are
 * stacked with <tspan dy> and the block is offset so its visual centre lands
 * at y = 0 (the bubble's centre).
 *
 * Tiny bubbles (r ≤ 13) fall back to a single label below the circle.
 *
 * Memoized: labels re-render (and re-fit) only when their own props change,
 * not on every sim tick.
 */
const BubbleLabel = memo(function BubbleLabel({ label, r, areaStr, ink }) {
  const baseSize = Math.max(9, Math.min(14, r / 3.2));
  const maxW     = Math.max(r * 1.65, 28);

  // Tiny bubble: single line sitting below the circle
  if (r <= 13) {
    return (
      <text textAnchor="middle" dy={r + 11} className="bubble-name" style={{ fontSize: baseSize, fill: ink }}>
        {label}
      </text>
    );
  }

  const { fontSize, lines } = fitLabel({ label, maxWidth: maxW, baseSize, minSize: 8, maxLines: 3 });
  const lineH = fontSize * 1.22;

  // The 10px mono area tag also has to fit before it earns a line.
  const showArea   = !!areaStr && r > 26 && measureText(areaStr, 10) <= maxW;
  const totalLines = lines.length + (showArea ? 1 : 0);
  // First tspan dy: raise so the whole block is vertically centred at y=0.
  const startDy    = -((totalLines - 1) * lineH) / 2 + fontSize * 0.35;

  return (
    <text textAnchor="middle" className="bubble-name" style={{ fontSize, fill: ink }}>
      {lines.map((ln, i) => (
        <tspan key={i} x="0" dy={i === 0 ? startDy : lineH}>{ln}</tspan>
      ))}
      {showArea && (
        <tspan x="0" dy={lineH} className="bubble-area" style={ink ? { fill: ink, fillOpacity: 0.72 } : undefined}>{areaStr}</tspan>
      )}
    </text>
  );
});

/**
 * The diagram canvas: everything that re-renders on animation ticks (sim
 * frames, drags) without touching the chrome around it — the SVG scene with
 * image layers, contours, hulls, the stacked axonometric, links and bubbles,
 * plus the on-demand WebGL 3-D view. The scenes are rebuilt inside the
 * TickLayer closure so they read fresh node positions each frame.
 *
 * Everything is passed in: `nodes` is the live (mutable) node-position map,
 * the `on*` handlers own all pointer behavior, and the geometry helpers
 * close over BubbleTab's live scale/draft state.
 */
export default function DiagramCanvas({
  tickStore,
  // modes & view
  stackMode,
  is3D,
  floorMode,
  hulls,
  hullPad,
  hasBuildings,
  highlightGaps,
  warnOverlaps,
  adjActive,
  verticalAdj,
  showRotate,
  showResize,
  ghostUnplaced,
  placedKeys,
  focusCheck,
  envelopeUnderlays,
  envelopeBadge,
  makeInterior,
  onSeedDown,
  onCellDown,
  alignGuides,
  planGrid,
  effScale,
  floorGap,
  stackImages,
  cam3d,
  bubbleStyle,
  bubbleOpacity,
  panActive,
  tool,
  svgRef,
  originX,
  originY,
  vb,
  units,
  // data
  nodes,
  instances,
  adjacencies,
  byId,
  imgLayers,
  selected,
  selectedInst,
  multi,
  selLink,
  editShape,
  marquee,
  scalePoints,
  moveLayer,
  rotateLayer,
  scaleBar,
  attributionLayer,
  // scene builders & geometry helpers
  makeStackScene,
  make3DScene,
  computeAdjacency,
  layerRect,
  imgTransform,
  levelVisible,
  clusterKey,
  radiusOf,
  colorForLabel,
  colorOf,
  rankOf,
  closestPair,
  shapeOf,
  polyVertsOf,
  polyHandlesOf,
  polyRingPath,
  areaUnits,
  editAnchorInst,
  instPin,
  ea,
  scaleLabelFor,
  // handlers
  onSvgPointerDown,
  onMove,
  onUp,
  onBubbleDown,
  onRotateHandleDown,
  onResizeHandleDown,
  onLinkClick,
  onPolyVertexDown,
  addPolyVertex,
  removePolyVertex,
  onCycleCorner,
  hoverRef,
}) {
  return (
    <TickLayer store={tickStore}>
      {() => {
        const stack = stackMode ? makeStackScene() : null;
        const scene3d = is3D ? make3DScene() : null;
        // Voronoi interior sketch (envelope master plan) — rebuilt each tick so
        // the cells track the envelope and its seeds during a drag. Envelopes
        // with cells render hollow (the cells carry the colour).
        const interior = makeInterior && !stackMode ? makeInterior() : null;
        const interiorRoots = interior ? new Set(interior.map((b) => b.rootId)) : EMPTY_SET;
        // Unmet-link highlighting is positional; only pay for it while it's on.
        const unmetLinkIds = highlightGaps && adjActive
          ? new Set(computeAdjacency().unmet.map((l) => l.id))
          : EMPTY_SET;
        // Master plan flags overlapping footprints (a warning, not a force):
        // any pair of rooms whose discs interpenetrate past ~5% is marked so
        // both read with a danger outline. Positional → computed each tick.
        let overlapKeys = EMPTY_SET;
        if (warnOverlaps) {
          overlapKeys = new Set();
          const arr = instances
            .map((o) => ({ key: o.key, n: nodes.get(o.key), r: radiusOf(o.s), vis: levelVisible(o.s) }))
            // Ghost (un-placed) rooms aren't authored yet — don't flag them as overlaps.
            .filter((o) => o.n && o.vis && (!ghostUnplaced || placedKeys.has(o.key)));
          for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
              const a = arr[i], b = arr[j];
              if (Math.hypot(a.n.x - b.n.x, a.n.y - b.n.y) < (a.r + b.r) * 0.95) {
                overlapKeys.add(a.key);
                overlapKeys.add(b.key);
              }
            }
          }
        }
        // Vertical adjacency: while editing one floor, a room linked to a room on
        // ANOTHER floor can't show its link line (the other end is hidden), so it
        // gets a small tab — an ↑ / ↓ / ↕ arrow (partner above / below / both),
        // green when the pair is aligned in plan (the stair/lift stacks), red when
        // it isn't. Positional → each tick. Value: { state, dir }.
        let vBadge = EMPTY_MAP;
        if (verticalAdj) {
          vBadge = new Map();
          for (const l of adjacencies) {
            const sa = byId.get(l.space_a), sb = byId.get(l.space_b);
            if (!sa || !sb || (sa.level || '') === (sb.level || '')) continue; // same floor
            const pair = closestPair(sa, sb);
            if (!pair) continue;
            const gap = edgeGap(pair.d, radiusOf(sa), radiusOf(sb)) * (effScale || 1);
            const met = linkSatisfied(l.strength, gap);
            const ra = rankOf(sa), rb = rankOf(sb);
            for (const [sp, ix, delta] of [[sa, pair.ai, rb - ra], [sb, pair.bi, ra - rb]]) {
              if (!levelVisible(sp)) continue;
              const key = `${sp.id}:${ix}`;
              const dir = delta > 0 ? 'up' : 'down';
              const prev = vBadge.get(key);
              vBadge.set(key, {
                state: prev?.state === 'unmet' || !met ? 'unmet' : 'met',
                dir: prev && prev.dir !== dir ? 'both' : dir,
              });
            }
          }
        }
        return (<>
          {is3D && scene3d && (
            <div className="stage-3d">
              <Suspense fallback={<div className="stage-3d-hint">Loading 3-D view…</div>}>
                <Stacked3D scene={scene3d} gap={floorGap} showImage={stackImages} camMode={cam3d} />
              </Suspense>
              <div className="stage-3d-hint">Drag to orbit · scroll to zoom · right-drag to pan</div>
            </div>
          )}
          <svg
            ref={svgRef}
            viewBox={`${originX} ${originY} ${vb.w} ${vb.h}`}
            className={`bubble-svg ${scalePoints ? 'scaling' : ''} ${panActive || moveLayer || rotateLayer ? 'panning' : ''} ${tool === 'link' ? 'linking' : ''}`}
            onPointerDown={onSvgPointerDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <defs>
              <filter id="sketchy" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n" />
                <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
              </filter>
              {/* Placement grid: one faint cell per metric snap step, anchored to
                  the world origin so it stays fixed under pan/zoom. Major cells
                  only — a quiet reference field, not the primary snap (that's
                  edge/corner alignment). */}
              {planGrid && (
                <pattern id="plan-grid" width={planGrid.step} height={planGrid.step} patternUnits="userSpaceOnUse">
                  <path className="plan-grid-line" d={`M ${planGrid.step} 0 L 0 0 0 ${planGrid.step}`} fill="none" vectorEffect="non-scaling-stroke" />
                </pattern>
              )}
              {/* Diagonal hatch for the circulation band inside an envelope
                  (the area the room cells leave free). */}
              <pattern id="circ-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line className="circ-hatch-line" x1="0" y1="0" x2="0" y2="7" />
              </pattern>
            </defs>
            {(() => {
              const imgs = imgLayers.map((im) => {
                if (!im.visible || !im.image) return null; // pixels may still be loading
                const r = layerRect(im);
                if (!r) return null;
                const active = moveLayer === im.id || rotateLayer === im.id;
                return (
                  <image
                    key={im.id}
                    href={im.image}
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    opacity={im.opacity}
                    preserveAspectRatio="none"
                    transform={imgTransform(r)}
                    style={im.filter ? { filter: filterCss(im.filter) } : undefined}
                    className={active ? 'layer-active' : ''}
                  />
                );
              });
              // In the stacked view, warp the images onto the ground-floor plane
              // (not clipped — the full site image shows through). The ⊞ Images
              // toggle can hide them.
              if (!stack || !stack.groundTransform) return imgs;
              if (!stackImages) return null;
              return <g transform={stack.groundTransform}>{imgs}</g>;
            })()}

            {/* Faint placement-grid overlay: above the site image, below rooms,
                no pointer capture. Only in Master plan (planGrid is null else). */}
            {planGrid && !stackMode && (
              <rect className="plan-grid" x={originX} y={originY} width={vb.w} height={vb.h} fill="url(#plan-grid)" pointerEvents="none" />
            )}

            {/* Master-plan building envelopes drawn as fixed context under the
                Building env — the footprint each building's rooms are arranged
                inside. Non-interactive; the focused building's is emphasised. */}
            {envelopeUnderlays && !stackMode &&
              envelopeUnderlays.map((e) => {
                const top = polyBounds(e.verts).minY;
                return (
                  <g
                    key={`env:${e.id}`}
                    className={`envelope-underlay ${e.focused ? 'focused' : ''}`}
                    transform={`translate(${e.x}, ${e.y})${e.rot ? ` rotate(${e.rot})` : ''}`}
                    pointerEvents="none"
                  >
                    <path d={polygonPath(e.verts)} />
                    <text
                      className="envelope-label"
                      y={top - 8}
                      textAnchor="middle"
                      transform={e.rot ? `rotate(${-e.rot} 0 ${top - 8})` : undefined}
                    >▱ {e.name}</text>
                  </g>
                );
              })}

            {/* Topographic site contours — concentric rings that echo each
                building's convex-hull SHAPE (not a generic ellipse), replacing
                the grid (flat site-plan field). Grouped by clusterKey (building),
                so each building gets ONE field that matches its hull, independent
                of the bubble colour mode. */}
            {!stackMode && (() => {
              // Padded discs per building (same construction the hulls use),
              // so the contour outline matches the building hull exactly.
              const byG = new Map();
              for (const o of instances) {
                if (!levelVisible(o.s)) continue;
                const n = nodes.get(o.key);
                if (!n) continue;
                const g = clusterKey(o.s);
                if (!byG.has(g)) byG.set(g, []);
                byG.get(g).push({ x: n.x, y: n.y, r: radiusOf(o.s) + hullPad });
              }
              const rings = [];
              for (const [g, discs] of byG) {
                const hull = hullOfDiscs(discs);
                if (hull.length < 3) continue;
                const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
                const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
                // Concentric contours = the hull outline scaled about its centroid,
                // from just inside the hull outward into the surrounding "terrain".
                for (let k = 1; k <= 6; k++) {
                  const f = k / 6;
                  const scale = 0.4 + f * 1.2; // 0.6 (inner) … 1.6 (outer)
                  const scaled = hull.map((p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale }));
                  const d = smoothHullPath(scaled);
                  if (!d) continue;
                  rings.push(
                    <path
                      key={`contour:${g}:${k}`}
                      d={d}
                      className="site-contour"
                      style={{ opacity: 0.9 - f * 0.6 }}
                    />
                  );
                }
              }
              return rings;
            })()}

            {(() => {
              // Building hulls always show (when buildings exist); category hulls
              // are optional via the ⬡ Categories toggle.
              const out = [];
              const addHulls = (keyFn, cls, withLabel) => {
                const byG = new Map();
                for (const o of instances) {
                  if (!levelVisible(o.s)) continue;
                  const n = nodes.get(o.key);
                  if (!n) continue;
                  const g = keyFn(o.s);
                  if (g == null) continue;
                  if (!byG.has(g)) byG.set(g, []);
                  byG.get(g).push({ x: n.x, y: n.y, r: radiusOf(o.s) + hullPad });
                }
                for (const [g, discs] of byG) {
                  const hull = hullOfDiscs(discs);
                  const d = smoothHullPath(hull);
                  if (!d) continue;
                  const color = colorForLabel(g);
                  out.push(<path key={`${cls}:${g}`} d={d} className={`group-hull ${cls}`} fill={color} stroke={color} />);
                  if (withLabel) {
                    const top = hull.reduce((m, p) => (p.y < m.y ? p : m), hull[0]);
                    out.push(
                      <text key={`lbl:${g}`} x={top.x} y={top.y - 4} textAnchor="middle" className="hull-label" fill={color}>
                        {g}
                      </text>
                    );
                  }
                }
              };
              if (!stackMode && hasBuildings) addHulls((s) => { const root = rootContainer(s, byId); return root ? root.name : null; }, 'building-hull', true);
              if (!stackMode && hulls) addHulls((s) => s.department || 'General', 'cat-hull', false);
              return out;
            })()}

            {/* Stacked axonometric view. Dashed corner guides tie the floors into
                one building; each floor is an iso-tilted group so its plate,
                bubbles and the warped images foreshorten onto the plane. */}
            {stack &&
              stack.guides.map((g, i) => (
                <line key={`guide:${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className="floor-guide" />
              ))}
            {/* Floor plates + room footprints. The plate is the projected
                polygon (screen space, crisp dashes); each floor's rooms render
                inside its plane-affine group so every footprint foreshortens
                flat onto the plate — circles land as ellipses, boxes as
                parallelograms, custom outlines as true plan shapes. A clean
                axon: flat fills, hairline outlines, no fake lighting. */}
            {stack &&
              stack.floors.map((f) => (
                <g key={`floor:${f.label}`}>
                  {floorMode === 'offset' && (
                    <>
                      <polygon points={f.slabFront} fill={f.color} className="slab-face slab-front" />
                      <polygon points={f.slabRight} fill={f.color} className="slab-face slab-right" />
                    </>
                  )}
                  <polygon points={f.platePts} className={`floor-plate floor-plane ${floorMode}`}
                    stroke={f.color} fill={`${f.color}${floorMode === 'overlaid' ? '0c' : '1a'}`} />
                  <g transform={`${f.planeTransform} translate(${f.off.x} ${f.off.y})`}>
                    {f.bubbles.map((o) => {
                      const n = nodes.get(o.key);
                      if (!n) return null;
                      const fill = colorOf(o.s);
                      const common = {
                        className: `stack-room ${floorMode}`,
                        fill,
                        stroke: darkHex(fill, 0.45),
                        vectorEffect: 'non-scaling-stroke',
                      };
                      const kind = shapeOf(o.s);
                      if (kind === 'poly') {
                        const poly = polyVertsOf(o.s);
                        if (poly) return <path key={o.key} d={polygonPath(poly)} transform={`translate(${n.x} ${n.y})`} {...common} />;
                      }
                      if (kind === 'box') {
                        let bw = radiusOf(o.s) * Math.sqrt(Math.PI), bh = bw;
                        if (n.w > 0 && n.h > 0) {
                          const aspect = n.w / n.h;
                          bh = Math.sqrt(areaUnits(o.s) / aspect);
                          bw = aspect * bh;
                        }
                        return (
                          <rect key={o.key} x={-bw / 2} y={-bh / 2} width={bw} height={bh}
                            transform={`translate(${n.x} ${n.y})${n.rot ? ` rotate(${n.rot})` : ''}`} {...common} />
                        );
                      }
                      return <circle key={o.key} cx={n.x} cy={n.y} r={radiusOf(o.s)} {...common} />;
                    })}
                  </g>
                  <text x={f.labelPos.x} y={f.labelPos.y} className="floor-plate-label"
                    fill={f.color} textAnchor="middle">{f.label}</text>
                </g>
              ))}
            {/* Links drawn in screen space so cross-floor connectors read clearly. */}
            {stack &&
              adjacencies.map((l) => {
                const sa = byId.get(l.space_a), sb = byId.get(l.space_b);
                if (!sa || !sb) return null;
                const inter = rankOf(sa) !== rankOf(sb);
                if (inter && floorMode !== 'offset') return null;
                const pair = stack.closestPairScreen(sa, sb);
                if (!pair) return null;
                return <line key={`sl:${l.id}`} x1={pair.a.x} y1={pair.a.y} x2={pair.b.x} y2={pair.b.y} className={`link ${l.strength}${inter ? ' interfloor' : ''}`} />;
              })}
            {/* Room labels — upright, in screen space (drawing them inside the
                plane group would shear the text). Haloed via CSS so they stay
                readable over plates, fills and the site image. */}
            {stack &&
              stack.ordered.map((o) => {
                const p = stack.screenPos.get(o.key);
                if (!p) return null;
                const label = `${o.s.name}${Math.max(1, o.s.count || 1) > 1 ? ` ${o.i + 1}` : ''}`;
                return (
                  <g key={`slbl:${o.key}`} transform={`translate(${p.x}, ${p.y})`} className="bubble stacked">
                    <title>{label} — {fmtArea(ea(o.s), units)}</title>
                    <BubbleLabel label={label} r={p.r * 0.92} areaStr={fmtArea(ea(o.s), units)} ink={darkHex(colorOf(o.s), 0.62)} />
                  </g>
                );
              })}

            {scalePoints &&
              scalePoints.map((p, i) => (
                <g key={i} className="scale-point">
                  <circle cx={p.x} cy={p.y} r="6" />
                  <circle cx={p.x} cy={p.y} r="2" />
                </g>
              ))}
            {scalePoints?.length === 2 && (
              <line x1={scalePoints[0].x} y1={scalePoints[0].y} x2={scalePoints[1].x} y2={scalePoints[1].y} className="scale-line" />
            )}

            {!stackMode &&
              adjacencies.map((l) => {
                const sa = byId.get(l.space_a);
                const sb = byId.get(l.space_b);
                if (!sa || !sb) return null;
                if (!levelVisible(sa) || !levelVisible(sb)) return null;
                const pair = closestPair(sa, sb);
                if (!pair) return null;
                const isSelLink = selLink && ((selLink.space_a === l.space_a && selLink.space_b === l.space_b) || (selLink.space_a === l.space_b && selLink.space_b === l.space_a));
                const connected = selected != null && (l.space_a === selected || l.space_b === selected);
                return (
                  <g key={l.id} className="link-hit" onClick={() => onLinkClick(l)}>
                    {/* Aggregated building-to-building links carry how many room
                        relationships rolled up into them. */}
                    {l.count > 0 && (
                      <title>{`${sa.name} ↔ ${sb.name} — ${l.count} room relationship${l.count === 1 ? '' : 's'} between these buildings`}</title>
                    )}
                    <line x1={pair.a.x} y1={pair.a.y} x2={pair.b.x} y2={pair.b.y} className="link-hitarea" />
                    <line
                      x1={pair.a.x}
                      y1={pair.a.y}
                      x2={pair.b.x}
                      y2={pair.b.y}
                      className={`link ${l.strength}${isSelLink || connected ? ' selected' : ''}${highlightGaps && unmetLinkIds.has(l.id) ? ' unmet' : ''}`}
                    />
                  </g>
                );
              })}

            {!stackMode &&
              instances.map((o) => {
              const n = nodes.get(o.key);
              if (!n) return null;
              const { s, i } = o;
              if (!levelVisible(s)) return null;
              const r = radiusOf(s);
              const isSel = selected === s.id && (Math.max(1, s.count || 1) === 1 || selectedInst === i);
              const pinned = !!instPin(s, i);
              const inMulti = multi.has(o.key);
              const overlapping = overlapKeys.has(o.key);
              const ghost = ghostUnplaced && !placedKeys.has(o.key); // un-placed → faint
              const dimmed = focusCheck && !focusCheck(s); // outside the focused building
              const envInfo = envelopeBadge ? envelopeBadge(s) : null;
              const count = Math.max(1, s.count || 1);
              const kind = shapeOf(s);
              const box = kind === 'box';
              const poly = kind === 'poly' ? polyVertsOf(s) : null;
              const polyHandles = kind === 'poly' ? polyHandlesOf(s) : null;
              const pb = poly ? polyBounds(poly) : null;
              const side = r * Math.sqrt(Math.PI); // square of equal area
              // Building rectangles: a box carries an authored aspect (n.w/n.h),
              // rescaled each render to hold the room's live target area — so an
              // area edit re-locks the geometry automatically (like the poly lock).
              let bw = side, bh = side;
              if (box && n.w && n.h) {
                const target = areaUnits(s);      // == side²
                const aspect = n.w / n.h;
                bh = Math.sqrt(target / aspect);
                bw = aspect * bh;
              }
              const editing = editShape === s.id && i === editAnchorInst(s);
              // Envelope with a live interior sketch: the cells carry the colour,
              // so the envelope itself reads as an outline with its name above.
              const hollow = interiorRoots.has(s.id);
              // Master-plan placement orientation. Circles look identical rotated,
              // so the handle only shows for box/poly; the label counter-rotates
              // to stay upright.
              const rot = n.rot || 0;
              const canRotate = showRotate && (box || !!poly);
              // Live area of the rendered outline, recomputed each frame (the area
              // lock keeps it ≈ the brief target — shown so the size reads "live").
              const polyAreaStr = poly ? fmtArea(ea(s) * (polygonArea(poly) / (areaUnits(s) || 1)), units) : null;
              const fillOp = isSel ? Math.min((bubbleOpacity ?? 0.32) + 0.25, 1) : pinned ? Math.min((bubbleOpacity ?? 0.32) + 0.1, 1) : bubbleOpacity ?? 0.32;
              const sw = isSel ? 3 : pinned ? 2.5 : 1.5;
              const outline = bubbleStyle === 'outline';
              const sketch = bubbleStyle === 'sketch';
              // Flat "site-plan" matte: solid fill + poché keyline (a darkened tone
              // of the same hue), white keyline when selected, dark ink for labels.
              const flat = !outline && !sketch;
              const baseColor = colorOf(s);
              const fillOpEff = outline ? 0 : flat ? (isSel ? 1 : 0.95) : fillOp;
              const swEff = outline ? sw + 1 : sw;
              const strokeColor = flat ? (isSel ? '#ffffff' : darkHex(baseColor, 0.4)) : baseColor;
              const inkColor = flat ? darkHex(baseColor, 0.62) : undefined;
              const shapeFilter = sketch ? 'url(#sketchy)' : undefined;
              return (
                <g
                  key={o.key}
                  data-space-id={s.id}
                  data-instance={i}
                  className={`bubble ${isSel ? 'selected' : ''} ${inMulti ? 'multi' : ''} ${overlapping ? 'overlap' : ''} ${ghost ? 'ghost' : ''} ${dimmed ? 'dim' : ''}`}
                  transform={`translate(${n.x}, ${n.y})${rot ? ` rotate(${rot})` : ''}`}
                  onPointerDown={(e) => onBubbleDown(e, o)}
                  onPointerEnter={() => (hoverRef.current = { space: s, idx: i })}
                  onPointerLeave={() => (hoverRef.current?.space.id === s.id && hoverRef.current?.idx === i ? (hoverRef.current = null) : null)}
                >
                  <title>
                    {s.name}
                    {count > 1 ? ` ${i + 1} of ${count}` : ''} — {fmtArea(ea(s), units)}
                  </title>
                  {pinned &&
                    (poly ? (
                      <path d={polyRingPath(poly, 6)} className="pin-ring" />
                    ) : box ? (
                      <rect x={-bw / 2 - 5} y={-bh / 2 - 5} width={bw + 10} height={bh + 10} rx="3" className="pin-ring" />
                    ) : (
                      <circle r={r + 5} className="pin-ring" />
                    ))}
                  {inMulti &&
                    (poly ? (
                      <path d={polyRingPath(poly, 9)} className="multi-ring" />
                    ) : box ? (
                      <rect x={-bw / 2 - 7} y={-bh / 2 - 7} width={bw + 14} height={bh + 14} rx="4" className="multi-ring" />
                    ) : (
                      <circle r={r + 7} className="multi-ring" />
                    ))}
                  {poly ? (
                    <path className={`poly-shape ${editing ? 'editing' : ''}`} d={polygonPath(poly)} fill={baseColor} fillOpacity={hollow ? 0.06 : fillOpEff} stroke={strokeColor} strokeWidth={swEff} strokeLinejoin="round" filter={shapeFilter} />
                  ) : box ? (
                    <rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} rx={flat ? 0 : Math.min(4, Math.min(bw, bh) / 8)} fill={baseColor} fillOpacity={fillOpEff} stroke={strokeColor} strokeWidth={swEff} filter={shapeFilter} />
                  ) : (
                    <circle r={r} fill={baseColor} fillOpacity={fillOpEff} stroke={strokeColor} strokeWidth={swEff} filter={shapeFilter} />
                  )}
                  {hollow ? (
                    // Interior sketch active: the room cells occupy the centre, so
                    // the building's name moves above the outline (like underlays).
                    <text
                      className="envelope-label"
                      y={pb.minY - 8}
                      textAnchor="middle"
                      transform={rot ? `rotate(${-rot} 0 ${pb.minY - 8})` : undefined}
                    >▱ {s.name}</text>
                  ) : rot ? (
                    <g transform={`rotate(${-rot})`}>
                      <BubbleLabel label={`${s.name}${count > 1 ? ` ${i + 1}` : ''}`} r={r} areaStr={fmtArea(ea(s), units)} ink={inkColor} />
                    </g>
                  ) : (
                    <BubbleLabel
                      label={`${s.name}${count > 1 ? ` ${i + 1}` : ''}`}
                      r={r}
                      areaStr={fmtArea(ea(s), units)}
                      ink={inkColor}
                    />
                  )}
                  {/* Envelope feasibility badge: the DRAWN footprint against the
                      REQUIRED one (the building's biggest storey). Red = the
                      envelope is too small for the brief. */}
                  {envInfo && (() => {
                    const by = (poly ? pb.maxY : r) + 16;
                    const bad = envInfo.drawn < envInfo.required - 0.5;
                    return (
                      <text
                        className={`env-badge ${bad ? 'bad' : ''}`}
                        y={by}
                        textAnchor="middle"
                        transform={rot ? `rotate(${-rot} 0 ${by})` : undefined}
                      >
                        {fmtArea(envInfo.drawn, units)}{bad ? ` · needs ≥ ${fmtArea(envInfo.required, units)}` : ' envelope'}
                      </text>
                    );
                  })()}
                  {/* Vertical-adjacency tab: this room links to a room on another
                      floor (↑ above · ↓ below · ↕ both), green when it stacks in
                      plan, red when not. Pinned just outside the top-right corner;
                      the glyph counter-rotates to stay upright. */}
                  {vBadge.has(o.key) && (() => {
                    const info = vBadge.get(o.key);
                    const bx = (box ? bw / 2 : r * 0.7) + 1;
                    const by = (box ? -bh / 2 : -r * 0.7) - 1;
                    const glyph = info.dir === 'up' ? '↑' : info.dir === 'down' ? '↓' : '↕';
                    return (
                      <g className={`vlink-badge ${info.state}`}>
                        <title>Vertical link — room {info.dir === 'both' ? 'above & below' : info.dir === 'up' ? 'above' : 'below'} · {info.state === 'met' ? 'stacks in plan' : 'not aligned'}</title>
                        <circle cx={bx} cy={by} r="8" />
                        <text x={bx} y={by} textAnchor="middle" dominantBaseline="central" transform={rot ? `rotate(${-rot} ${bx} ${by})` : undefined}>{glyph}</text>
                      </g>
                    );
                  })()}
                  {/* Rotate handle: a stem + knob above the footprint, only for a
                      selected box/poly in Master plan. It rides the group's
                      rotation, so it always points to the shape's "up". */}
                  {canRotate && isSel && !editing && (() => {
                    const topY = poly ? pb.minY : -side / 2;
                    const knobY = topY - 20;
                    return (
                      <g className="rotate-handle" onPointerDown={(e) => onRotateHandleDown(e, o)}>
                        <line x1="0" y1={topY} x2="0" y2={knobY} className="rotate-stem" />
                        <circle cx="0" cy={knobY} r="6" className="rotate-knob" />
                      </g>
                    );
                  })()}
                  {/* Area-lock resize handles on a selected Building box — one at
                      each CORNER (like most design software). Dragging a corner
                      sets the rectangle's aspect while the target area is held; the
                      opposite corner stays pinned. A live w×h readout shows the
                      lock. Handles ride the box rotation. */}
                  {box && showResize && isSel && (
                    <g className="resize-handles">
                      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => (
                        <rect
                          key={`${sx},${sy}`}
                          className="resize-handle"
                          x={(sx * bw) / 2 - 4}
                          y={(sy * bh) / 2 - 4}
                          width="8"
                          height="8"
                          style={{ cursor: sx * sy > 0 ? 'nwse-resize' : 'nesw-resize' }}
                          onPointerDown={(e) => onResizeHandleDown(e, o, sx, sy)}
                        />
                      ))}
                      {effScale && (
                        <text className="dim-badge" x="0" y={-bh / 2 - 10} textAnchor="middle" transform={rot ? `rotate(${-rot})` : undefined}>
                          {(bw * effScale).toFixed(1)} × {(bh * effScale).toFixed(1)} {distUnit(units)}
                        </text>
                      )}
                    </g>
                  )}
                  {editing && polyHandles && (
                    <g className="poly-edit">
                      {polyHandles.map((p, vi) => {
                        const a = polyHandles[vi];
                        const b = polyHandles[(vi + 1) % polyHandles.length];
                        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                        return (
                          <circle
                            key={`add:${vi}`}
                            cx={mid.x}
                            cy={mid.y}
                            r="4"
                            className="poly-add"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => (e.stopPropagation(), addPolyVertex(s, vi))}
                          />
                        );
                      })}
                      {polyHandles.map((p, vi) => {
                        // Handle glyph = the vertex's corner style: circle =
                        // curve, rounded square = fillet, square = sharp.
                        // Right-click cycles the style; drag moves; dbl-click
                        // removes.
                        const k = p.k === 's' || p.k === 'f' ? p.k : 'c';
                        const shared = {
                          className: `poly-handle k-${k}`,
                          onPointerDown: (e) => onPolyVertexDown(e, s, vi),
                          onDoubleClick: (e) => (e.stopPropagation(), removePolyVertex(s, vi)),
                          onContextMenu: (e) => (e.preventDefault(), e.stopPropagation(), onCycleCorner(s, vi)),
                        };
                        const title = <title>drag to move · right-click: corner style ({k === 'c' ? 'curve' : k === 'f' ? 'fillet' : 'sharp'}) · double-click to remove</title>;
                        return k === 'c' ? (
                          <circle key={`v:${vi}`} cx={p.x} cy={p.y} r="6" {...shared}>{title}</circle>
                        ) : (
                          <rect key={`v:${vi}`} x={p.x - 5.5} y={p.y - 5.5} width="11" height="11" rx={k === 'f' ? 4 : 0} {...shared}>{title}</rect>
                        );
                      })}
                      {pb && (
                        <text className="poly-area-badge" x="0" y={pb.minY - 12} textAnchor="middle">
                          {polyAreaStr}
                        </text>
                      )}
                    </g>
                  )}
                </g>
              );
            })}

            {/* Voronoi interior sketch — each placed envelope partitioned into
                room cells seeded from the Concept layout. A cell is the room's
                handle: click it to select the room (works with the Link tool
                too), drag it to move the whole building (the cell belongs to
                the envelope). The SEED dot re-plans the room — dragging it
                saves the room's Concept pin. */}
            {interior &&
              interior.map((b) => (
                <g key={`vor:${b.rootId}`} className="voronoi-layer">
                  {/* Circulation band: the envelope hatched underneath — the
                      shrunken cells leave it visible between the rooms. */}
                  {b.circ > 0 && (
                    <path className="circ-fill" d={polygonPath(b.boundary)} fill="url(#circ-hatch)" />
                  )}
                  {b.cells.map((c) => {
                    const isSelCell = selected === c.spaceId;
                    // Fitted label: measured-width line breaks at a font scaled
                    // to the cell (same fitter the bubbles use), name block
                    // above centre and the area line below so neither collides
                    // with the seed dot. Slivers keep just their seed + tooltip.
                    const cb = polyBounds(c.poly);
                    const cw = cb.maxX - cb.minX;
                    const chh = cb.maxY - cb.minY;
                    const fit = cw > 30 && chh > 24
                      ? fitLabel({ label: c.name, maxWidth: cw * 0.8, baseSize: 10, minSize: 7, maxLines: 2 })
                      : null;
                    const lineH = fit ? fit.fontSize * 1.12 : 0;
                    const showName = fit && fit.lines.length > 0 && fit.lines.length * lineH + 10 < chh * 0.9;
                    const showArea = showName && c.areaPU != null && chh > fit.lines.length * lineH + 34
                      && measureText(`${fmtArea(c.areaPU, units)} / ${fmtArea(c.targetPU, units)}`, 8.5) < cw * 0.85;
                    const ink = darkHex(c.color, 0.62);
                    return (
                      <g key={`vc:${c.key}`} className={`voronoi-cell ${c.tight ? 'tight' : ''}${isSelCell ? ' selected' : ''}${c.related ? ' related' : ''}`}>
                        <path
                          className="voronoi-fill"
                          d={polygonPath(c.poly)}
                          fill={c.color}
                          stroke={darkHex(c.color, 0.45)}
                          onPointerDown={onCellDown ? (e) => onCellDown(e, c) : undefined}
                        >
                          <title>
                            {`${c.name}${c.areaPU != null ? ` — ${fmtArea(c.areaPU, units)} cell for a ${fmtArea(c.targetPU, units)} target${c.tight ? ' (does not fit here)' : ''}` : ''}
click to select · drag to move the building · drag the dot to re-plan the room`}
                          </title>
                        </path>
                        {showName &&
                          fit.lines.map((line, li) => (
                            <text
                              key={li}
                              className="voronoi-name"
                              x={c.centre.x}
                              y={c.centre.y - 7 - (fit.lines.length - 1 - li) * lineH}
                              textAnchor="middle"
                              fontSize={fit.fontSize}
                              fill={ink}
                            >
                              {line}
                            </text>
                          ))}
                        {showArea && (
                          <text className="voronoi-area" x={c.centre.x} y={c.centre.y + 14} textAnchor="middle" fill={ink}>
                            {fmtArea(c.areaPU, units)} / {fmtArea(c.targetPU, units)}
                          </text>
                        )}
                        {/* Generous invisible hit ring — the 5px dot alone was a
                            fiddly drag target. It takes the pointer; the dot is
                            purely visual. */}
                        <circle className="voronoi-seed-hit" cx={c.seed.x} cy={c.seed.y} r="12" onPointerDown={(e) => onSeedDown(e, c)}>
                          <title>{c.name} — drag to re-plan the room (saves its Concept pin)</title>
                        </circle>
                        <circle className="voronoi-seed" cx={c.seed.x} cy={c.seed.y} r="5" fill={c.color} />
                      </g>
                    );
                  })}
                </g>
              ))}

            {/* Edge-alignment guides — the neighbour edge/centre a dragged
                footprint is snapping to. Read from a ref so they track the live
                drag (TickLayer re-renders each move). */}
            {alignGuides?.current?.map((g, i) =>
              g.x != null ? (
                <line key={`ag:${i}`} className="align-guide" x1={g.x} y1={g.y0} x2={g.x} y2={g.y1} />
              ) : (
                <line key={`ag:${i}`} className="align-guide" x1={g.x0} y1={g.y} x2={g.x1} y2={g.y} />
              )
            )}

            {scaleBar && (
              <g className="scale-bar" transform={`translate(${originX + 20}, ${originY + vb.h - 24})`}>
                <rect x="-8" y="-16" width={scaleBar.len + 150} height="30" rx="4" className="scale-bar-bg" />
                <line x1="0" y1="0" x2={scaleBar.len} y2="0" />
                <line x1="0" y1="-5" x2="0" y2="5" />
                <line x1={scaleBar.len} y1="-5" x2={scaleBar.len} y2="5" />
                <text x={scaleBar.len + 8} y="4">
                  {scaleBar.label} · {scaleLabelFor(effScale)}
                </text>
              </g>
            )}

            {attributionLayer && (
              <text x={originX + vb.w - 8} y={originY + vb.h - 8} textAnchor="end" className="attribution">
                {attributionLayer.attribution}
              </text>
            )}

            {marquee && (
              <rect
                className="marquee"
                x={Math.min(marquee.x0, marquee.x1)}
                y={Math.min(marquee.y0, marquee.y1)}
                width={Math.abs(marquee.x1 - marquee.x0)}
                height={Math.abs(marquee.y1 - marquee.y0)}
              />
            )}
          </svg>
        </>);
      }}
    </TickLayer>
  );
}
