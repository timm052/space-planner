# BriefTrack — Roadmap

BriefTrack today is a single-user, locally-run tool that makes the **client
brief the source of truth** and reconciles designed areas against it, with a
scale-accurate, image-aware bubble diagram for early space planning. This is
where it could go next. Items are grouped by theme and roughly ordered by
value-to-effort within each group; nothing here is committed.

## Near term (rounding out the core)

- **Undo / redo** for diagram edits (pin, move, link, shape, area). Currently
  every change persists immediately; an in-memory command stack would make
  experimentation safe.
- **Multi-select on the diagram** — marquee or shift-click to pin / box /
  delete several bubbles at once (the data model already supports per-instance
  state).
- **Bubble grouping hulls** — draw a soft convex hull behind each building /
  department so containment reads at a glance.
- **Adjacency matrix view** — the classic architect's triangular matrix as an
  alternative editor for the same `adjacencies` data.
- **Snapshot diffing** — overlay two milestones to see which spaces grew or
  shrank, reusing the existing `snapshots` model.
- **Per-space notes & images** — the `notes` column exists but is unused in the
  UI; surface it plus reference images per space.
- **Keyboard-first editing** in the Brief tree (arrow to move, tab to indent).

## Medium term (collaboration & integration)

- **Multi-user + auth** — the API is already REST/SQLite; add accounts,
  project sharing, and optimistic-locking on writes. The single biggest change
  to the data layer.
- **Realtime presence** — WebSocket layer so two people can arrange bubbles
  together; the simulation already runs per-client, so broadcasting node
  positions is the main work.
- **Import area schedules** — parse a Revit/IFC or spreadsheet export straight
  into a milestone (the milestone model is keyed by space, so a column mapping
  UI is enough).
- **DXF / DWG underlay** — accept CAD as a background layer (vector, not just
  raster), reusing the per-layer calibration model.
- **Version history** — keep a per-project audit log; SQLite makes
  append-only history cheap.

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

- **Tests** — pure helpers in `src/compute.js` and the scale math are the
  highest-value unit-test targets; add an API integration test suite.
- **Type safety** — migrate to TypeScript (or JSDoc + `checkJs`) starting with
  `compute.js` and the API contract.
- **Packaging** — ship as a desktop app (Tauri/Electron) so non-technical
  architects can run it without Node, or a hosted multi-tenant deployment.
- **Accessibility** — keyboard and screen-reader passes on the diagram
  (currently pointer-driven) and full-app focus management.
- **i18n & imperial polish** — the unit system exists; complete imperial
  formatting (feet-and-inches) and translatable strings.

## Known limitations to address

- Background images are stored as base64 data URLs inside the project row —
  fine for a single user, but should move to blob storage for sharing/scale.
- The force simulation runs on the main thread; very large programs (hundreds
  of rooms) would benefit from a web worker.
- No server-side auth or rate-limiting on the geocode/tile proxies.
