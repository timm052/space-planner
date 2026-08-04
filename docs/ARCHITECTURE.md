# BriefTrack — Architecture & Design Notes

> Written for AI coding agents (and humans) who need to understand how this app
> is built and **why** before changing it. It documents the data model, the
> non-obvious math, the state-management conventions, and the gotchas that have
> already bitten us. Read this before editing `BubbleTab.jsx`, the scale logic,
> or the SQLite schema.

---

## 1. What the app is

BriefTrack reconciles **designed areas against the client brief** for
architects, and provides a **scale-accurate, image-aware diagram** for early
space planning.

- **Brief** — the agreed programme as its own hierarchy (`brief_spaces`), with
  formula-driven areas, benchmarks, dated revisions and a change log.
- **Design** — the live rooms (`spaces`) that carry geometry and drive the
  diagram, reconciled against the Brief **explicitly** (see §4).
- **Diagram** — three environments over one shell: ◯ Concept (bubbles,
  relationships, force sim), ▱ Master plan (building envelopes on a calibrated
  site), ▤ Building (per-floor massing blocks) — each with its own persisted
  layout, exportable as scale-accurate sheets and a multi-page drawing set.
- **Milestones** — snapshots of measured areas at each design stage; the
  Dashboard shows variance, net:gross efficiency, and drift over time.

The whole thing is **single-user and local** by design (see §2).

---

## 2. Tech choices and rationale

| Choice | Why |
| --- | --- |
| **React 18 + Vite** | Fast SPA dev; no framework lock-in. The diagram is the complex part and benefits from React's declarative SVG rendering plus imperative refs for the animation loop. |
| **Express REST API** | Tiny, boring, well-understood. The clean frontend/back split keeps the client unchanged when the backend is later embedded in a desktop shell (Tauri/Electron). |
| **`node:sqlite` (built-in)** | Zero native compilation, zero external DB. Requires Node ≥ 22.5. A single-file DB matches the single-user, local nature. |
| **No ORM** | Hand-written prepared statements in `server/index.js`. The schema is small; an ORM would be overhead. |
| **No chart library** | The drift chart and the entire bubble diagram are hand-rolled SVG. We need pixel/coordinate control (true-scale geometry, custom force layout) that chart libs fight against. |
| **`jspdf` (client-side)** | The PDF is drawn from the same diagram-unit coordinates the screen uses, so "what you see is what prints" and scale accuracy is exact. Drawing primitives (not a canvas screenshot) keeps it crisp and vector. |
| **Images as base64 data URLs in the project row** | Simplest possible storage for a single-user, local app — no blob store, no file paths, survives DB copy. For very large image sets, on-disk files alongside the DB would be better (a natural fit once packaged as a desktop app; see ROADMAP). |
| **Server-side proxies for geocode + tiles** | Keeps the browser canvas same-origin (untainted, so `toDataURL` works) and needs no API keys. |

---

## 3. Repo map

