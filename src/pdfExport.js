import { jsPDF } from 'jspdf';

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
const TITLE_H = 22; // mm reserved at the bottom for the title block

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#888888');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [136, 136, 136];
}

function imageFormat(dataUrl) {
  return /^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG';
}

// scene = {
//   bounds:{minX,minY,maxX,maxY}, layers:[{dataUrl,x,y,w,h,opacity}],
//   links:[{x1,y1,x2,y2,strength}], bubbles:[{x,y,r,color,opacity,label,sublabel}],
//   scale:{ratioLabel, scaleBar:{lenUnits,label}}|null, north:{deg}|null,
//   title:{name,client,stage,sheet,scaleLabel,date}
// }   — all geometry in diagram units.

// Pick the page + mm-per-unit for one sheet: the smallest ISO page that holds
// the content at true scale (or, in relative/NTS mode, fit the content to A3).
function layoutSheet(scene) {
  const { bounds } = scene;
  const contentWUnits = Math.max(1, bounds.maxX - bounds.minX);
  const contentHUnits = Math.max(1, bounds.maxY - bounds.minY);

  const toScale = !!scene.scale;
  let mmPerUnit = MM_PER_UNIT;
  let reduced = null;
  let page = null;
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

// One environment's drawing as a single sheet.
export function exportDiagramPdf(scene) {
  const layout = layoutSheet(scene);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [layout.page.w, layout.page.h] });
  renderSheet(doc, scene, layout);
  const safe = (scene.title.name || 'diagram').replace(/[^\w-]+/g, '_');
  doc.save(`${safe}_bubble_diagram.pdf`);
}

// The drawing set: several sheets (concept · master plan · one per floor) in
// one PDF, each page sized for its own content and scale.
export function exportDrawingSet({ sheets, fileName = 'drawing_set.pdf' }) {
  if (!sheets.length) return;
  const layouts = sheets.map(layoutSheet);
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

    // Label, scaled to the bubble but kept legible.
    const pt = Math.max(4.5, Math.min(9, rmm * 0.9));
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(pt);
    doc.text(b.label, X(b.x), Y(b.y) - (b.sublabel ? 0.3 : -pt * 0.12), { align: 'center', baseline: 'middle' });
    if (b.sublabel && rmm > 6) {
      doc.setFontSize(Math.max(4, pt * 0.8));
      doc.setTextColor(70, 70, 70);
      doc.text(b.sublabel, X(b.x), Y(b.y) + pt * 0.5, { align: 'center', baseline: 'middle' });
    }
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

  // Title block.
  const t = scene.title;
  const ty = page.h - MARGIN - TITLE_H;
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, ty, availW, TITLE_H);
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(t.name, MARGIN + 4, ty + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const meta = [t.client, t.stage].filter(Boolean).join('  ·  ');
  doc.text(meta, MARGIN + 4, ty + 14);
  doc.setFontSize(7);
  doc.setTextColor(90, 90, 90);
  doc.text(`${t.sheet || 'Bubble diagram'} · BriefTrack`, MARGIN + 4, ty + 19);

  // Right side of title block: scale + date.
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(t.scaleLabel, MARGIN + availW - 4, ty + 8, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 90, 90);
  doc.text(`${page.name} · ${t.date}`, MARGIN + availW - 4, ty + 14, { align: 'right' });
  if (reduced) {
    doc.setTextColor(180, 60, 50);
    doc.text(`reduced ×${(1 / reduced).toFixed(2)} to fit`, MARGIN + availW - 4, ty + 19, { align: 'right' });
  }
}
