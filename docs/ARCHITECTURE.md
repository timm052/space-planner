# BriefTrack — Architecture & Design Notes

> Written for AI coding agents (and humans) who need to understand how this app
> is built and **why** before changing it. It documents the data model, the
> non-obvious math, the state-management conventions, and the gotchas that have
> already bitten us. Read this before editing `BubbleTab.jsx`, the scale logic,
> or the SQLite schema.

---

## 1. What the app is

BriefTrack reconciles **designed areas against the client brief** for
architects, and provides a **scale-accurate, image-aware bubble diagram** for
early space planning.

- **Brief** — the required program as a hierarchy (buildings → spaces), each
  with a target area and count.
- **Milestones** — snapshots of measured areas at each design stage; the
  Dashboard shows variance, net:gross efficiency, and drift over time.
- **Bubble diagram** — one bubble (or box) per room, sized true-to-scale,
  arranged over a calibrated satellite and/or imported site plan, exportable
  as a scale-accurate PDF.

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
  db.js            Schema, additive migrations (ensureColumn), demo seed
  index.js         Express app: all REST endpoints + geocode/tile proxies
src/
  api.js           Thin fetch wrapper; one method per endpoint
  compute.js       PURE helpers: area math, hierarchy, units, CSV. No React.
  pdfExport.js     jsPDF scene → scale-accurate PDF (page fit, scale bar, north)
  App.jsx          App shell: topbar, nav, routes between list/project/settings
  components/
    ProjectList.jsx     Project cards + create form
    ProjectView.jsx     Full-height project frame: bar + tabs + tab content
    Dashboard.jsx       Stats, drift chart, department/building rollups
    BubbleTab.jsx       THE big one (~1000 lines): diagram, sim, layers, PDF
    BriefTab.jsx        Hierarchical program tree with drag-to-reparent
    SnapshotsTab.jsx    Milestone recording/editing
    DriftChart.jsx      Hand-rolled SVG line chart
    HelpPanel.jsx       Modal documenting diagram gestures
    SettingsPage.jsx    App-wide defaults (units, tolerance, grossing)
  styles.css       All styling. CSS custom properties in :root for theming.
