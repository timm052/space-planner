# BriefTrack — Roadmap

*Last reviewed: 2026-08-04, after the viewport/interaction merge (PR #5).*

BriefTrack is a **single-user, locally-run** tool for the early stages of a
building project. It holds the **agreed brief as its own source of truth**,
tracks how the design drifts away from it, and gives architects a three-stage
diagram — relationships, site, massing — to think spatially while the programme
is still moving. Its future is a **self-contained desktop app** an architect
installs and runs on a real job, not a hosted or multi-user product.

Nothing here is committed. Items are grouped by horizon and ordered by
value-to-effort within each group.

---

## 1. Where the project actually is

**The programme model is now two trees.** `brief_spaces` (the agreed programme)
and `spaces` (the live design) are separate hierarchies reconciled **explicitly**
by path key — preview a diff, apply it, or pull one room back. Brief areas can be
formulas over project variables and other rooms, with a benchmarks library, a
circulation allowance, dated revisions and an append-only change log. Design
options save whole A/B schemes against one brief. This is the app's strongest
conceptual asset and it is barely a month old.

**The diagram is a pipeline, not a canvas.** Three environments, each owning one
geometry and its own mechanics, gated by one declarative `ENV_CAPS` table, with
independent per-environment layouts (`pin_json` / `plan_json` / `block_json`):
◯ Concept (bubbles, force sim, relationships, scale-free) → ▱ Master plan
(building envelopes on the calibrated site, drawn-vs-required footprint badge,
Voronoi interior sketch seeded from Concept and writing back to it) → ▤ Building
(block-up into per-floor area-locked rectangles inside the envelope, storey
heights, vertical adjacency, stacked and 3-D overviews). Output is a multi-page
drawing set — concept sheet, master plan sheet, one sheet per floor — built from
persisted layouts.

**The viewport work paid in correctness, not line count.** Forced layouts on the
drag hot path fell 98% (121 → 2 per gesture); snap geometry moved into a pure,
tested `modes.js`; footprints, interior cells, bubble radius and sheet bounds are
now computed once and shared by the canvas *and* the PDF, killing a class of
"the export doesn't match the screen" bugs. `@react-spring/web` was evaluated and
declined — the defect it would have solved was an uncancelled tween, now fixed
and tested.

**Engineering health:** 349 tests (pure domain math, formula engine, geometry,
scene builders, the mode machine, the full REST surface against a temp DB,
prop-driven views, and jsdom pointer flows), ESLint clean (22 pre-existing
warnings), a repeatable perf bench (`scripts/perf-bench.js`), CI on tests + build
+ an API smoke test.

**What has *not* been touched:** getting *measured* areas in, getting a client
document out, and anything that makes the app trustworthy on a live job
(portable files, restore, packaging).

### Shipped since the last roadmap review

Items the previous roadmap listed as future that are now done: **from bubbles to
blocks** (the Building environment), **design options / scenarios**, **`Cmd/Ctrl-K`
quick-find palette**, **colour-by status**, **editable stacked layouts** (per-floor
editing is now the primary mode), **light theme**, **multi-page sheet sets**, and a
first cut of **bulk brief entry** (paste a schedule into the Brief).

---

## 2. Guiding constraints (deliberately not changing)

- **Single-user, local-first.** No accounts, no cloud sync, no multi-tenancy.
- **The two trees stay explicit.** Nothing syncs Brief → Design automatically; an
  implicit sync would silently overwrite negotiated numbers.
- **The scale model and its two invariants** — one shared `effScale`; a scale
  change is a uniform zoom about the viewport centre (ARCHITECTURE §6).
- **One definition per quantity.** Footprints, radii, interior cells and sheet
  bounds are computed once and shared between screen and PDF. Do not re-derive.
- **Additive-only migrations**; existing `data/brieftrack.db` files keep working.
- **Optimistic mutate + full refetch.** Make the refetch cheap; no cache merging.
- **Minimal dependencies**, hand-rolled SVG, no UI or chart library.

## 3. Now — finish the data loop

The diagram outgrew the tracking side. A brief can be pasted in; measured areas
still cannot, and nothing comes out that a client can read.

1. **Import measured areas into a milestone.** A milestone *is* a Revit/ArchiCAD
   area schedule. Today the editor can prefill from the Design tree
   (`⤓ Use current design areas`), which helps only when the design *is* the
   model — measured areas from the BIM file are still typed room by room. Parse
   a pasted or uploaded schedule,
   match rows to spaces by name (exact → fuzzy → manual), **summing** multiple
   source rows onto one space (which is exactly how a count-3 space records its
   total), and fill the editor's `areas` state so the user still reviews before
   saving. `POST /projects/:id/snapshots` already accepts an `areas` map, so this
   is client-side work plus one additive `spaces.import_key` column to remember
   the mapping for the next milestone.
2. **Harden the brief import.** `parseImport()` in `ProgramTab.jsx` is a good
   start but flat: no **building or level** columns (so a multi-storey brief
   still has to be nested by hand afterwards — and Building/Master plan need
   exactly that structure), paste-only with no file upload, grouping only by
   category, and one `POST` per row. Add hierarchy columns, a file drop, and a
   `POST /projects/:id/brief-spaces/bulk` transaction endpoint.
3. **Client-ready report.** The drawing set covers *drawings*; there is no
   document. Produce one issue-ready PDF: title block, the area schedule (brief
   vs each milestone, variance, tolerance flags), the by-category rollup, the
   drift chart, flagged spaces — optionally appending the existing drawing
   sheets. Keep `pdfExport.js`'s scale-accurate path untouched; this is a second
   document type beside it, with the pagination logic pure and tested.
4. **Brief templates** — seed a project from a building-type template (school,
   library, clinic, small office). Once (2) lands, a template is just a bundled
   schedule through the same endpoint.

## 4. Next — trust and depth

**Trust (the app is holding a real job's data):**

- **Portable project files** — export/import a whole project (both trees,
  adjacencies, all three layouts, milestones, images, options) as one file.
  Backup, hand-off, and the thing a desktop app needs in order to open and save.
  Prerequisite for packaging.
- **Restore, not just audit.** `change_log` records programme edits but nothing
  can be rolled back, and `brief_revisions` snapshots only the Brief. Give the
  log a restore path — imports and recursive deletes are the operations that
  make it necessary.
- **Departmental area budgets** — a target per department/building with live
  consumption as the brief is edited, so over-brief shows up *before* a
  milestone is recorded.

**Depth in the pipeline that exists:**

- **Adjacency score breakdown** — the badge grades; it should explain. A panel
  listing each unmet pair with its gap, per-strength thresholds in Settings, and
  feeding the score into auto-layout as an objective rather than a report card.
- **Annotations, dimensions & measure** — the master plan and floor sheets are
  presentation output and cannot be annotated. Text, leaders, dimension strings,
  and a measure tool on the calibrated background.
- **By-level area chart** — department area per floor, beside the geometric
  stacking readout the Building rail already shows.
- **Per-space data sheets** — finishes, occupancy, servicing, building on notes
  and the reference image.
- **DXF / DWG underlay** — CAD as a vector background layer, reusing the
  per-layer calibration model.
- **Envelope efficiency beyond one number** — circulation is a single percentage
  per building today; per-level or per-department factors are the natural next
  step once people use it in anger.

## 5. Later — the desktop product

- **Desktop packaging (the headline direction).** One installable app instead of
  Node ≥ 22.5 and two dev servers. **Decide the runtime first:** the app depends
  on built-in `node:sqlite`, Electron's bundled Node may lag that, and Tauri has
  no Node at all — so packaging starts with a storage decision, not a build
  script. Everything downstream (images on disk, native file dialogs, print) gets
  easier once it lands.
- **Auto-layout suggestions** — constraint solving for required adjacencies and
  departmental zoning, on top of the existing sim and the block-up seeder.
- **Code / compliance rule packs** — egress distances, minimum areas,
  accessibility, evaluated against the programme.
- **Cost & carbon overlays** — $/m² and embodied-carbon factors per department,
  live as areas change.
- **Occupancy-driven standards** — derive targets from headcounts ×
  area-per-person; the formula engine and benchmarks library already do half of
  this.

## 6. Quality & platform (continuous)

- **Run lint in CI.** `npm run lint` passes and CI doesn't run it. One line.
- **`BubbleTab.jsx` is 4,016 lines.** The viewport work deliberately stopped
  short: the pointer dispatch ladder and the drag/link state are still inline
  because they interleave with hook-owned handlers (`usePolyEditing`,
  `useImageLayers`). That is the next extraction when someone is in there
  anyway — not a refactor for its own sake.
- **End-to-end happy path** (Playwright): create → import a brief → place
  envelopes → block up → record a milestone → read the dashboard. Nothing
  currently exercises a full journey.
- **Type safety** — JSDoc + `checkJs` is in place on `modes.js`; branding the
  coordinate types (`Metres`, `DiagramUnits`, `NaturalPx`, `ScreenPx`) so
  ARCHITECTURE §6's invariants are *checked* still needs TypeScript in the
  project.
- **Vitest migration** — would remove the `tsx` classic-runtime hack that makes
  component tests set `globalThis.React`. Touches ~20 files; blocks nothing.
- **Diagram accessibility** — app chrome has focus rings, keyboard-operable
  cards and reduced-motion; the canvas is still pointer-only.
- **CSS `@layer`** — replace "import order IS the cascade" with real layers;
  `diagram.css` is 1,766 lines and the constraint is load-bearing today.
- **Imperial & i18n** — finish feet-and-inches formatting; make strings
  translatable.

## 7. Decisions on record (with the trigger that would reopen them)

Recorded so they are not re-litigated from scratch:

- **`@react-spring/web` — declined.** The interruptibility problem was real but
  its cause was a tween nothing cancelled on gesture start; fixed and covered by
  a regression test. Reopen only if view animation becomes continuous and
  steerable mid-flight (momentum pan, a gesture-driven camera).
- **`@use-gesture/react` — not now.** Input handling is already correct,
  including the wheel path. **Trigger:** touch support becomes a requirement, or
  momentum/inertia is wanted.
- **Worker + `comlink` for the sim — not now.** The baseline shows no
  sim/render contention: 400 rooms runs a 60-move gesture in ~53 ms of
  synchronous work. **Trigger:** real projects reaching room counts where the sim
  starves the frame.
- **three.js as a second renderer — an open product call.** `Stacked3D` is
  857 kB (234 kB gzip), the heaviest chunk, but lazy — it costs nothing until
  someone opens the 3-D view. It duplicates the SVG isometric view, and both are
  maintained. The question is whether a free-camera massing view earns a second
  rendering backend; that is a decision about what the product is for, not a
  refactoring side effect.
- **`DiagramCanvas` prop plumbing — deferred with reason.** 94 props across a
  99-line destructure looks alarming, but the file holds only ~7 real derivation
  sites in 1,038 lines: it is already presentational. Grouping the props is
  ergonomics with no test leverage. **Trigger:** a second consumer of the scene
  (a WebGL 2-D renderer, a server-side sheet renderer), or doing it
  opportunistically while already in the file.

## 8. Known limitations to address

- **Images are base64 data URLs in the DB.** They no longer travel on every
  refetch (`serialize.js` strips them), but they bloat the database file and
  every backup of it. Files beside the DB is the answer, and it arrives naturally
  with desktop packaging.
- **The force simulation runs on the main thread** — fine today (see §7), but the
  watch line is "hundreds of rooms".
- **The API server does not hot-reload** and holds an exclusive lock on the DB,
  so only one instance runs at a time (`npm run dev:alt` exists for a second
  port, but not a second DB).
- **The stacked SVG view and the WebGL view are two answers to one question** —
  see the three.js decision above.
- **Adjacency scoring needs a scale** to judge adjacency in metres; Concept
  therefore grades topologically instead.
