// Page-aware help overlay. A short workflow guide sits on top; every detail
// section below is collapsible, and only the sections for the page (and, on
// the diagram, the open environment) start expanded — so the panel reads as a
// one-screen guide, not a manual.
const SHORTCUTS = {
  Mouse: [
    ['Click', 'Select a room — or a link'],
    ['Drag a room', 'Move it (position is saved where you drop it)'],
    ['Drag empty canvas', 'Marquee multi-select'],
    ['Shift-click', 'Add / remove from the selection'],
    ['Drag right→left', 'Crossing select — takes every room the box touches'],
    ['Drag left→right', 'Window select — takes only rooms fully inside the box'],
    ['Hold Space + drag', 'Pan the view'],
    ['Hold right button + drag', 'Pan the view (a plain right-click opens the room menu)'],
    ['Middle button + drag', 'Pan the view'],
    ['Pinch (touch)', 'Zoom about the midpoint between your fingers'],
    ['Click a link', 'Edit it — desired / required / remove'],
    ['Right-click a room', 'Quick actions — pin, edit outline, rotate, remove'],
    ['Right-click a corner handle', 'Cycle its corner style (curve → fillet → sharp)'],
    ['Double-click north', 'Reset project north'],
    ['Drag with the Markup tool', 'Draw a redline stroke (Escape abandons it mid-stroke)'],
    ['Drag with the Measure tool', 'Read a distance; hold Shift to constrain to an axis'],
  ],
  Keyboard: [
    ['Ctrl+K', 'Find a room or command — select & fly to it'],
    ['V', 'Select tool'],
    ['L', 'Link tool — drag from room to room'],
    ['D', 'Markup tool — freehand redline over the drawing'],
    ['M', 'Measure tool — drag to read a distance at the drawing’s scale'],
    ['A', 'Auto-layout pass (Concept only)'],
    ['P', 'Pin / unpin (Concept only)'],
    ['+ / − / 0', 'Zoom in / out / fit the program in view'],
    ['Tab / ⇧Tab', 'With a room selected — step through the visible rooms'],
    ['← ↑ ↓ →', 'Nudge the selection — 1 m (Shift = 0.1 m) once scaled. While editing an outline, nudges the selected corner instead'],
    ['Alt while dragging', 'Finer grid snap (Master plan / Building)'],
    ['⌫ / Del', 'Remove the selection — one room or many (undoable)'],
    ['Esc', 'Cancel the drag in progress → close what is open → leave outline editing → deselect'],
    ['Ctrl+Z / Ctrl+⇧+Z', 'Undo / redo — including deletions'],
  ],
};

// The workflow in order; `page` keys match HelpPanel's `page` prop.
const WORKFLOW = [
  ['Brief', 'brief', 'Agree the programme — rooms, counts, areas & formulas. Import from a spreadsheet, lean on benchmarks, save dated revisions.'],
  ['Send to Design', 'design', 'Push the Brief onto the Design tab (per-row preview). The Design schedule is the live copy the diagram draws.'],
  ['Diagram', 'diagram', 'Arrange it: ◯ Concept relationships → ▱ Master plan envelopes on the site → ▤ Building floors & massing.'],
  ['Milestones', 'milestones', 'Record designed areas at each stage — one click prefills from the current design.'],
  ['Dashboard', 'dashboard', 'Watch drift against the Brief: KPIs, drift chart, flagged rooms and the change log.'],
];

