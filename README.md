# BriefTrack

**Program compliance & area-drift tracking for architects.**

## The problem it solves

On every project, the client brief fixes a spatial program — a list of required
spaces and target areas. As the design develops (Concept → Schematic → Design
Development → CDs), designed areas inevitably drift: circulation eats into
rooms, structure thickens, value engineering trims spaces. In practice this
reconciliation is done in ad-hoc spreadsheets that go stale, and over-budget
or under-brief areas are often discovered late, when fixing them is expensive.
Brief compliance is also a contractual obligation — many briefs specify a
tolerance (e.g. ±5%) per space.

BriefTrack makes the brief the single source of truth and turns each design
milestone into a recorded snapshot measured against it:

- **Brief** — the client's agreed program, kept as its own hierarchy: buildings
  and zones that contain spaces (and spaces within spaces), in addition to
  departments. Containers roll up their descendants' areas; only leaf spaces
  carry area. Add a building, then "+ inside" to nest spaces; re-parent from the
  edit row. Areas can be **formulas** rather than fixed numbers — `@staff * 12`,
  `15% * [Adult Collection]`, `max(40, @occupants * 1.8)` — driven by project
  **variables** and references to other spaces, with a **benchmarks** library of
  typical allowances by building type and a **circulation allowance** for
  grossing up. Dated **revisions** record the brief as it gets renegotiated, and
  a **change log** tracks every programme edit.
- **Design** — the live areas that drive the diagram, held as a **separate**
  tree from the Brief so in-progress design numbers never silently overwrite
  what was agreed. Reconcile them explicitly: preview and apply the Brief onto
  the Design, or pull a single room's areas back the other way. Save named
  **design options** to compare A/B schemes against one Brief and swap between
  them.
- **Diagram — three environments, one per design stage.** The diagram is a
  pipeline of workspaces, each owning one geometry and its own mechanics, with
  independent per-environment layouts and a progress readout in the switcher:
  - **◯ Concept** — bubbles & relationships. One bubble per room, sized
    *relative* to the largest (scale-free), coloured by department or building,
    with the force layout, links (desired/required), pinning (`P`), momentary
    auto-layout (`A`) and an adjacency score graded against the layout the
    simulation aims for.
  - **▱ Master plan** — building **envelopes** on the scaled site. Each
    building is one footprint: place it from the tray (seeds a hexagonal
    outline area-locked to the **required footprint** — the biggest storey),
    reshape its outline, rotate it, and read the drawn-vs-required badge (red
    when the envelope is too small for the brief). Room relationships that
    cross buildings roll up into building-to-building links between the
    envelopes, graded in metres. No simulation — nothing moves by itself;
    overlaps warn instead of pushing apart. Flat briefs without buildings
    place rooms directly.
  - **▤ Building** — floors & massing. **Block up** lays each building's rooms
    out per floor (linked rooms seeded adjacent) inside its envelope, drawn as
    a dashed underlay. Rooms are area-locked rectangles (corner-drag resize,
    90° rotation), edited one floor at a time, with edge/corner + metric grid
    snapping, vertical-adjacency badges, a per-building stacking readout
    (click to focus a building) and stacked / 3-D overview modes.
  - **Image layers** — add as many as you like: a **satellite** layer (geocode
    an address → Esri World Imagery, auto-calibrated from map zoom) and
    **imported** site plans or surveys. Each carries its own scale calibration,
    opacity, visibility, position, **rotation** and a diagrammatic **filter**
    (grayscale, blueprint, faded, high-contrast, ink). Calibrate one by marking
    a known distance; all layers then share the diagram's scale and line up.
    Rotation and filters are baked into the sheets, so exports stay accurate.
    Layers are editable in Master plan, drawn read-only in Building, and hidden
    in Concept.
  - **Standard scales** — 1:100 / 1:200 / 1:500 / 1:1000 / 1:2000 (imperial
    equivalents on ft² projects). Rooms and all image layers draw true-to-size
    and rescale together; **positions stay fixed when the scale changes**.
  - **Project north** — drag the compass rose to set north (double-click resets
    to up); it appears on the diagram and the PDF.
  - **PDF sheets & the drawing set** — `↓ PDF` exports the open environment
    (concept diagram as an NTS sheet; master plan / floor sheets
    scale-accurate on the smallest ISO page that fits, with title block, scale
    bar and north). `↓ Set` exports the whole pipeline — concept sheet, master
    plan sheet and one sheet per floor — as a single multi-page PDF built from
    each environment's saved layout.
  - **The rail** — `A·01 Areas` lists rooms by category or by building and
    level with editable areas (rooms resize live as you type); `A·02 Adjacency`
    is the relationship schedule, and `▦ Matrix` opens the classic triangular
    grid over the same data. In Building it doubles as the stacking navigator.
  - **One room per instance** — count 3 draws three rooms, each placed and
    linked independently; adjacency links target a specific instance of each
    space.
  - **Adjacency compliance score** — a toolbar badge grades how well the layout
    honours the declared relationships (the weighted share of required/desired
    links actually placed adjacent — in metres once a scale is set, topologically
    in Concept); click it to highlight the unmet links in red.
  - **Navigation** — hold Space or right-drag to pan, wheel to zoom about the
    cursor, `0` to fit, and `Ctrl/Cmd-K` to find a room or run a command and fly
    to it. Each environment remembers its own framing.
  - **Multi-select & undo** — marquee or shift-click, then act on the whole
    selection; arrow keys nudge by 1 m (Shift = 0.1 m). Edits are undoable with
    `Ctrl+Z` / `Ctrl+Shift+Z`.
  - **Help** — a page- and environment-aware "?" panel documents every gesture.