```
server/
  db.js            Schema, additive migrations (ensureColumn), legacy image
                   migration (migrateImages), adjacency instance-key rebuild
                   (migrateAdjacencies), demo seed
  index.js         Express app wiring (routers, error handler, static prod)
  serialize.js     Response shaping: publicProject(), IMAGE_META_COLS — keeps
                   base64 payloads out of the per-mutation refetch
  brief.js         The independent Brief: formula resolution into target_area,
                   path-keyed Brief⇄Design reconciliation (diff / apply / pull),
                   dated revisions, brief→milestone
  options.js       Design options — save/list/load/delete a whole design
                   (spaces + adjacencies) as a named A/B scheme
  changelog.js     Programme audit trail; logs programme fields, never geometry
  routes/          One router per resource: projects, spaces, brief_spaces,
                   program (revisions, brief adjacencies, changes, options),
                   adjacencies, snapshots, images (incl. GET /images/:id/data),
                   settings, proxy (geocode + tiles)
src/
  api.js           Thin fetch wrapper; one method per endpoint
  compute.js       PURE helpers: area math, hierarchy, units, CSV. No React.
  adjacency.js     PURE: compliance scoring + closestInstancePair (the ONE
                   closest-pair implementation — sim, links, PDF, stacked view)
  geometry.js      PURE: hulls, polygons, power/Voronoi cells, image filters
  pins.js          PURE: pinPatch — the shared pin_json before/after builder
  formula.js       PURE: the brief-area formula engine (tokenizer → recursive-
                   descent parser → evaluator). ONE implementation shared by the
                   client's live preview and the server's authoritative
                   resolution — keep them on this module, never fork it.
  benchmarks.js    PURE: planning benchmarks (typical allowances by building
                   type) + the project → settings → built-in override chain
  textfit.js       PURE: measured label fitting (wrap, balance, shrink, ellipsis)
  imageUtils.js    PURE: image filter presets + data-URL helpers
  useHistory.js    undo/redo stack for diagram edits
  prefs.js         localStorage UI preferences (one namespace)
  scale.js floors.js viz.js theme.jsx   scale math · storeys/cameras · colours · theming
  pdfExport.js     jsPDF: renders a scene onto a sheet; single sheet or a
                   multi-page drawing set (lazy-loaded)
  pngExport.js     SVG → 2× raster, or the WebGL frame in 3-D (lazy-loaded)
  hooks/
    useViewport.js useImageDims.js useSimulation.js
    useDiagramPrefs.js  the diagram's persisted view preferences in one hook
    usePins.js useLinks.js useSpaceEditing.js usePolyEditing.js
    useImageLayers.js useCategoryColors.js
    useImageData.js  session cache: image id → data URL (fetched once)
    useTick.js       tick store + <TickLayer> — animation renders bypass chrome
  App.jsx          App shell: topbar, nav, routes between list/project/settings
  components/
    ProjectList.jsx     Project cards + create form
    ProjectView.jsx     Full-height project frame: bar + tabs + shared selection
    Dashboard.jsx       KPI cards, drift chart, rollups
    BubbleTab.jsx       Diagram orchestrator: state, pointer handlers, canvas
    BriefTab.jsx        The SHARED treemap + hierarchical schedule editor. NOT a
                        tab itself — ProgramTab and DesignTab each wrap it,
                        passing a `store` adapter (which table the edits write
                        to) plus their own actions and sidebar cards.
    ProgramTab.jsx      The "Brief" tab: the independent agreed programme
                        (brief_spaces) — import, grossing allowance, adjacency
                        requirements, revisions, benchmarks, send-to-design
    DesignTab.jsx       The "Design" tab: the live areas (spaces) that drive
                        the diagram
    SnapshotsTab.jsx    Milestone recording/editing
    DriftChart.jsx      Hand-rolled SVG line chart
    HelpPanel.jsx       Shortcuts modal
    SettingsPage.jsx    App-wide defaults (units, tolerance, grossing)
    diagram/
      scenes.js         PURE scene builders — footprints, interior cells, bubble
                        radii, sheet bounds, stacked + WebGL scenes. The ONE
                        definition of each; the canvas AND pdfExport read it
      modes.js          PURE snap geometry + pointer-mode arbitration
                        (grid/edge snap, guides, pan, marquee) — JSDoc-typed
      selection.js linking.js layerTools.js
                        PURE state machines lifted out of BubbleTab (tested)
      DiagramCanvas.jsx The SVG scene (renders inside the TickLayer)
      DiagramToolbar.jsx  Stage topbar, tool dock, zoom cluster, ⋯ More
      SelectionHud.jsx  The one contextual action bar (room / multi / link)
      CommandPalette.jsx  Ctrl/Cmd-K room + command finder
      DiagramRail.jsx   A·01 Areas + A·02 Adjacency rail (Building: stacking)
      LayersPanel.jsx   Image layers, satellite fetch, scale/calibration panels
      Stacked3D.jsx     WebGL view (lazy-loaded — keeps three.js out of the
                        main bundle)
      LayerRow.jsx MatrixPanel.jsx NorthRose.jsx StagePopover.jsx
  styles.css       Style entry: ordered @imports of styles/ (contiguous slices
                   of the former monolith — import order IS the cascade)
  styles/          tokens.css (the design system) · base.css · views.css ·
                   diagram.css
  components/ui.jsx           <Banner> / <Empty> / <Overlay> — the app's one
                              error / empty / modal markup
                   Fonts are self-hosted via @fontsource imports in main.jsx.
scripts/perf-bench.js  Pointer-path benchmark (rect calls + ms per gesture at
                   50 / 150 / 400 rooms): node --import tsx scripts/perf-bench.js
docs/ARCHITECTURE.md  (this file)
docs/DESIGN.md        the design language as built
ROADMAP.md            where the project stands, what's next, and the decisions
                      already taken (with the triggers that would reopen them)
```

