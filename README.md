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

- **Brief** — the client's program as a **hierarchy**: buildings/zones that
  contain spaces (and spaces within spaces), in addition to departments.
  Containers roll up their descendants' areas; only leaf spaces carry area.
  Add a building, then "+ inside" to nest spaces; re-parent from the edit row.
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
  - **Two independent image layers** — a **satellite** layer (geocode an
    address → Esri World Imagery, auto-calibrated from map zoom) **and** an
    **imported** site-plan/survey layer, each with its own scale calibration,
    opacity, visibility, position and **rotation**. Calibrate either by marking
    a known distance; both then share the diagram's scale and line up. "Move"
    nudges a layer; "Rotate" turns it (e.g. to square the satellite up to
    north). Rotation is baked into the PDF so the export stays accurate.
  - **Standard scales** — 1:200 / 1:500 / 1:1000 / 1:2000 (imperial equivalents
    on ft² projects). Bubbles and all image layers draw true-to-size and
    rescale together; **bubble positions stay fixed when the scale changes**.
  - **Project north** — drag the compass rose to set north (double-click resets
    to up); it appears on the diagram and the PDF.
  - **PDF sheets & the drawing set** — `↓ PDF` exports the open environment
    (concept diagram as an NTS sheet; master plan / floor sheets
    scale-accurate on the smallest ISO page that fits, with title block, scale
    bar and north). `↓ Set` exports the whole pipeline — concept sheet, master
    plan sheet and one sheet per floor — as a single multi-page PDF built from
    each environment's saved layout.
  - **Split view** — a side panel lists rooms grouped by department/building
    with editable areas; bubbles resize live as you type.
  - **Pan** — view locked by default; toggle pan to drag the canvas. Bubbles are
    not clamped to the viewport.
  - **One bubble per room** — count 3 draws three clustered bubbles, each
    pinnable; adjacency links connect the closest pair of rooms.
  - **Floor view modes** — when the brief uses building levels, switch the
    diagram between **all floors** together, **one floor at a time**, or a
    **stacked axonometric** — each floor an isometric plane with its rooms (and
    the site image, warped to match the perspective) lying on it, tied together
    by dashed corner guides. Floors can be **offset** apart or **overlaid** on
    one plane to compare footprints.
  - **Adjacency compliance score** — with a scale set, a toolbar badge grades how
    well the current layout honours the declared relationships (the weighted share
    of required/desired links whose bubbles are actually placed adjacent); click
    it to highlight the unmet links in red.
  - **Help** — a "?" panel documents every gesture and feature.
- **Settings** — user preferences: default units (m²/ft²), default tolerance,
  and default efficiency target for new projects.
- **Milestones** — record designed net areas (from your BIM/CAD area schedule)
  at each stage issue, plus gross floor area.
- **Dashboard** — instant program variance, per-space and per-department (or
  per-building) status against the tolerance, net-to-gross efficiency vs.
  target, and a drift chart across milestones with the tolerance band.
- **CSV export** — full area schedule (brief vs. every milestone) for client
  reports and stage sign-offs.

## Interface

A full-screen professional application (not a centered web page): a slim top
bar with the brand and global nav, then a work area that fills the viewport.
Inside a project, a compact bar carries the title, tabs and actions. The
**Diagram** is the centrepiece — its canvas fills all available space (sized
to the window via a live viewBox) with the editable **Areas** and
**Relationships** rail alongside it, and floating overlays for layers, legend
and scale so nothing steals canvas. The same size hierarchy (most-important
element largest) is applied across the dashboard, brief and milestones.

## Stack

- **Frontend:** React 18 + Vite (SPA, SVG charts, no chart library)
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

The suite (`test/`) covers the pure domain logic in `compute.js` (hierarchy,
leaf-aware rollups, units, CSV) and `scale.js` (scale conversions + the
zoom-about-anchor invariant); API integration tests that spin the Express app up
against an isolated temp database (set via `BRIEFTRACK_DB_DIR`) and exercise
every endpoint, including parent-cycle prevention and recursive subtree deletes;
and component tests that render the prop-driven React views (Dashboard,
DriftChart, ProjectList) to static markup via `react-dom/server` and assert on
the output. JSX in the tests is transformed by `tsx` (the `--import tsx` flag in
the `test` script). CI runs `npm test` before the build.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET/POST | `/api/projects` | list / create projects |
| GET/PUT/DELETE | `/api/projects/:id` | detail (brief + milestones) / update / delete |
| POST | `/api/projects/:id/spaces` | add a space to the brief |
| PUT/DELETE | `/api/spaces/:id` | edit / remove a space |
| POST | `/api/projects/:id/adjacencies` | link two spaces (upserts strength) |
| PUT/DELETE | `/api/adjacencies/:id` | change strength / remove link |
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
- **[ROADMAP.md](ROADMAP.md)** — where this could go next.

## Requirements

Node **≥ 22.5** (uses the built-in `node:sqlite`). No external database.

## Contributing

This is a single-file-DB, single-user app by design. Migrations are
**additive only** (`ensureColumn` in `server/db.js`) so existing `data/`
databases keep working. Run `npm run build` after changes; the API server does
not hot-reload, so restart it after editing `server/*`.

## License

MIT — see [LICENSE](LICENSE).
