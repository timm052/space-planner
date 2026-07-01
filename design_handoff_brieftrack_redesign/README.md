# Handoff: BriefTrack Redesign

## Overview
A full visual + interaction redesign of **BriefTrack** — the program-compliance / area-drift tracking app for architects. The redesign covers the four core screens of a project: **Diagram** (the bubble/adjacency canvas), **Brief** (the program table), **Dashboard** (KPIs + drift chart), and **Milestones** (snapshot comparison).

The redesign establishes one coherent visual language across all four screens — a flat, architectural **"drafting / site-plan"** system — and rethinks the Diagram's interaction model (modes vs. gestures vs. selection-actions) and the Brief's primary visualization (a squarified **treemap**).

## About the Design Files
The file in this bundle — `BriefTrack.dc.html` — is a **design reference created in HTML**. It is a working, interactive prototype that demonstrates the intended look, layout, motion, and behavior. **It is not production code to copy verbatim.**

The target codebase is the existing **`archi-app`** React app (Vite + React, plain CSS in `src/styles.css`, components in `src/components/`). The task is to **recreate these designs inside that app**, reusing its data layer (`compute.js`, `api.js`, the SQLite-backed server) and component structure, and replacing/updating the existing JSX + CSS to match. Do **not** ship the HTML file itself, and do **not** introduce a new framework.

> Implementation note about the prototype's structure: the prototype is authored as a single component with inline styles and a `React.createElement`-based SVG canvas. In `archi-app`, split it back into the existing component files (see **Component Mapping** below) and move styling into `src/styles.css` (or CSS modules) as the codebase already does. Inline styles in the prototype are a convenience of the prototype environment, not a directive.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, motion, and interactions are all specified. Recreate the UI pixel-faithfully using the app's existing CSS conventions. Exact tokens are listed in **Design Tokens** below.

---

## Design Tokens

### Color — dark theme (default) and light theme
The app supports a **dark** (default) and **light** theme, toggled in the top bar. Implement as CSS custom properties on a root wrapper (the prototype sets them via JS; in `archi-app` prefer a `data-theme` attribute on `<html>`/root and two `:root` blocks).

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0b0d12` | `#edebe4` | app background |
| `--bg2` | `#0f131a` | `#f6f5f1` | bars, insets, chart tracks |
| `--panel` | `#161b24` | `#ffffff` | cards / surfaces |
| `--panel2` | `#1e242f` | `#f3f1ea` | hover surface, inputs |
| `--panel3` | `#262d3a` | `#e6e3d9` | kbd keys, chips |
| `--border` | `#2c3340` | `#d8d4c8` | card & control borders |
| `--border-soft` | `#222936` | `#e6e3da` | row dividers |
| `--text` | `#eef1f7` | `#1b2029` | primary text |
| `--muted` | `#8d96a8` | `#5f6878` | secondary text |
| `--faint` | `#5b6478` | `#9aa1ad` | tertiary / units |
| `--accent` | `#f0b53f` | `#c5841a` | brand amber (primary) |
| `--accent-ink` | `#1a1308` | `#ffffff` | text on accent |
| `--accent2` | `#57c7d4` | `#1c8499` | secondary cyan |
| `--good` | `#4cc38a` | `#2f9d6b` | on-target / under-control |
| `--bad` | `#e5675f` | `#cc4a42` | error / over-target |
| `--warn` | `#e8b04b` | `#b3812a` | warning |
| `--canvas-bg` | `#11151c` | `#e7e4dc` | diagram canvas field |
| `--contour` | `rgba(255,255,255,.07)` | `rgba(40,50,70,.08)` | topographic ring lines, medallions |

### Category colors (program departments) — same in both themes
| Category | Hex |
|---|---|
| Public | `#f0b53f` |
| Staff | `#5b9dd9` |
| Support | `#4cc38a` |
| Community | `#c678dd` |

### Building colors
Main Library `#f0b53f` · Community Pavilion `#57c7d4`

### Status colors (drift / compliance)
On target `#4cc38a` · Over `#e8b04b` · Under `#57c7d4`

### Typography
Load three Google fonts: **Inter** (400/500/600/700/800), **JetBrains Mono** (400/500/600/700), **Space Grotesk** (400/500/600/700).
- **Inter** — body/UI default.
- **Space Grotesk** — display: wordmark, screen/section headers (uppercase, letter-spacing `.10–.12em`), big numerals, tile/room names, milestone titles.
- **JetBrains Mono** — all numbers/areas/percentages, reference tags (`A·01`, `B·02`, `D·05`, `M·01`), keyboard keys.