**`compute.js` is the place to start** when learning the domain: it is pure,
test-friendly, and encodes all the area/hierarchy/unit rules.

---

## 4. Data model (SQLite)

All schema lives in `server/db.js`. Migrations are **additive only** via
`ensureColumn(table, col, ddl)` — we never drop/rename, so old databases keep
working. New columns must also be added to `PROJECT_FIELDS` in `index.js` to be
writable through `PUT /api/projects/:id`.

### Two room trees (read this first)

There are **two independent room hierarchies**, and confusing them is the
easiest way to break this app:

- **`spaces` — the Design.** The live rooms that carry diagram geometry
  (pins, shapes, plans, blocks) and drive the canvas. The "Design" tab.
- **`brief_spaces` — the Brief.** The agreed programme. Programme fields only,
  **no geometry**. The "Brief" tab.

They are reconciled **explicitly, never implicitly**. `server/brief.js` matches
rows across the two trees by **path key** — the `/`-joined chain of ancestor
names — so a Brief row and a Design row correspond when their positions in the
hierarchy match, not by id. Nothing syncs on its own: the user previews a diff
and applies it (`apply-brief`), or pulls one room the other way
(`pull-to-brief`). Preserve that: an automatic sync would silently overwrite
negotiated programme numbers with in-progress design areas.

### `projects`
Core: `name, client, stage, units ('m2'|'ft2'), grossing_target, tolerance`.

Diagram/render state (all per-project):
- `sim_enabled` — force layout on/off.
- `display_scale` — metres per diagram unit (the chosen drawing scale). Null =
  relative/auto sizing.
- `bubble_opacity`, `bubble_style` (`solid|outline|sketch`), `view_x`, `view_y`
  — view pan offset.
- `north_deg` — project north, clockwise from up.
- `north_locked` — 1 freezes north, so rotating the design onto the site does
  not drag the bearing with it.
- `diagram_env` — the last-open environment (`concept|masterplan|building`).
  Per-environment pan framing is a client concern (session cache +
  `brieftrack.viewByEnv` in localStorage), not a column.
- `level_heights` — JSON `{ "<level label>": metres }`; storeys without an entry
  use 3.5 m (`DEFAULT_STOREY_M`).
- `category_colors` — JSON map of category/building label → custom colour.
- **Legacy image columns** (`bg_*`, `sat_*`, `bg_scale`) — superseded by the
  `images` table below, folded in once by `migrateImages()` (flagged by
  `images_migrated`) and stripped from every response by `serialize.js`.
  **Do not read or write them in new code.**

### `images`
One row per background layer, unlimited per project: `kind`
(`satellite|custom`), `name`, `image` (base64 data URL), `mpp` (metres per
natural pixel — its own calibration), `opacity`, `visible`, `x`, `y` (centre
offset in units), `rot` (deg CW), `filter`
(`''|grayscale|blueprint|faded|contrast|ink`), `sort_order`, `attribution`.
The `image` column never travels in the project bundle — see §5.

Programme state:
- `variables` — JSON `{ name: number }`, referenced in formulas as `@name`.
- `circulation` — circulation/grossing allowance as a fraction of net
  (0.35 → gross ≈ net × 1.35). Null = no estimate.
- `benchmarks` — per-project override of the benchmark library; null falls back
  to app settings, which fall back to the built-ins in `src/benchmarks.js`.

### `spaces` (the program — a self-referential tree)
- `project_id`, `department`, `name`, `count`, `target_area`, `notes`,
  `sort_order`.
- `parent_id` — self-FK for hierarchy (nullable; no DB-level cascade, see §7).
- `kind` — `'space' | 'building' | 'group'`. Containers carry **no area of
  their own**; their area rolls up from leaf descendants.
- `child_mode` — how a space relates to its children: `'group'` (pure container
  summing children — default and legacy), `'within'` (children sit inside its
  own area and are excluded from totals), `'attached'` (children are separate
  areas that move with it). Leaf detection in `compute.js` depends on this.
