// SVG → polylines, for a site plan exported from Illustrator, QGIS, Rhino or
// anything else that speaks SVG.
//
// Parsed with a regex sweep rather than DOMParser so the module runs in Node
// and can be tested. That is a deliberate limitation and worth being plain
// about: nested <g transform> chains are resolved, but CSS-driven geometry,
// <use>/<symbol> references, clip paths and markers are not. What comes in is
// the drawn outlines — which is what an underlay is for.
//
// SVG's Y already counts downward, the same as the diagram, so no flip here.
// A viewBox is honoured: it is what maps the file's numbers onto its stated
// width/height, and ignoring it is how an import arrives at the wrong size.

import { pathToPolylines } from './pathParse.js';

const ATTR = (tag, name) => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`).exec(tag);
  return m ? (m[1] ?? m[2]) : null;
};
const NUM = (tag, name, dflt = 0) => {
  const v = ATTR(tag, name);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

/** Parse `transform` into a 2×3 matrix [a,b,c,d,e,f]. */
export function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (n) => {
    m = [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let f;
  while ((f = re.exec(String(str || '')))) {
    const a = f[2].split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    switch (f[1]) {
      case 'matrix': if (a.length >= 6) mul(a.slice(0, 6)); break;
      case 'translate': mul([1, 0, 0, 1, a[0] || 0, a[1] || 0]); break;
      case 'scale': mul([a[0] ?? 1, 0, 0, a.length > 1 ? a[1] : (a[0] ?? 1), 0, 0]); break;
      case 'rotate': {
        const r = ((a[0] || 0) * Math.PI) / 180;
        const [cx, cy] = [a[1] || 0, a[2] || 0];
        if (cx || cy) mul([1, 0, 0, 1, cx, cy]);
        mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
        if (cx || cy) mul([1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX': mul([1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0]); break;
      case 'skewY': mul([1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]); break;
      default: break;
    }
  }
  return m;
};

const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const ptsAttr = (s) => {
  const n = String(s || '').trim().split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
  const out = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};

const ellipse = (cx, cy, rx, ry, seg = 48) => {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
};

/**
 * @returns {{ polylines: Array<{layer:string, closed:boolean, pts:Array<[number,number]>}>,
 *   layers: string[], bounds: object|null, unitsPerMetre: number, unitsKnown: boolean,
 *   skipped: Record<string, number>, count: number }|null}
 */
export function parseSvg(text) {
  const src = String(text || '');
  if (!/<svg[\s>]/i.test(src)) return null;

  const svgTag = /<svg[^>]*>/i.exec(src)?.[0] ?? '<svg>';
  const viewBox = (ATTR(svgTag, 'viewBox') || '').split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const widthAttr = ATTR(svgTag, 'width');

  // Group transforms nest, so walk the markup keeping a matrix stack. `id` or
  // `inkscape:label` on a <g> becomes the layer name, which is how every tool
  // that writes SVG records layers.
  const stack = [{ m: [1, 0, 0, 1, 0, 0], layer: '0' }];
  const polylines = [];
  const skipped = {};
  const layerSet = new Set();
  const add = (pts, closed) => {
    const top = stack[stack.length - 1];
    if (pts.length < 2) return;
    layerSet.add(top.layer);
    polylines.push({ layer: top.layer, closed, pts: pts.map((p) => apply(top.m, p)) });
  };

  const TAG = /<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
  let t;
  while ((t = TAG.exec(src))) {
    const whole = t[0];
    const name = t[1].toLowerCase().replace(/^.*:/, '');
    const selfClosing = /\/>$/.test(whole);
    const closing = whole.startsWith('</');

    if (name === 'g' || name === 'svg') {
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const top = stack[stack.length - 1];
      const tm = parseTransform(ATTR(whole, 'transform'));
      const m = [
        top.m[0] * tm[0] + top.m[2] * tm[1], top.m[1] * tm[0] + top.m[3] * tm[1],
        top.m[0] * tm[2] + top.m[2] * tm[3], top.m[1] * tm[2] + top.m[3] * tm[3],
        top.m[0] * tm[4] + top.m[2] * tm[5] + top.m[4], top.m[1] * tm[4] + top.m[3] * tm[5] + top.m[5],
      ];
      const layer = ATTR(whole, 'inkscape:label') || ATTR(whole, 'id') || top.layer;
      if (!selfClosing) stack.push({ m, layer });
      continue;
    }
    if (closing) continue;

    // A shape's own transform composes on top of its group's.
    const top = stack[stack.length - 1];
    const own = ATTR(whole, 'transform');
    if (own) {
      const tm = parseTransform(own);
      stack.push({
        m: [
          top.m[0] * tm[0] + top.m[2] * tm[1], top.m[1] * tm[0] + top.m[3] * tm[1],
          top.m[0] * tm[2] + top.m[2] * tm[3], top.m[1] * tm[2] + top.m[3] * tm[3],
          top.m[0] * tm[4] + top.m[2] * tm[5] + top.m[4], top.m[1] * tm[4] + top.m[3] * tm[5] + top.m[5],
        ],
        layer: ATTR(whole, 'id') && name === 'path' ? top.layer : top.layer,
      });
    }

    if (name === 'path') {
      for (const sub of pathToPolylines(ATTR(whole, 'd'))) add(sub.pts, sub.closed);
    } else if (name === 'polyline') add(ptsAttr(ATTR(whole, 'points')), false);
    else if (name === 'polygon') add(ptsAttr(ATTR(whole, 'points')), true);
    else if (name === 'line') add([[NUM(whole, 'x1'), NUM(whole, 'y1')], [NUM(whole, 'x2'), NUM(whole, 'y2')]], false);
    else if (name === 'rect') {
      const x = NUM(whole, 'x'), y = NUM(whole, 'y'), w = NUM(whole, 'width'), h = NUM(whole, 'height');
      if (w > 0 && h > 0) add([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
    } else if (name === 'circle') {
      const r = NUM(whole, 'r');
      if (r > 0) add(ellipse(NUM(whole, 'cx'), NUM(whole, 'cy'), r, r), true);
    } else if (name === 'ellipse') {
      const rx = NUM(whole, 'rx'), ry = NUM(whole, 'ry');
      if (rx > 0 && ry > 0) add(ellipse(NUM(whole, 'cx'), NUM(whole, 'cy'), rx, ry), true);
    } else if (['text', 'image', 'use', 'tspan', 'symbol', 'clippath', 'marker', 'foreignobject'].includes(name)) {
      skipped[name] = (skipped[name] || 0) + 1;
    }

    if (own) stack.pop();
  }

  if (!polylines.length) return { polylines: [], layers: [], bounds: null, unitsPerMetre: 1, unitsKnown: false, skipped, count: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of polylines) for (const [x, y] of pl.pts) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }

  // Real-world size, when the file states one. A width in mm plus a viewBox is
  // the only combination that says how big this drawing IS; anything else is
  // just pixels, and the caller has to scale it by hand.
  let unitsPerMetre = 1;
  let unitsKnown = false;
  const mmMatch = /^([\d.]+)\s*(mm|cm|m|in)$/i.exec(String(widthAttr || '').trim());
  if (mmMatch && viewBox.length === 4 && viewBox[2] > 0) {
    const perUnit = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254 }[mmMatch[2].toLowerCase()];
    unitsPerMetre = (parseFloat(mmMatch[1]) * perUnit) / viewBox[2];
    unitsKnown = true;
  }

  return {
    polylines,
    layers: [...layerSet].sort(),
    bounds: { minX, minY, maxX, maxY },
    unitsPerMetre,
    unitsKnown,
    skipped,
    count: polylines.length,
    yUp: false, // SVG already counts downward, like the diagram
  };
}
