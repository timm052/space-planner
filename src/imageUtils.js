/**
 * Bakes rotation (clockwise degrees) and/or a CSS filter into a new data URL
 * using an offscreen canvas sized to the rotated bounding box. This keeps
 * the PDF export scale-accurate when images are rotated or filtered.
 *
 * @param {string} dataUrl - Source image data URL.
 * @param {number} deg     - Clockwise rotation in degrees.
 * @param {string} filter  - CSS filter string (e.g. "grayscale(1)"), or falsy.
 * @returns {Promise<{dataUrl:string, canvasW:number, canvasH:number, naturalW:number}|null>}
 */
export function bakeImage(dataUrl, deg, filter) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const rad = (deg * Math.PI) / 180;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const cw = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)));
      const ch = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const ctx = c.getContext('2d');
      if (filter && filter !== 'none') ctx.filter = filter;
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -w / 2, -h / 2);
      resolve({ dataUrl: c.toDataURL('image/png'), canvasW: cw, canvasH: ch, naturalW: w });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
