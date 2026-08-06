// Contrast + palette regression guards for the design tokens.
//
// These caught a whole class of defect that no other test could see: the light
// theme's semantic inks were chosen to match the dark theme's HUE rather than
// to hit a contrast target, so every accent-coloured label on paper sat between
// 2.44 and 4.54:1 where AA needs 4.5. The values are parsed straight out of
// styles/tokens.css, so editing a token re-runs the maths.
//
// Pure arithmetic — no browser, no renderer. Deliberate: the same audit run
// against a live page produced stale readings, and token maths cannot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CATEGORY_COLORS, CATEGORY_FALLBACK, STATUS_HEX, pocheInk,
  simulateCvd, deltaE76 as deltaE, toLab as lab, CVD_MIN_DE, categoryColorWarning,
} from '../src/viz.js';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

// ---------- token parsing ----------
function block(selector) {
  const i = css.indexOf(selector);
  assert.ok(i >= 0, `missing ${selector} block`);
  const body = css.slice(i, css.indexOf('}', i));
  const out = {};
  for (const [, k, v] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}
const DARK = block(':root[data-theme=\'dark\']');
const LIGHT = block(':root[data-theme=\'light\']');

// Resolve one level of var() aliasing (dark's --accent-text: var(--accent)).
const resolve = (tokens, name) => {
  const raw = tokens[name] ?? DARK[name];
  const m = /^var\((--[\w-]+)\)$/.exec(raw || '');
  return m ? resolve(tokens, m[1]) : raw;
};

// ---------- colour maths ----------
const rgb = (hex) => {
  const h = hex.trim();
  assert.match(h, /^#[0-9a-f]{6}$/i, `expected a 6-digit hex, got "${hex}"`);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ['--bg', '--bg2', '--panel', '--panel2', '--panel3', '--canvas-bg'];
const TEXT_TOKENS = ['--text', '--muted', '--accent-text', '--accent2-text', '--good-text', '--bad-text', '--warn-text'];

for (const [theme, tokens] of [['dark', DARK], ['light', LIGHT]]) {
  test(`${theme}: every text token clears WCAG AA (4.5:1) on every surface`, () => {
    for (const ink of TEXT_TOKENS) {
      for (const surf of SURFACES) {
        const ratio = contrast(rgb(resolve(tokens, ink)), rgb(resolve(tokens, surf)));
        assert.ok(
          ratio >= 4.5,
          `${theme} ${ink} on ${surf} = ${ratio.toFixed(2)}:1 (needs 4.5) — pick a darker/lighter ${ink}`
        );
      }
    }
  });

  test(`${theme}: graphic tokens clear the 3:1 non-text threshold`, () => {
    for (const g of ['--accent', '--accent2', '--good', '--bad', '--warn']) {
      for (const surf of ['--bg', '--panel', '--canvas-bg']) {
        const ratio = contrast(rgb(resolve(tokens, g)), rgb(resolve(tokens, surf)));
        assert.ok(ratio >= 3, `${theme} ${g} on ${surf} = ${ratio.toFixed(2)}:1 (needs 3 for UI)`);
      }
    }
  });

  test(`${theme}: ink tokens are legible on the fill they sit on`, () => {
    for (const [ink, fill] of [['--accent-ink', '--accent'], ['--bad-ink', '--bad']]) {
      const ratio = contrast(rgb(resolve(tokens, ink)), rgb(resolve(tokens, fill)));
      assert.ok(ratio >= 4.5, `${theme} ${ink} on ${fill} = ${ratio.toFixed(2)}:1`);
    }
  });
}

// --faint is deliberately NOT in TEXT_TOKENS: it cannot reach 4.5:1 in either
// theme without collapsing onto --muted. This pins that decision so nobody
// "fixes" it by darkening it into a duplicate.
test('--faint stays a non-text token, visibly distinct from --muted', () => {
  for (const [theme, tokens] of [['dark', DARK], ['light', LIGHT]]) {
    const faint = rgb(resolve(tokens, '--faint'));
    const muted = rgb(resolve(tokens, '--muted'));
    const apart = Math.max(...[0, 1, 2].map((i) => Math.abs(faint[i] - muted[i])));
    assert.ok(apart >= 12, `${theme} --faint has collapsed onto --muted (max channel delta ${apart})`);
  }
});

// ---------- category palette ----------
// Simulate dichromatic vision (Viénot, Brettel & Mollon 1999) and measure CIE76
// separation. Blue+purple was the failure that motivated this: the seeded
// palette read as 50.4 ΔE to normal vision and 3.3 ΔE to a deuteranope.

// The threshold lives in viz.js so the app's legend warning and this test
// cannot drift apart. 20 proved too lenient: a palette scoring 22.3 still read
// as two families in a deuteranopia simulation of the real canvas.
const MIN_DE = CVD_MIN_DE;

test('category palette stays distinguishable to dichromatic vision', () => {
  const entries = Object.entries(CATEGORY_COLORS);
  for (const type of ['deutan', 'protan']) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [na, ca] = entries[i];
        const [nb, cb] = entries[j];
        const d = deltaE(simulateCvd(rgb(ca), type), simulateCvd(rgb(cb), type));
        assert.ok(d >= MIN_DE, `${type}: ${na} (${ca}) vs ${nb} (${cb}) = ΔE ${d.toFixed(1)}, needs ${MIN_DE}`);
      }
    }
  }
});

