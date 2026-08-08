import { jsPDF } from 'jspdf';
import { sheetFileStem } from './sheet.js';

// A diagram unit is defined as 0.2646 mm of paper (≈ 1 CSS px at 96 dpi), so a
// drawing printed at MM_PER_UNIT mm/unit is at scale 1:(unit_metres / 0.0002646).
// This is what makes the PDF dimensionally accurate when a standard scale is set.
const MM_PER_UNIT = 0.2645833;

// Landscape ISO sizes (mm) we'll try to fit the drawing onto.
const PAGES = [
  { name: 'A4', w: 297, h: 210 },
  { name: 'A3', w: 420, h: 297 },
  { name: 'A2', w: 594, h: 420 },
  { name: 'A1', w: 841, h: 594 },
  { name: 'A0', w: 1189, h: 841 },
];

const MARGIN = 12; // mm
const TITLE_H = 28; // mm reserved at the bottom for the title block

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#888888');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [136, 136, 136];
}

function imageFormat(dataUrl) {
  return /^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG';
}

// scene = {
//   bounds:{minX,minY,maxX,maxY}, layers:[{dataUrl,x,y,w,h,opacity}],
//   links:[{x1,y1,x2,y2,strength}],
//   bubbles:[{x,y,r,color,opacity,label,sublabel,poly?,labelAbove?}],
//   cells:[{poly,r,color,label,sublabel}] — interior room cells (master plan),
//   scale:{ratioLabel, scaleBar:{lenUnits,label}}|null, north:{deg}|null,
//   title:{name,client,stage,sheet,scaleLabel,date,
//          number,revision,status,drawnBy,checkedBy}
// }   — all geometry in diagram units.

// Pick the page + mm-per-unit for one sheet: the smallest ISO page that holds
// the content at true scale (or, in relative/NTS mode, fit the content to A3).
export { PAGES };

function layoutSheet(scene, forcePage = null) {
  const { bounds } = scene;
  const contentWUnits = Math.max(1, bounds.maxX - bounds.minX);
  const contentHUnits = Math.max(1, bounds.maxY - bounds.minY);

  const toScale = !!scene.scale;
  let mmPerUnit = MM_PER_UNIT;
  let reduced = null;
  let page = null;

  // An explicitly chosen sheet wins. Auto-fitting to the smallest page that
  // holds the drawing is the right default, but a client or an authority
  // expects a particular size regardless of how much happens to be on it —
  // and there was no way to say so.
  const forced = forcePage && PAGES.find((p) => p.name === forcePage);
  if (forced) {
    page = forced;
    const availW = page.w - 2 * MARGIN;
    const availH = page.h - 2 * MARGIN - TITLE_H;
    if (toScale) {
      const fit = Math.min(availW / contentWUnits, availH / contentHUnits);
      // Only ever reduce: a drawing that fits stays at true scale, so the
      // stated ratio keeps meaning what it says.
      if (fit < mmPerUnit) {
        reduced = mmPerUnit / fit;
        mmPerUnit = fit;
      }
    } else {
      mmPerUnit = Math.min(availW / contentWUnits, availH / contentHUnits);
    }
    return { page, mmPerUnit, reduced };
  }

  if (toScale) {
    const needW = contentWUnits * mmPerUnit + 2 * MARGIN;
    const needH = contentHUnits * mmPerUnit + 2 * MARGIN + TITLE_H;
    page = PAGES.find((p) => p.w >= needW && p.h >= needH);
    if (!page) {
      // Larger than A0 — fall back to A0 and scale down, noting the reduction.
      page = PAGES[PAGES.length - 1];
      const availW = page.w - 2 * MARGIN;
      const availH = page.h - 2 * MARGIN - TITLE_H;
      const fit = Math.min(availW / contentWUnits, availH / contentHUnits);
      reduced = mmPerUnit / fit; // factor by which true scale was reduced
      mmPerUnit = fit;
    }
  } else {
    page = PAGES[1]; // A3
    const availW = page.w - 2 * MARGIN;
    const availH = page.h - 2 * MARGIN - TITLE_H;
    mmPerUnit = Math.min(availW / contentWUnits, availH / contentHUnits);
  }
  return { page, mmPerUnit, reduced };
}

/**
 * One environment's drawing as a rendered jsPDF document, before it is handed
 * to a browser download. Exported so a test can read the sheet back rather
 * than take the title block on trust.
 */
export function buildSheetDoc(scene, { page = null } = {}) {
  const layout = layoutSheet(scene, page);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [layout.page.w, layout.page.h] });
  renderSheet(doc, scene, layout);
  return { doc, layout };
}

