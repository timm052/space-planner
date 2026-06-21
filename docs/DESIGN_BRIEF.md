# BriefTrack — Design Brief

> A working document for a design pass. It describes what the app is, who it's for,
> how it's built, every screen, the current design system (pulled from the code),
> and the highest-value opportunities to improve the look and feel.
>
> **Goal of a design pass:** raise the visual polish and usability of an already
> functional tool **without breaking** its scale-accurate diagram engine or its
> dark "architectural drafting" identity. Prefer refining the existing system
> (tokens, spacing, hierarchy, states) over a ground-up restyle.

---

## 1. What BriefTrack is

BriefTrack is a **brief-compliance / area-drift tracker for architects**. During a
building's design, the *designed* areas of every room drift away from the agreed
client **brief** (the program). BriefTrack makes that drift visible across design
milestones and gives architects an interactive, scale-accurate **bubble diagram**
to plan adjacencies and space layout on top of a real site image.

**Primary user:** an architect or design-team lead in early stages (Concept →
Schematic → Design Development) who needs to (a) keep the program honest against
the brief, and (b) think spatially about relationships between rooms.

**The two jobs the product does:**
1. **Track** — designed area vs. brief target per space, rolled up by building /
   level / category, compared across milestones, with tolerance flags.
2. **Diagram** — an interactive bubble/space-planning canvas that is *true to scale*,
   sits over a satellite or imported site plan, supports adjacency links, floor
   stacking, a real 3-D view, and freeform room shapes.

---

## 2. Run it / see it live

```bash
npm install
npm run dev          # Vite web on :5173, Express API on :3001
```

- A demo project, **"Greenfield Community Library"**, is seeded on first run
  (two buildings, ground + first floors, 16 spaces, 3 milestones with realistic
  drift). Delete the `data/` folder to reseed.
