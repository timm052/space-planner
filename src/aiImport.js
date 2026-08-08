// Adobe Illustrator (.ai) → polylines.
//
// A modern .ai file IS a PDF. Since Illustrator 9 the format has been
// "PDF-compatible": the file is a valid PDF carrying Illustrator's private data
// alongside, which is why Acrobat and Preview open .ai files directly. So
// reading one means reading a PDF content stream, and writing one means writing
// a PDF — there is no separate Illustrator format to implement.
//
// Scope, stated plainly: this reads path-construction operators (m, l, c, v, y,
// re, h) out of the content streams, applying the current transformation matrix
// from cm/q/Q. It does NOT interpret text, images, clipping, shading, patterns
// or XObject forms, and it does not read the legacy pre-v9 PostScript format.
// Anything unread is counted and reported rather than passed over in silence.
//
// PDF user space is 1/72 inch and Y counts UP, so both are converted here.

import { inflate } from './inflate.js';

const PT_TO_M = 0.0254 / 72;

/** Split a PDF into its content streams, inflating FlateDecode where needed. */
export async function extractStreams(bytes) {
  // Byte-exact, not text. TextDecoder('latin1') is really windows-1252, which
  // maps 0x80–0x9F to characters above U+00FF — so round-tripping a compressed
  // stream through a string corrupts precisely the bytes a DEFLATE payload is
  // full of. Instead keep the bytes, and build a 1:1 shadow string purely so
  // the offsets of `stream` / `endstream` can be found by index.
  const u8 = typeof bytes === 'string'
    ? Uint8Array.from(bytes, (c) => c.charCodeAt(0) & 0xff)
    : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let latin = '';
  for (let i = 0; i < u8.length; i += 8192) {
    latin += String.fromCharCode(...u8.subarray(i, Math.min(i + 8192, u8.length)));
  }

  const out = [];
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    // Look back at the dictionary to see whether it is compressed.
    const dict = latin.slice(Math.max(0, m.index - 400), m.index);
    // Per the PDF spec the data is followed by an EOL before `endstream`.
    // That byte is a delimiter, not payload, and DecompressionStream refuses a
    // stream with anything trailing it — so trim it off.
    let dataEnd = end;
    while (dataEnd > start && (u8[dataEnd - 1] === 0x0a || u8[dataEnd - 1] === 0x0d)) dataEnd--;

    if (/FlateDecode/.test(dict)) {
      try {
        const inflated = await inflate(u8.subarray(start, dataEnd));
        let s = '';
        for (let i = 0; i < inflated.length; i += 8192) {
          s += String.fromCharCode(...inflated.subarray(i, Math.min(i + 8192, inflated.length)));
        }
        out.push(s);
      } catch {
        /* a stream we cannot inflate is not fatal — skip it */
      }
    } else {
      out.push(latin.slice(start, end));
    }
    re.lastIndex = end;
  }
  return out;
}

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const xf = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function cubic(p0, p1, p2, p3, steps, push) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

/**
 * Read path geometry from PDF/AI content streams.
 * @returns {{polylines, layers, bounds, unitsPerMetre, unitsKnown, skipped, count, yUp}|null}
 */
export async function parseAi(input) {
  const streams = await extractStreams(input);
  if (!streams.length) return null;

  const polylines = [];
  const skipped = {};
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let cur = null;
  let startPt = null;
  const steps = 12;

  const push = (p) => {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    if (!cur) cur = { closed: false, pts: [] };
    cur.pts.push(p);
  };
  const endPath = (closed) => {
    if (cur && cur.pts.length >= 2) polylines.push({ layer: 'AI', closed: closed || cur.closed, pts: cur.pts });
    cur = null;
    startPt = null;
  };

  for (const s of streams) {
    // Operands accumulate until an operator token consumes them.
    const toks = s.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z*'"]+|[[\]<>{}()/]/g) || [];
    let ops = [];
    for (const tk of toks) {
      const n = Number(tk);
      if (Number.isFinite(n) && /^[-\d.]/.test(tk)) { ops.push(n); continue; }
      switch (tk) {
        case 'q': stack.push(ctm.slice()); break;
        case 'Q': ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
        case 'cm': if (ops.length >= 6) ctm = mul(ctm, ops.slice(-6)); break;
        case 'm': if (ops.length >= 2) { endPath(false); const p = xf(ctm, ops[ops.length - 2], ops[ops.length - 1]); push(p); startPt = p; } break;
        case 'l': if (ops.length >= 2) push(xf(ctm, ops[ops.length - 2], ops[ops.length - 1])); break;
        case 'c': if (ops.length >= 6 && cur?.pts.length) {
          const a = ops.slice(-6);
          cubic(cur.pts[cur.pts.length - 1], xf(ctm, a[0], a[1]), xf(ctm, a[2], a[3]), xf(ctm, a[4], a[5]), steps, push);
        } break;
        case 'v': if (ops.length >= 4 && cur?.pts.length) {
          const a = ops.slice(-4);
          const p0 = cur.pts[cur.pts.length - 1];
          cubic(p0, p0, xf(ctm, a[0], a[1]), xf(ctm, a[2], a[3]), steps, push);
        } break;
        case 'y': if (ops.length >= 4 && cur?.pts.length) {
          const a = ops.slice(-4);
          const p3 = xf(ctm, a[2], a[3]);
          cubic(cur.pts[cur.pts.length - 1], xf(ctm, a[0], a[1]), p3, p3, steps, push);
        } break;
        case 're': if (ops.length >= 4) {
          const [x, y, w, h] = ops.slice(-4);
          endPath(false);
          for (const p of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) push(xf(ctm, p[0], p[1]));
          if (cur) cur.closed = true;
          endPath(true);
        } break;
        case 'h': if (cur && startPt) { push(startPt); cur.closed = true; } break;
        case 'n': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
          endPath(true); break;
        case 'S': case 's': endPath(cur?.closed); break;
        case 'W': case 'W*': skipped.clip = (skipped.clip || 0) + 1; break;
        case 'Tj': case 'TJ': skipped.text = (skipped.text || 0) + 1; break;
        case 'Do': skipped.xobject = (skipped.xobject || 0) + 1; break;
        case 'sh': skipped.shading = (skipped.shading || 0) + 1; break;
        default: break;
      }
      ops = [];
    }
    endPath(false);
  }

  if (!polylines.length) {
    return { polylines: [], layers: [], bounds: null, unitsPerMetre: PT_TO_M, unitsKnown: true, skipped, count: 0, yUp: true };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of polylines) for (const [x, y] of pl.pts) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return {
    polylines,
    layers: ['AI'],
    bounds: { minX, minY, maxX, maxY },
    // PDF user space is points; that IS a real-world size, so an .ai always
    // knows how big it is.
    unitsPerMetre: PT_TO_M,
    unitsKnown: true,
    skipped,
    count: polylines.length,
    yUp: true, // PDF counts upward
  };
}
