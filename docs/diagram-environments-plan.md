# Diagram decomposition — three environments, one canvas each

## Why

Today one view (`BubbleTab.jsx`, ~1,950 lines) mixes three geometries in the same
space — bubbles, boxes, and custom polygons — with one set of mechanics stretched
over all of them:

- **Shape is just an attribute.** `spaces.shape` is `'bubble' | 'box' | 'poly'`
  (server/db.js), toggled per space with B / the HUD. Any project can be an
  arbitrary mix, and every tool has to cope with every geometry.
- **One force sim for everything.** `useSimulation` treats every shape as a
  circle (`radiusOf`). Boxes and polygons collide, spring and drift like
  bubbles — which is right for concept diagramming and wrong for a drawn site
  plan, where a placed shape must never move by itself.
- **One toolbar for three workflows.** Force sliders (concept mechanics) sit
  next to satellite fetch / calibration / north (site mechanics) next to floor
  modes / 3-D (building mechanics). Each stage of work only needs a third of it.

The fix is to split the diagram into **three environments**, each owning one
geometry and the mechanics that suit it, mapped to the design stages the app
already knows about (`projects.stage` defaults to `'Concept'`):

| Environment    | Stage it serves | Geometry                  | Core mechanic                     |
| -------------- | --------------- | ------------------------- | --------------------------------- |
| **Concept**    | briefing, early | bubbles (circles)         | force-directed, relationships     |
| **Master plan**| site planning   | custom shapes (polygons)  | direct manipulation on a scaled site |
| **Building**   | massing         | boxes (blocks)            | snap, floors, stacking            |

## The three environments

### 1. Concept — the relationship diagram (bubbles)

Purpose: get the program's relationships right before geometry exists.
Everything is a circle; nothing has a fixed footprint yet.

**Keeps (this is the current sim-driven behaviour):**
- Force simulation: adjacency springs, cluster cohesion, collision, momentary
  auto-layout (A), relax-on-drop, drag-saves-position, pin/lock (P).
- Link tool (L), adjacency matrix, link strength cycling, selected-link HUD.
- Colour by category / building, custom colours, legend, category hulls,
  building hulls, hull size.
- Multi-select (marquee / shift), batch categorise, batch pin, group drag.
- Force sliders (room / building strength) — they only mean something here.
- Split rail (areas + relationships), undo/redo, PNG export.

**Loses (moves out):**
- Box / custom-shape conversion (B key, shape buttons, "convert all").
- Vertex editing, area-locked polygon solver.
- Satellite / image layers, calibration, scale presets, scale bar, north rose.
  (Option: allow ONE faint reference image, view-only, for orientation — no
  calibration UI.)
- Floor modes and 3-D.

**Gains:**
- Scale-free by design: radius stays relative (`16 + 50·√(area/max)` path);
  the "adjacency score in metres" belongs to master plan. A topological
  compliance hint (linked bubbles touching or not) can stay.
- A **"Promote to master plan"** action per building / selection (see flows).

### 2. Master plan — the scaled site drawing (custom shapes)

Purpose: place real footprints on a real site at a real scale. Shapes are
*drawn*, so nothing may ever move unless the user moves it.

**Keeps:**
- Custom polygon geometry: the smooth area-locked outline, vertex drag/add/
  remove (`solveAreaLockedVertex`), the live area badge.
- All image-layer machinery: upload, satellite fetch, per-layer opacity /
  filter / move / rotate, two-point calibration, layer panel.
- Scale presets + scale bar, north rose, attribution, site contours.
- Scaled PDF export with title block (ratio label, north, scale bar).
- Multi-select, group drag, undo/redo, split rail.

**Loses:**
- The force simulation entirely — no springs, no auto-layout, no drift.
  Every position is authored. (`relaxRef`, `alphaRef`, force sliders gone.)
- Pin/lock as a concept: everything behaves as pinned. P becomes redundant —
  or is repurposed as "lock against accidental drag".

**Gains (new mechanics this geometry earns):**
- **Shape rotation** (drag handle or R + drag), mirroring — polygons need
  orientation on a site; bubbles never did.