Type sizes are small-UI scale: body `12–14px`; section labels `12.5–13px` uppercase; big hero numerals `30–44px` Space Grotesk 700, letter-spacing `-.02em`; chart/tile labels `9.5–12px`.

### Radius / shape
Cards `13px`. Controls/inputs `7–9px`. Chips/tags `4–5px`. Reference tags are bordered mono chips. **Swatches are flat squares (no border-radius), not dots** — this is intentional and part of the language. Pills were removed in favor of flat letter-spaced tags.

### Shadow
Floating/glass elements: `0 12px 38px rgba(0,0,0,.42)` dark / `0 10px 30px rgba(40,40,60,.14)` light. Flat surfaces use borders, not shadows.

### Motion
Minimal. Control transitions `.12s`. **Do not use CSS entrance/keyframe animations on re-rendering panels** — in the prototype these caused panels to get stuck at `opacity:0` under frequent re-renders; rely on conditional mount instead.

---

## The Visual System (apply to all four screens)
1. **Flat fields, no gloss.** Areas/tiles/bubbles are solid matte color with a crisp **poché keyline** = a darkened tone of the same hue (`darkHex(color, 0.4)` for keylines, `darkHex(color, 0.62)` for ink/text on fills). No gradients, no drop shadows, no specular highlights on data shapes.
2. **Square swatches** (flat), letter-spaced **uppercase Space Grotesk** section headers, each prefixed by a mono **reference tag** (`A·`/`B·`/`D·`/`M·` per screen).
3. **Dotted leader lines** between a label and its value (drawing-schedule / spec-index style): `border-bottom: 1px dotted var(--border)` on a `flex:1` spacer, nudged `transform: translateY(-3px)`.
4. **Contour-ring medallions** for grand totals — concentric circles (`stroke: var(--contour)`) behind a big Space Grotesk numeral.
5. **Topographic site contours** replace any grid: faint concentric ellipses around cluster centroids.
6. Tabular **JetBrains Mono** for every number.

Helper used throughout (port as a util):
```js
// darken a hex toward black by amt (0..1) → "rgb(r,g,b)"
function darkHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  r=Math.round(r*(1-amt)); g=Math.round(g*(1-amt)); b=Math.round(b*(1-amt));
  return `rgb(${r},${g},${b})`;
}
```

---

