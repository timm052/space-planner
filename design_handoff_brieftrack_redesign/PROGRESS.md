# BriefTrack Redesign — Implementation Progress

Status: **complete** (all phases) plus post-review refinements. Last updated 2026-06-23.

This file records what was built to apply the redesign in this `design_handoff_brieftrack_redesign/`
bundle to the live `archi-app` React app. The phased plan lives in `docs/redesign-plan.md`.
The data layer (`compute.js`, `api.js`, server/SQLite) was reused unchanged; all "extras"
(image layers, 3D, scale tooling, floors, matrix, PDF, undo/redo) were preserved.

Verification throughout: browser preview (dark + light), DOM/computed-style checks, and the
test suite (`npm test`) — **109 tests passing**.

---

## New files
- `src/theme.jsx` — `ThemeProvider` + `useTheme`; dark/light via `data-theme` on `<html>`,
  persisted to `localStorage` (`brieftrack.theme`).
- `src/viz.js` — shared visual helpers: `darkHex(hex, amt)` (poché keylines/ink),
  `squarify(items, W, H)` (treemap), `CATEGORY_COLORS` / `BUILDING_COLORS` / `categoryColor`,
  `STATUS_COLOR` / `statusColor`.

## Phase 0 — Foundations
- `index.html`: load Inter / JetBrains Mono / Space Grotesk (with the weights the design uses).
- `src/styles.css`: replaced the single dark `:root` with **dark + light** token sets keyed by
  `data-theme`, matching the handoff palette exactly (`--bg2`, `--panel2/3`, `--accent2`,
  `--canvas-bg`, `--contour`, `--glass`, `--glass-border`, ruler/grid tokens, etc.).
- `src/main.jsx`: wrapped `<App/>` in `<ThemeProvider>`.

## Phase 1 — Shell
- `src/App.jsx`: amber 4-cell brand mark, `Brief`+amber `Track` wordmark (Space Grotesk),
  **Dark | Light** segmented toggle.
- `src/components/ProjectView.jsx` (+ CSS): project name in Space Grotesk, centred tabs,
  **mono count pills** on Brief/Milestones, active tab styling.

## Phase 2 — Dashboard + Milestones
- `src/components/Dashboard.jsx`: 4 flat **KPI cards** (`D·01`–`D·04`) with 3px status accent
  bars, mono tags, Space Grotesk values; `D·06` by-category rollup; `D·07` flagged spaces as a
  **dotted-leader** schedule. (Building rollup + milestone comparison moved off the Dashboard.)
- `src/components/DriftChart.jsx`: restyled to the flat SVG (`D·05`) — amber target line, faint
  ±tolerance band, status-coloured dots, mono labels, `BRIEF TARGET … ±N%` annotation.
- `src/components/SnapshotsTab.jsx` (Milestones): `M·01` milestone cards (status bar, variance
  badge, net + gross/efficiency mini-stats, latest highlighted) and `M·02` change schedule
  (dotted-leader rows, ▲/▼ deltas). Snapshot CRUD preserved.
- Shared CSS vocabulary added to `styles.css`: `.screen`, `.sec-head/.sec-tag/.sec-title`,
  `.flat-card`, `.kpi-*`, `.dl-row` (dotted leader), `.rollup-*`, `.ms-*`.

## Phase 3 — Brief
- `src/components/BriefTab.jsx`: **view toggle** `▦ Treemap | ≣ Schedule` (treemap default).
  - **Treemap** via `squarify` + `ResizeObserver` (with a synchronous initial measure to avoid a
    StrictMode 0-width miss); flat category tiles, poché inset dividers, `darkHex` ink, 2-line
    name clamp, labels hidden on small tiles, `title` tooltips, click/shift-click selection.
  - **Schedule**: existing editable hierarchical table kept intact.
  - **Summary sidebar**: `B·01` Σ net-target **medallion** (contour rings), `B·02` area-by-category
    split bar + dotted-leader rows, `B·03` by-building rows (correct building colours).
- CSS: `.brief-layout`, `.seg` toggle, `.treemap-*`, `.medallion-*`, `.split-bar`.

## Phase 4 — Diagram (`src/components/BubbleTab.jsx`)
Visual language:
- Flat **matte rooms** (solid `'solid'` style): fill + poché keyline `darkHex(color,.4)` (white
  when selected) + dark ink labels `darkHex(color,.62)`, Space Grotesk names.
