// Label fitting for the bubble diagram — pure and unit-testable.
//
// The old label wrap guessed line lengths from a character count with an
// average-width heuristic, which read oddly: lines overflowed narrow bubbles
// ("Multipurpose" spilling out), wraps broke unevenly ("Quiet Reading" /
// "Room"), and long words never shrank to fit. This module wraps with REAL
// measured text widths, balances the lines (minimum width variance), shrinks
// the font when the name genuinely doesn't fit, and ellipsizes only as a
// last resort.

// Measure text width via a shared canvas, in the label font. Widths are
// cached per string at a normalized size and scaled, so the sim's per-frame
// re-renders never re-measure. Falls back to the old character heuristic
// where canvas isn't available (jsdom tests, SSR).
let ctx = null;
const widthCache = new Map();
const LABEL_FONT = '600 100px "Space Grotesk", "Inter", sans-serif';
export function measureText(text, fontSize) {
  if (ctx === null) {
    try {
      ctx = (typeof document !== 'undefined' && document.createElement('canvas').getContext('2d')) || false;
    } catch {
      ctx = false;
    }
  }
  if (!ctx) return text.length * fontSize * 0.55;
  let w = widthCache.get(text);
  if (w == null) {
    if (widthCache.size > 2000) widthCache.clear();
    ctx.font = LABEL_FONT;
    w = ctx.measureText(text).width / 100;
    widthCache.set(text, w);
  }
  return w * fontSize;
}

// Split `words` into exactly `count` lines, choosing the break positions that
// minimise the variance of line widths (so "Quiet Reading Room" becomes
// "Quiet" / "Reading Room", not "Quiet Reading" / "Room"). Returns
// { lines, maxLineWidth }. Small inputs → brute force is plenty.
function balancedBreak(words, count, widthOf) {
  const joins = [];
  const best = { cost: Infinity, lines: null, maxLineWidth: Infinity };
  const widths = new Array(count);
  const target = widthOf(words.join(' ')) / count;
  const rec = (start, line) => {
    if (line === count - 1) {
      joins[line] = words.slice(start).join(' ');
      let cost = 0;
      let maxW = 0;
      for (let i = 0; i < count; i++) {
        widths[i] = widthOf(joins[i]);
        cost += (widths[i] - target) ** 2;
        maxW = Math.max(maxW, widths[i]);
      }
      if (cost < best.cost) {
        best.cost = cost;
        best.lines = [...joins.slice(0, count)];
        best.maxLineWidth = maxW;
      }
      return;
    }
    // Each line takes at least one word, leaving enough for the rest.
    for (let end = start + 1; end <= words.length - (count - 1 - line); end++) {
      joins[line] = words.slice(start, end).join(' ');
      rec(end, line + 1);
    }
  };
  rec(0, 0);
  return best;
}

// Trim `text` (appending …) until it fits `maxWidth` at `fontSize`.
function ellipsize(text, fontSize, maxWidth, measure) {
  if (measure(text, fontSize) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && measure(t + '…', fontSize) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/**
 * Fit a label into a horizontal budget: balanced line-breaking at the largest
 * font size (from `baseSize` down to `minSize`) at which every line fits in
 * `maxWidth` using at most `maxLines` lines. If even `minSize` can't fit, the
 * overflow is ellipsized. Returns { fontSize, lines }.
 */
export function fitLabel({ label, maxWidth, baseSize, minSize = 8, maxLines = 3, measure = measureText }) {
  const words = String(label).split(/\s+/).filter(Boolean);
  if (words.length === 0) return { fontSize: baseSize, lines: [] };

  for (let size = baseSize; size >= minSize - 1e-9; size -= Math.max(0.75, (baseSize - minSize) / 4)) {
    // A word that can never fit at this size forces a smaller font.
    if (words.some((w) => measure(w, size) > maxWidth)) continue;
    for (let count = 1; count <= Math.min(maxLines, words.length); count++) {
      const { lines, maxLineWidth } = balancedBreak(words, count, (t) => measure(t, size));
      if (maxLineWidth <= maxWidth) return { fontSize: size, lines };
    }
  }

  // Nothing fits even at minSize: greedy-wrap, fold any overflow into the
  // last allowed line, and ellipsize whatever still doesn't fit.
  const lines = [];
  let cur = '';
  for (const w of words) {
    const joined = cur ? `${cur} ${w}` : w;
    if (!cur || measure(joined, minSize) <= maxWidth) {
      cur = joined;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines[maxLines - 1] = lines.slice(maxLines - 1).join(' ');
    lines.length = maxLines;
  }
  return { fontSize: minSize, lines: lines.map((l) => ellipsize(l, minSize, maxWidth, measure)) };
}