## Component Mapping (prototype → archi-app)
| Prototype area | archi-app file to update |
|---|---|
| Top bar + theme toggle + project bar/tabs | `ProjectView.jsx` (+ new theme context) |
| Diagram canvas, tool dock, control cluster, right rail | `BubbleTab.jsx` + `components/diagram/*` |
| Brief treemap + schedule table + summary sidebar | `BriefTab.jsx` |
| Dashboard KPIs, drift chart, rollup, flagged | `Dashboard.jsx` |
| Drift chart SVG | `DriftChart.jsx` |
| Milestones cards + change schedule | (Dashboard's `SnapshotDiff` / a Milestones view) |
| Shortcuts panel | `HelpPanel.jsx` |
| All tokens / classes | `styles.css` |

---

## Screens / Views

### 1) Shell (top bar + project bar)
- **Top bar** (54px): brand mark (30px amber rounded-8 square w/ 4-cell glyph) + wordmark `Brief` + amber `Track` in Space Grotesk 700; right side: text nav (Projects, Settings) + **theme toggle** segmented control (Dark | Light).
- **Project bar** (below): back-to-Projects chevron, project name (Space Grotesk 17px 600) + meta line (`Client · Stage · ±tolerance`), centered **tab nav** (Dashboard / Diagram / Brief `16` / Milestones `3` — counts are mono pills), and a `⤓ CSV` button at the right.
- Active tab: `--panel2` bg, `--accent` text, weight 600.

### 2) Diagram  (signature screen — `BubbleTab.jsx`)
**Layout:** 56px left tool dock · fluid canvas · 336px right rail.

**Interaction model (this is a deliberate redesign — implement exactly):**
- **Two canvas modes only:** **Select (V)** and **Link (L)**. Plus **Auto-layout (A)** toggle and a Recenter button. Tool dock buttons show their hotkey as a tiny corner badge.
- **Pan is a transient gesture, not a mode:** hold **Space** → grab cursor → drag to pan. (So empty-canvas drag is unambiguously marquee-select.)
- **One contextual action bar** (bottom-center, glass) is the single home for actions, and it has three forms:
  - **Single room selected:** swatch + name + area, then **Pin (P) · Box (B) · Shape (S) · Category · ⌫(Delete)**.
  - **Multiple rooms (Shift-click):** `N rooms selected` + **Pin all / Box all / Shape all / ⌫**.
  - **A link selected (click any link):** `RoomA — RoomB` + **Desired / Required** segmented toggle + **Remove**. (Replaces the old hidden 3-click cycle.)
- **Shortcuts** (`?` or the top-right `?` button) open a modal with two columns (Mouse / Keyboard). Keymap: `V` select, `L` link, `A` auto-layout, `P` pin, `B` box, `S` shape, `⌫` remove, `Esc` deselect, hold-Space pan, Shift-click multi, double-click rename, click-link edit.

**Canvas (flat site-plan aesthetic):**
- Field bg `--canvas-bg`. **No grid.** Instead, faint **topographic contour rings** (6 concentric ellipses per building centroid, `stroke: var(--contour)`, opacity fading outward).
- **Building hulls:** fine dashed ellipses (`stroke-dasharray: 2 7`, building color, ~0.55 opacity) + letter-spaced caps label (`MAIN LIBRARY`, `COMMUNITY PAVILION`) in Space Grotesk.
- **Rooms = flat matte circles** sized true-to-area (radius ∝ √area), fill = category/building color (`fill-opacity .95`), **keyline = `darkHex(color, .4)`** (white when selected), **ink labels = `darkHex(color, .62)`** (name in Space Grotesk 600 + area in mono). Equal-area **Box (square, side = r·√π)** and **freeform polygon** variants per the B/S actions.
- **Links:** required = solid hairline (`var(--text)`, 2px), desired = dotted (`stroke-dasharray: 1 5`, 1.4px); selected/connected = `#57c7d4`, thicker. Invisible 16px-wide hit-line per link for selection.
- Glass overlays (backdrop-blur, `--glass`/`--glass-border`): top-left legend, top-center control cluster (Colour: Category|Building · Floors · Scale · Layers), top-right actions (undo/redo, adjacency % badge, PDF, `?`), bottom-left scale bar, bottom-right north rose, bottom-center contextual hint (hidden when an action bar is showing). A depth **vignette** overlay: `radial-gradient(ellipse 90% 85% at 50% 46%, transparent 72%, rgba(0,0,0,.16))`.

**Right rail (336px) — "program takeoff":**
- `A·01 AREAS` with Building|Category toggle. A **key-plan split bar** (flat, hairline-divided proportional strip) + legend with mono %. Then groups, each with a flat swatch header + count + mono total, and **room rows as dotted-leader schedule** (swatch · name · dotted leader · mono area). Clicking a row selects the room on the canvas.
- `A·02 ADJACENCY` schedule: each relationship is a row with a **drafting line glyph** (solid line + end-nodes = required; dotted = desired — matching the canvas link vocabulary) + `RoomA / RoomB`. Header shows `6 req · 10 des`.
- **Σ total medallion** pinned footer: concentric contour rings + big Space Grotesk total.

### 3) Brief  (`BriefTab.jsx`)
Two-column: fluid left + 300px sticky summary sidebar. Left has a **view toggle: `▦ Treemap` | `≣ Schedule`** (Treemap default).

**Treemap view (the radical primary visualization — modeled on the WITS World Bank treemap in `reference/wits-treemap-reference.png`):**
- A responsive rectangle (full width × clamped height `max(420, min(640, round(W*0.62)))`) packed by a **squarified treemap** (Bruls et al.). Every space = one tile; **tile area ∝ program area**; verified 100% coverage, no gaps.
- Sort spaces by area descending before packing. Tile = flat category color, `box-shadow: inset 0 0 0 1px rgba(0,0,0,.16)` divider (`inset 0 0 0 2.5px var(--text)` when selected), top-left label: name (Space Grotesk 600, 2-line clamp) + `%` + `m²` in mono. Hide labels on small tiles (name if `w>46 && h>24`; meta if `w>66 && h>50`); slivers are color-only with a `title` tooltip.
- Click a tile → select that space (shared selection with Diagram); Shift-click → multi.
- Measure container width with a `ResizeObserver` and re-pack on resize. **Squarify implementation to port:**
```js
function squarify(items, W, H) { // items: [{id, value>0}] → [{id,x,y,w,h}]
  const total = items.reduce((s,d)=>s+d.value,0) || 1;
  const scale = (W*H)/total;
  const data = items.map(d => ({ id:d.id, area:d.value*scale }));
  const result = [];
  let rect = { x:0, y:0, w:W, h:H }, row = [];
  const worst = (rw, side) => {
    if (!rw.length) return Infinity;
    let sum=0,mx=-Infinity,mn=Infinity;
    rw.forEach(d=>{ sum+=d.area; if(d.area>mx)mx=d.area; if(d.area<mn)mn=d.area; });
    const s2=sum*sum, w2=side*side;
    return Math.max((w2*mx)/s2, s2/(w2*mn));
  };
  const layout = () => {
    const side = Math.min(rect.w, rect.h);
    const sum = row.reduce((s,d)=>s+d.area,0), thick = sum/side;
    if (rect.w <= rect.h) {            // band spans width
      let cx = rect.x;
      row.forEach(d=>{ const cw=d.area/thick; result.push({id:d.id,x:cx,y:rect.y,w:cw,h:thick}); cx+=cw; });
      rect = { x:rect.x, y:rect.y+thick, w:rect.w, h:rect.h-thick };
    } else {                           // band spans height
      let cy = rect.y;
      row.forEach(d=>{ const ch=d.area/thick; result.push({id:d.id,x:rect.x,y:cy,w:thick,h:ch}); cy+=ch; });
      rect = { x:rect.x+thick, y:rect.y, w:rect.w-thick, h:rect.h };
    }
    row = [];
  };
  let i = 0;
  while (i < data.length) {
    const d = data[i], side = Math.min(rect.w, rect.h);
    if (row.length === 0 || worst(row.concat(d), side) <= worst(row, side)) { row.push(d); i++; }
    else layout();
  }
  if (row.length) layout();
  return result;
}
```
> Open enhancement the user is considering: a **nested treemap grouped by building or category** (group borders/labels like the reference's product groups). Implement flat first; group is a follow-up.

**Schedule view:** the existing editable hierarchical table — Building row (flat swatch + flat `BUILDING` tag, no emoji) → Level subheader → space rows (flat swatch · name · note icon · category · count · area each · total). Click a space row to expand an inline **Notes** panel. An add-row form (Space/Category/Name/Count/Area + Add) sits above; keyboard hints (`↑↓` move, `Tab` nest, `Enter` edit, `N` notes, `Del` remove). Footer grand total in Space Grotesk accent.

**Summary sidebar (both views):**
- `B·01` Σ net-target medallion (contour rings + `1,722 m²` Space Grotesk).
- `B·02` Area by category: flat hairline-divided split bar + **dotted-leader rows** (`Public ···· 1,025 m² · 60%`).
- `B·03` By building: dotted-leader rows.

### 4) Dashboard  (`Dashboard.jsx` + `DriftChart.jsx`)
Centered max-width 1500px column.
- **4 KPI cards** (`D·01`–`D·04`), each with a 3px status accent bar on top, mono tag + uppercase label, big Space Grotesk value, foot note. Values from real data (see below): Brief net target `1,722 m²`; Designed net (latest) `1,698 m²`; Programme variance `−1.4%` (green, within ±5%); Net:gross efficiency `70%` (red, under 72% target).
- **Drift chart** (`D·05`): flat SVG line across milestones with target line (`--accent`), faint ±5% **tolerance band**, on-target/over/under **dots colored by status**; mono value labels above points, Space Grotesk milestone names + mono dates below. Target/band annotated top-left (`BRIEF TARGET 1,722 · ±5%`). See `DriftChart.jsx` for the existing scale math; restyle to flat tokens.
- Two-column: `D·06` **By-category rollup** (Category | Target | Designed | Δ, Δ colored by status) and `D·07` **Flagged spaces** dotted-leader schedule (`name ···· target → designed · ±%`), header count `N outside ±5%`.

### 5) Milestones
Centered max-width 1100px column.
- `M·01` **Recorded milestones:** one card per snapshot, 3px status bar, mono tag, variance badge (status color), milestone label (Space Grotesk), mono date, big net (Space Grotesk) + gross & efficiency mini-stats. Latest card gets an accent border highlight.
- `M·02` **Change schedule** (`Schematic → Design Dev`): header shows net change + count; each changed space is a **dotted-leader row**: swatch · name · dept · `from → to` (mono) · signed delta with ▲/▼ glyph colored (`#e8b04b` grew / `#57c7d4` shrank).

---

## Interactions & Behavior (summary)
- **Tabs** switch the main view (client-side).
- **Theme toggle** swaps the token set (persist the choice).
- **Selection** is shared state across Diagram canvas, Brief rail rows, and Brief treemap tiles — a space selected in one is highlighted in the others. `Esc` clears.
- **Diagram:** see the interaction-model section. Pin/Box/Shape/Delete act on the current selection (single or multi). Links are click-to-create (default desired) and click-to-edit.
- **Brief:** Treemap/Schedule toggle; treemap re-packs on resize; schedule rows expand notes.
- **Milestones / Dashboard:** the milestone comparison picks two snapshots (existing `SnapshotDiff` supports arbitrary pairs; the prototype hardwires Schematic→DD for display).

## State Management
Reuse `archi-app`'s existing data layer (`compute.js`: `briefNet`, `snapshotNet`, `rollup`, `spaceStatus`, `leafSpaces`, `fmtArea`, `fmtPct`; `api.js`; server/SQLite). New UI-only state to add: `theme` (`dark`/`light`), Diagram `tool` (`select`/`link`), `spaceHeld` (pan), `selIds[]` + `selLink`, per-room `pinned/boxed/shaped/removed` maps, `colorBy`, `floor`, `scale`, `showLayers`, `showHelp`, Brief `briefView` (`treemap`/`schedule`) and measured `treeW`. None of these need persistence except `theme`.

## Data (real seed — matches the app's demo project "Greenfield Community Library")
- **Tolerance** ±5% · **grossing target** ≥72% · **brief net total** 1,722 m².
- **16 spaces** (`[name, category, building, count, targetEach m²]`): Entrance & Foyer/Public/main/1/110 · Welcome / Returns Desk/Public/main/1/35 · Children's Library/Public/main/1/200 · Teen Zone/Public/main/1/85 · Café/Public/main/1/75 · Open Office/Staff/main/1/90 · Workroom / Sorting/Staff/main/1/65 · Staff Lounge/Staff/main/1/38 · Book Storage/Support/main/1/80 · IT / Server/Support/main/1/18 · Loading & Receiving/Support/main/1/42 · Adult Collection/Public/main/1/380 · Quiet Reading Room/Public/main/1/140 · Multipurpose Hall/Community/pavilion/1/180 · Meeting Rooms/Community/pavilion/3/28 · Maker Space/Community/pavilion/1/100. (Main Library = Ground + First floors; Community Pavilion = Ground.)
- **3 milestones** (designed areas, brief order): Concept Design `2026-02-12` gross 2480 → `[116,36,208,88,78,93,67,39,83,19,44,392,146,186,86,104]` (net 1,785); Schematic Design `2026-04-08` gross 2410 → `[112,35,201,84,75,90,65,38,80,18,42,378,140,181,84,100]` (net 1,723); Design Development `2026-06-05` gross 2440 → `[108,34,196,80,72,88,63,36,78,19,46,372,150,178,82,96]` (net 1,698).
- **Adjacencies** (16): required — Foyer–Welcome, Foyer–Children's, Open Office–Workroom, Workroom–Book Storage, Book Storage–Loading, Adult Collection–Quiet Reading; desired — Foyer–Café, Foyer–Adult Collection, Foyer–Multipurpose, Children's–Teen, Teen–Maker, Multipurpose–Meeting, Multipurpose–Maker, Multipurpose–Café, Open Office–Staff Lounge, IT–Open Office.

## Assets
No raster assets. Logo mark is a small inline SVG (4 squares + circle). North rose, scale bar, drafting glyphs, contour rings, and the treemap are all CSS/SVG. The only external dependency is the three Google Fonts.

`reference/wits-treemap-reference.png` is the user's target style for the Brief treemap (WITS World Bank, "Germany, Export by Product").

## Files
- `BriefTrack.dc.html` — the full interactive design reference (all four screens, both themes, all interactions). Open it in a browser to inspect exact spacing, colors, motion, and behavior. Use it as the source of truth alongside this README.
- `reference/wits-treemap-reference.png` — treemap style reference for the Brief tab.