- **Topographic contour rings** replace the grid (concentric ellipses per cluster centroid).
- **Dashed building hulls** (`stroke-dasharray 2 7`) with letter-spaced caps labels.
- **Flat links**: required = solid hairline (`--text`), desired = fine dotted, selected/
  connected = cyan (`--accent2`).
Interaction model (the deliberate redesign):
- **Left tool dock**: Select (V) · Link (L) · Auto-layout (A) · Recenter, with hotkey badges.
- Two modes; **Link mode** = click two rooms to connect (default desired).
- **Hold-Space = transient pan** (empty-canvas drag stays marquee).
- **One contextual action bar** (bottom-centre glass), three forms: single room
  (Pin/Box/Shape/Category/⌫) · multiple rooms (Pin all/Box all/Shape all/⌫) · link selected
  (Desired|Required toggle + Remove).

## Phase 5 — Polish
- Removed the legacy hyphenated token aliases; migrated all CSS to the new token names.
- `src/components/HelpPanel.jsx`: two-column **Mouse / Keyboard** shortcuts block with the new
  keymap; corrected stale link/pan/multi-select copy.
- Restyled the Diagram **right rail** to the "program takeoff": `A·01 AREAS` (square swatches,
  dotted-leader rows, mono totals, Building|Category toggle), `A·02 ADJACENCY` (`N req · N des`,
  drafting-line glyphs) and a **Σ net-total medallion** footer. Inline area-editing preserved.
- **Cross-screen selection sync** (Diagram ↔ Brief): shared `selectedSpaceId` lifted into
  `ProjectView`. BubbleTab syncs inbound via an effect and outbound via `pickSpace()/clearPick()`
  at the actual selection points. NOTE: do **not** add an outbound `useEffect` on `selected` — it
  render-loops; the event-driven approach is intentional.

---

## Post-review refinements

### Toolbar rebuilt to match the reference
The wide button bar was replaced with floating glass clusters on a full-height canvas:
- **Top-left controls**: `COLOUR [Category|Building]` · `FLOORS` · `SCALE` · `⧉ Layers` · `⋯ More`.
- **Top-right actions**: `↶ ↷` · `● NN% adjacency` badge · `↓ PDF` · `?`.
- Legend sits just below the controls; tool dock on the left edge.
- The extras (Style, All boxes, Category hulls + padding, Adjacency matrix, side-panel toggle,
  stacked/3D camera, site-image-on-floors) moved into the **⋯ More** popover.

### Force system reworked (`src/hooks/useSimulation.js`)
Problem: buildings slowly drifted to the screen edges (an earlier version anchored clusters to
points spread `W×1.15` — i.e. off-screen).
- **Buildings barely move**: each cluster captures a **"home" centroid** on first settle; a gentle
  *home-restoring* force returns the cluster toward home, plus light cohesion to hold its shape.
  Self-stabilizing → no drift (verified 0 px over 4 s).
- **Rooms move freely**: collision/charge, adjacency springs, sibling springs.
- Clustering is **by building** (matches hulls/contours), independent of the colour mode
  (`clusterKey` in BubbleTab).
- **Cluster-aware spawn**: rooms spawn around per-building centres spread horizontally on-screen,
  so buildings start separated rather than bunched.
- **Two user sliders** in ⋯ More → "Auto-layout forces": **Rooms** and **Buildings** (0–150%,
  defaults 100% / 50%), persisted to `localStorage` (`brieftrack.nodeforce` /
  `brieftrack.buildingforce`), re-energizing the sim live.

---

## Notes / gotchas for future work
- The demo project carries an imported **site image** (currently a photo) that overlays the
  contour field; hide it via **⧉ Layers** for the clean drafting look. It is user data, left visible.
- The preview screenshot tool intermittently hangs on the WebGL/glass-heavy Diagram; restarting
  the dev server clears it. DOM/computed-style checks were used as the reliable fallback.
- Nothing has been committed yet — all changes are in the working tree under `src/` and `index.html`.
- Tests that encode redesigned components live in `test/components.test.js` (Dashboard, DriftChart,
  Milestones); update them alongside those components.