- **Nudge with arrow keys** (scaled: 1 m / 0.1 m with modifiers) — precision
  placement is the point of this environment.
- **Optional snap:** shape-edge to shape-edge, and to a metric grid derived
  from the calibrated scale.
- **Collision as a *warning*, not a force**: overlapping footprints get a
  hatched overlap region / red edge instead of being pushed apart.
- **Adjacency as an overlay:** the metric compliance score and unmet-link
  highlighting live HERE (they already require `effScale`); links render as
  read-only guides — no link editing tool needed (edit relationships in
  Concept or the matrix).
- "Everything is a bubble until placed": spaces not yet drawn appear in a
  side tray (or as ghost circles at their concept positions) and are *placed*
  onto the site, converting to a default polygon on drop.

### 3. Building — the massing model (boxes)

Purpose: stack the program into buildings — floors, blocks, gross area per
level. This is the roadmap's "from bubbles to blocks" made into its own room.

**Keeps:**
- Box geometry (equal-area squares today → real rectangles, below).
- Floor machinery: level assignment, per-level filtering, offset / overlaid
  stacked isometric, the 3-D WebGL view, floor gap, cameras, cross-floor
  link rendering.
- Multi-select, undo/redo, PNG export (incl. WebGL grab).

**Loses:**
- Force sim (same reasoning as master plan), bubbles and polygons,
  satellite/calibration UI (a single calibrated footprint underlay from the
  master plan is enough — view-only).

**Gains:**
- **Rectangles, not just squares:** boxes get `w × h` (area-locked: dragging
  one edge adjusts the other to hold the target area) + 90° rotation.
- **Grid snap + alignment guides** (edges/centres of neighbours) — boxes want
  orthogonal discipline, the opposite of the bubble sim.
- **Per-floor editing as the default mode** (the current "single floor"
  filter becomes the primary state; "all" is the overview).
- **Stacking readouts:** gross area per floor per building in the rail; a
  vertical by-level area chart (roadmap item) fits naturally here.
- **Vertical adjacency:** interfloor links scored/highlighted (stair/lift
  adjacency is a real brief requirement).
- Editable layouts in the stacked view (roadmap item) — drag a box on its
  iso plane.

## Where existing UI lands

| Existing control | Goes to |
| --- | --- |
| Force sliders, auto-layout (A), bubble style, hull toggle/size | Concept |
| Link tool (L), matrix | Concept (matrix also readable elsewhere) |
| Layers popover, satellite panel, calibrate, move/rotate layer | Master plan |
| Scale presets, scale bar, north rose, attribution | Master plan (scale/north also shown read-only in Building) |
| Floor switcher, offset/overlaid/3-D, floor gap, cameras, ⊞ images | Building |
| Adjacency score badge + gap highlighting | Master plan (metric) · Building (per-floor/vertical) · Concept (topological hint only) |
| B (box toggle), shape convert buttons, "convert all" | Removed — geometry is decided by environment, not per space |
| Pin (P) | Concept only (Master plan/Building are always-authored) |
| Select tool, marquee, shift-click, group drag, undo/redo, recentre, PNG/PDF | Shared shell |

## Data model

### Layouts become per-environment

Today one `pin_json` holds the single mixed layout. Concept positions
(relationship-optimised) and master-plan positions (site-accurate) are
different truths and must not overwrite each other.

- `spaces.pin_json` → keep for **concept** (unchanged semantics: saved pos +
  optional `locked`).
- New `spaces.plan_json` — master-plan placement per instance:
  `{ [i]: { x, y, rot } }`. Presence in `plan_json` = "placed on the site".
- New `spaces.block_json` — building placement per instance:
  `{ [i]: { x, y, w, h, rot } }` (level stays in `spaces.level`).
- `spaces.shape` / `shape_json`: `shape` column becomes **legacy** (used only
  by migration); `shape_json` keeps the polygon outline and is owned by the
  master-plan environment.
- `projects`: add `diagram_env TEXT DEFAULT 'concept'` (last-open
  environment). Per-env view offsets: reuse `view_x/view_y` for concept, add
  `plan_view_json` / `block_view_json` (or one `views_json`).

Additive `ensureColumn` migrations — same pattern the schema already uses.