- Tests: `npm test` (Node's built-in runner; 109 tests).

---

## 3. Tech stack (what a designer needs to know)

- **React 18 + Vite**, plain JSX. **No component/UI library** — every control is
  hand-rolled and styled in one stylesheet: [`src/styles.css`](../src/styles.css).
- Theming is **CSS custom properties** on `:root` (see §6). Restyling is mostly a
  matter of editing tokens + component rules, not rewiring components.
- The diagram is **hand-authored SVG** (not a chart lib) with a real 3-D view in
  **three.js / react-three-fiber** ([`src/components/diagram/Stacked3D.jsx`](../src/components/diagram/Stacked3D.jsx)).
- Fonts are expected to be **Inter** (UI) and **JetBrains Mono** (numbers / scale
  bar). They're referenced in CSS but **not yet bundled/linked** — a design pass
  should add a proper `@font-face`/link so they render as intended.
- Backend: Express + SQLite. Not design-relevant beyond "data persists per project."

---

## 4. Information architecture

```
Projects (list)
  └─ Project
       ├─ Dashboard     KPIs + drift chart + milestone/area tables + flags
       ├─ Diagram       the bubble / space-planning canvas  ← the signature screen
       ├─ Brief         the program: hierarchical area schedule (editable table)
       └─ Milestones    snapshots of designed areas over time
  Settings (global)
```

Top bar: brand (logo + "BriefTrack"), global nav (Projects / Settings).
Inside a project: a compact project bar with `‹ Projects`, the project title, the
tab row (Dashboard / Diagram / Brief n / Milestones n), and a `⤓ CSV` export.

---

## 5. Screens (current state)

> To capture fresh screenshots, see §8.

### 5.1 Projects (landing)
Card grid (`.project-grid`, `auto-fill minmax(340px,1fr)`). Each card: project name,
client, status chips (stage), space/milestone counts, "Brief net target". Hover
lifts the card with an amber border + shadow. A `+ New Project` action sits in the
page header.

### 5.2 Dashboard
- A row of **KPI cards**: *Brief net target* (e.g. 1,382 m²), *Designed net ·
  <stage>* (1,698 m²), *Program variance* (**+22.9%**, red when over), *Net ÷ Gross
  efficiency* (69.6%).
- **"Net area drift across milestones"** — a line chart: an amber series for
  designed net across Concept → Schematic → Design Development, with a dashed green
  **brief-target** baseline. (Custom SVG chart in [`src/components/DriftChart.jsx`](../src/components/DriftChart.jsx).)
- Below: **Milestone comparison**, **By building**, **By category**, and **Flagged
  spaces** (rooms outside tolerance) tables.

### 5.3 Diagram (the signature screen)
Layout: a left **toolbar** strip, the **canvas** (`.bubble-stage`), and a right
**rail** (Areas editor + Relationships) that can be toggled/resized.

- **Toolbar groups:** Auto-layout toggle · Pan · Undo/Redo · Scale (1:100…1:2000) ·
  Colour by (category/building) · Layers · Panel · shape tools (All boxes/bubbles,
  Style: solid/outline/sketch, Categories hull, Matrix) · Floors switcher
  (All / per-level / Stacked offset / overlaid / **3-D**) · Adjacency score · PDF · Help.
- **Canvas:** bubbles are circles **sized true-to-scale** from each room's target
  area, drawn over a satellite/site image; adjacency links between rooms (solid =
  required, dashed = desired); a legend with editable category swatches; a draggable
  **north rose**; a scale bar; floating **FABs** (Pin / Box / ✎ Shape) for the
  selected room; a stage hint line.
- **Right rail:** *Areas* — grouped, collapsible, live-editable area inputs with
  running totals; *Relationships* — the adjacency list / strength editor.
- **Modes that carry the same data:** flat plan → stacked isometric ("offset" /
  "overlaid") → real WebGL 3-D, plus a scale-accurate **PDF export**.
- **Freeform shapes (recent):** any room can be given an editable, **area-locked**
  polygon that renders as a smooth, bubble-like blob (corners draggable; ＋ adds a
  corner; double-click removes). Dragging changes only the outline, never the area;
  the shape carries across all views (in 3-D it's an extruded, rounded cushion).

### 5.4 Brief
A top **add-row** (kind selector *Space/Building/Group* · Category datalist · name ·
count · area · `+ Add`), a keyboard-shortcut hint line, then a **hierarchical
table**: container rows (e.g. *Main Library*) highlighted in amber, with indented
child spaces showing Category, Count, Area each, Total, and per-row Notes / Edit / ✕.
Supports drag-and-drop reparenting and full keyboard editing.

### 5.5 Milestones
Captured snapshots of designed areas at each milestone; feeds the Dashboard drift
chart and snapshot-diff.

### 5.6 Settings
Global app/project preferences (units, tolerance, etc.).

---

## 6. Design system (as built — the source of truth)

All in [`src/styles.css`](../src/styles.css) `:root`. **This is the palette a design
pass should refine, not replace wholesale** — it's a deliberate dark "drafting"
look with a single warm amber accent + a cool cyan secondary.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0d12` | app background (deepest) |
| `--bg-2` | `#0f131a` | secondary background |
| `--panel` | `#161b24` | cards / panels |
| `--panel-2` | `#1e242f` | inputs, raised surfaces |
| `--panel-3` | `#262d3a` | hover surfaces |
| `--border` | `#2c3340` | default borders |
| `--border-soft` | `#222936` | subtle dividers |
| `--text` | `#eef1f7` | primary text |
| `--muted` | `#8d96a8` | secondary text |
| `--faint` | `#5b6478` | tertiary / hints |
| `--accent` | `#f0b53f` | **primary amber** (CTAs, active nav, focus) |
| `--accent-ink` | `#1a1308` | text on amber |
| `--accent-2` | `#57c7d4` | **cyan secondary** (links, selection, handles) |
| `--good` | `#4cc38a` | within tolerance / positive |
| `--bad` | `#e5675f` | over tolerance / negative |
| `--warn` | `#e8b04b` | caution |
| `--focus` | `rgba(240,181,63,.55)` | focus ring |
| `--shadow` | `0 10px 34px rgba(0,0,0,.38)` | card shadow |

- **Type:** `Inter` (UI), `JetBrains Mono` (numerics, scale bar, attribution).
  Headings: h1 26px, h2 16px, h3 14px; body 14px/1.5. **Action item:** the fonts
  aren't actually loaded yet — wire them up.
- **Radius:** 8px controls, 12px cards, 7px small buttons, 999px chips.
- **Buttons:** `.btn` (panel-2 fill) · `.btn.primary` (amber) · `.btn.ghost` ·
  `.btn.small` · `.btn.on` (toggle-active, amber tint). Active press nudges 1px.
- **Bubble palette** (rooms, in [`BubbleTab.jsx`](../src/components/BubbleTab.jsx)):
  `#e8b04b #5b9dd9 #4cc38a #c678dd #e5707a #56b6c2 #d19a66 #98c379 #7aa2f7 #f7768e`
  (category colours are user-overridable per project).
- **A11y already present:** `:focus-visible` rings, themed scrollbars, `::selection`,
  `prefers-reduced-motion`, disabled states, ARIA on project cards. Keep/extend these.

---

## 7. Highest-value design opportunities

Ordered roughly by impact. These are *suggestions* for the design pass, not
mandates.

1. **Load the intended fonts.** Inter + JetBrains Mono are referenced but not
   linked, so the app currently falls back to system fonts. This alone will sharpen
   the whole UI.
2. **Toolbar density (Diagram).** The diagram toolbar is a long single row of ~15
   controls and wraps awkwardly at narrower widths. Opportunity: group into
   clusters / overflow menu / segmented controls; clarify which are *modes* vs.
   *actions*. This is the most-used screen — worth the most attention.
3. **Empty / first-run states.** Projects list, a brand-new project, and the
   diagram-before-image states could use friendlier illustrations and guidance.
4. **KPI cards & drift chart hierarchy.** The Dashboard reads a bit flat; stronger
   numeric hierarchy, clearer over/under-tolerance signalling, and chart polish
   (axis labels, hover tooltips, the brief-target baseline) would help.
5. **Brief table legibility.** Dense hierarchical table; container vs. leaf rows,
   indentation, and the inline category/area editors could be visually clearer.
6. **Right rail & panels.** The Areas/Relationships rail, the floating
   "stage-popover" panels (Layers, Satellite, Scale) and FABs are functional but
   stylistically a bit ad-hoc — unifying their surfaces, spacing and headers would
   tighten things.
7. **Selection / hover / pin / multi-select feedback** on the canvas uses dashed
   rings and opacity bumps; a more refined, consistent state language would read
   better, especially now that freeform shapes add vertex handles.
8. **Light mode?** Currently dark-only. Architects often present on white. A light
   theme is a larger effort but high value — the token system makes it feasible.
9. **3-D / stacked view chrome** (camera presets, spacing slider, hint text) is
   minimal; could be made more discoverable and polished.

---

## 8. Constraints & guidance for the design pass

- **Don't break the scale model.** Bubbles, boxes, polygons and image layers all
  render in *diagram units* derived from a real metric scale; the PDF export must
  stay scale-accurate. Visual changes are fine; changing geometry/units is not.
- **The diagram is SVG + a WebGL overlay.** Style via classes/tokens; avoid
  changing the SVG coordinate/viewBox logic ([`src/hooks/useViewport.js`](../src/hooks/useViewport.js),
  `BubbleTab` render).
- **Keep the dark "drafting" identity** and the amber+cyan accent pairing unless a
  light theme is explicitly in scope.
- **Reuse the token system.** New colours/spacing should become `:root` variables,
  not one-off hex values, so PDF/3-D/SVG stay consistent.
- **Respect existing a11y** (focus rings, reduced-motion, contrast). Maintain AA
  contrast on the dark surfaces.
- **Pure helpers are tested** ([`src/geometry.js`](../src/geometry.js), `scale.js`,
  `compute.js`); keep `npm test` green.

---

## 9. Capturing current screenshots

Binary screenshots aren't checked in (the automated tooling in this environment
couldn't reliably persist them). To grab fresh, accurate visuals:

1. `npm run dev`, open `http://localhost:5173`.
2. Open **Greenfield Community Library**.
3. Capture these states (full-window):
   - **Projects** list (go back to `‹ Projects`).
   - **Dashboard** (KPIs + drift chart).
   - **Diagram** — flat plan with the satellite image and bubbles; then select a
     room and use **✎ Shape** to show a freeform shape with handles.
   - **Diagram → Floors → Stacked · offset** and **→ Stacked · 3-D**.
   - **Brief** table.
4. Save into `docs/design/` (e.g. `01-projects.png`, `02-dashboard.png`,
   `03-diagram-2d.png`, `04-diagram-3d.png`, `05-brief.png`) and link them back
   into §5 of this doc.

A quick way to grab just the diagram canvas as an image (run in the browser
console while on the Diagram tab):

```js
const svg = document.querySelector('.bubble-svg');
const xml = new XMLSerializer().serializeToString(svg);
const img = new Image();
img.onload = () => {
  const c = Object.assign(document.createElement('canvas'),
    { width: svg.clientWidth, height: svg.clientHeight });
  const x = c.getContext('2d');
  x.fillStyle = '#0e1218'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  const a = Object.assign(document.createElement('a'),
    { href: c.toDataURL('image/png'), download: 'diagram.png' });
  a.click();
};
img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
```

---

## 10. Pointers (where things live)

| Area | File |
|---|---|
| Global styles & tokens | [`src/styles.css`](../src/styles.css) |
| App shell / nav | [`src/App.jsx`](../src/App.jsx), [`src/components/ProjectView.jsx`](../src/components/ProjectView.jsx) |
| Projects list | [`src/components/ProjectList.jsx`](../src/components/ProjectList.jsx) |
| Dashboard + chart | [`src/components/Dashboard.jsx`](../src/components/Dashboard.jsx), [`src/components/DriftChart.jsx`](../src/components/DriftChart.jsx) |
| Bubble diagram (the big one) | [`src/components/BubbleTab.jsx`](../src/components/BubbleTab.jsx) |
| Diagram sub-components | [`src/components/diagram/`](../src/components/diagram/) (LayerRow, MatrixPanel, NorthRose, Stacked3D) |
| Brief table | [`src/components/BriefTab.jsx`](../src/components/BriefTab.jsx) |
| Help/legend copy | [`src/components/HelpPanel.jsx`](../src/components/HelpPanel.jsx) |
| Geometry / scale helpers | [`src/geometry.js`](../src/geometry.js), [`src/scale.js`](../src/scale.js) |
| PDF export | [`src/pdfExport.js`](../src/pdfExport.js) |