// Lightness is the channel colour-vision deficiency leaves intact, so the
// palette must not rely on hue alone — two categories at the same L* are the
// failure mode that a ΔE threshold alone did not catch.
test('category palette steps in lightness, not just hue', () => {
  const Ls = Object.values(CATEGORY_COLORS).map((h) => lab(rgb(h))[0]).sort((a, b) => b - a);
  const spread = Ls[0] - Ls[Ls.length - 1];
  assert.ok(spread >= 25, `L* spread is only ${spread.toFixed(0)} — the palette separates by hue alone`);
});

// Room labels sit ON the fill, so the ink rule has to cope with the whole
// lightness range the palette now uses.
test('label ink stays legible on every category fill', () => {
  for (const [name, hex] of Object.entries(CATEGORY_COLORS)) {
    const fill = rgb(hex);
    const ink = rgb(pocheInk(hex).replace(/rgb\((\d+),(\d+),(\d+)\)/, (_, r, g, b) =>
      '#' + [r, g, b].map((v) => (+v).toString(16).padStart(2, '0')).join('')));
    const ratio = contrast(ink, fill);
    assert.ok(ratio >= 4.5, `${name} (${hex}): label ink is ${ratio.toFixed(2)}:1 on its own fill`);
  }
});

// Category and status are two different lenses over the same rooms. Sharing a
// hex means one colour carries two meanings depending on which lens is active.
test('no category colour collides with a compliance-status colour', () => {
  for (const [name, hex] of Object.entries(CATEGORY_COLORS)) {
    for (const [status, shex] of Object.entries(STATUS_HEX)) {
      const d = deltaE(rgb(hex), rgb(shex));
      assert.ok(d >= 15, `category ${name} (${hex}) vs status ${status} (${shex}) = ΔE ${d.toFixed(1)}`);
    }
  }
});

test('the fallback cycle does not reintroduce a status colour', () => {
  for (const hex of CATEGORY_FALLBACK) {
    for (const [status, shex] of Object.entries(STATUS_HEX)) {
      const d = deltaE(rgb(hex), rgb(shex));
      assert.ok(d >= 15, `fallback ${hex} vs status ${status} (${shex}) = ΔE ${d.toFixed(1)}`);
    }
  }
});

// The seeded four were guarded, but the 5th and 6th were not — and a project
// with five departments is ordinary. The app's own legend warning caught
// "Public reads the same as General" on the demo data, which is precisely the
// case this now covers.
test('the whole fallback cycle survives dichromatic vision', () => {
  for (const type of ['deutan', 'protan']) {
    for (let i = 0; i < CATEGORY_FALLBACK.length; i++) {
      for (let j = i + 1; j < CATEGORY_FALLBACK.length; j++) {
        const [a, b] = [CATEGORY_FALLBACK[i], CATEGORY_FALLBACK[j]];
        const d = deltaE(simulateCvd(rgb(a), type), simulateCvd(rgb(b), type));
        assert.ok(d >= MIN_DE, `${type}: cycle ${i} (${a}) vs ${j} (${b}) = ΔE ${d.toFixed(1)}, needs ${MIN_DE}`);
      }
    }
  }
});

// The warning the legend shows must agree with the palette we ship: if the
// default colours tripped it, every project would open with warnings.
test('categoryColorWarning is silent on the shipped palette', () => {
  const all = CATEGORY_FALLBACK.map((hex, i) => ({ label: `c${i}`, hex }));
  for (const { label, hex } of all) {
    const warning = categoryColorWarning(hex, all.filter((o) => o.label !== label));
    assert.equal(warning, null, `${hex} warns: ${warning}`);
  }
});

// The diagram used to carry its OWN hardcoded PALETTE, drifted from viz.js: the
// same department rendered #e8b04b on the canvas and #f0b53f in the Brief
// treemap, and the canvas copy still paired blue with purple (3.3 ΔE to a
// deuteranope). Only a screenshot caught it, because both palettes "looked
// fine" in isolation. This pins the single source.
test('the diagram does not define its own category palette', () => {
  const src = readFileSync(new URL('../src/components/BubbleTab.jsx', import.meta.url), 'utf8');
  const decl = /const PALETTE\s*=\s*([^;]+);/.exec(src);
  assert.ok(decl, 'expected a PALETTE declaration in BubbleTab.jsx');
  assert.ok(
    !/\[\s*'#/.test(decl[1]),
    `BubbleTab declares a literal colour array (${decl[1].trim().slice(0, 60)}…) — it must reuse viz.js's palette`
  );
  assert.match(decl[1], /CATEGORY_FALLBACK/);
});

// The first four cycle entries ARE the seeded categories, so a project that
// names its departments anything other than Public/Staff/Support/Community
// still gets the dichromat-safe four before the palette wraps.
test('the fallback cycle leads with the seeded four', () => {
  assert.deepEqual(CATEGORY_FALLBACK.slice(0, 4), Object.values(CATEGORY_COLORS));
});