// One environment's drawing as a single sheet.
export function exportDiagramPdf(scene, { page = null } = {}) {
  const { doc } = buildSheetDoc(scene, { page });
  doc.save(`${sheetFileStem(scene.title)}_bubble_diagram.pdf`);
}

/**
 * The same sheet as an Adobe Illustrator file.
 *
 * Since Illustrator 9 the .ai format has been "PDF-compatible": the file IS a
 * PDF, carrying Illustrator's private data alongside, which is why Acrobat and
 * Preview open .ai directly. So writing one means writing a PDF and naming it
 * .ai — that is not a trick, it is the format. Illustrator opens the result and
 * every object is editable.
 *
 * Returns the mm-per-unit used, so a caller can report the true scale.
 */
export function exportDiagramAi(scene, { page = null } = {}) {
  const { doc, layout } = buildSheetDoc(scene, { page });
  const blob = doc.output('blob');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([blob], { type: 'application/postscript' }));
  a.download = `${sheetFileStem(scene.title)}_${(scene.title.sheet || 'sheet').replace(/[^\w-]+/g, '_')}.ai`;
  a.click();
  URL.revokeObjectURL(a.href);
  return layout;
}

/** Millimetres per diagram unit for a sheet — shared with the SVG exporter. */
export function sheetMmPerUnit(scene, page = null) {
  return layoutSheet(scene, page).mmPerUnit;
}

// The drawing set: several sheets (concept · master plan · one per floor) in
// one PDF, each page sized for its own content and scale.
export function exportDrawingSet({ sheets, fileName = 'drawing_set.pdf', page = null }) {
  if (!sheets.length) return;
  // Every sheet in a set takes the same size when one is chosen — a set that
  // changes paper part-way through is not a set.
  const layouts = sheets.map((sc) => layoutSheet(sc, page));
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [layouts[0].page.w, layouts[0].page.h] });
  sheets.forEach((scene, i) => {
    if (i > 0) doc.addPage([layouts[i].page.w, layouts[i].page.h], 'landscape');
    renderSheet(doc, scene, layouts[i]);
  });
  doc.save(fileName);
}