### One-time migration of existing projects

- Every space keeps its current positions as **concept** layout (no change).
- `shape='poly'` spaces: copy current position+outline into `plan_json` (they
  were clearly being site-planned).
- `shape='box'` spaces: copy position into `block_json` as an equal-area
  square (the current rendering), level from `spaces.level`.
- Nothing is deleted; switching to Concept always works for old projects.

## Component architecture

Target shape (the branch is already named `refactor/diagram-decomposition`):

```
components/diagram/
  DiagramShell.jsx        ← owns: env switcher, viewport, tick store, selection
                             machine, history, rail, export, error popover
  envs/
    ConceptEnv.jsx        ← sim hook, link tool, force UI, hulls/contours
    MasterPlanEnv.jsx     ← layers/satellite/calibrate, poly editing, snap/nudge
    BuildingEnv.jsx       ← floors, boxes, snap, stacked/3-D
  canvas/
    ConceptCanvas.jsx | PlanCanvas.jsx | BlockCanvas.jsx
      (each a TickLayer; shared primitives — Label, SelectionRings, ScaleBar,
       ImageLayerGroup — extracted from today's DiagramCanvas)
```

Each env plugs three things into the shell:

1. **a pointer controller** — the env-specific slice of today's
   `onSvgPointerDown / onMove / onUp / onBubbleDown` switchyard
   (drag-with-relax vs. drag-static-with-snap vs. drag-on-floor-plane);
2. **a canvas** (what renders per tick);
3. **toolbar/HUD config** (which buttons exist, what the action bar offers).

Shared and unchanged: `selection.js`, `linking.js`, `layerTools.js`,
`geometry.js`, `scenes.js`, `useViewport`, `useTick`, `useHistory`,
`useImageData`, prefs. `useSimulation` becomes Concept-only.

The env switcher is a segmented control in the stage topbar
(`◯ Concept · ▱ Master plan · ▤ Building`), persisted per project; default
could follow `projects.stage`.

## Promotion flows (what ties the environments together)

- **Concept → Master plan ("Place")**: entering Master plan with un-placed
  spaces shows them as ghost bubbles at their concept positions; clicking
  "place" (or dragging one from the tray) writes `plan_json` and seeds a
  default hexagon outline scaled to the target area. Concept layout is the
  *seed*, never the live position.
- **Master plan / Concept → Building ("Block up")**: per building, generate
  equal-area rectangles per space grouped by level, laid out in a snap grid;
  user then arranges per floor.
- Areas always flow from the brief (single source of truth) — an area edit in
  the rail re-locks every environment's geometry to the new target, exactly
  as `areaUnits` does today.

## Phases

Pause for review after each phase (verify in the browser preview, both themes).

**Phase 0 — Extract the shell (no behaviour change).**
Split `BubbleTab.jsx`: shell (viewport/selection/history/rail/export) vs.
sim vs. layer-tools vs. poly-editing pointer logic, each into its own
hook/module. All three geometries still co-exist. This de-risks everything
after it; the existing view-render tests must stay green.

**Phase 1 — Environment switcher + Concept env.**
Add `diagram_env`, the segmented control, and make Concept the current
behaviour *minus* boxes/polys/layers/floors (spaces with plan/block data
still render as bubbles here). Feature-gate rather than delete — Master plan
and Building temporarily fall back to the mixed view.

**Phase 2 — Master plan env.**
`plan_json` + migration; static drag, nudge, rotate, snap; placement flow for
un-placed spaces; move layers/satellite/calibration/scale/north UI in;
overlap warning; metric adjacency overlay + score. Remove poly rendering
from Concept.

**Phase 3 — Building env.**
`block_json` + migration; rectangles with area-lock + snap + guides;
per-floor editing default; move floor modes/3-D in; per-floor area readouts.
Remove boxes from Concept/Master plan; delete the legacy `shape` toggle UI
(B key, convert-all).

**Phase 4 — REVISED (2026-07-08): pipeline, envelopes, block-up, output.**
The original Phase 4 ("promotion flows + polish") was rethought before
implementation — see **"Phase 4 revision"** below for the full model. In short:

