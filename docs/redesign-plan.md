# BriefTrack Redesign — Implementation Plan

Applying `design_handoff_brieftrack_redesign/` (the `BriefTrack.dc.html` prototype + README)
to the existing `archi-app` React app. **Reuse the data layer** (`compute.js`, `api.js`,
server/SQLite). Do **not** ship the HTML prototype or add a new framework. Recreate the
designs in the existing component files + `src/styles.css`.

Source of truth: `design_handoff_brieftrack_redesign/README.md` and `BriefTrack.dc.html`.

## Key decisions (locked)
- **Diagram:** apply the new visual language + Select/Link interaction model, **but keep
  existing extras** not in the brief — image underlays, 3D stacked view, scale tools.
- Deliver this plan file, then implement starting at Phase 0.

## Field mapping (redesign term → app data)
- "Category" / department color → existing `space.department`.
- "Building" → `rootContainer(space, byId)`.
- Reuse `briefNet`, `snapshotNet`, `rollup`, `spaceStatus`, `leafSpaces`, `fmtArea`, `fmtPct`.

---

## Phase 0 — Foundations (shared)
1. **Fonts** — add Inter / JetBrains Mono / Space Grotesk `<link>`s in `index.html`.
2. **Theme system** — `styles.css` `:root` → token set keyed by `data-theme` on `<html>`
   (dark default + light). Rename to redesign tokens (`--panel2/3`, `--accent2`) and add
   `--canvas-bg`, `--contour`, `--glass`, `--glass-border`. Keep old hyphenated aliases
   temporarily to avoid breaking unported CSS, remove at the end.
3. **ThemeContext** + `localStorage` persistence (only `theme` persists).
4. **Utils** — new `src/viz.js`: `darkHex(hex, amt)` and `squarify(items, W, H)`.
5. **Shared selection** — lift `selIds[]` / `selLink` into `ProjectView`; pass to Diagram
   + Brief so a space selected in one highlights in the others. `Esc` clears.

## Phase 1 — Shell
- Top bar: 4-cell amber brand glyph, `Brief`+amber `Track` (Space Grotesk 700),
  Projects/Settings nav, **Dark|Light segmented toggle**.
- Project bar: back chevron, name + meta line (`Client · Stage · ±tol`), centered tabs
  with **mono count pills**, `⤓ CSV`. Active tab = `--panel2` bg / `--accent` text.
- Files: `App.jsx`, `ProjectView.jsx`.

## Phase 2 — Dashboard + Milestones
- 4 KPI cards (`D·01`–`D·04`): 3px status accent bar, mono tag + uppercase label,
  Space Grotesk value, foot note. Values from real data.
- `DriftChart.jsx`: restyle to flat tokens — target line, ±5% tolerance band,
  status-colored dots, mono labels. Keep existing scale math.
- By-category rollup (`D·06`) + flagged spaces (`D·07`) as **dotted-leader schedules**.
- Milestones (`SnapshotsTab.jsx` / `SnapshotDiff`): `M·01` snapshot cards (status bar,
  variance badge, net + gross/efficiency mini-stats, accent border on latest);
  `M·02` change schedule as dotted-leader rows with ▲/▼ deltas.

## Phase 3 — Brief
- View toggle **▦ Treemap (default) | ≣ Schedule**.
- Treemap: `ResizeObserver` + `squarify`; flat category tiles, poché inset divider,
  clamped labels (hide on small tiles), click/shift-click selection (shared).
- Schedule: keep existing editable hierarchical table; flat swatches + `BUILDING` tags,
  inline Notes panel, add-row form, keyboard hints, grand-total footer.
- Summary sidebar (both views): `B·01` net-target medallion, `B·02` by-category split bar
  + dotted-leader rows, `B·03` by-building dotted-leader rows.
- Files: `BriefTab.jsx`.

## Phase 4 — Diagram (largest, last)
Rebuild interaction model in `BubbleTab.jsx`, preserving image underlay / 3D / scale extras:
- Modes: **Select (V)**, **Link (L)**; **Auto-layout (A)** toggle; Recenter. Transient
  **hold-Space pan**. Tool dock with hotkey corner badges.
- One **contextual action bar** (bottom-center glass), 3 forms: single room
  (Pin/Box/Shape/Category/Delete), multi (Pin all/Box all/Shape all/Delete), link
  selected (Desired/Required toggle + Remove).
- Canvas: topographic contour rings (no grid), dashed building hulls + caps labels,
  flat matte rooms (radius ∝ √area, `darkHex` keyline/ink), Box + freeform Shape variants,
  solid(required)/dotted(desired) links with 16px hit-lines, glass overlays + vignette.
- Right rail (336px): `A·01 AREAS` (Building|Category toggle, key-plan split bar,
  dotted-leader room rows), `A·02 ADJACENCY` schedule (drafting-line glyphs), Σ medallion.
- `HelpPanel.jsx`: two-column Mouse/Keyboard shortcuts modal.
- Keep `diagram/Stacked3D.jsx`, image-underlay, and scale tooling working under new styling.

## Phase 5 — Polish & verify
- Cross-screen selection sync; verify both themes; responsive treemap + diagram.
- Remove temporary token aliases from Phase 0.
- Run via preview, screenshot each screen, compare to `BriefTrack.dc.html`.

## New UI-only state (none persist except `theme`)
`theme`, Diagram `tool`/`spaceHeld`/`selIds`/`selLink`/per-room `pinned|boxed|shaped|removed`/
`colorBy`/`floor`/`scale`/`showLayers`/`showHelp`, Brief `briefView`/`treeW`.