- **Settings** — user preferences: default units (m²/ft²), default tolerance,
  and default efficiency target for new projects.
- **Milestones** — record designed net areas (from your BIM/CAD area schedule)
  at each stage issue, plus gross floor area; one click prefills every room from
  the current Design tree.
- **Dashboard** — instant program variance, per-space and per-department (or
  per-building) status against the tolerance, net-to-gross efficiency vs.
  target, a drift chart across milestones with the tolerance band, and the
  programme change log.
- **CSV export** — full area schedule (brief vs. every milestone) for client
  reports and stage sign-offs.

## Interface

A full-screen professional application (not a centered web page) in a flat
architectural **drafting** language, with **dark, light and auto** themes. A
slim top bar carries the brand and global nav; inside a project, a compact bar
carries the title, tabs and actions. The **Diagram** is the centrepiece — its
canvas fills all available space (sized to the window via a live viewBox), with
the environment switcher and its progress readout above it, the `A·01 Areas` /
`A·02 Adjacency` rail alongside, floating glass overlays for the tools, layers,
legend and scale, and one contextual action bar for whatever is selected. See
[docs/DESIGN.md](docs/DESIGN.md) for the full design language.

## Stack

- **Frontend:** React 18 + Vite (SPA; hand-rolled SVG, no UI or chart library)
  with three.js / react-three-fiber for the 3-D massing view (lazy-loaded)
- **Backend:** Express REST API
- **Database:** SQLite via Node's built-in `node:sqlite` (no native deps) —
  stored in `data/brieftrack.db`, created and seeded with a demo project on
  first run

## Run it

Requires Node ≥ 22.5 (uses built-in SQLite).

```bash
npm install
npm run dev        # API on :3001, app on http://localhost:5173
```

Production:

```bash
npm run build
npm start          # serves API + built app on :3001 (or $PORT)
```

## Tests

```bash
npm test           # Node's built-in test runner (no extra deps)
```

349 tests in `test/` cover:

- the pure domain logic — `compute.js` (hierarchy, leaf-aware rollups, units,
  CSV), `scale.js` (conversions + the zoom-about-anchor invariant), `formula.js`
  (the brief-area expression engine), `geometry.js` (hulls, power/Voronoi cells,
  area-locked outlines), `adjacency.js`, `floors.js`, `pins.js`, `textfit.js`;
- the diagram's pure modules — the selection / linking / layer-tool state
  machines, the `modes.js` snap geometry, and the `scenes.js` builders that the
  canvas and the PDF sheets share;
