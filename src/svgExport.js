// SVG export — the sheet as editable vectors for Illustrator, Affinity, Figma
// or InDesign.
//
// Complements the DXF: DXF is what a CAD recipient wants and carries real
// metres; SVG is what a graphics recipient wants and carries colour, opacity
// and text as text. Both come off the same sheet scene, so neither can drift
// from what the PDF shows.
//
// Written at 1 user unit = 1 mm with a physical width/height on the root, so
// the file opens at true size in every editor rather than at some nominal pixel
// dimension. Groups are named the way the DXF layers are, because that is what
// becomes a layer in Illustrator.

import { sheetNote } from './sheet.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const n = (v) => (Math.round(v * 1000) / 1000).toString();

/**
 * @param {object} scene   buildSheetScene output (diagram units).
 * @param {object} opts
 * @param {number} opts.mmPerUnit  Millimetres per diagram unit on the sheet.
 * @param {string} opts.title
 * @returns {string} SVG document.
 */
export function buildSvg(scene, { mmPerUnit = 0.2645833, title = 'Drawing' } = {}) {
  if (!scene?.bubbles) return null;
  const b = scene.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const pad = 8; // mm
  const w = (b.maxX - b.minX) * mmPerUnit + pad * 2;
  const h = (b.maxY - b.minY) * mmPerUnit + pad * 2;
  const X = (u) => pad + (u - b.minX) * mmPerUnit;
  const Y = (u) => pad + (u - b.minY) * mmPerUnit;

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${n(w)}mm" height="${n(h)}mm" `
    + `viewBox="0 0 ${n(w)} ${n(h)}">`
  );
  out.push(`<title>${esc(title)}</title>`);
  // A white ground: these files are for print and placement, and a transparent
  // background reads as black in half the tools that open it.
  out.push(`<rect x="0" y="0" width="${n(w)}" height="${n(h)}" fill="#ffffff"/>`);

  const polyPts = (pts) => pts.map((p) => `${n(X(p.x))},${n(Y(p.y))}`).join(' ');

  if (scene.links?.length) {
    out.push('<g id="ANNO-LINK" fill="none" stroke="#7c88a1">');
    for (const l of scene.links) {
      out.push(
        `<line x1="${n(X(l.x1))}" y1="${n(Y(l.y1))}" x2="${n(X(l.x2))}" y2="${n(Y(l.y2))}" `
        + `stroke-width="${l.strength === 'required' ? 0.5 : 0.3}"`
        + `${l.strength === 'required' ? '' : ' stroke-dasharray="1.4 1.2"'}/>`
      );
    }
    out.push('</g>');
  }

  if (scene.cells?.length) {
    out.push('<g id="SITE-ROOM">');
    for (const c of scene.cells) {
      out.push(`<polygon points="${polyPts(c.poly)}" fill="${esc(c.color)}" fill-opacity="0.3" stroke="${esc(c.color)}" stroke-width="0.2"/>`);
    }
    out.push('</g>');
  }

  out.push('<g id="SITE-ENVELOPE">');
  for (const bub of scene.bubbles) {
    const fill = esc(bub.color);
    const op = bub.opacity ?? 0.32;
    if (bub.poly?.length >= 3) {
      out.push(`<polygon points="${polyPts(bub.poly)}" fill="${fill}" fill-opacity="${op}" stroke="${fill}" stroke-width="0.3"/>`);
    } else {
      out.push(`<circle cx="${n(X(bub.x))}" cy="${n(Y(bub.y))}" r="${n(bub.r * mmPerUnit)}" fill="${fill}" fill-opacity="${op}" stroke="${fill}" stroke-width="0.3"/>`);
    }
  }
  out.push('</g>');

  // Text stays text — the whole reason a designer wants SVG rather than a PDF
  // raster is to restyle the labels.
  out.push('<g id="ANNO-NAME" font-family="Inter, Helvetica, Arial, sans-serif" text-anchor="middle" fill="#1a1a1a">');
  for (const bub of scene.bubbles) {
    const size = Math.max(1.6, Math.min(4, bub.r * mmPerUnit * 0.34));
    out.push(`<text x="${n(X(bub.x))}" y="${n(Y(bub.y))}" font-size="${n(size)}">${esc(bub.label)}</text>`);
    if (bub.sublabel) {
      out.push(`<text x="${n(X(bub.x))}" y="${n(Y(bub.y) + size * 1.15)}" font-size="${n(size * 0.78)}" fill="#5a5a5a">${esc(bub.sublabel)}</text>`);
    }
  }
  for (const c of scene.cells ?? []) {
    let cx = 0; let cy = 0;
    for (const p of c.poly) { cx += p.x; cy += p.y; }
    cx /= c.poly.length; cy /= c.poly.length;
    const size = Math.max(1.4, Math.min(3, c.r * mmPerUnit * 0.32));
    out.push(`<text x="${n(X(cx))}" y="${n(Y(cy))}" font-size="${n(size)}">${esc(c.label)}</text>`);
  }
  out.push('</g>');

  if (scene.markup?.length) {
    out.push('<g id="ANNO-MARKUP" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">');
    for (const m of scene.markup) {
      const pts = (m.points || []).map(([x, y]) => `${n(X(x))},${n(Y(y))}`).join(' ');
      if (pts) out.push(`<polyline points="${pts}" stroke="${esc(m.color)}" stroke-width="${n(m.width * mmPerUnit)}"/>`);
    }
    out.push('</g>');
  }

  // Sheet notes: text as text, with a leader to what they point at, so the
  // recipient can retype or restyle them like anything else in the file.
  if (scene.notes?.length) {
    out.push('<g id="ANNO-NOTE" font-family="Inter, Helvetica, Arial, sans-serif">');
    for (const nt of scene.notes) {
      const size = nt.height * mmPerUnit;
      const anchor = nt.leader && nt.leader.x > nt.x ? 'end' : 'start';
      const gap = size * 0.4;
      if (nt.leader) {
        const footX = anchor === 'end' ? X(nt.x) + gap : X(nt.x) - gap;
        out.push(`<line x1="${n(X(nt.leader.x))}" y1="${n(Y(nt.leader.y))}" x2="${n(footX)}" y2="${n(Y(nt.y))}" stroke="${esc(nt.color)}" stroke-width="${n(Math.max(0.1, size / 8))}"/>`);
        out.push(`<circle cx="${n(X(nt.leader.x))}" cy="${n(Y(nt.leader.y))}" r="${n(Math.max(0.15, size / 5))}" fill="${esc(nt.color)}"/>`);
      }
      const lines = String(nt.text || '').split('\n');
      const spans = lines
        .map((line, i) => `<tspan x="${n(X(nt.x))}" dy="${i === 0 ? 0 : n(size * 1.25)}">${esc(line)}</tspan>`)
        .join('');
      out.push(`<text x="${n(X(nt.x))}" y="${n(Y(nt.y))}" font-size="${n(size)}" text-anchor="${anchor}" fill="${esc(nt.color)}">${spans}</text>`);
    }
    out.push('</g>');
  }

  if (scene.title) {
    const t = scene.title;
    out.push('<g id="ANNO-SHEET" font-family="Inter, Helvetica, Arial, sans-serif" fill="#333333">');
    out.push(`<text x="${n(pad)}" y="${n(h - 2.5)}" font-size="3">${esc(sheetNote(t))}</text>`);
    if (scene.markup?.length) {
      out.push(`<text x="${n(w - pad)}" y="${n(h - 2.5)}" font-size="2.4" text-anchor="end" fill="#999999">Coloured lines are markup — not drawn geometry</text>`);
    }
    out.push('</g>');
  }

  out.push('</svg>');
  return out.join('\n');
}

/** Trigger a browser download. */
export function downloadSvg(svg, filename) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