- `level` — storey label; `height_m` — optional clear height (null = inherit the
  storey's, so a taller room reads as a double-height volume in 3-D).
- `circ_pct` — on container rows: the building's circulation allowance, which
  grosses up the envelope's required footprint.
- `shape` / `shape_json` — `shape` is **legacy** (geometry now follows the
  environment, not a per-space toggle); `shape_json` holds the normalised
  outline used by master-plan envelopes and drawn footprints.
- `pin_x`/`pin_y` — **legacy** single pin (read as instance 0 only).

**Per-environment layouts.** Each environment persists its own positions, keyed
by instance index (`"0"`, `"1"`, … for a space with `count` N). They are
different truths and must never overwrite each other:

| Column | Environment | Slot shape |
| --- | --- | --- |
| `pin_json` | ◯ Concept | `{ x, y, locked? }` — presence = pinned |
| `plan_json` | ▱ Master plan | `{ x, y, rot, a }` — presence = placed on the site (`a` = drawn footprint area in units²) |
| `block_json` | ▤ Building | `{ x, y, w, h, rot }` — presence = blocked into a floor |

On containers, `plan_json` + `shape_json` describe the **building envelope**;
its drawn area is checked against the required footprint (biggest storey ÷
`1 − circ_pct`) and the badge turns red when the envelope is too small.
- `area_formula` — when set, `target_area` is **derived**, not authored. The
  server resolves the expression and persists the result into `target_area`
  (`brief.js`), so every reader can keep using `target_area` and stay unaware
  of formulas. Do not write `target_area` directly on a formula-driven row.

### `brief_spaces` (the Brief tree)
Mirrors the programme fields of `spaces` — `parent_id`, `kind`, `department`,
`name`, `count`, `target_area`, `area_formula`, `child_mode`, `level`, `notes`,
`image`, `sort_order` — and deliberately carries **no** geometry columns.

### `adjacencies`
`space_a`/`space_b` with `inst_a`/`inst_b`, `strength ('required'|'desired')`,
unique on **(space_a, space_b, inst_a, inst_b)**. Links target a *specific
instance* of each space, so a `count > 1` space can link its copies
independently; instance 0 is the first/only room. Old databases had
`UNIQUE(space_a, space_b)` and are rebuilt into the wider key by
`migrateAdjacencies()`, existing rows landing at 0–0.

### `brief_adjacencies`
Adjacency **requirements** declared on Brief rooms ("Kitchen must adjoin
Servery"), unique per `(a_id, b_id)`. Scored against the Design's actual links
by path key — the requirement and the link live in different trees.

### `brief_revisions`
Dated, immutable copies of the whole Brief tree (Rev A/B/C as the brief is
renegotiated). `data` is the serialized `brief_spaces` rows.

### `design_options`
Named saves of a whole design (`spaces` + `adjacencies`) as `data`, so A/B
schemes can be compared against one Brief and swapped in.

### `change_log`
Append-only audit of programme edits: `tree` ('brief'|'design'), `name`,
`field`, `old`, `new`. Programme fields only — geometry is never logged.

### `snapshots` + `snapshot_areas`
A milestone (`label, taken_at, gross_area`) and its measured area per space.
Only **leaf** spaces are measured. `kind` distinguishes a recorded
`'milestone'` from one generated off the Brief.

### `settings`
Key/value app-wide defaults applied to *new* projects.

---

## 5. API surface

REST, JSON, under `/api`. Notable contracts:

- `GET /api/projects/:id` returns `{ project, spaces, brief_spaces, snapshots,
  adjacencies, brief_adjacencies, images }` — the whole project, both trees, in
  one round trip (the client re-fetches this after every mutation; see §7
  "optimistic + refetch"). **Images are metadata
  only** (no base64), and the project row is stripped of the legacy
  `bg_image`/`sat_image` blobs (`serialize.js`) — this keeps the per-mutation
  refetch in the KB range.
- `GET /api/images/:id/data` → `{ image: dataURL }`. Pixels are immutable
  after upload, so the client (`useImageData`) fetches each image once per
  session and caches it at module level (with in-flight promise dedupe).
- `PUT /api/projects/:id` accepts any subset of `PROJECT_FIELDS`. Fields settable
  to null (e.g. clearing an image) are written when the **key is present**, so
  the client sends explicit nulls.
- `PUT /api/spaces/:id` — presence-based for `pin_x/pin_y/pin_json/parent_id`
  (so they can be cleared). Validates parent against cycles (`parentOk`).
- `DELETE /api/spaces/:id` — recursive subtree delete via a `WITH RECURSIVE …
  UNION` CTE (see §7 gotcha).
- `GET /api/geocode?q=` → Nominatim proxy. `GET /api/tile/:z/:x/:y` → Esri World
  Imagery proxy (same-origin so the canvas stays untainted).
- The Brief subsystem (`brief-spaces`, `brief-diff`, `apply-brief`,
  `pull-to-brief`, `brief-revisions`, `brief-adjacencies`, `options`, `changes`)
  is routed through `server/brief.js`, `options.js` and `changelog.js`; the full
  endpoint table lives in the README. Reconciliation is by **path key**, never
  by id, and never automatic.

---

## 6. The math that matters

This is the part most likely to be broken by a careless edit. **Test scale
changes and image alignment after touching any of it.**

### 6.1 The scale model (one scale for everything)

A **diagram unit ≈ 0.2646 mm of paper** (≈ 1 CSS px @ 96 dpi). So a drawing at
scale `1:S` means 1 unit = `S × 0.0002646` metres. `display_scale` stores this
metres-per-unit value; `ratioToScale`/`scaleToRatio` convert to/from the `1:S`
ratio.

There is **exactly one render scale `effScale`** (metres/unit) for the whole
diagram:

```
effScale = display_scale (a preset like 1:200)  ??  fitScale (auto-fit primary image)
```

Everything is drawn at `effScale` so bubbles and images **share one coordinate
system and stay aligned**:
- Bubble radius (true scale) = `sqrt(area_m2 / π) / effScale`.
- Image layer width (units) = `naturalWidthPx × mpp / effScale`.

Each image stores intrinsic **`mpp` (metres per natural pixel)** from its own
calibration, so two images with correct `mpp` line up at any `effScale`. This
is why "independent calibration per image" works without breaking alignment.

### 6.2 Calibration (2-point → mpp)

User clicks two points on an image a known real distance apart. Because the
on-screen scale (units-per-pixel = `renderedWidthUnits / naturalWidth`) is
rotation-invariant:

```
naturalPx = (clickDistanceUnits / layerWidthUnits) × naturalWidth
mpp = realMetres / naturalPx
```

### 6.3 Scale-change alignment (the subtle one)

When the user changes scale (`S0 → S1`), true-scale **sizes** change by
`f = S0/S1`. If bubble *positions* stayed fixed while images rescaled, a bubble
over a building would drift off it. Fix: a **uniform zoom in place** — scale
bubble node positions, persisted pins, and image offsets by `f` **about the
current viewport centre** `A = (view.x + W/2, view.y + H/2)`:

```
p' = A + (p - A) × f
```

The view itself is left unchanged (A is the fixed point), so what the user is
looking at stays put. Verified invariant: a pinned bubble's *fractional*
position within the satellite image is identical before and after. See
`onScaleSelect` in `BubbleTab.jsx`. **Do not re-introduce a "re-energise the
sim on scale change" effect — it would shuffle positions.**

### 6.4 Dynamic viewBox (fills the screen)

`W=900, H=620` are only the **logical world anchor** (spawn, gravity, image
centre). The visible SVG `viewBox` is sized to the container via a
`ResizeObserver` (`vb = {w,h}`), so a bigger screen shows *more* world at the
same scale. The origin keeps the logical canvas centred and is
backward-compatible:

```
originX = W/2 - vb.w/2 + view.x      viewBox = `${originX} ${originY} ${vb.w} ${vb.h}`
```

When `vb == 900×620` this reduces to the old `view.x view.y 900 620`. Use
`vb`/origin (not `W`/`H`) for anything viewport-relative: `toSvgCoords`, pan
deltas, scale bar, attribution. The scale-change anchor `W/2 + view` equals the
viewport centre for any `vb`, so it didn't need changing.

### 6.5 Force simulation

A hand-written spring sim in a `requestAnimationFrame` loop (only runs while
`sim_enabled` and `alpha > threshold`, or during a drag). Forces: department/
building centroid gravity, sibling springs (instances of one space), adjacency
springs (between the **closest pair** of instances), and collision separation.
Pinned/held/dragged nodes are fixed points. Node positions live in a **ref**
(`nodesRef`), not React state — the loop mutates them directly and calls
`setTick` to re-render. Only **pins** persist; unpinned positions are transient
(but dragging with sim off auto-pins, so manual layouts survive reload).

### 6.6 Per-instance bubbles & pins

`count > 1` renders N instances (`key = "${spaceId}:${i}"`). Pins are stored in
`pin_json` keyed by instance index. The UI supports **pin one** (the selected/
hovered instance) and **pin all** (`savePinAll`). Selection tracks both the
space (`selected`, drives linking/colour) and the instance (`selectedInst`,
drives which bubble Pin acts on).

### 6.7 PDF sheets and the drawing set

`pdfExport.js` maps diagram units → mm at a fixed `0.2646 mm/unit` (true scale),
picks the smallest ISO page (A4…A0) that fits the scene bounds, and draws image
layers (clipped to the frame), links, rooms, a scale bar, a north arrow and a
title block. `exportDiagramPdf(scene)` renders one sheet;
`exportDrawingSet({ sheets })` renders the pipeline — concept sheet (NTS, no
site layers), master plan sheet, one sheet per floor — into a single document,
built from the **persisted** layouts so it works from any environment.
**Image rotation and filters are baked** into a canvas *before* the scene reaches
`pdfExport` (which stays rotation-agnostic), so exports remain scale-accurate.

### 6.8 One definition per quantity (canvas ⇄ sheet)

The sheet and the screen must agree, so the quantities they both need live once,
in `scenes.js`, and are imported by the canvas, the snap resolver and
`pdfExport` alike: `boxExtents` / `boxCorners` / `polyAt` (footprint geometry),
`interiorSeeds` / `interiorCells` (the Voronoi interior sketch),
`trueScaleRadius` / `relativeRadius` (the two bubble-size rules), and
`sceneBounds` (which picks the page size). These were each written out 2–4 times
before; every copy was a chance for the export to disagree with the display.
**If you need one of these numbers, import it — never re-derive it.**

### 6.9 Hierarchy (leaf-aware compute)

`compute.js` treats only **leaf** spaces (no children, kind `space`) as
carrying area. `briefNet`, `snapshotNet`, and `rollup` operate over leaves;
`subtreeArea` rolls a container up from its leaf descendants; `orderedTree`
yields `{space, depth}` for the Brief tree.

---

## 7. State & conventions (and gotchas)

- **Optimistic mutate + full refetch.** Most actions `PUT` then call
  `onChanged()` which re-fetches the whole project. For drag/slider previews we
  also mutate the in-memory object and `setTick` so the UI updates before the
  round trip. Keep this pattern; don't add partial client-side cache merging.
- **Refs vs state.** Anything the RAF loop or a pointer handler reads on every
  frame uses a ref (`nodesRef`, `viewRef`, `hoverRef`, `dragRef`).
  **Gotcha:** commit the *ref* value on pointer-up, not the state var — a fast
  release saved a stale `view` before we switched to `viewRef`.
- **Animation ticks bypass React state.** `setTick` bumps an external store
  (`useTick.js`); only the `<TickLayer>` wrapping the SVG canvas + 3-D mount
  re-renders per frame — toolbar/rail/popovers don't. Positional derived values
  (`makeStackScene`, `make3DScene`, unmet-link sets) are computed *inside* the
  TickLayer closure so they read fresh node positions; the toolbar's adjacency
  badge recomputes on a 300 ms throttle (`AdjacencyBadge`). If you add UI that
  must track node positions live, render it inside the TickLayer (or subscribe
  to the store) — chrome outside it only updates on real state changes.
  Corollary: optimistic in-place edits that chrome displays (e.g. layer
  sliders) must also bump chrome state (`forceChrome`).
- **Debounced saves** via `debouncers.current[key]` for sliders, view pan,
  north, and area edits.
- **Double-click is detected manually** where needed — `PointerEvent.detail`
  and native `dblclick` proved unreliable on SVG. (Pin used to be double-click;
  it's now `P`/button.) Also: React's `onPointerEnter` fires from a native
  `pointerover` (not `pointerenter`) — matters when scripting/testing hover.
- **Recursive space delete uses `UNION` (not `UNION ALL`).** A data cycle plus
  `UNION ALL` once infinite-looped the CTE and crashed the server. `parentOk`
  prevents cycles, but the dedup is defence-in-depth — keep it.
- **`parentOk` must SELECT `parent_id`** when walking the ancestor chain — an
  early version only checked the immediate parent and let a cycle form.
- **`API_PORT` in dev.** The preview launcher injects `PORT`, which would make
  the API bind to Vite's port; in dev the API reads `API_PORT` (falls back to
  3001). Don't revert to plain `PORT`.
- **Legacy image migration is server-side**, in `db.js` (`migrateImages()`,
  guarded by `projects.images_migrated`): old `bg_*`/`sat_*` columns are folded
  into `images` rows at startup. The client migrates nothing — don't re-add a
  client-side copy. `migrateAdjacencies()` similarly rebuilds the old
  `UNIQUE(space_a, space_b)` key into the per-instance one.
- **Pointer moves are coalesced to one frame.** `onMove` stashes the latest
  event and schedules a rAF that does the work and the single `setTick`; the
  client rect is cached on pointer-down and invalidated by the `ResizeObserver`.
  Two invariants fall out of this and are covered by tests: `onUp` must **flush
  the pending move synchronously before** handling the release (otherwise the
  last movement of every gesture is dropped and a stale position is committed),
  and gesture state a flush reads — the marquee box, for one — must live in a
  **ref**, not React state.
- **The user's hand beats an in-flight view glide.** `stopViewTween()` is called
  from `onSvgPointerDown` and the wheel handler; without it a recentre glide and
  the pan handler both write `setView` every frame.
- **Per-environment caches are keyed by environment.** The module-level layout
  and view caches use `projectId:env` — sharing them lets Concept and Master
  plan bleed positions into each other.
- **Rail sections need their own `overflow-y:auto`** — relying on the rail
  scrolling let a long Areas list visually overlap Relationships.

---

## 8. How to extend (recipes)

**Add a project field** (e.g. a new diagram toggle):
1. `ensureColumn('projects', 'foo', 'foo INTEGER DEFAULT 0')` in `db.js`.
2. Add `'foo'` to `PROJECT_FIELDS` in `index.js`.
3. Read `project.foo` in the component; write via `saveProject({ foo })`.

**Add a per-space field:** `ensureColumn('spaces', ...)`, then thread it through
the `spaces` POST/PUT in `index.js` and the relevant tab.

**Add a diagram tool:** most live in `BubbleTab.jsx`. Pointer interactions go
through `onSvgPointerDown/onMove/onUp` (which multiplex pan / marquee /
layer-move / calibrate / room-drag / vertex-drag / seed-drag); the snap and
arbitration math belongs in `diagram/modes.js`, where it is pure and tested.
Keep new geometry in diagram units so the sheets and scale stay correct, and add
anything the PDF also needs to `scenes.js` rather than to a renderer (§6.8).

**Gate a feature per environment:** add the flag to `ENV_CAPS` in
`BubbleTab.jsx` and read `caps.<flag>` — one declarative table instead of
scattered `isConcept && …` ternaries. A fourth environment should be a new row.

**Add a tab:** add to `TABS` in `ProjectView.jsx`; non-diagram tabs render inside
a `.page` wrapper, the diagram renders full-bleed (`.project-content.full`).

---

## 9. Notes for AI agents

- **Run `npm test`, `npm run lint` and `npm run build` after edits** — the
  fastest correctness gates. `npm test` (Node's built-in runner via `tsx` for
  JSX) is **349 tests**: the pure helpers (`compute`, `scale`, `formula`,
  `geometry`, `adjacency`, `floors`, `pins`, `textfit`), the diagram's pure
  modules (`selection`, `linking`, `layerTools`, `modes`, `scenes`), the full
  REST surface against an isolated temp DB (`BRIEFTRACK_DB_DIR`), the
  prop-driven React views rendered to static markup (`react-dom/server`), and
  jsdom pointer-event tests over the diagram shell. Add a case there when you
  change domain math, an endpoint, a view, or pointer behaviour. Note: `tsx`
  transforms JSX with the *classic* runtime, so component tests set
  `globalThis.React` before rendering. Then verify scale/alignment in the running
  app. (CI runs tests + build + an API smoke test — not lint, yet.)
- **Pointer-path changes have a benchmark**: `node --import tsx
  scripts/perf-bench.js` reports `getBoundingClientRect` calls and ms per
  60-move gesture at 50 / 150 / 400 rooms. The current baseline is ~0.03 rect
  calls per move; a regression there means a forced synchronous layout came back
  onto the drag hot path.
- The API server does **not** hot-reload; **restart it** after touching
  `server/*` (the preview launcher restart re-runs migrations).
- `compute.js` changes ripple into Dashboard, CSV, and the diagram — verify
  totals stay leaf-aware.
- When in doubt about scale, reason in the two invariants: **bubbles and images
  share `effScale`**, and **a scale change is a uniform zoom about the viewport
  centre**.
- Prefer additive migrations; never break an existing user's `data/` DB.
