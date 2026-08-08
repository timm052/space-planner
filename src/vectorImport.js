// One vector-import entry point over three readers.
//
// DXF, SVG and Illustrator all end up as the same thing here — polylines with a
// source layer, a real-world size where the file states one, and a count of
// what could not be read. Everything downstream (placement, rendering, export)
// then has a single shape to deal with.
//
// This is REFERENCE geometry, not programme. Imported outlines never contribute
// to an area, a total or a compliance figure — the app has no constraint
// objects, so an imported tree-protection circle is a circle, and pretending
// otherwise would be the same silent-wrongness this codebase has been busy
// removing. It is an underlay to trace and align against.

import { parseDxf } from './dxfImport.js';
import { parseSvg } from './svgImport.js';
import { parseAi } from './aiImport.js';

export const VECTOR_EXTENSIONS = ['.dxf', '.svg', '.ai', '.pdf'];
export const VECTOR_ACCEPT = '.dxf,.svg,.ai,.pdf,image/svg+xml,application/pdf,application/postscript';

/** Which reader a file needs, by extension first and content second. */
export function detectFormat(name = '', head = '') {
  const ext = String(name).toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (ext === '.dxf') return 'dxf';
  if (ext === '.svg') return 'svg';
  if (ext === '.ai' || ext === '.pdf') return 'ai';
  // Fall back to sniffing, because files arrive renamed more often than not.
  const h = String(head).slice(0, 2048);
  if (/^%PDF-/.test(h)) return 'ai';
  if (/<svg[\s>]/i.test(h)) return 'svg';
  if (/^\s*0\s*[\r\n]+\s*SECTION/.test(h) || /\bENTITIES\b/.test(h)) return 'dxf';
  return null;
}

/**
 * Read any supported vector file.
 * @param {string|Uint8Array} content
 * @param {string} name Filename, for format detection.
 * @returns {Promise<object|null>} Common parse shape, or null when unreadable.
 */
export async function parseVector(content, name = '') {
  const asText = typeof content === 'string'
    ? content
    : new TextDecoder('latin1').decode(content instanceof Uint8Array ? content : new Uint8Array(content));
  const fmt = detectFormat(name, asText);
  if (!fmt) return null;
  const parsed = fmt === 'dxf' ? parseDxf(asText)
    : fmt === 'svg' ? parseSvg(asText)
      : await parseAi(content);
  if (!parsed) return null;
  return { ...parsed, format: fmt, yUp: parsed.yUp ?? true };
}

/**
 * Place a parse onto the drawing: real units → diagram units, Y oriented to the
 * diagram, centred on a given point.
 *
 * Centring rather than honouring the file's own coordinates is deliberate.
 * A survey in easting/northing would land hundreds of kilometres from the
 * drawing — off-screen, looking exactly like an import that silently did
 * nothing. The user aligns it once, visibly, and can then nudge it numerically.
 *
 * @param {object} parsed From parseVector.
 * @param {number} effScale Metres per diagram unit.
 * @param {{x:number,y:number}} centre
 * @param {number} manualScale Multiplier for files that state no real size.
 */
export function placeVector(parsed, effScale, centre = { x: 0, y: 0 }, manualScale = 1) {
  if (!parsed?.polylines?.length || !(effScale > 0) || !parsed.bounds) return [];
  const k = ((parsed.unitsPerMetre || 1) * (manualScale || 1)) / effScale;
  const cx = (parsed.bounds.minX + parsed.bounds.maxX) / 2;
  const cy = (parsed.bounds.minY + parsed.bounds.maxY) / 2;
  const flip = parsed.yUp ? -1 : 1;
  return parsed.polylines.map((pl) => ({
    layer: pl.layer,
    closed: pl.closed,
    points: pl.pts.map(([x, y]) => [
      +(centre.x + (x - cx) * k).toFixed(2),
      +(centre.y + (y - cy) * k * flip).toFixed(2),
    ]),
  }));
}

/** Real-world width of a parse, in metres — for the "is this the right size?" readout. */
export function realWidthM(parsed) {
  if (!parsed?.bounds) return null;
  return (parsed.bounds.maxX - parsed.bounds.minX) * (parsed.unitsPerMetre || 1);
}