- **4a — Pipeline + capability table.** One declarative `ENV_CAPS` table
  replaces the scattered `isConcept`/`isStatic` gates; the env switcher shows
  per-env progress (placed / blocked counts); per-env empty states.
- **4b — Building-envelope master plan.** When the brief has buildings, Master
  plan operates on building ENVELOPES (container rows carry `plan_json` +
  `shape_json`), with a drawn-vs-required footprint badge. Flat programs keep
  room-level placement.
- **4c — Envelope-constrained Building + Block up.** Per-building focus, the
  MP envelope as a fixed underlay, and an adjacency-seeded per-floor grid
  seeder for unblocked rooms.
- **4d — Drawing-set export + help overhaul.** Env-correct single exports
  (Concept = NTS, no site image) plus a multi-page drawing set (concept sheet ·
  master plan sheet · per-floor building sheets) built from persisted layouts;
  env-aware HelpPanel; ROADMAP/README updates.
- Then a **3-D alignment + look-and-feel pass** (real rectangles in
  stacked/3-D, building focus, envelope on the ground plane).

## Phase 4 revision — pipeline + building envelopes (2026-07-08)

Phases 0–3 delivered the three environments, but all three still operate on the
same unit — individual rooms — and the env switcher reads as three parallel
tabs when the reality is a pipeline (brief → relationships → site → massing).
The revision makes the three environments answer three genuinely different
questions: *what relates to what* → *what fits where on the site* → *what
stacks inside each building*.

### 4a — Make the pipeline visible; declare capabilities

- **`ENV_CAPS` capability table.** The ~25 scattered env gates
  (`isConcept && …`, `!isStatic`, …) collapse into one declarative table:
  geometry, sim, layers (edit/view/none), floors, pin, forces, snap, scale UI,
  rotate mode, resize, shape tools, tray. One lookup per gate; the env
  differences become readable in one screen; a future fourth env is a table
  row. (The plan's original DiagramShell/env-component split is DROPPED — the
  flag-shell + hooks architecture from Phase 0–3 proved out; the table gives
  most of the remaining benefit at a fraction of the churn.)
- **Pipeline status in the switcher.** Each segment gains a live sub-status:
  Concept = room count, Master plan = placed/total (buildings or rooms),
  Building = blocked/total rooms. The switcher becomes a progress readout, not
  just a mode toggle.
- **Per-env empty states.** Master plan without a calibrated image/scale
  prompts "add a site plan / satellite and calibrate"; Building without levels
  hints at assigning levels in the Brief. Dismissable, shown on the stage.
- Staleness badges from the rethink are NOT needed: every geometry is
  area-locked to the brief, so area edits already re-fit all environments.
  The one real divergence — envelope drawn vs required — is handled in 4b.

### 4b — Master plan operates on building envelopes

When the brief has buildings (containers), the master plan's draggable objects
become the **buildings**, one footprint each:

- **Data: zero schema change.** An envelope lives on the container space's own
  row — `plan_json` slot `{ x, y, rot, a }` (a = drawn footprint area in
  diagram units²) + `shape_json` (normalized outline, default hexagon). All
  the Phase 2 poly machinery (area-locked vertex editing, free rotation, snap,
  overlap warning, ghosts/tray) transfers unchanged.
- **Required footprint** = max per-level area sum across the building's leaves
  × an efficiency factor (default 1.0 for now). The envelope seeds at that
  area; vertex edits stay area-locked to the DRAWN area (`slot.a`), which the
  user can change via an area field in the selection HUD.
- **Drawn-vs-required badge**: the envelope's area badge shows
  `drawn / required` and turns red when drawn < required — a live feasibility
  check, and the master plan's answer to staleness (when the brief grows, the
  deficit shows immediately).
- **Flat programs** (no containers) keep today's room-level master plan —
  nothing regresses.
- Adjacency in envelope mode is between buildings (links aggregated between
  containers) — deferred if noisy; room-level links simply don't render.

### 4c — Building constrained by the envelope; Block up

- **Per-building focus**: the stacking rail becomes the navigator — clicking a
  building header focuses the Building env on it (other buildings fade).
