// DXF import — a survey or site plan as VECTORS to trace and snap to, rather
// than a raster to squint at.
//
// Scope is deliberately narrow, and the narrowness is the point. This reads the
// entities a site drawing is actually made of — LINE, LWPOLYLINE, POLYLINE and
// CIRCLE/ARC — on their own layers, and nothing else. It does NOT resolve
// blocks (INSERT), splines, hatches, xrefs, dimensions or text styles. A parser
// that half-understands a block reference produces geometry in the wrong place,
// which is worse than declining: the drawing looks imported and is wrong.
// Unsupported entities are counted and reported so the user knows what was left
// behind rather than discovering it by eye.
//
// Output is in the DXF's own units, converted to metres via $INSUNITS. Callers
// divide by the drawing scale to reach diagram units.

/** $INSUNITS → metres per unit. 0 = unitless; treat as metres and say so. */
const INSUNITS_M = {
  0: 1, 1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01,
  6: 1, 7: 1000, 8: 2.54e-8, 9: 2.54e-5, 10: 0.9144, 11: 1e-10,
  12: 1e-9, 13: 1e-6, 14: 0.1, 15: 10, 16: 100, 17: 1e9,
};

const SUPPORTED = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC']);

/** Split a DXF into (code, value) pairs. Tolerates CR/LF and stray blank lines. */
function pairs(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) return out; // malformed past this point — stop
    out.push([code, lines[i + 1]]);
  }
  return out;
}

/**
 * Parse a DXF into flat polylines.
 *
 * @param {string} text
 * @returns {{
 *   polylines: Array<{ layer: string, closed: boolean, pts: Array<[number, number]> }>,
 *   layers: string[], unitsPerMetre: number, unitsKnown: boolean,
 *   bounds: {minX,minY,maxX,maxY}|null, skipped: Record<string, number>, count: number
 * }|null}
 */
