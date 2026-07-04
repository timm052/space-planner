// PNG export of the diagram — WYSIWYG capture of the current view at 2×.
// Lazy-imported from BubbleTab (same pattern as pdfExport).
//
// Two paths:
//  - Flat / stacked views: the live SVG is cloned and rasterized. An SVG
//    rendered inside an <img> cannot see the page's stylesheets, so every
//    class-driven style is inlined from computed styles (which also resolves
//    theme var() tokens), and the self-hosted fonts the SVG uses are embedded
//    as data-URI @font-face rules so labels keep their real typefaces.
//  - 3-D view: the WebGL canvas is captured directly (the renderer runs with
//    preserveDrawingBuffer) and composited over the canvas background.
//
// HTML overlays (legend, north rose, toolbars) are intentionally not part of
// the capture — the SVG already carries the scale bar and attribution.

// Style properties worth carrying into the standalone SVG. Copying computed
// values resolves classes, inherited values and CSS variables in one go.
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'stroke-miterlimit',
  'opacity', 'visibility', 'display', 'mix-blend-mode', 'filter',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'text-anchor', 'dominant-baseline', 'text-transform',
  'paint-order',
];

const normWeight = (w) => (w === 'bold' ? '700' : w === 'normal' ? '400' : String(w));

// Collect the (family, weight) pairs the cloned SVG actually uses, then embed
// the matching latin-subset @font-face rules (from the self-hosted fontsource
// CSS) with their woff2 files inlined as data URIs. Best effort: on any
// failure the export still runs, just with system-font fallback.
async function embeddedFontCss(clone) {
  const wanted = new Set();
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    const fam = el.style?.fontFamily;
    if (!fam) continue;
    const first = fam.split(',')[0].trim().replace(/["']/g, '');
    wanted.add(`${first}|${normWeight(el.style.fontWeight || '400')}`);
  }
  if (wanted.size === 0) return '';

  const faces = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    for (const rule of rules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const weight = normWeight(rule.style.getPropertyValue('font-weight').trim() || '400');
      if (!wanted.has(`${family}|${weight}`)) continue;
      const src = rule.style.getPropertyValue('src');
      const m = /url\(["']?([^"')]+)["']?\)/.exec(src);
      if (!m) continue;
      const url = new URL(m[1], sheet.href || location.href).href;
      // fontsource emits one face per unicode-range subset; the basic latin
      // file is enough for room labels and keeps the payload small.
      if (!/-latin-\d/.test(url)) continue;
      faces.push({ family, weight, url });
    }
  }

  const css = await Promise.all(
    faces.map(async ({ family, weight, url }) => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');}`;
      } catch {
        return '';
      }
    })
  );
  return css.join('');
}

/**
 * Rasterize the live diagram SVG onto a canvas at `scale`× the on-screen size.
 * Returns the canvas (exported separately so tests / previews can inspect it).
 */
export async function renderDiagramToCanvas(svgEl, { scale = 2, background } = {}) {
  const rect = svgEl.getBoundingClientRect();
  const clone = svgEl.cloneNode(true);

  // Parallel walk — cloneNode preserves document order, so the two
  // querySelectorAll('*') lists line up index for index.
  const srcEls = [svgEl, ...svgEl.querySelectorAll('*')];
  const dstEls = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < srcEls.length; i++) {
    const cs = getComputedStyle(srcEls[i]);
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) dstEls[i].style.setProperty(p, v);
    }
  }

  clone.setAttribute('width', rect.width);
  clone.setAttribute('height', rect.height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const fontCss = await embeddedFontCss(clone);
  if (fontCss) {
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = fontCss;
    clone.insertBefore(styleEl, clone.firstChild);
  }

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.width = rect.width;
    img.height = rect.height;
    img.src = url;
    // decode() waits for embedded resources (fonts, data-URI images) so the
    // first draw doesn't race the font load.
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * scale);
    canvas.height = Math.round(rect.height * scale);
    const ctx = canvas.getContext('2d');
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Composite the WebGL canvas (transparent background) over the canvas colour.
export function render3DToCanvas(glCanvas, { background } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = glCanvas.width;
  canvas.height = glCanvas.height;
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(glCanvas, 0, 0);
  return canvas;
}

export function downloadCanvasPng(canvas, fileName) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not encode the PNG'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      resolve();
    }, 'image/png');
  });
}

/** One-call export used by the toolbar button. */
export async function exportDiagramPng({ svgEl, glCanvas, fileName, background, scale = 2 }) {
  const canvas = glCanvas
    ? render3DToCanvas(glCanvas, { background })
    : await renderDiagramToCanvas(svgEl, { scale, background });
  await downloadCanvasPng(canvas, fileName);
}
