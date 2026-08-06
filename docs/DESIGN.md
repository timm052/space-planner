# BriefTrack — Design Language

> What the app looks like **as built**, and the rules for keeping it coherent
> when adding to it. The runtime source of truth is
> [`src/styles/tokens.css`](../src/styles/tokens.css); this file explains the
> intent behind it. For how the app is *built*, see
> [ARCHITECTURE.md](ARCHITECTURE.md).

## Identity

A flat, architectural **drafting / site-plan** language. Data shapes are solid
matte colour with a crisp darkened keyline (poché) — no gradients, no drop
shadows, no gloss. Chrome is quiet; the drawing is the loud part. Two themes
ship: a deep slate **dark** and a warm-paper **light** for bright offices and
printing, with a Dark / Light / **Auto** toggle that follows
`prefers-color-scheme` live. Both are first-class — check every new surface in
both.

## Tokens

All colour, shadow and the rail width live in `styles/tokens.css` as custom
properties on `:root`, with a `:root[data-theme='light']` override. `theme.jsx`
sets `data-theme` on `<html>` and persists the choice. **Never write a one-off
hex in a component** — add a token.

| Role | Tokens |
| --- | --- |
| Surfaces | `--bg` `--bg2` `--panel` `--panel2` `--panel3` |
| Lines | `--border` `--border-soft` `--contour` `--grid` `--grid-major` |
| Text | `--text` `--muted` (`--faint` is **not** text — see below) |
| Brand | `--accent` (amber) `--accent-soft` `--accent2` (cyan) |
| Semantic | `--good` (on target) `--warn` (over) `--bad` (error / over-tolerance) |
| Text tier | `--accent-text` `--accent2-text` `--good-text` `--bad-text` `--warn-text` |
| On-fill ink | `--accent-ink` `--bad-ink` |
| Canvas | `--canvas-bg` `--footprint` `--ruler-bg` `--ruler-ink` |
| Floating | `--glass` `--glass-border` `--shadow` `--focus` |
| Shape & motion | `--r-sm/-md/-lg/-pill` · `--dur-fast/-base/-slow` · `--ease` `--ease-pop` |

**Three colour families, and mixing them up is the easy mistake.** A brand or
semantic hue at full chroma only has to clear **3:1** as a fill, border or
swatch, but **4.5:1** as text — and the light theme's chroma cannot reach 4.5
on paper. So:

- `background` / `border-color` / `stroke` → `--accent`, `--good`, `--bad`, …
- `color` → `--accent-text`, `--good-text`, `--bad-text`, … (dark theme aliases
  these straight to the graphic token; light overrides each with a darker,
  same-hue value)
- text drawn **on top of** a filled `--accent` / `--bad` surface → `--accent-ink`
  / `--bad-ink`

`--faint` is a **non-text** token — hairlines, guides, decorative glyphs. It
cannot reach 4.5:1 in either theme without collapsing onto `--muted`, so quiet
text uses `--muted`. `test/tokens.contrast.test.js` enforces all of this
arithmetically (no browser needed); if you add a token, add it there.

Data colours are **not** tokens — categories, buildings and compliance statuses
come from `src/viz.js` (`CATEGORY_COLORS`, `BUILDING_COLORS`, `STATUS_COLOR`,
`labelInk`) and are user-overridable per project (`projects.category_colors`).
Two rules govern that palette, both pinned by `test/tokens.contrast.test.js`:
it must stay separable under **deuteranopia and protanopia** (≥20 ΔE — the old
blue/purple pair measured 3.3), and no category colour may collide with a
compliance-status colour, since they are two lenses over the same rooms. Four
hues is the ceiling for hue-only encoding; past that, add hatch rather than
another colour.

## Type

Three self-hosted families (`@fontsource`, imported in `main.jsx` — no CDN):

- **Inter** — body and UI, 12–14px.
- **Space Grotesk** — display: the wordmark, uppercase letter-spaced section
  headers, big numerals, room and tile names.
- **JetBrains Mono** — every number, area, percentage, keyboard key and
  reference tag.

## The drafting vocabulary

Reuse these devices rather than inventing new ones:

1. **Reference tags** — each section is prefixed by a bordered mono chip keyed
   per screen: `A·` diagram rail, `B·` brief/design, `D·` dashboard,
   `M·` milestones (`.sec-tag` + `.sec-title`).
2. **Flat square swatches** — colour keys are squares, never dots or pills.
3. **Dotted leader rows** (`.dl-row`) — label · dotted rule · mono value, in the
   manner of a drawing schedule or spec index.
4. **Contour medallions** — grand totals sit over concentric `--contour` rings
   behind a large Space Grotesk numeral.
5. **Poché** — `darkHex(color, .4)` for a shape's keyline, `darkHex(color, .62)`
   for ink drawn on a filled shape (`src/viz.js`).
6. **Glass overlays** — floating canvas furniture uses `--glass` +
   `--glass-border` + backdrop blur, so the drawing reads through it.

Motion is minimal and runs on three duration tokens — `--dur-fast` (100ms,
control tints and focus rings), `--dur-base` (160ms, popovers, panels, action
bars) and `--dur-slow` (280ms, view glides and entrances) — with `--ease` for
standard moves and `--ease-pop` where a slight overshoot is wanted. Use the
tokens; a literal duration is drift.

**No entrance/keyframe animations on panels that re-render** — under frequent
re-render they stick at `opacity: 0`; mount conditionally instead. View
transitions use a hand-rolled tween that honours `prefers-reduced-motion` by
snapping to the target, and any in-flight glide is cancelled the moment the
user touches the canvas.

