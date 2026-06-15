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
- **Automated test suite** — `npm test` (Node's built-in runner, no extra deps)
  covering the pure domain math (`compute.js`, `scale.js`) and the full REST API
  against an isolated temp DB; wired into CI ahead of the build.
- **Keyboard focus & motion accessibility** — visible focus rings across all
  controls, keyboard-operable project cards, `prefers-reduced-motion` support
  and themed scrollbars.

## Near term (rounding out the core)

- **Per-space data sheets** — build on notes/images with finishes, occupancy,
  servicing and other brief attributes per space.
- **Diagram presets** — save and reuse colour palettes, scales and layer
  setups across projects.
- **Richer PDF / export options** — page-size and title-block customisation,
  multi-page sheet sets.

## Medium term (integration & data)

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

## Platform / quality

- **Desktop packaging (the headline direction)** — ship as a Tauri or Electron
  app so non-technical architects can install and run BriefTrack without Node.
  The SQLite database lives in a normal app-data location, and projects can be
  saved and opened as portable files.
- **Tests** — unit + API suites are now in place (see Shipped). Next: component
  tests for the React tabs (Testing Library + jsdom) and an end-to-end happy
  path; the diagram's pointer/sim logic is the largest remaining gap.
- **Type safety** — migrate to TypeScript (or JSDoc + `checkJs`) starting with
  `compute.js` and the API contract.
- **Accessibility** — full-app focus rings and keyboard-operable cards are done;
  remaining work is the diagram itself (currently pointer-driven — needs keyboard
  bubble selection/move and screen-reader semantics) and a screen-reader pass on
  the tabs and tables.
- **i18n & imperial polish** — the unit system exists; complete imperial
  formatting (feet-and-inches) and translatable strings.

## Known limitations to address

- Background images are stored as base64 data URLs inside the project row —
  fine for local single-user use, but very large image sets would be better
  stored as files alongside the database (a natural fit once packaged as a
  desktop app).
- The force simulation runs on the main thread; very large programs (hundreds
  of rooms) would benefit from a web worker.