const SECTIONS = [
  {
    page: 'brief',
    title: 'Brief — the agreed programme',
    items: [
      ['An independent record', 'The Brief is its own room tree, decoupled from the diagram — edit it freely; nothing moves until you Send to Design.'],
      ['Import', '⇪ Import pastes a schedule straight from Excel/Sheets (name · category · count · area), optionally grouped into zones by category.'],
      ['Formulas', 'Any area cell accepts =formulas: @variables, [Room] references, min/max/round/sum, percentages. Typing @ or [ suggests as you go.'],
      ['Benchmarks', 'Typical allowances per building type as ready-made formulas — customise the library per project (✎) or app-wide in Settings.'],
      ['Grossing', 'The circulation allowance estimates gross from net, feeds the master plan’s envelope sizing and the milestone editor.'],
      ['Required adjacencies', 'Declare which rooms must sit together; the card scores them against the diagram’s actual links.'],
      ['Revisions', 'Save the Brief as a dated revision (Rev A/B/C) and diff the current programme against it later.'],
      ['Milestone', '◷ records the Brief’s areas as targets mapped onto the design by name.'],
    ],
  },
  {
    page: 'design',
    title: 'Design — the live schedule',
    items: [
      ['Drives the diagram', 'These areas size every bubble, footprint and floor plate. Edit here or on the diagram — same numbers.'],
      ['vs Brief', 'Each row shows its variance against the matching Brief room (by name and parent); the footer totals the net drift.'],
      ['Options', '◧ Options saves whole schemes (Option A / Option B) and swaps between them — matched rooms keep their milestone history.'],
      ['Back to the Brief', 'The ⇥ button on a row (or the diagram’s action bar / right-click menu) copies one room’s programme into the Brief.'],
      ['Sort & subtotals', 'Click a column head to sort the view (drag order is untouched); category subtotals sit in the footer.'],
    ],
  },
  {
    page: 'milestones',
    title: 'Milestones — recorded stages',
    items: [
      ['Record', 'A milestone captures designed areas at a date — “⤓ Use current design areas” prefills every room from the Design tab.'],
      ['Targets', 'Rooms measure against the Brief target when one exists (design targets stand in until then).'],
      ['Gross', '≈ Estimate gross fills the gross area from net × the project’s circulation allowance.'],
      ['Compare', 'The change schedule diffs any two milestones — pick them in the header.'],
    ],
  },
  {
    page: 'dashboard',
    title: 'Dashboard — drift at a glance',
    items: [
      ['Brief is the reference', 'The net KPI, drift chart and milestone deltas measure the design against the Brief once one exists.'],
      ['Flagged spaces', 'Rooms outside tolerance list here — click one to jump to it on the diagram.'],
      ['Change log', 'Recent changes remembers every programme edit (never geometry) with old → new values.'],
    ],
  },
  {
    page: 'diagram',
    env: null,
    title: 'The three environments',
    items: [
      ['Pipeline', 'The diagram is three workspaces, one per design stage: ◯ Concept (what relates to what), ▱ Master plan (what fits where on the site), ▤ Building (what stacks inside each building). The switcher shows each stage’s progress.'],
      ['Independent layouts', 'Each environment keeps its own positions. Moving a bubble in Concept never moves a placed footprint — entering an environment for the first time seeds it from the previous stage, then it diverges.'],
      ['Areas flow from the brief', 'Edit a target area anywhere (the Areas panel, the Brief) and every environment’s geometry re-locks to it — bubbles resize, polygons and boxes rescale while keeping their shape.'],
      ['Geometry per environment', 'Shape is decided by the environment, not per room: Concept draws circles, Master plan draws footprint polygons, Building draws rectangles. There are no manual shape toggles.'],
      ['Navigate', 'Scroll to zoom about the cursor (pinch on a trackpad) or use the zoom cluster bottom-right — its % readout resets to 100%, ⌐¬ fits the program. Hold Space and drag to pan. Each environment remembers its own framing, across sessions.'],
      ['Find anything', 'Ctrl+K (or the ⌕ button) opens the palette: type a room to select it and fly there, or run a command — switch environment, jump to a floor, place or block up everything.'],
      ['Spotlight a group', 'Click a legend label to fade every other category/building — rooms, links, hulls and interior cells all follow. Click again (or Esc) to restore.'],
      ['Colour by status', 'Once a milestone is recorded, the Colour control gains Status: rooms tint red (over target), green (on) or teal (under) against the latest milestone, ± the project tolerance.'],
      ['Adjacency schedule', 'The rail’s Adjacency list grades every relationship against the current layout — red dot = unmet (sorted first), green = satisfied. Click a pair to fly to it.'],
      ['Select', 'Ctrl+A selects every visible room. Esc closes whatever is open first (help, matrix, panels, spotlight), then clears the selection.'],
      ['Audit the layout', 'The ◈ badge opens the unmet-relationships list — click a row to fly to that pair. The ▦ matrix grades every declared pair against the current layout (green met · red unmet).'],
    ],
  },
  {
    page: 'diagram',
    env: 'concept',
    title: 'Concept — bubbles & relationships',
    items: [
      ['Bubbles', 'Each bubble is a room, sized RELATIVE to the largest room (Concept is scale-free). Spaces with a count show one bubble per room.'],
      ['Move & pin', 'Drag to move (saved where you drop it, neighbours step aside after the drop). Hover + P (or the Pin button) locks a bubble against the simulation.'],
      ['Auto-layout', 'A (or the dock button) runs one settling pass of the force layout and stops — opening the tab never rearranges your diagram.'],
      ['Links', 'L, then DRAG from one room to another (a rubber band follows the cursor) — or click two rooms. Click a link to toggle desired/required or remove it. ▦ Matrix shows the classic triangular grid.'],
      ['Adjacency hint', 'The ◈ badge grades relationships against the layout the simulation aims for — a link counts when its bubbles sit at their natural resting distance. Click it to flag the unmet links.'],
      ['Categories & hulls', 'Colour by category or building; recolour via the legend swatches. ⬡ hulls draw soft outlines around each group — the outline hugs the arrangement’s real profile (it digs into empty stretches between clusters; the ⋯ menu’s Hull pad sets how loosely it wraps).'],
      ['Multi-select', 'Marquee across empty canvas or Shift-click. The action bar pins, recategorises or deletes the whole selection; drag any member to move the group.'],
    ],
  },
  {
    page: 'diagram',
    env: 'masterplan',
    title: 'Master plan — envelopes on the site',
    items: [
      ['Buildings, not rooms', 'With buildings in the brief, the master plan places one ENVELOPE per building — the building’s footprint. (A flat brief without buildings places rooms directly.)'],
      ['Place', 'Un-placed buildings wait in the tray as ghosts at their concept position. Place (or drag) writes them onto the site and seeds a hexagonal outline sized to the required footprint.'],
      ['Envelope area', 'The badge under each envelope shows the drawn footprint against the REQUIRED one (the building’s biggest storey) and turns red when the envelope is too small. Select an envelope to set its area by number.'],
      ['Outline', '✎ Shape edits the envelope’s outline — drag corners, click ＋ to add one, double-click to remove, right-click to change a corner’s style. Arrow keys nudge the corner you last touched. Corners snap to neighbouring edges and the metric grid like the envelope itself, and a drag that would fold the outline over itself is refused (the handle turns red) rather than collapsing the area lock. The outline is area-locked by default: only its shape changes.'],
      ['Which rules — the figure or the drawing', 'Beside the drawn-area chip is a lock. 🔒 area (the default, and how the app has always worked) means the stated figure rules and dragging a corner only reshapes. Click it for 🔓 drawn and the DRAWING rules: dragging a corner changes what the footprint encloses and the stated area follows it, in the same undo step. The schedule marks a figure that came off the drawing with ▱, so nobody has to guess where a number came from. A room whose area comes from a formula stays locked — the next resolve would overwrite anything the drag wrote.'],
      ['Corner styles', 'While editing, every corner can be a smooth curve, a tight fillet or a sharp corner: the action-bar buttons set all corners at once, right-clicking a handle cycles just that one (circle = curve, rounded square = fillet, square = sharp). Styles carry through the stacked, 3-D and PDF views.'],
      ['From the concept hull', 'The ⬡ Hull button reshapes a selected envelope to match its building’s hull in the Concept view; “⬡ Envelopes from concept hulls” in the ⋯ menu does every building at once. Only the shape transfers — the area stays locked to the envelope.'],
      ['Interior sketch', 'Placed envelopes show their rooms as shaded cells (the 👁 dock button toggles it). Cells are AREA-TRUE: each one is sized to its room’s share of the programme, positioned from the Concept layout — so the sketch reads as a plan. Every cell turns red-dashed when the storey doesn’t fit the envelope. Click a cell to select its room (the Link tool works on cells too); dragging a cell moves the whole building; a selected room’s linked partners get a teal outline.'],
      ['Re-plan a room', 'Drag a cell’s dot to move the room inside its envelope — the cells re-balance live, and the move saves back to the Concept view and pins the room there.'],
      ['Fit chip', 'Under each sketched envelope, “N of M rooms fit” totals the storey at a glance — red while any room is squeezed below its target.'],
      ['One storey at a time', 'With levels assigned, the Interior selector in the toolbar picks which storey’s rooms fill each envelope (ground by default — a floor plate holds one storey, so there is no “all floors” overlay). Rooms without a level count as ground.'],
      ['Circulation', 'The ⤨ % field on a selected envelope reserves a circulation share of the gross footprint (empty = the project’s circulation allowance from the Brief tab, 0 = off). It grosses up the required footprint and hatches the interior the room cells leave free.'],
      ['Building links', 'Room relationships that cross buildings roll up into building-to-building links between the envelopes (hover one for the count), and the ◈ badge grades them in metres — so the site layout answers the Concept’s demands.'],
      ['Site & scale', '⧉ Layers imports site plans / satellite images; calibrate one to set the real scale (or pick a preset). The scale bar and metric grid follow.'],
      ['North', 'North is anchored to the satellite image: fetching one imports project north from the imagery provider (tiles are north-up), and rotating the image layer carries north with it. The bearing always reads 0–360°. Dragging the compass rose rotates the DESIGN about the site centre — the image and north stay put while the scheme turns onto the site (both the master plan and the building floors, one undoable step). The 🔒 padlock on the rose locks north: the rose goes inert and nothing — image rotation or a new satellite fetch — can move the bearing until you unlock it.'],
      ['Authored, always', 'There is no simulation here — nothing ever moves by itself. Overlapping footprints get a red dashed warning outline instead of being pushed apart.'],
      ['Precision', 'Drags can snap to neighbour edges/corners and to the metric grid (two toggles in the dock, off by default; Alt = finer). Arrow keys nudge 1 m, Shift-arrows 0.1 m. The ⟲ handle rotates a footprint (Shift = 15°) — or type exact degrees in the action bar’s ⟲ field.'],
    ],
  },
  {
    page: 'diagram',
    env: 'building',
    title: 'Building — floors & massing',
    items: [
      ['Block up', 'Rooms enter this environment via the tray’s Block up: each building’s rooms are packed per floor INSIDE its envelope outline, linked rooms seeded next to each other (anything that genuinely doesn’t fit parks just below the envelope).'],
      ['Rectangles', 'Every room is an area-locked rectangle: drag a corner handle to change its proportions (the target area holds, the opposite corner stays pinned), ⟲ 90° turns it.'],
      ['Floors', 'You land on one floor at a time — the Floors menu (or the Stacking rail) switches storeys; “All floors”, stacked and 3-D views are read-only overviews.'],
      ['Move between floors', 'Right-click a room → “Move to …”, or use the ▤ selector in the action bar (works on a multi-selection too). The plan position carries over.'],
      ['Re-pack & stack', 'Right-click → “Re-pack this floor” re-runs the adjacency-greedy grid for that building; the Ctrl+K palette also offers “Re-pack (all buildings)” and “Stack linked rooms” — which moves every room with a cross-floor relationship directly over its partner.'],
      ['Align & distribute', 'With several rooms selected, the action bar gains align (edges / centres, both axes) and distribute (equal gaps) — flush walls without pixel-nudging.'],
      ['Onion skin', 'The layered dock button ghosts the storey above (teal dashes) and below (grey dots) under the floor you are editing — line up stairs, cores and stacked rooms by eye.'],
      ['Fit per floor', 'Each envelope underlay reads “Ground · used / drawn · N% spare” for the floor being edited — the spare share is what is left for circulation & structure, red when it drops below the building’s circulation share.'],
      ['Rename floors', 'Floor names in the Stacking rail are editable — a rename updates every space on that storey (one undo step) and carries the storey height along.'],
      ['Focus', 'Click a building in the Stacking rail to fade everything else; its master-plan envelope shows as a dashed underlay to arrange rooms inside.'],
      ['Stacking rail', 'Per building: gross area per floor as a colour-banded bar chart (segments follow the Colour control — vertical zoning at a glance), the envelope footprint it must fit (red when a storey exceeds it), click a row to edit that floor.'],
      ['Vertical links', 'A room linked to another floor wears an ↑/↓/↕ tab — green when the pair stacks in plan (stairs/lifts line up), red when it doesn’t. Click the tab to jump to the partner’s floor with it selected.'],
      ['Heights', 'Storey heights live at the top of the Stacking rail (per level, in metres; 3.5 m default). A selected room’s ↥ field sets its own clear height — taller than its storey reads as a double-height / multi-floor volume in 3-D. Heights need the drawing scale to show at true proportion.'],
      ['3-D', 'Stacked · 3D is a WebGL model — orbit, zoom, camera preset buttons (Persp / Iso / Plan / Front / Side) top-right, floor spacing via the ⇕ slider, site image on the ground floor. Click a room to select it. With a scale set, storeys stack at their real heights.'],
    ],
  },
  {
    page: 'diagram',
    env: null,
    title: 'Markup — redlining over the drawing',
    items: [
      ['What it is', 'The ✎ Markup tool (D) draws freehand redlines over the plan — circling a clash, sketching an idea, marking something up for a colleague. It is a comment on the drawing, never part of it: markup can never change an area, a total or a compliance figure.'],
      ['Pen', 'While the tool is live the dock shows four colours and three widths. A stroke is committed when you release; Escape mid-stroke abandons it.'],
      ['Notes', 'Switch the tray from ✎ to T and the same tool writes words instead. Click to place a note; drag FROM the thing you mean TO where the words should sit and it gets a leader pointing back at it. Type in the field that appears — Enter places it, Shift+Enter breaks the line, Escape abandons it. A note is markup like any other: it changes no area and no total.'],
      ['Where it lives', 'Markup belongs to the environment you drew it in, and — while you are editing a single floor — to that storey, so a ground-floor note does not float over the first. It is not part of a design option, so switching Option A ⇄ B leaves your redlines alone.'],
      ['It moves with the drawing', 'Ink is authored in the drawing’s own coordinates, so it stays on whatever you drew it over through pan, zoom and a change of drawing scale — and prints at the weight you drew it.'],
      ['Removing it', 'Ctrl+Z undoes the last stroke. “Clear” removes every mark in the current scope as a single undoable step.'],
      ['On the sheet', 'Markup exports with every output — PDF, SVG, .ai and DXF — over the drawing, with notes as real text on their own layer. The sheet says so in the legend, so a marked-up print is never mistaken for an issued drawing.'],
    ],
  },
  {
    page: 'diagram',
    env: null,
    title: 'Output',
    items: [
      ['Export menu', 'Everything ships from the ⤓ Export button: a PNG of the current view (2×, 3-D included), a PDF sheet of the open environment, or the full drawing set.'],
      ['PDF sheet', 'The concept diagram exports as an NTS sheet; master plan and floor sheets are scale-accurate with title block, scale bar and north.'],
      ['Title block', '⊞ Title block… in the export menu sets the drawing number, revision, status, issue date and who drew and checked it — the fields BS EN ISO 7200 treats as mandatory. They print on every output, and a numbered sheet names its own file after the number and revision so two issues file side by side.'],
      ['Drawing set', 'Concept sheet, master plan sheet and one sheet per floor — a single PDF built from each environment’s saved layout.'],
      ['Undo / redo', 'Moves, placements, links, shapes and area edits are undoable — ↶/↷ or Ctrl+Z / Ctrl+Shift+Z. History is per environment session.'],
    ],
  },
];