export function parseDxf(text) {
  const p = pairs(text);
  if (!p.length) return null;

  let insunits = null;
  const polylines = [];
  const skipped = {};
  const layerSet = new Set();

  // Header scan for $INSUNITS — it decides what the coordinates MEAN.
  for (let i = 0; i < p.length - 2; i++) {
    if (p[i][0] === 9 && p[i][1].trim() === '$INSUNITS') {
      const v = p.find((q, j) => j > i && q[0] === 70);
      if (v) insunits = Number(v[1]);
      break;
    }
  }

  // Walk entities. Each starts at a 0-code; we collect its group codes until
  // the next 0-code, then convert.
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const t = cur.type;
    if (!SUPPORTED.has(t)) {
      if (t && t !== 'SECTION' && t !== 'ENDSEC' && t !== 'EOF' && t !== 'TABLE' && t !== 'ENDTAB'
        && t !== 'LAYER' && t !== 'VERTEX' && t !== 'SEQEND' && t !== 'BLOCK' && t !== 'ENDBLK') {
        skipped[t] = (skipped[t] || 0) + 1;
      }
      cur = null;
      return;
    }
    const layer = cur.layer || '0';
    layerSet.add(layer);
    if (t === 'LINE') {
      if (cur.x != null && cur.x1 != null) polylines.push({ layer, closed: false, pts: [[cur.x, cur.y], [cur.x1, cur.y1]] });
    } else if (t === 'CIRCLE' || t === 'ARC') {
      // Circles and arcs become polylines — a traceable outline is what this is
      // for, and it keeps the whole downstream path to one primitive.
      const seg = 48;
      const a0 = t === 'ARC' ? ((cur.a0 ?? 0) * Math.PI) / 180 : 0;
      const a1 = t === 'ARC' ? ((cur.a1 ?? 360) * Math.PI) / 180 : Math.PI * 2;
      const sweep = a1 > a0 ? a1 - a0 : a1 - a0 + Math.PI * 2;
      const pts = [];
      for (let k = 0; k <= seg; k++) {
        const a = a0 + (sweep * k) / seg;
        pts.push([cur.x + Math.cos(a) * cur.r, cur.y + Math.sin(a) * cur.r]);
      }
      if (cur.r > 0) polylines.push({ layer, closed: t === 'CIRCLE', pts });
    } else if (cur.pts?.length >= 2) {
      polylines.push({ layer, closed: !!(cur.flags & 1), pts: cur.pts });
    }
    cur = null;
  };

  let inPolyline = null; // an old-style POLYLINE gathering VERTEX children
  for (const [code, raw] of p) {
    const value = raw;
    if (code === 0) {
      const t = value.trim().toUpperCase();
      // A POLYLINE's vertices arrive as separate entities until SEQEND.
      if (inPolyline) {
        if (t === 'VERTEX') { cur = { type: 'VERTEX' }; continue; }
        if (t === 'SEQEND') {
          const done = inPolyline;
          inPolyline = null;
          cur = null;
          if (done.pts.length >= 2) {
            layerSet.add(done.layer || '0');
            polylines.push({ layer: done.layer || '0', closed: !!(done.flags & 1), pts: done.pts });
          }
          continue;
        }
      }
      flush();
      if (t === 'POLYLINE') { inPolyline = { type: 'POLYLINE', pts: [], flags: 0, layer: '0' }; cur = inPolyline; continue; }
      cur = { type: t, pts: [] };
      continue;
    }
    if (!cur) continue;
    const n = Number(value);
    if (code === 8) { cur.layer = value.trim(); if (inPolyline && cur === inPolyline) inPolyline.layer = value.trim(); }
    else if (code === 10) {
      if (cur.type === 'VERTEX' && inPolyline) cur.vx = n;
      else if (cur.type === 'LWPOLYLINE') cur.px = n;
      else cur.x = n;
    } else if (code === 20) {
      if (cur.type === 'VERTEX' && inPolyline) { inPolyline.pts.push([cur.vx, n]); }
      else if (cur.type === 'LWPOLYLINE') cur.pts.push([cur.px, n]);
      else cur.y = n;
    } else if (code === 11) cur.x1 = n;
    else if (code === 21) cur.y1 = n;
    else if (code === 40) cur.r = n;
    else if (code === 50) cur.a0 = n;
    else if (code === 51) cur.a1 = n;
    else if (code === 70) { cur.flags = n; if (inPolyline && cur === inPolyline) inPolyline.flags = n; }
  }
  flush();

  if (!polylines.length) return { polylines: [], layers: [], unitsPerMetre: 1, unitsKnown: insunits != null, bounds: null, skipped, count: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of polylines) {
    for (const [x, y] of pl.pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  return {
    polylines,
    layers: [...layerSet].sort(),
    // Metres per DXF unit. Unitless files are assumed metric; `unitsKnown`
    // lets the UI say so rather than pretending.
    unitsPerMetre: INSUNITS_M[insunits ?? 0] ?? 1,
    unitsKnown: insunits != null && insunits !== 0,
    bounds: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null,
    skipped,
    count: polylines.length,
  };
}

/**
 * Convert parsed polylines into diagram-unit strokes, centred on `centre`.
 *
 * DXF Y counts up and the diagram counts down, so Y is negated — the same flip
 * the exporter applies in reverse. Centring rather than honouring the file's
 * own coordinates is deliberate: survey easting/northing would land the import
 * hundreds of kilometres from the drawing, off-screen, looking like nothing
 * happened. The user aligns it once, visibly.
 *
 * @param {object} parsed  From parseDxf.
 * @param {number} effScale Metres per diagram unit.
 * @param {{x:number,y:number}} centre Diagram-unit point to centre on.
 */
export function toStrokes(parsed, effScale, centre = { x: 0, y: 0 }) {
  if (!parsed?.polylines?.length || !(effScale > 0) || !parsed.bounds) return [];
  const k = parsed.unitsPerMetre / effScale; // DXF units → diagram units
  const cx = (parsed.bounds.minX + parsed.bounds.maxX) / 2;
  const cy = (parsed.bounds.minY + parsed.bounds.maxY) / 2;
  return parsed.polylines.map((pl) => ({
    layer: pl.layer,
    closed: pl.closed,
    points: pl.pts.map(([x, y]) => [
      +(centre.x + (x - cx) * k).toFixed(2),
      +(centre.y - (y - cy) * k).toFixed(2),
    ]),
  }));
}
