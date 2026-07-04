import { lazy, memo, Suspense } from 'react';
import { fmtArea, rootContainer } from '../../compute.js';
import { convexHull, smoothHullPath, filterCss, polygonPath, polyBounds, polygonArea } from '../../geometry.js';
import { darkHex } from '../../viz.js';
import { TickLayer } from '../../hooks/useTick.js';

// three.js + react-three-fiber are the bulk of the main bundle; the 3-D view
// is one floor mode, so load it on demand (same pattern as pdfExport).
const Stacked3D = lazy(() => import('./Stacked3D.jsx'));

const EMPTY_SET = new Set();

/**
 * Renders a bubble's name (and optional area) as word-wrapped SVG text,
 * vertically centred inside a circle of radius `r`.
 *
 * Strategy: character-count greedy wrap using an average char-width heuristic
 * (fontSize × 0.55). Lines are stacked with <tspan dy> and the whole block is
 * offset so its visual centre lands at y = 0 (the bubble's centre).
 *
 * Tiny bubbles (r ≤ 13) fall back to a single label below the circle.
 *
 * Memoized: labels re-render (and re-wrap) only when their own props change,
 * not on every sim tick.
 */
const BubbleLabel = memo(function BubbleLabel({ label, r, areaStr, ink }) {
  const fontSize = Math.max(9, Math.min(14, r / 3.2));
  const lineH    = fontSize * 1.22;
  const charW    = fontSize * 0.55;
  const maxW     = Math.max(r * 1.65, 28);
  const cpl      = Math.max(4, Math.floor(maxW / charW)); // chars per line

  // Tiny bubble: single line sitting below the circle
  if (r <= 13) {
    return (
      <text textAnchor="middle" dy={r + 11} className="bubble-name" style={{ fontSize, fill: ink }}>
        {label}
      </text>
    );
  }

  // Greedy word-wrap, capped at 3 lines
  const words = label.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= cpl) { cur += ' ' + w; }
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) {
    lines[2] = lines.slice(2).join(' ');
    if (lines[2].length > cpl) lines[2] = lines[2].slice(0, cpl - 1) + '…';
    lines.length = 3;
  }

  const showArea   = !!areaStr && r > 26;
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
  onLinkClick,
  onPolyVertexDown,
  addPolyVertex,
  removePolyVertex,
  hoverRef,
}) {
  return (
    <TickLayer store={tickStore}>
      {() => {
        const stack = stackMode ? makeStackScene() : null;
        const scene3d = is3D ? make3DScene() : null;
        // Unmet-link highlighting is positional; only pay for it while it's on.
        const unmetLinkIds = highlightGaps && effScale
          ? new Set(computeAdjacency().unmet.map((l) => l.id))
          : EMPTY_SET;
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
              {/* Colour-independent shading overlaid on a coloured circle to make
                  it read as a lit 3D sphere (highlight top-left, shaded rim). */}
              {/* Diffuse shading + rim shadow — colour-independent, layered over fill */}
              <radialGradient id="sphere3d" cx="36%" cy="30%" r="72%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.52)" />
                <stop offset="35%" stopColor="rgba(255,255,255,0.10)" />
                <stop offset="65%" stopColor="rgba(0,0,0,0.02)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.52)" />
              </radialGradient>
              {/* Tight specular hot-spot */}
              <radialGradient id="sphere-spec" cx="32%" cy="26%" r="38%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.82)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              {/* Contact shadow — dark centre fading to transparent */}
              <radialGradient id="sphere-shadow-grad">
                <stop offset="0%" stopColor="rgba(0,0,0,0.38)" />
                <stop offset="65%" stopColor="rgba(0,0,0,0.14)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
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

            {/* Topographic site contours — concentric rings that echo each
                building's convex-hull SHAPE (not a generic ellipse), replacing
                the grid (flat site-plan field). Grouped by clusterKey (building),
                so each building gets ONE field that matches its hull, independent
                of the bubble colour mode. */}
            {!stackMode && (() => {
              // Padded sample points per building (same construction the hulls use),
              // so the contour outline matches the building hull exactly.
              const byG = new Map();
              for (const o of instances) {
                if (!levelVisible(o.s)) continue;
                const n = nodes.get(o.key);
                if (!n) continue;
                const g = clusterKey(o.s);
                if (!byG.has(g)) byG.set(g, []);
                const r = radiusOf(o.s) + hullPad;
                for (let a = 0; a < Math.PI * 2; a += Math.PI / 4)
                  byG.get(g).push({ x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r });
              }
              const rings = [];
              for (const [g, pts] of byG) {
                const hull = convexHull(pts);
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
                  const r = radiusOf(o.s) + hullPad;
                  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4)
                    byG.get(g).push({ x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r });
                }
                for (const [g, pts] of byG) {
                  const hull = convexHull(pts);
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
            {/* Floor plates: projected polygon (screen-space) + slab edge faces.
                The polygon is computed from the 3-D footprint corners so the
                shape is correct for every camera angle. */}
            {stack &&
              stack.floors.map((f) => (
                <g key={`floor:${f.label}`}>
                  <polygon points={f.platePts} className={`floor-plate floor-plane ${floorMode}`}
                    stroke={f.color} fill={`${f.color}${floorMode === 'overlaid' ? '0c' : '1a'}`} />
                  {floorMode === 'offset' && (
                    <>
                      <polygon points={f.slabFront} fill={f.color} className="slab-face slab-front" />
                      <polygon points={f.slabRight} fill={f.color} className="slab-face slab-right" />
                    </>
                  )}
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
            {/* Rooms as lit 3D spheres sitting on their floor plane. */}
            {stack &&
              stack.ordered.map((o) => {
                const p = stack.screenPos.get(o.key);
                if (!p) return null;
                const r = p.r;
                const kind = shapeOf(o.s);
                const box = kind === 'box';
                const poly = kind === 'poly' ? polyVertsOf(o.s) : null;
                const pbS = poly ? polyBounds(poly) : null;
                const side = r * Math.sqrt(Math.PI);
                const polyD = poly ? polygonPath(poly) : null;
                const extrude = r * 0.5; // screen-space "thickness" for the raised blob
                // Contact shadow: under the sphere bottom, or under the extruded blob's base.
                const shadow = poly
                  ? { cy: extrude + pbS.maxY * 0.95, rx: (pbS.maxX - pbS.minX) / 2 * 0.92, ry: (pbS.maxX - pbS.minX) / 2 * 0.22 }
                  : { cy: r * 0.65, rx: r * 0.9, ry: r * 0.24 };
                const label = `${o.s.name}${Math.max(1, o.s.count || 1) > 1 ? ` ${o.i + 1}` : ''}`;
                return (
                  <g key={`sph:${o.key}`} transform={`translate(${p.x}, ${p.y})`} className="bubble stacked sphere">
                    <title>{label} — {fmtArea(ea(o.s), units)}</title>
                    <ellipse cx="0" cy={shadow.cy} rx={shadow.rx} ry={shadow.ry} fill="url(#sphere-shadow-grad)" />
                    {poly ? (
                      <>
                        {/* Extruded body: a darkened copy dropped below the top face
                            so the freeform shape reads as a raised 3-D blob. */}
                        <path d={polyD} transform={`translate(0, ${extrude})`} fill={colorOf(o.s)} />
                        <path d={polyD} transform={`translate(0, ${extrude})`} fill="rgba(0,0,0,0.32)" />
                        <path d={polyD} fill={colorOf(o.s)} />
                        <path d={polyD} fill="url(#sphere3d)" />
                        <path d={polyD} fill="url(#sphere-spec)" />
                      </>
                    ) : box ? (
                      <>
                        <rect x={-side / 2} y={-side / 2} width={side} height={side} rx={Math.min(5, side / 8)} fill={colorOf(o.s)} />
                        <rect x={-side / 2} y={-side / 2} width={side} height={side} rx={Math.min(5, side / 8)} fill="url(#sphere3d)" />
                        <rect x={-side / 2} y={-side / 2} width={side} height={side} rx={Math.min(5, side / 8)} fill="url(#sphere-spec)" />
                      </>
                    ) : (
                      <>
                        <circle r={r} fill={colorOf(o.s)} />
                        <circle r={r} fill="url(#sphere3d)" />
                        <circle r={r} fill="url(#sphere-spec)" />
                      </>
                    )}
                    <BubbleLabel label={label} r={r} areaStr={fmtArea(ea(o.s), units)} />
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
              const count = Math.max(1, s.count || 1);
              const kind = shapeOf(s);
              const box = kind === 'box';
              const poly = kind === 'poly' ? polyVertsOf(s) : null;
              const polyHandles = kind === 'poly' ? polyHandlesOf(s) : null;
              const pb = poly ? polyBounds(poly) : null;
              const side = r * Math.sqrt(Math.PI); // square of equal area
              const editing = editShape === s.id && i === editAnchorInst(s);
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
                  className={`bubble ${isSel ? 'selected' : ''} ${inMulti ? 'multi' : ''}`}
                  transform={`translate(${n.x}, ${n.y})`}
                  onPointerDown={(e) => onBubbleDown(e, o)}
                  onPointerEnter={() => (hoverRef.current = { space: s, idx: i })}
                  onPointerLeave={() => (hoverRef.current?.space.id === s.id && hoverRef.current?.idx === i ? (hoverRef.current = null) : null)}
                >
                  <title>
                    {s.name}
                    {count > 1 ? ` ${i + 1} of ${count}` : ''} — {fmtArea(ea(s), units)} · P pin · B box
                  </title>
                  {pinned &&
                    (poly ? (
                      <path d={polyRingPath(poly, 6)} className="pin-ring" />
                    ) : box ? (
                      <rect x={-side / 2 - 5} y={-side / 2 - 5} width={side + 10} height={side + 10} rx="3" className="pin-ring" />
                    ) : (
                      <circle r={r + 5} className="pin-ring" />
                    ))}
                  {inMulti &&
                    (poly ? (
                      <path d={polyRingPath(poly, 9)} className="multi-ring" />
                    ) : box ? (
                      <rect x={-side / 2 - 7} y={-side / 2 - 7} width={side + 14} height={side + 14} rx="4" className="multi-ring" />
                    ) : (
                      <circle r={r + 7} className="multi-ring" />
                    ))}
                  {poly ? (
                    <path className={`poly-shape ${editing ? 'editing' : ''}`} d={polygonPath(poly)} fill={baseColor} fillOpacity={fillOpEff} stroke={strokeColor} strokeWidth={swEff} strokeLinejoin="round" filter={shapeFilter} />
                  ) : box ? (
                    <rect x={-side / 2} y={-side / 2} width={side} height={side} rx={flat ? 0 : Math.min(4, side / 8)} fill={baseColor} fillOpacity={fillOpEff} stroke={strokeColor} strokeWidth={swEff} filter={shapeFilter} />
                  ) : (
                    <circle r={r} fill={baseColor} fillOpacity={fillOpEff} stroke={strokeColor} strokeWidth={swEff} filter={shapeFilter} />
                  )}
                  <BubbleLabel
                    label={`${s.name}${count > 1 ? ` ${i + 1}` : ''}`}
                    r={r}
                    areaStr={fmtArea(ea(s), units)}
                    ink={inkColor}
                  />
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
                      {polyHandles.map((p, vi) => (
                        <circle
                          key={`v:${vi}`}
                          cx={p.x}
                          cy={p.y}
                          r="6"
                          className="poly-handle"
                          onPointerDown={(e) => onPolyVertexDown(e, s, vi)}
                          onDoubleClick={(e) => (e.stopPropagation(), removePolyVertex(s, vi))}
                        />
                      ))}
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