function renderSheet(doc, scene, { page, mmPerUnit, reduced }) {
  const { bounds } = scene;
  const contentWUnits = Math.max(1, bounds.maxX - bounds.minX);
  const contentHUnits = Math.max(1, bounds.maxY - bounds.minY);

  // Centre the drawing in the area above the title block.
  const drawW = contentWUnits * mmPerUnit;
  const drawH = contentHUnits * mmPerUnit;
  const availW = page.w - 2 * MARGIN;
  const availH = page.h - 2 * MARGIN - TITLE_H;
  const offX = MARGIN + (availW - drawW) / 2;
  const offY = MARGIN + (availH - drawH) / 2;
  const X = (ux) => offX + (ux - bounds.minX) * mmPerUnit;
  const Y = (uy) => offY + (uy - bounds.minY) * mmPerUnit;

  // Clip the drawing to the content frame so big background images don't bleed
  // into the margins / title block.
  doc.saveGraphicsState();
  doc.rect(MARGIN, MARGIN, availW, availH).clip();
  doc.discardPath();

  // Image layers.
  for (const l of scene.layers) {
    try {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: l.opacity }));
      doc.addImage(l.dataUrl, imageFormat(l.dataUrl), X(l.x), Y(l.y), l.w * mmPerUnit, l.h * mmPerUnit, undefined, 'FAST');
      doc.restoreGraphicsState();
    } catch {
      /* skip an image jsPDF can't decode */
    }
  }

  // Adjacency links.
  for (const ln of scene.links) {
    const [r, g, b] = ln.strength === 'required' ? [174, 183, 201] : [120, 130, 150];
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(ln.strength === 'required' ? 0.5 : 0.3);
    if (ln.strength === 'required') doc.setLineDashPattern([], 0);
    else doc.setLineDashPattern([1.4, 1.2], 0);
    doc.line(X(ln.x1), Y(ln.y1), X(ln.x2), Y(ln.y2));
  }
  doc.setLineDashPattern([], 0);

  // Interior room cells (master-plan sketch) — light area-true fills under
  // the envelope outlines, each with a small name/area label.
  const polyDeltas = (poly) => {
    const deltas = [];
    for (let i = 1; i < poly.length; i++)
      deltas.push([X(poly[i].x) - X(poly[i - 1].x), Y(poly[i].y) - Y(poly[i - 1].y)]);
    return deltas;
  };
  for (const c of scene.cells ?? []) {
    const [r, g, bl] = hexToRgb(c.color);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.3 }));
    doc.setFillColor(r, g, bl);
    doc.lines(polyDeltas(c.poly), X(c.poly[0].x), Y(c.poly[0].y), [1, 1], 'F', true);
    doc.restoreGraphicsState();
    doc.setDrawColor(Math.round(r * 0.75), Math.round(g * 0.75), Math.round(bl * 0.75));
    doc.setLineWidth(0.2);
    doc.lines(polyDeltas(c.poly), X(c.poly[0].x), Y(c.poly[0].y), [1, 1], 'S', true);
    // Label at the cell's centroid, sized to the cell like a small bubble.
    let cx = 0, cy = 0;
    for (const p of c.poly) { cx += p.x; cy += p.y; }
    cx /= c.poly.length; cy /= c.poly.length;
    const rmm = c.r * mmPerUnit;
    if (rmm > 3.5) {
      const pt = Math.max(4, Math.min(7, rmm * 0.7));
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(pt);
      doc.text(c.label, X(cx), Y(cy) - 0.3, { align: 'center', baseline: 'middle' });
      if (c.sublabel && rmm > 5.5) {
        doc.setFontSize(Math.max(3.5, pt * 0.8));
        doc.setTextColor(70, 70, 70);
        doc.text(c.sublabel, X(cx), Y(cy) + pt * 0.5, { align: 'center', baseline: 'middle' });
      }
    }
  }

  // Bubbles (or boxes). Outline style draws stroke only, to match the viewport.
  const outline = scene.bubbleStyle === 'outline';
  for (const b of scene.bubbles) {
    const [r, g, bl] = hexToRgb(b.color);
    const rmm = b.r * mmPerUnit;
    const side = rmm * Math.sqrt(Math.PI); // square of equal area
    const drawPoly = (style) => {
      const deltas = [];
      for (let i = 1; i < b.poly.length; i++)
        deltas.push([X(b.poly[i].x) - X(b.poly[i - 1].x), Y(b.poly[i].y) - Y(b.poly[i - 1].y)]);
      doc.lines(deltas, X(b.poly[0].x), Y(b.poly[0].y), [1, 1], style, true);
    };
    const drawShape = (style) =>
      b.poly ? drawPoly(style)
        : b.box ? doc.rect(X(b.x) - side / 2, Y(b.y) - side / 2, side, side, style)
        : doc.circle(X(b.x), Y(b.y), rmm, style);
    if (!outline) {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: b.opacity }));
      doc.setFillColor(r, g, bl);
      drawShape('F');
      doc.restoreGraphicsState();
    }
    doc.setDrawColor(r, g, bl);
    doc.setLineWidth(outline ? 0.4 : 0.25);
    drawShape('S');

    // Label, scaled to the bubble but kept legible. An envelope whose interior
    // is sketched (labelAbove) wears its name above the outline instead —
    // its centre belongs to the room cells.
    const pt = Math.max(4.5, Math.min(9, rmm * 0.9));
    if (b.labelAbove && b.poly) {
      let topY = Infinity;
      for (const p of b.poly) topY = Math.min(topY, p.y);
      doc.setTextColor(70, 70, 70);
      doc.setFontSize(6.5);
      doc.text(`${b.label} · ${b.sublabel}`, X(b.x), Y(topY) - 2, { align: 'center', baseline: 'bottom' });
    } else {
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(pt);
      doc.text(b.label, X(b.x), Y(b.y) - (b.sublabel ? 0.3 : -pt * 0.12), { align: 'center', baseline: 'middle' });
      if (b.sublabel && rmm > 6) {
        doc.setFontSize(Math.max(4, pt * 0.8));
        doc.setTextColor(70, 70, 70);
        doc.text(b.sublabel, X(b.x), Y(b.y) + pt * 0.5, { align: 'center', baseline: 'middle' });
      }
    }
  }

  // Redline markup — last, so it sits over the drawing exactly as it does on
  // screen, and still inside the clip so a stray mark can't run into the title
  // block. Drawn as straight segments between the stored samples: the client
  // already simplified the stroke, and jsPDF has no quadratic path primitive.
  for (const s of scene.markup ?? []) {
    const [r, g, b] = hexToRgb(s.color);
    doc.setDrawColor(r, g, b);
    // Stroke width is in diagram units, like the geometry, so it converts with
    // the same mmPerUnit and prints at the weight it was drawn at.
    doc.setLineWidth(Math.max(0.15, s.width * mmPerUnit));
    doc.setLineJoin('round');
    doc.setLineCap('round');
    if (s.points.length === 1) {
      const [x, y] = s.points[0];
      doc.line(X(x), Y(y), X(x), Y(y)); // a tap is a dot
      continue;
    }
    for (let i = 1; i < s.points.length; i++) {
      doc.line(X(s.points[i - 1][0]), Y(s.points[i - 1][1]), X(s.points[i][0]), Y(s.points[i][1]));
    }
  }
  doc.setLineCap('butt');
  doc.setLineJoin('miter');

  // Sheet notes — the words, plus a leader to what they are about. Drawn last
  // inside the clip so a note always sits over the drawing it comments on.
  for (const nt of scene.notes || []) {
    const [r, g, b] = hexToRgb(nt.color);
    const sizePt = Math.max(4, nt.height * mmPerUnit * 2.8346); // mm -> pt
    // Left of the leader's foot, the words run right; right of it, they run
    // left, so a leader never crosses its own text.
    const align = nt.leader && nt.leader.x > nt.x ? 'right' : 'left';
    const gapMm = nt.height * mmPerUnit * 0.4;
    if (nt.leader) {
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(Math.max(0.15, nt.height * mmPerUnit / 8));
      const footX = align === 'right' ? X(nt.x) + gapMm : X(nt.x) - gapMm;
      doc.line(X(nt.leader.x), Y(nt.leader.y), footX, Y(nt.y));
      doc.setFillColor(r, g, b);
      doc.circle(X(nt.leader.x), Y(nt.leader.y), Math.max(0.25, nt.height * mmPerUnit / 5), 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(sizePt);
    doc.setTextColor(r, g, b);
    // The author's own line breaks are the layout — SVG and PDF neither wrap.
    const lines = String(nt.text || '').split('\n');
    lines.forEach((line, i) => {
      doc.text(line, X(nt.x), Y(nt.y) + i * sizePt * 0.4409, { align });
    });
  }

  doc.restoreGraphicsState(); // remove clip

  // Frame.
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, MARGIN, availW, availH);

  // Scale bar (bottom-left inside the frame).
  if (scene.scale?.scaleBar) {
    const sb = scene.scale.scaleBar;
    const lenMm = sb.lenUnits * mmPerUnit;
    const bx = MARGIN + 6;
    const by = MARGIN + availH - 8;
    doc.setDrawColor(20, 20, 20);
    doc.setLineWidth(0.4);
    doc.line(bx, by, bx + lenMm, by);
    doc.line(bx, by - 1.5, bx, by + 1.5);
    doc.line(bx + lenMm, by - 1.5, bx + lenMm, by + 1.5);
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    doc.text(sb.label, bx + lenMm + 3, by + 1);
  }

  const legendRight = MARGIN + availW - 5;
  const legendY = MARGIN + availH - 7.5;

  // Say so when the sheet carries redlines or notes, so nobody reads a
  // marked-up print as an issued drawing. Independent of the legend: a sheet
  // with one category has no legend to hang the disclaimer off, and it is the
  // marked-up sheet that most needs to say what it is.
  if (scene.markup?.length || scene.notes?.length) {
    doc.setFontSize(6.5);
    doc.setTextColor(120, 120, 120);
    doc.text('Coloured lines and notes are markup - not drawn geometry', legendRight, legendY - 4.6, { align: 'right' });
  }

  // Colour legend (bottom-right inside the frame) — decodes the category
  // colours on paper. Right-aligned so it never collides with the scale bar.
  if (scene.legend?.length) {
    const sw = 2.6; // swatch square (mm)
    doc.setFontSize(6.5);
    const entryW = (label) => sw + 1.4 + doc.getTextWidth(label) + 5;
    let lx = legendRight;
    const ly = legendY;
    for (const item of [...scene.legend].reverse()) {
      lx -= entryW(item.label);
      const [r, g, b] = hexToRgb(item.color);
      doc.setFillColor(r, g, b);
      doc.rect(lx, ly - sw + 0.6, sw, sw, 'F');
      doc.setTextColor(50, 50, 50);
      doc.text(item.label, lx + sw + 1.4, ly);
    }
  }

  // North arrow (top-right inside the frame).
  if (scene.north) {
    const nx = MARGIN + availW - 12;
    const ny = MARGIN + 12;
    const a = ((scene.north.deg || 0) * Math.PI) / 180; // clockwise from up
    const tip = { x: nx + 8 * Math.sin(a), y: ny - 8 * Math.cos(a) };
    const tail = { x: nx - 6 * Math.sin(a), y: ny + 6 * Math.cos(a) };
    doc.setDrawColor(20, 20, 20);
    doc.setLineWidth(0.5);
    doc.line(tail.x, tail.y, tip.x, tip.y);
    // arrowhead
    const ah = 0.4;
    doc.line(tip.x, tip.y, tip.x - 2.4 * Math.sin(a - ah), tip.y + 2.4 * Math.cos(a - ah));
    doc.line(tip.x, tip.y, tip.x - 2.4 * Math.sin(a + ah), tip.y + 2.4 * Math.cos(a + ah));
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    doc.text('N', tip.x, tip.y - 1.5, { align: 'center' });
  }

  // Title block. Three cells: identity on the left, sheet data in the middle,
  // the identification number and revision on the right — the two things a
  // reader cites when they refer to the print, so they get the outer edge and
  // the largest type after the project name.
  const t = scene.title;
  const ty = page.h - MARGIN - TITLE_H;
  const RIGHT_W = Math.min(52, availW * 0.3);
  const MID_W = Math.min(44, availW * 0.26);
  const midX = MARGIN + availW - RIGHT_W - MID_W;
  const rightX = MARGIN + availW - RIGHT_W;
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, ty, availW, TITLE_H);
  // Cell rules, only where there is a cell to divide off.
  doc.setLineWidth(0.2);
  doc.line(midX, ty, midX, ty + TITLE_H);
  doc.line(rightX, ty, rightX, ty + TITLE_H);

  // A labelled field: 5pt grey caption over its value. ASCII punctuation only
  // in printed strings — jsPDF's standard-font encoding silently DROPS an em
  // dash, so a fallback written as one prints as nothing at all.
  const field = (x, y, label, value, { bold = false, size = 9, w = 0 } = {}) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(120, 120, 120);
    doc.text(label, x, y);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(20, 20, 20);
    // Long numbers (a BS 1192 code runs to 24 characters) shrink to fit their
    // cell rather than running through the rule into the next one.
    let str = String(value ?? '');
    if (w > 0 && str) {
      while (doc.getTextWidth(str) > w && doc.getFontSize() > 5) doc.setFontSize(doc.getFontSize() - 0.5);
    }
    doc.text(str, x, y + 5);
  };

  // Left cell: who and what.
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(t.name, MARGIN + 4, ty + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const meta = [t.client, t.stage].filter(Boolean).join('  ·  ');
  doc.text(meta, MARGIN + 4, ty + 15);
  doc.setFontSize(7);
  doc.setTextColor(90, 90, 90);
  const credits = [
    t.sheet || 'Bubble diagram',
    t.drawnBy ? `Drawn ${t.drawnBy}` : null,
    t.checkedBy ? `Checked ${t.checkedBy}` : null,
    'BriefTrack',
  ].filter(Boolean).join(' · ');
  doc.text(credits, MARGIN + 4, ty + 20);
  if (reduced) {
    doc.setTextColor(180, 60, 50);
    doc.text(`reduced ×${(1 / reduced).toFixed(2)} to fit - do not measure from this print`, MARGIN + 4, ty + 25);
  } else if (t.nonStandardScale) {
    // Say it on the sheet, because the sheet is what travels. "Auto" is the
    // default and fits the drawing to the paper, so a ratio like 1:1159 ships
    // easily — and a reader with a scale rule will take a wrong dimension off
    // it in good faith.
    doc.setTextColor(180, 60, 50);
    doc.text('non-standard scale - do not measure from this print', MARGIN + 4, ty + 25);
  }

  // Middle cell: sheet data.
  field(midX + 4, ty + 6, 'SCALE', t.scaleLabel, { bold: true, size: 10, w: MID_W - 8 });
  field(midX + 4, ty + 17, 'DATE', t.date, { size: 8, w: MID_W - 8 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(120, 120, 120);
  doc.text(page.name, midX + MID_W - 4, ty + TITLE_H - 3, { align: 'right' });

  // Right cell: identification.
  field(rightX + 4, ty + 6, 'DRAWING No.', t.number || '-', { bold: true, size: 10, w: RIGHT_W - 8 });
  const revW = Math.min(18, RIGHT_W / 3);
  field(rightX + 4, ty + 17, 'REV', t.revision || '-', { bold: true, size: 10, w: revW - 4 });
  if (t.status) field(rightX + 4 + revW, ty + 17, 'STATUS', t.status, { size: 8, w: RIGHT_W - revW - 8 });
}
