# BriefTrack — Refactor Plan (performance · UI unification · cleanup)

> Companion to [ARCHITECTURE.md](ARCHITECTURE.md) and [DESIGN_BRIEF.md](DESIGN_BRIEF.md).
> Executed in phases; **pause for review after each phase** (verify in the browser
> preview + `npm test` + `npm run build` before moving on).
>
> **Updated after the redesign merge (PR #3, 2026-07-03).** The visual redesign
> (fonts, dark/light theme system in `theme.jsx`, tool dock, contextual action
> bar, restyled Dashboard/Brief/Milestones) is already in. That absorbed most of
> the original "UI unification" scope; Phase 4 below is rescoped to what's left.
> The performance problems are unchanged (server untouched; `BubbleTab.jsx` grew
> to ~2,900 lines).

## Guiding constraints (things we deliberately do NOT change)

- The scale model and its two invariants (shared `effScale`; scale change = uniform
  zoom about viewport centre). No geometry/unit changes.
- The **optimistic mutate + full refetch** state pattern (per ARCHITECTURE §7) —
  we make the refetch *cheap* instead of replacing it with cache merging.
- Additive-only DB migrations; existing `data/` DBs must keep working.
- Hand-rolled SVG diagram + no UI/chart library; dark "drafting" identity.

---

## Phase 0 — Baseline & tooling (small)

1. **Add ESLint** (flat config, `eslint-plugin-react-hooks`) — the code already
   carries `eslint-disable` comments but there is no config, so nothing enforces
   the hooks rules the codebase leans on. Add `npm run lint`; fix or explicitly
   annotate what it flags.
2. Capture a **performance baseline**: React Profiler flamegraph of the Diagram
   tab with the demo project while the sim runs, and the byte size of
   `GET /api/projects/:id`. These are the before/after numbers for Phases 1–2.
3. Housekeeping: replace the `YOUR_USERNAME` placeholder repo URL in
   `package.json`; confirm 109 tests green.

**Exit:** lint runs clean; baseline numbers recorded here.

### Phase 0 — DONE (2026-07-03)

- ESLint 9 flat config added (`eslint.config.js`, `npm run lint`): react +
  react-hooks plugins. `react-hooks/refs` disabled (refs-in-render is the
  documented RAF architecture); `set-state-in-effect` /
  `preserve-manual-memoization` kept as warnings (12 today, revisit in Phase 2);
  `react/no-unknown-property` off for `Stacked3D.jsx` (r3f props).
- **Lint found a real regression from the redesign merge:** `multiPin()` still
  referenced its old `pinned` parameter (renamed `locked`) — "📌 Pin all" on a
  multi-selection threw a `ReferenceError`. Fixed.
- Dead code removed (all flagged by lint, all orphaned by the redesign):
  `panMode` state (Pan button replaced by hold-Space), `lastClickRef`,
  `migratedRef` (the client-side legacy image migration was dropped in the
  redesign — Phase 1 must still add the server-side equivalent), `viewMoved`,
  `hasImage`, unused imports in BubbleTab/Dashboard/useSimulation/tests.
- `package.json` repository URL placeholder → real repo.
- **Baselines** (seeded demo DB):
  - `GET /api/projects/:id` with one satellite image: **336,023 bytes** —
    re-downloaded after *every* mutation. Image-less project: 621 bytes.
  - `npm test`: 109 pass. Build: main chunk **1,117 kB** (three.js is bundled
    eagerly; see Phase 2).
  - React Profiler flamegraph: to capture in-browser at the start of Phase 2.

---

## Phase 1 — Performance: stop shipping images on every mutation (biggest win)

**Problem.** `GET /api/projects/:id` returns `SELECT *` of the project row
(including legacy `bg_image` / `sat_image` base64 columns) **plus** every row of
`images` with its full base64 `image` column. The client re-fetches this payload
after *every* mutation — each pin, each debounced slider/area edit. With a couple
of site images that is easily multiple MB per keystroke-commit, serialized,
parsed, and re-diffed by React.

1. **Move the one-time legacy migration server-side** (startup, guarded like
   `ensureColumn`): convert `bg_*`/`sat_*` project columns into `images` rows,
   mirroring what `BubbleTab`'s `migratedRef` effect does today. Then delete the
   client-side migration from `BubbleTab.jsx`.
2. **Send image *metadata* only** in `GET /api/projects/:id` (explicit column
   list, no `image`, no legacy `bg_image`/`sat_image`). Columns stay in the DB
   (additive-only rule) — they just stop travelling.
3. **Serve pixels separately**: `GET /api/images/:id/data` returning the data URL
   (or raw bytes + content-type). Client caches by image id — pixels never change
   after upload, so a tiny module-level `Map` (id → dataURL) means each image
   downloads **once per session** instead of on every refetch. PDF export and the
   3-D view read from the same cache.
4. Minor: collapse the snapshot-areas N+1 in `projects.js` into one
   `JOIN … GROUP BY` query.

**Exit:** refetch payload drops from MBs to KBs; pin/edit round-trips visibly
snappier; image upload/calibrate/PDF/3-D all still work; API tests updated.

### Phase 1 — DONE (2026-07-03)

- Step 1 was already done: `migrateImages()` in `db.js` (server-side, flagged by
  `projects.images_migrated`) — the redesign's deletion of the client copy was
  correct, not a gap.
- `server/serialize.js`: `publicProject()` strips legacy `bg_image`/`sat_image`
  from every project response; `IMAGE_META_COLS` keeps the `image` data URL out
  of all images responses (project bundle, POST, PUT).
- New `GET /api/images/:id/data`; client `useImageData` hook keeps a
  module-level session cache with **promise-level in-flight dedupe** (naive
  result-only caching fetched 4× under StrictMode + refetch races — caught in
  preview, fixed). Upload/satellite paths seed the cache with the data URL they
  just sent.
- Snapshot-areas N+1 collapsed into one JOIN.
- **Result (demo project, measured):** refetch payload **336,023 → 10,140
  bytes (33×)**; pixels (325 KB) travel exactly once per session. Verified in
  preview: diagram renders, satellite layer renders from cache when visible,
  exactly one `/data` request. Tests: 111 pass (2 new).

---

## Phase 2 — Performance: isolate the render loop

**Problem.** The sim's RAF loop calls `setTick` every frame, re-rendering the
entire 2,533-line `BubbleTab` — toolbar, rail, popovers, legend, and all derived
values (`adjLinks` is O(links × count²) via `closestPair`, `areaTree`, `groups`,
`effColors`, and every `BubbleLabel` word-wrap) on **every animation frame**, and
on every pointer-move during drags/pans/layer moves.

1. **Split chrome from canvas.** Extract the SVG scene into `<DiagramCanvas>`;
   the `tick` state lives there. Toolbar, right rail, legend, and popovers become
   siblings that only re-render on real state changes (`React.memo` +
   stable callbacks where needed). This is the structural half of Phase 3, done
   first for the perf payoff.
2. **Memoize the per-frame hot spots** that don't depend on node positions:
   `BubbleLabel` (memo on `label/r/areaStr`), hull point generation inputs,
   colour lookups, `areaTree`, `relList`.
3. **Throttle position-dependent derived UI**: the adjacency score / unmet-links
   set doesn't need frame-accurate updates — recompute it at most every ~250 ms
   (or on sim settle) instead of per tick.
4. **Lazy-load the 3-D view.** `Stacked3D` (three.js + r3f, the bulk of the
   1,117 kB main chunk) is imported statically but only used in one floor mode —
   `React.lazy` it the same way `pdfExport` already is.
5. Re-profile against the Phase 0 baseline; record numbers.

**Exit:** while the sim runs, only the canvas subtree re-renders; steady-state
(sim settled) renders drop to ~zero; drag/pan stays smooth on the demo project.

### Phase 2 — DONE (2026-07-03)

- **Lazy 3-D:** `Stacked3D` behind `React.lazy` + `Suspense` — main chunk
  **1,117 kB → 280 kB** (three.js's 834 kB loads only on entering 3-D mode).
- **Tick isolation:** new `src/hooks/useTick.js` — an external tick store +
  `<TickLayer>` (via `useSyncExternalStore`). The sim/drag `setTick` now bumps
  the store instead of component state; the SVG scene + 3-D mount render inside
  the layer's closure (fresh ref reads per tick, latest committed state from
  the last real render). `stackScene()`/`build3DScene()`/unmet-link sets are
  computed inside the closure; unmet links only while highlighting is on.
- **AdjacencyBadge:** the toolbar score subscribes to ticks, recomputing at
  most every 300 ms (and immediately on data changes).
- `BubbleLabel` memoized (word-wrap no longer recomputed per frame). Layer
  sliders bump a small chrome state so popover inputs still track drags.
- **Measured (demo project, 2 s auto-layout pass):** 65,709 DOM mutations
  inside the SVG vs **4** outside it. Before, every frame re-rendered the
  toolbar, popovers, rail, action bar and legend.

---

## Phase 3 — Cleanup: decompose BubbleTab & remove duplication

`BubbleTab.jsx` (2,533 lines) currently owns interaction, persistence, undo,
scene-building, and all render passes. Target shape (~6 focused files + hooks,
each testable):

```
components/diagram/
  DiagramToolbar.jsx     toolbar groups (pure props)
  DiagramRail.jsx        Areas + Relationships rail (incl. resize handle)
  StagePopovers.jsx      layers / satellite / calibrate / error popovers
  StackedScene.jsx       stackScene() + its SVG render pass
  scene3d.js             build3DScene() as a pure function (feeds Stacked3D)
  shapes.jsx             Bubble / Box / Poly renderers + BubbleLabel
hooks/
  usePointerModes.js     pan / marquee / layer move-rotate / calibrate / drag
  usePins.js             savePin / savePinAll / multiPin / pinKeys (one impl)
  usePolyEdit.js         freeform-shape editing
```

Specific dedup/cleanup targets:

- **`closestPair` exists 4×** (BubbleTab, useSimulation, stackScene screen-space
  variant, build3DScene inline loop) → one parameterised helper in
  `adjacency.js`, with a test.
- **Pin persistence logic exists 4×** (`savePin`, `savePinAll`, `multiPin`,
  `pinKeys` all rebuild the same before/after `pin_json` objects) → one helper.
- **Camera state naming**: `camKey` (stacked SVG camera) vs `cam3d` (WebGL
  camera) are near-identical concepts with interchangeable names/comments →
  rename to `stackCam` / `cam3d` and co-locate the preset lists in `floors.js`.
- **Legacy field removal** (enabled by Phase 1): delete the client migration,
  `bg_scale` reads, and `pin_x`/`pin_y` writes from new code paths (server keeps
  accepting them; columns stay).
- **localStorage keys** (`brieftrack.split/hulls/hullpad/railw`) → one tiny
  `prefs.js` helper with a single namespace.
- Update ARCHITECTURE.md §3/§8 repo map to the new layout.

**Exit:** `BubbleTab.jsx` < ~700 lines (state + composition only); behaviour
identical (manual pass over: drag, pin, marquee, calibrate, scale change, floors,
3-D, PDF); tests green + new unit tests for extracted pure helpers.

### Phase 3 — DONE (2026-07-04), with reduced scope

Done:
- `closestInstancePair` in `adjacency.js` replaces all **4** copies (BubbleTab,
  useSimulation, stacked screen-space variant, 3-D scene inline loop) + tests.
- `pins.js` `pinPatch()` replaces the pin_json before/after boilerplate in all
  **5** pin actions (drag-save, pin, pin-all, multi-pin, group-move) + tests;
  per-site lock semantics preserved via callback.
- `diagram/scenes.js`: `buildStackScene` / `build3DScene` extracted as pure
  functions (+ structural unit tests incl. re-centring and ground-image maths).
- `diagram/DiagramRail.jsx`: the A·01/A·02 rail extracted.
- `prefs.js` replaces the scattered `brieftrack.*` localStorage calls.
- Camera states disambiguated: `camKey` → `stackCam` (stacked SVG) vs `cam3d`
  (WebGL).
- ARCHITECTURE.md §3/§5/§7 updated (repo map, image-data endpoint, tick-store
  convention).
- Suite grew 111 → **123 tests**; verified in preview: flat/stacked/3-D floors,
  pin/unpin, action bars, rail, and the scale-change alignment invariant
  (1:500→1:200→1:500 round-trips a pinned bubble exactly).

Deliberately not done (candidates for a later pass):
- `BubbleTab.jsx` is ~2,580 lines, not <700 — extracting the stage popovers,
  action bar, topbar and the SVG shape renderers (`shapes.jsx`) remains. The
  perf-relevant split (Phase 2's TickLayer) is in, so the remaining extraction
  is readability-only and mechanical.

---

## Phase 4 — UI unification (rescoped: what the redesign didn't cover)

The redesign already delivered fonts, the `data-theme` token system, the tool
dock, the contextual action bar, and restyled screens. Remaining unification:

1. **Self-host the fonts.** They currently load from the Google Fonts CDN in
   `index.html` — a local-first (and future desktop-shell) app shouldn't need
   network for its UI type. Move Inter / JetBrains Mono / Space Grotesk to
   `public/fonts/` + `@font-face`.
2. **Split `styles.css`** (now ~1,500 lines) into ordered imports:
   `tokens.css` (both theme blocks) · `base.css` (reset, type, buttons, forms,
   cards) · `diagram.css` · `views.css`. Mechanical, no visual change.
3. **Unify the floating surfaces** that still hand-roll chrome (`stage-popover`
   variants, Layers panel, calibrate bar, matrix panel, HelpPanel) → one
   `Popover`/panel primitive.
4. **One error/empty-state component.** App, ProjectView, and BubbleTab each
   hand-roll `banner error` / `.empty` markup → shared `<Banner>` / `<Empty>`.
5. Sweep remaining one-off inline `style={{…}}` into classes using tokens.

**Exit:** both themes screenshot-identical before/after (minus font loading
source); no scale/diagram behaviour change.

### Phase 4 — DONE (2026-07-04)

- **Fonts self-hosted** via `@fontsource/{inter,jetbrains-mono,space-grotesk}`
  (weights 400–700 — the CDN link had requested Inter 800, which nothing
  uses). Google Fonts `<link>`s removed from `index.html`; verified zero CDN
  requests, local woff2 files load on demand.
- **`styles.css` split** into `src/styles/` — `tokens.css` (72 lines, the
  whole design system) · `base.css` (309) · `views.css` (240) ·
  `diagram.css` (~880). Files are **contiguous slices** of the old monolith,
  imported in original order, so the cascade is byte-for-byte identical
  (headers in each file document this rule). Thematic re-grouping was
  deliberately avoided — reordering same-specificity rules changes the
  cascade.
- **`<Banner>` / `<Empty>`** (`components/ui.jsx`) replace ~20 hand-rolled
  error/empty divs across 9 files; Banner adds `role="alert"`.
- **`<StagePopover>`** unifies the stage-panel chrome (header + ✕): used by
  the layers panel and the error popover (whose inline styles became
  `.stage-popover.error`). The sat/calibrate/more popovers have no chrome to
  share and keep their surface classes.
- Rail inline styles (`sec-head` margins, table column widths) → classes.
- Verified in preview, both themes: diagram, rail, layers popover, fonts.
  Tests 123 pass; build green (CSS bundle now includes the font faces).

---

## Phase 5 — Final verification

- `npm test` (extend for: image-data endpoint, server-side migration, extracted
  helpers) and `npm run build`.
- Browser pass of the demo project: every toolbar control, calibrate + scale
  change (alignment invariant), floors incl. 3-D, PDF export, CSV export.
- Compare perf numbers vs Phase 0 baseline; record results here.

## Suggested order & sizing

| Phase | Size | Risk |
|---|---|---|
| 0 Tooling/baseline | S | none |
| 1 Image payload | M | low (API tests cover it) |
| 2 Render isolation | M–L | medium (touches the hot loop) |
| 3 Decomposition | L | medium (mechanical but wide) |
| 4 UI unification | M | low (visual only) |
| 5 Verification | S | — |

Phases 1 and 2 are independent; 3 builds on 2's component split; 4 can run any
time after 3 (shared primitives land where the popovers now live).
