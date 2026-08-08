// Title-block text shared by every exporter (PDF, .ai, SVG, DXF), kept out of
// pdfExport.js so the CAD and SVG writers don't have to pull jsPDF in with it.
//
// The fields themselves follow BS EN ISO 7200, which treats the identification
// number, the revision index, the date of issue and the responsible people as
// mandatory title-block data. Blank fields are simply left out rather than
// printed empty — an unnumbered working print should look like one.

/**
 * Filename stem. A sheet with a drawing number files itself under that number
 * and revision, which is how it will be referred to and how it has to sit in a
 * folder next to the last issue. Unnumbered sheets keep the project-name stem.
 */
export function sheetFileStem(title = {}) {
  const clean = (v) => String(v || '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  const number = clean(title.number);
  if (number) return [number, clean(title.revision)].filter(Boolean).join('-');
  return clean(title.name) || 'diagram';
}

/**
 * One-line sheet note for the formats with no room for a drawn title block
 * (the DXF annotation layer, the SVG footer). Same facts, in the order a
 * reader scans them: what it is, then what identifies it.
 */
export function sheetNote(title = {}) {
  const rev = title.revision ? `rev ${title.revision}` : '';
  return [
    title.name,
    title.sheet,
    title.scaleLabel,
    [title.number, rev].filter(Boolean).join(' '),
    title.status,
    title.date,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' — ');
}