docs/ARCHITECTURE.md  (this file)
ROADMAP.md
```

**`compute.js` is the place to start** when learning the domain: it is pure,
test-friendly, and encodes all the area/hierarchy/unit rules.

---

## 4. Data model (SQLite)

All schema lives in `server/db.js`. Migrations are **additive only** via
`ensureColumn(table, col, ddl)` — we never drop/rename, so old databases keep
working. New columns must also be added to `PROJECT_FIELDS` in `index.js` to be
writable through `PUT /api/projects/:id`.

### `projects`
Core: `name, client, stage, units ('m2'|'ft2'), grossing_target, tolerance`.

Diagram/render state (all per-project):
- `sim_enabled` — force layout on/off.
- `display_scale` — metres per diagram unit (the chosen drawing scale). Null =
  relative/auto sizing.
- `bubble_opacity`, `view_x`, `view_y` — view pan offset.
- `north_deg` — project north, clockwise from up.
- **Two image layers**, each calibrated independently:
  - Custom: `bg_image` (data URL), `bg_mpp` (metres/natural-pixel),
    `bg_opacity`, `bg_visible`, `bg_x`, `bg_y` (centre offset, units),
    `bg_rot` (deg), `bg_attribution`.
  - Satellite: `sat_*` mirror of the above.
- `bg_scale` — **legacy** single-layer scale; only read by the one-time
  migration in `BubbleTab` (do not use in new code).

### `spaces` (the program — a self-referential tree)
- `project_id`, `department`, `name`, `count`, `target_area`, `notes`,
  `sort_order`.
- `parent_id` — self-FK for hierarchy (nullable; no DB-level cascade, see §7).
- `kind` — `'space' | 'building' | 'group'`. Containers carry **no area of
  their own**; their area rolls up from leaf descendants.
- `shape` — `'bubble' | 'box'` (diagram rendering).
- `pin_x`/`pin_y` — **legacy** single pin (read as instance 0 only).
- `pin_json` — current per-instance pins: `{"0":{x,y},"2":{x,y}}` keyed by
  instance index. A space with `count` N has instances `0..N-1`, each a
  separate bubble that can be pinned independently.

### `adjacencies`
`space_a < space_b` (canonicalised), `strength ('required'|'desired')`, unique
per pair. The bubble diagram's links.

### `snapshots` + `snapshot_areas`
A milestone (`label, taken_at, gross_area`) and its measured area per space.
Only **leaf** spaces are measured.

### `settings`
Key/value app-wide defaults applied to *new* projects.

---

## 5. API surface

REST, JSON, under `/api`. Notable contracts:

- `GET /api/projects/:id` returns `{ project, spaces, snapshots, adjacencies }`
  — the whole project in one round trip (the client re-fetches this after every
  mutation; see §6 "optimistic + refetch").
- `PUT /api/projects/:id` accepts any subset of `PROJECT_FIELDS`. Fields settable
  to null (e.g. clearing an image) are written when the **key is present**, so
  the client sends explicit nulls.
- `PUT /api/spaces/:id` — presence-based for `pin_x/pin_y/pin_json/parent_id`
  (so they can be cleared). Validates parent against cycles (`parentOk`).
- `DELETE /api/spaces/:id` — recursive subtree delete via a `WITH RECURSIVE …
  UNION` CTE (see §7 gotcha).
- `GET /api/geocode?q=` → Nominatim proxy. `GET /api/tile/:z/:x/:y` → Esri World
  Imagery proxy (same-origin so the canvas stays untainted).

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

### 6.7 PDF export

`pdfExport.js` maps diagram units → mm at a fixed `0.2646 mm/unit` (true scale),
picks the smallest ISO page (A4…A0) that fits the content bounds, and draws
image layers (clipped to the frame), links, bubbles/boxes, a scale bar, a north
arrow, and a title block. **Image rotation is baked** into a rotated canvas in
`BubbleTab.bakeRotation` *before* handing it to `pdfExport` (which stays
rotation-agnostic), so exports remain scale-accurate.

### 6.8 Hierarchy (leaf-aware compute)

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
- **Legacy migration** runs once on `BubbleTab` mount: old single-image
  projects (`bg_scale` set, no `*_mpp`) are converted to the dual-layer model
  (Esri attribution → satellite layer). Guarded by `migratedRef`.
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
through `onSvgPointerDown/onMove/onUp` (which already multiplex pan / layer-move
/ calibrate / bubble-drag by mode flags). Keep new geometry in diagram units so
PDF export and scale stay correct.

**Add a tab:** add to `TABS` in `ProjectView.jsx`; non-diagram tabs render inside
a `.page` wrapper, the diagram renders full-bleed (`.project-content.full`).

---

## 9. Notes for AI agents

- **Run `npm test` and `npm run build` after edits** — the fastest correctness
  gates. `npm test` (Node's built-in runner via `tsx` for JSX) covers the pure
  helpers in `compute.js`/`scale.js`, the full REST surface against an isolated
  temp DB (`BRIEFTRACK_DB_DIR`), and the prop-driven React views rendered to
  static markup (`react-dom/server`). Add a case there when you change domain
  math, an endpoint, or a view. Note: `tsx` transforms JSX with the *classic*
  runtime, so component tests set `globalThis.React` before rendering. Then
  verify scale/alignment in the running app.
- The API server does **not** hot-reload; **restart it** after touching
  `server/*` (the preview launcher restart re-runs migrations).
- `compute.js` changes ripple into Dashboard, CSV, and the diagram — verify
  totals stay leaf-aware.
- When in doubt about scale, reason in the two invariants: **bubbles and images
  share `effScale`**, and **a scale change is a uniform zoom about the viewport
  centre**.
- Prefer additive migrations; never break an existing user's `data/` DB.