- **Envelope underlay**: the focused building's MP envelope renders at its
  plan position/rotation as a fixed outline; rooms are arranged inside it.
- **Block up**: for a focused building (or all), rooms without `block_json`
  seed per floor as a packed grid inside/near the envelope, ordered by concept
  adjacency (strongly-linked rooms adjacent — the sim's knowledge reused as a
  one-shot seeder). Replaces silent seed-on-entry as the *visible* promotion.
- **Fit feedback**: per floor, Σ room areas vs envelope area (rail readout).

### 4d — Output as a drawing set; help that matches reality

- **Env-correct single exports**: Concept PDF is NTS — no site layers, no
  north, no scale bar (today it wrongly includes them when a scale exists).
- **Export set**: one multi-page PDF — concept sheet (NTS) · scaled master
  plan sheet (envelopes) · per-floor building sheets — built from PERSISTED
  layouts (`pin_json` / `plan_json` / `block_json`), so it works from any env.
  `pdfExport.js` refactors into `renderScene(doc, scene)` + a set wrapper.
- **HelpPanel** becomes env-aware and drops stale content (B/S keys,
  "auto-layout on/off"); ROADMAP/README updated.

### 3-D pass (after 4a–4d)

Stacked / 3-D views still draw boxes as equal-area squares — they gain the
real `w × h` rectangles + 90° rotation, the building focus filter, and the
envelope footprint on the ground plane; plus a general look-and-feel pass.

## Risks / notes

- `pin_json` stays backward-compatible; new columns are additive — old DBs
  open fine, and the migration only *copies* data.
- The pointer switchyard in BubbleTab is the tangliest part; Phase 0 is
  deliberately "move, don't change" so diffs stay reviewable.
- The module-level `layoutCache` must become per-environment
  (`projectId:env`) or Concept and Master plan will bleed positions.
- Tests: geometry/selection/linking suites are unaffected; view-render tests
  need a light update when BubbleTab's export moves to DiagramShell.
- Undo history should clear on env switch (closures capture env-specific
  helpers) — same rule as the existing project-switch clear.

## Open decisions

1. **Independent layouts per env** (recommended, as specced) vs. one shared
   position set. Shared is simpler but master-plan accuracy would be
   destroyed by any concept auto-layout pass.
2. Env switcher = free tabs remembered per project (recommended) vs. hard
   lock to `projects.stage`.
3. Does Master plan allow rectangles too, or is "polygon covers everything"
   enough? (Recommended: polygon-only; a rectangle is just a 4-vertex poly.)
4. Should Concept keep a single faint reference image, or be fully abstract?

## Phase 5 — Concept ⇄ Master plan workflow upgrades (SHIPPED 2026-07-09)

Four user-reported gaps in the concept → master plan pipeline. All four
batches implemented and browser-verified (200 tests, eslint clean).
Deviations from the spec below: the stacked-SVG view keeps its stylised
uniform lift (real heights live in the WebGL 3-D view, which needs the
drawing scale — no scale → legacy uniform heights); the hull match still
simplifies to 12 editable vertices; Voronoi cell areas cap at the room's
net target when circulation is on, so a too-small envelope reads as cells
short of their targets plus the red envelope badge.

### 5a — Concave concept hulls (hug the profile)

The concept hull (buildings, categories, site contours, and the envelope
"⬡ Hull" match) is a **convex** hull over 8 padded samples per bubble, so any
non-convex arrangement (an L of rooms, two clusters) wraps a lot of dead area
into the building.

- **`concaveHull(points, maxEdge)` in geometry.js** — start from `convexHull`,
  then repeatedly "dig" any hull edge longer than `maxEdge`: replace it with a
  detour through the interior sample point nearest the edge's midpoint, unless
  that would self-intersect or create a sliver. Deterministic, dependency-free,
  unit-testable (dumbbell layout → waisted outline; area ≤ convex area; no
  self-intersection; falls back to the convex hull for convex inputs).
- `maxEdge` derives from the bubbles themselves (≈ 2× the median padded room
  diameter), so the outline digs between clusters but never between adjacent
  rooms. `hullPad` (existing slider) stays the "not too close" control.