- API integration tests that spin the Express app up against an isolated temp
  database (`BRIEFTRACK_DB_DIR`) and exercise every endpoint, including
  parent-cycle prevention and recursive subtree deletes;
- component tests rendering the prop-driven React views to static markup via
  `react-dom/server`, plus jsdom **pointer-event** tests driving the diagram's
  interactive shell (drag, marquee, link, pan, calibrate).

JSX in the tests is transformed by `tsx` (the `--import tsx` flag in the `test`
script). `npm run lint` runs ESLint 9, and
`node --import tsx scripts/perf-bench.js` re-runs the pointer-path benchmark.
CI runs `npm test`, the build, and an API smoke test.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET/POST | `/api/projects` | list / create projects |
| GET/PUT/DELETE | `/api/projects/:id` | detail (both trees + milestones) / update / delete |
| **Design** (`spaces`) | | |
| POST | `/api/projects/:id/spaces` | add a room to the design |
| PUT/DELETE | `/api/spaces/:id` | edit / remove a room (recursive subtree delete) |
| POST | `/api/projects/:id/adjacencies` | link two room instances (upserts strength) |
| PUT/DELETE | `/api/adjacencies/:id` | change strength / remove link |
| **Brief** (`brief_spaces`) | | |
| POST | `/api/projects/:id/brief-spaces` | add a room to the brief |
| PUT/DELETE | `/api/brief-spaces/:id` | edit / remove a brief room |
| GET | `/api/projects/:id/brief-diff` | preview brief → design changes (adds/updates/deletes) |
| POST | `/api/projects/:id/apply-brief` | apply selected changes onto the design |
| POST | `/api/projects/:id/pull-to-brief` | copy one design room's programme into the brief |
| POST | `/api/projects/:id/brief-from-design` | seed the brief from the current design |
| POST | `/api/projects/:id/brief-milestone` | record the brief's areas as a milestone |
| GET/POST | `/api/projects/:id/brief-revisions` | list / take a dated brief revision |
| GET/DELETE | `/api/brief-revisions/:id` | fetch / remove a revision |
| POST | `/api/projects/:id/brief-adjacencies` | declare an adjacency requirement |
| DELETE | `/api/brief-adjacencies/:id` | remove a requirement |
| **Options & audit** | | |
| GET/POST | `/api/projects/:id/options` | list / save a design option (A/B scheme) |
| POST | `/api/projects/:id/options/:optionId/load` | swap an option into the design |
| DELETE | `/api/options/:id` | remove an option |
| GET | `/api/projects/:id/changes` | programme change log |
| **Images & misc** | | |
| POST | `/api/projects/:id/images` | upload an image layer |
| GET | `/api/images/:id/data` | image pixels as a data URL (fetched once, cached) |
| PUT/DELETE | `/api/images/:id` | edit metadata / remove a layer |
| GET/PUT | `/api/settings` | user preferences (key–value) |
| GET | `/api/geocode?q=` | address → lat/lon (Nominatim proxy) |
| GET | `/api/tile/:z/:x/:y` | satellite tile proxy (Esri World Imagery) |
| POST | `/api/projects/:id/snapshots` | record a milestone with areas |
| PUT/DELETE | `/api/snapshots/:id` | edit / remove a milestone |

Areas are stored per space line (a line with count 3 × 30 m² has a 90 m²
target, and you record the designed total for all three rooms).

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — design decisions, the data
  model, the scale/alignment math, and gotchas. Written for AI agents and
  humans extending the app; **read it before changing the diagram or schema**.
- **[docs/DESIGN.md](docs/DESIGN.md)** — the design language as built: tokens,
  type, the drafting vocabulary, and the rules for adding to it.
- **[ROADMAP.md](ROADMAP.md)** — where the project stands, what comes next, and
  the decisions already taken (with the triggers that would reopen them).

## Requirements

Node **≥ 22.5** (uses the built-in `node:sqlite`). No external database.

## Contributing

This is a single-file-DB, single-user app by design. Migrations are
**additive only** (`ensureColumn` in `server/db.js`) so existing `data/`
databases keep working. Run `npm run build` after changes; the API server does
not hot-reload, so restart it after editing `server/*`.

## License

MIT — see [LICENSE](LICENSE).