export default function HelpPanel({ page = 'diagram', env = null, onClose }) {
  // A section starts expanded when it belongs to this page — and, on the
  // diagram, to the open environment (env-null diagram sections expand only
  // when no environment matches, e.g. help opened from the project bar).
  const envMatch = SECTIONS.some((s) => s.page === 'diagram' && s.env === env);
  const isOpen = (sec) =>
    sec.page === page && (page !== 'diagram' || sec.env === env || (!envMatch && sec.env === null && sec.title !== 'Output'));
  const sections = [...SECTIONS].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>How BriefTrack works</h2>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <ol className="help-workflow" aria-label="The workflow">
          {WORKFLOW.map(([label, key, desc], i) => (
            <li key={key} className={key === page ? 'here' : ''}>
              <span className="hw-step">{i + 1}</span>
              <span className="hw-label">{label}{key === page ? ' — you are here' : ''}</span>
              <span className="hw-desc">{desc}</span>
            </li>
          ))}
        </ol>

        <div className="help-grid">
          {sections.map((sec) => (
            <details key={sec.title} className="help-section" open={isOpen(sec)}>
              <summary>
                {sec.title}
                {sec.page === 'diagram' && sec.env != null && sec.env === env && <span className="help-here"> · you are here</span>}
              </summary>
              <dl>
                {sec.items.map(([term, desc]) => (
                  <div key={term} className="help-item">
                    <dt>{term}</dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
          {page === 'diagram' && (
            <details className="help-section" open>
              <summary>Mouse &amp; keyboard</summary>
              <div className="help-shortcuts">
                {Object.entries(SHORTCUTS).map(([col, rows]) => (
                  <div key={col} className="help-shortcut-col">
                    <h3>{col}</h3>
                    {rows.map(([k, desc]) => (
                      <div key={k} className="help-shortcut-row">
                        <kbd>{k}</kbd>
                        <span>{desc}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
