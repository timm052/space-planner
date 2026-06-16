# BriefTrack — Roadmap

BriefTrack is a **single-user, locally-run** tool that makes the **client brief
the source of truth** and reconciles designed areas against it, with a
scale-accurate, image-aware bubble diagram for early space planning. Its future
is as a **self-contained desktop app** that architects can install and run
without Node or a server — not a hosted or multi-user product. This is where it
could go next. Items are grouped by theme and roughly ordered by
value-to-effort within each group; nothing here is committed.

## Shipped

The near-term core is now in place:

- **Undo / redo** for diagram edits (pin, move, link, shape, area, category).
- **Multi-select** on the diagram — marquee and shift-click — with batch pin,
  box, recategorise and delete, plus **group move** (drag the whole selection
  at once).
- **Bubble grouping hulls** behind each department / building.
- **Adjacency matrix view** as an alternative editor for the same adjacency
  data.
- **Snapshot diffing** — overlay two milestones to see which spaces grew or
  shrank.
- **Per-space notes & reference images**.
- **Keyboard-first editing** in the Brief tree (move, reorder, nest, edit).
- **Custom categories** — create and assign departments from the diagram, each
  with a custom colour.
- **Automated test suite** — `npm test` (Node's built-in runner) covering the
  pure domain math (`compute.js`, `scale.js`), the diagram geometry helpers
  (`geometry.js` — hull, pins, filters), the full REST API against an isolated
  temp DB, and the prop-driven React views (`react-dom/server` static markup);
  wired into CI ahead of the build.
- **Keyboard focus & motion accessibility** — visible focus rings across all
  controls, keyboard-operable project cards, `prefers-reduced-motion` support
  and themed scrollbars.
- **Adjacency compliance score** — a toolbar badge grading the weighted share of
  required/desired relationships whose bubbles are placed adjacent (judged in
  metres once a scale is set), with one-click highlighting of the unmet links.
- **Floor view modes** — for multi-level briefs the diagram switches between all
  floors together, a single floor at a time, or a stacked isometric 3D view that
  layers each floor as its own plate (pure helpers in `floors.js`, tested).

## Near term (rounding out the core)

- **Brief templates / starter programs** — seed a new project from a building-type
  template (school, library, clinic, small office) instead of a blank brief; the
  demo seed already proves the shape, so this is templated `spaces` rows.
- **Bulk brief entry** — paste a spreadsheet or import a CSV of the *program*
  (department, space, count, target) to populate the brief in one go — distinct
  from milestone import below, which brings in *measured* areas.
- **Find / quick-select spaces** — a search box (and `Cmd/Ctrl-K` palette) to
  jump to a space by name, select it on the diagram and scroll the Brief to it.
- **Colour-by status & level** — extend the diagram's colour-by beyond
  department/building to *compliance status* (over/under/on vs. the latest
  milestone) and *building level*, reusing the existing legend/colour plumbing.
- **Per-space data sheets** — build on notes/images with finishes, occupancy,
  servicing and other brief attributes per space.
- **Diagram presets** — save and reuse colour palettes, scales and layer
  setups across projects.
- **Richer PDF / export options** — page-size and title-block customisation,
  multi-page sheet sets, plus a **client-ready area schedule** (formatted
  PDF/XLSX, not just today's CSV).

## Medium term (integration & data)

- **Departmental area budgets** — set a target budget per department/building and
  track live consumption with progress gauges as you edit the brief, so over-brief
  shows up *before* a milestone is recorded (proactive vs. the reactive variance).
- **Adjacency score — next steps** — build on the shipped score: per-strength
  thresholds in Settings, a breakdown panel listing each unmet pair with its gap,
  and feeding the score into auto-layout as an objective.
- **Design options / scenarios** — branch a project's layout into A/B options and
  compare them side by side (areas, adjacency score, drift) for option studies.
- **Stacking diagram — next steps** — the diagram now has floor view modes (all /
  per-level / stacked isometric, see Shipped); extend with a true vertical
  by-level *area* chart (department area per floor) and editable layouts in the
  stacked view.
- **Import area schedules** — parse a Revit/IFC or spreadsheet export straight
  into a milestone (the milestone model is keyed by space, so a column mapping
  UI is enough).
- **DXF / DWG underlay** — accept CAD as a background layer (vector, not just
  raster), reusing the per-layer calibration model.
- **Local version history** — keep a per-project, append-only history so edits
  can be reviewed and rolled back; SQLite makes this cheap.

## Longer term (intelligence & output)

- **From bubbles to blocks** — promote the box mode into a rough mass-planning
  tool: snap boxes to a grid, stack by level, and read out gross area per floor.
- **Auto-layout suggestions** — use the adjacency graph to propose arrangements
  (force layout is already there; add constraint solving for "required"
  adjacencies and departmental zoning).
- **Code / compliance checks** — pluggable rule packs (egress distances,
  minimum room areas, accessibility) evaluated against the program.
- **Report generation** — a full project PDF/Docx (cover, area schedule,
  variance dashboard, bubble diagram, milestone drift) beyond today's
  diagram-only export.
- **Cost & carbon overlays** — attach $/m² and embodied-carbon factors per
  department for live budget and carbon estimates as areas change.
- **Annotations, dimensions & measure tool** — text notes, leader lines and
  dimension strings on the canvas, plus a quick distance/area measure on the
  calibrated background for presentation-ready diagrams.
- **Occupancy-driven area standards** — derive target areas from occupancy counts
  × area-per-person standards, so the brief can be generated from headcounts and
  re-checked against the chosen standard.

## Platform / quality

- **Desktop packaging (the headline direction)** — ship as a Tauri or Electron
  app so non-technical architects can install and run BriefTrack without Node.
  The SQLite database lives in a normal app-data location, and projects can be
  saved and opened as portable files.
- **Tests** — unit, geometry, API and view-render suites are in place (see
  Shipped). Next: an end-to-end happy path (Playwright) and coverage of the
  diagram's interactive shell (pointer/drag/RAF sim), which still needs jsdom +
  simulated pointer events or further helper extraction.
- **Type safety** — migrate to TypeScript (or JSDoc + `checkJs`) starting with
  `compute.js` and the API contract.
- **Accessibility** — full-app focus rings and keyboard-operable cards are done;
  remaining work is the diagram itself (currently pointer-driven — needs keyboard
  bubble selection/move and screen-reader semantics) and a screen-reader pass on
  the tabs and tables.
- **i18n & imperial polish** — the unit system exists; complete imperial
  formatting (feet-and-inches) and translatable strings.
- **Light theme** — the palette is fully tokenised in `:root`; add a light theme
  and a toggle (respect `prefers-color-scheme`) for bright-office / print use.

## Known limitations to address

- Background images are stored as base64 data URLs inside the project row —
  fine for local single-user use, but very large image sets would be better
  stored as files alongside the database (a natural fit once packaged as a
  desktop app).
- The force simulation runs on the main thread; very large programs (hundreds
  of rooms) would benefit from a web worker.