**`prefers-reduced-motion` needs handling in two places.** The global CSS
override in `diagram.css` neutralises every transition and keyframe, but it
cannot reach rAF-driven motion — so `useSimulation.js` checks the preference
itself and solves the auto-layout straight to its settled result instead of
animating the cooling curve. Same final layout, no travel. Any future
JS-driven animation must do likewise.

## Screens

| Screen | Composition |
| --- | --- |
| **Projects** | Card grid; client, stage, counts, brief net target. |
| **Dashboard** | KPI cards (`D·01`–`D·04`), drift chart with tolerance band, by-category rollup, flagged rooms, change log. |
| **Brief** | The agreed programme: treemap or editable schedule, formula cells, benchmarks, revisions, import, send-to-design. |
| **Design** | The same editor over the live design tree, plus reconciliation against the Brief. |
| **Bubble Diagram** | Full-bleed canvas: environment switcher with progress readout, left tool dock, floating glass clusters, right rail (`A·01` areas, `A·02` adjacency, Σ medallion), one contextual action bar. |
| **Milestones** | Snapshot cards (`M·01`) and a change schedule (`M·02`) with ▲/▼ deltas. |
| **Settings** | App-wide defaults for new projects. |

## The diagram canvas

The canvas is **three environments sharing one shell**. What differs between
them is declared in `ENV_CAPS` (`BubbleTab.jsx`) — geometry, sim, layers, snap,
rotation, trays — so visual work should read that table rather than inferring
which controls exist where.

- Field is `--canvas-bg` with faint **topographic contour rings** around each
  cluster — no grid.
- **◯ Concept** — flat matte circles sized *relative* to the largest room, fill
  by category or building, keyline `darkHex(c,.4)` (white when selected), labels
  fitted by `textfit.js`. Concave **hulls** hug each building's real profile.
  Links: required = solid hairline, desired = fine dotted; selected or connected
  turns `--accent2`. Each has an invisible wide hit-line.
- **▱ Master plan** — building **envelopes** as area-locked outlines on the
  calibrated site, with a drawn-vs-required area badge that turns red when the
  envelope is too small, hatched overlap warnings, and a Voronoi **interior
  sketch** whose cells carry the room colour and a cell-vs-target readout.
- **▤ Building** — area-locked rectangles per floor inside the envelope's dashed
  underlay, with edge/corner snapping and bounded alignment guides, plus the
  stacked isometric and WebGL overviews.
- **Furniture**: legend, control clusters, scale bar, north rose and the
  contextual action bar all float as glass. The action bar takes three forms —
  single room, multiple rooms, selected link.
- **Interaction**: Select (`V`) and Link (`L`) are the only modes; pan is a
  transient gesture (hold Space or right-drag); `Ctrl/Cmd-K` opens the palette.
  `HelpPanel.jsx` is the canonical, page- and environment-aware keymap — update
  it whenever the interaction model changes.

## Rules when extending

- **Don't break the scale model.** Geometry is in diagram units derived from a
  real metric scale, and the sheets must stay scale-accurate (ARCHITECTURE §6).
  Restyle freely; don't touch coordinates or units.
- **One definition per quantity.** Footprints, bubble radii, interior cells and
  sheet bounds live in `scenes.js` / `geometry.js` and are shared by the canvas
  and the PDF. If you need a size, import it — don't re-derive it in a renderer.
- **Scene primitives carry semantic state** (`selected`, `dim`, `related`,
  `tight`), never colours. Theming stays in CSS.
- **New colour or spacing becomes a token**, so SVG, WebGL and PDF stay
  consistent.
- **Labels are decluttered, not just fitted.** A room too small to read is left
  to its tooltip rather than labelled over its neighbours: rooms under ~18px
  on screen drop their label, and interior-sketch cells claim label space
  largest-first, skipping any that would collide with one already placed. At
  1:1000 this is the difference between three readable names and seven
  overlapping ones.
- **Canvas annotations avoid the floating chrome.** The toolbar is HTML over
  the SVG, so building hull labels clamp below the *measured* toolbar height
  (it wraps on narrow stages — a hard-coded band is wrong exactly where the
  collision happens).
- **Every view states its scale.** A metric environment gets the scale bar;
  Concept gets `NTS relative sizes`; 3-D gets an NTS note that distinguishes
  perspective from axonometric. Silence would imply measurability.
- **Pen weights and grab targets are screen-space, geometry is world-space.**
  Rooms scale with the camera; the strokes that annotate them do not. Line
  hierarchy carries `vector-effect: non-scaling-stroke`, and interactive
  handles divide their radius by the view zoom so they hold ≥24px at any zoom.
  Labels are fitted to a room's geometry, so they stay in world units but are
  scaled back above 100% to cap their on-screen size. None of this touches the
  PDF, which sets its own `doc.setLineWidth()` in mm.
- **Both themes, every time.** The warm-paper light theme is the one used for
  printing — check contrast there too.
- **Keep the a11y that exists**: `:focus-visible` rings, keyboard-operable
  cards, `prefers-reduced-motion`, themed scrollbars, `role="alert"` banners.
- **Reuse the primitives**: `<Banner>` / `<Empty>` / `<Overlay>`
  (`components/ui.jsx`) and `<StagePopover>` instead of hand-rolling chrome.
- `styles.css` is only an ordered set of `@import`s, and the files in
  `src/styles/` are **contiguous slices of a former monolith — import order is
  the cascade**. Add rules in the matching file; don't reorder same-specificity
  rules. (Moving to `@layer` is on the roadmap; until then this constraint is
  load-bearing.)

## Screenshots

None are checked in. Earlier captures went stale within a release and were
removed; capture fresh ones from the seeded demo project ("Greenfield Community
Library", recreated by deleting `data/`) when a document needs them.