- Swap in everywhere the canvas builds hulls (building hulls, category hulls,
  site-contour base shape) **and** in `conceptHullOutline` (BubbleTab), so the
  envelope-from-hull match produces the same tighter footprint the user sees.
  Bubble circle sampling goes 8 → 16 angles for a smoother dig. The frozen
  legacy tab keeps plain `convexHull`.

### 5b — Voronoi interior in the envelope master plan

While placing envelopes the rooms vanish; bring them back as a **Voronoi
partition of each envelope**, seeded by the rooms' concept positions — a live
sketch of the internal layout that stays consistent with the concept diagram.

- **Geometry (pure, in geometry.js):** `clipHalfPlane(poly, p, q)`
  (Sutherland–Hodgman against the p–q perpendicular bisector) and
  `voronoiCells(seeds, boundary)` → one clipped cell polygon per seed.
  O(n²) half-plane clips — trivial for tens of rooms; no new dependency.
- **Seed mapping (the bidirectional link).** A room's seed = its concept
  position (pin_json ?? concept layout cache) pushed through the same transform
  the "⬡ Hull" match implies: subtract the building's concept-hull centroid,
  scale by √(envelopeAreaUnits / hullArea), rotate by the envelope's `rot`,
  translate to its plan position. Seeds that land outside the envelope (e.g.
  hexagon envelope never hull-matched) clamp to the nearest interior point.
- **Editing back:** seeds render as draggable handles; dragging one
  inverse-maps to concept coordinates and writes **pin_json** — so the move is
  visible in Concept immediately. Consequence (by design): editing a seed
  *pins* that room in Concept, otherwise the sim would erase the edit.
  Cell shading = category/building colour (colorOf), label + cell area at the
  cell centroid, with the room's target area alongside (cell m² vs brief m² —
  a free fit readout).
- **Scope:** envelope master plan only (flat room-level MP already shows
  rooms). All of a building's rooms seed its diagram (matching what the
  concept hull wraps, levels flattened) — a per-level filter can come later.
  Toggled by a new MP toolbar eye ("Interior") pref, on by default; OFF in
  exports until it proves itself.

### 5c — Floor heights + per-space heights

Today the 3-D/stacked views use a fake uniform storey height and spaces have
no vertical dimension at all.

- **Schema (additive):** `projects.level_heights` TEXT — JSON map
  `{ "<level label>": metres }`, default 3.5 m per storey when absent;
  `spaces.height_m` REAL — optional per-space clear height (null = inherit the
  floor's). A space taller than its storey reads as a high/double-height
  volume and renders through the storeys above it.
- **UI:** the Building rail's Stacking section gains a small height input per
  level row (project-wide per level; per-building overrides deferred).
  Per-space height lives with the other space fields in the Brief editor
  (next to Level / storey) and as a field in the Building SelectionHud.
- **Consumers:** `buildStackScene`/`build3DScene`/`Stacked3D` take real storey
  heights (scaled like plan distances) instead of the uniform
  `gapY`-derived slab; a room with `height_m` extrudes to its own height from
  its floor's base — multi-floor spaces (halls, atria) finally look like it.
  Vertical adjacency, plan views and PDFs are unaffected (plan-view data).

### 5d — Optional circulation

Circulation exists nowhere today (the envelope's required footprint hardcodes
efficiency 1.0 — a known gap). Two complementary, both optional forms sharing
**one number per building**:

- **`spaces.circ_pct` REAL on container rows** (null = project default derived
  from `grossing_target`, 0 = off). Editable in the envelope HUD next to the
  area input.
- **Required footprint** becomes `footprintPU(c) / (1 − circ_pct)` — the
  envelope badge / Building rail chips finally demand room for corridors.
- **Voronoi interior (5b):** each cell shrinks toward its seed so its area is
  the room's net target; the interstitial band renders as hatched
  "circulation", and its m² shows in the rail. Cells simply fill the envelope
  when circulation is off.
- Explicit circulation *spaces* (stairs, lift cores) need no new mechanics —
  they're ordinary brief rows and already work in every environment.

Open decisions (confirm before implementation): 5b all-levels-flattened
default; 5c project-wide (not per-building) level heights; 5d single
percentage rather than explicit corridor drawing.
