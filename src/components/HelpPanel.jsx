// Modal overlay explaining the diagram. Content is organised around the three
// environments (Concept → Master plan → Building); the section for the
// environment that's open is listed first and tagged "you are here".
const SHORTCUTS = {
  Mouse: [
    ['Click', 'Select a room — or a link'],
    ['Drag a room', 'Move it (position is saved where you drop it)'],
    ['Drag empty canvas', 'Marquee multi-select'],
    ['Shift-click', 'Add / remove from the selection'],
    ['Hold Space + drag', 'Pan the view'],
    ['Click a link', 'Edit it — desired / required / remove'],
    ['Right-click a corner handle', 'Cycle its corner style (curve → fillet → sharp)'],
    ['Double-click north', 'Reset project north'],
  ],
  Keyboard: [
    ['V', 'Select tool'],
    ['L', 'Link tool — click two rooms'],
    ['A', 'Auto-layout pass (Concept only)'],
    ['P', 'Pin / unpin (Concept only)'],
    ['← ↑ ↓ →', 'Nudge 1 m — Shift = 0.1 m (Master plan / Building)'],
    ['Alt while dragging', 'Finer grid snap (Master plan / Building)'],
    ['⌫ / Del', 'Remove selection'],
    ['Esc', 'Deselect'],
    ['Ctrl+Z / Ctrl+⇧+Z', 'Undo / redo'],
  ],
};

const SECTIONS = [
  {
    env: null,
    title: 'The three environments',
    items: [
      ['Pipeline', 'The diagram is three workspaces, one per design stage: ◯ Concept (what relates to what), ▱ Master plan (what fits where on the site), ▤ Building (what stacks inside each building). The switcher shows each stage’s progress.'],
      ['Independent layouts', 'Each environment keeps its own positions. Moving a bubble in Concept never moves a placed footprint — entering an environment for the first time seeds it from the previous stage, then it diverges.'],
      ['Areas flow from the brief', 'Edit a target area anywhere (the Areas panel, the Brief) and every environment’s geometry re-locks to it — bubbles resize, polygons and boxes rescale while keeping their shape.'],
      ['Geometry per environment', 'Shape is decided by the environment, not per room: Concept draws circles, Master plan draws footprint polygons, Building draws rectangles. There are no manual shape toggles.'],
      ['Navigate', 'Scroll to zoom about the cursor (pinch on a trackpad); hold Space and drag to pan. The ✛ dock button fits the whole program in view. Each environment remembers its own framing.'],
      ['Select', 'Ctrl+A selects every visible room. Esc closes whatever is open first (help, matrix, panels), then clears the selection.'],
      ['Audit the layout', 'The ◈ badge opens the unmet-relationships list — click a row to fly to that pair. The ▦ matrix grades every declared pair against the current layout (green met · red unmet).'],
    ],
  },
  {
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
    env: 'masterplan',
    title: 'Master plan — envelopes on the site',
    items: [
      ['Buildings, not rooms', 'With buildings in the brief, the master plan places one ENVELOPE per building — the building’s footprint. (A flat brief without buildings places rooms directly.)'],
      ['Place', 'Un-placed buildings wait in the tray as ghosts at their concept position. Place (or drag) writes them onto the site and seeds a hexagonal outline sized to the required footprint.'],
      ['Envelope area', 'The badge shows the drawn footprint against the REQUIRED one (the building’s biggest storey) and turns red when the envelope is too small. Select an envelope to set its area by number.'],
      ['Outline', '✎ Shape edits the envelope’s outline — drag corners, click ＋ to add one, double-click to remove. The outline stays area-locked; only its shape changes.'],
      ['Corner styles', 'While editing, every corner can be a smooth curve, a tight fillet or a sharp corner: the action-bar buttons set all corners at once, right-clicking a handle cycles just that one (circle = curve, rounded square = fillet, square = sharp). Styles carry through the stacked, 3-D and PDF views.'],
      ['From the concept hull', 'The ⬡ Hull button reshapes a selected envelope to match its building’s hull in the Concept view; “⬡ Envelopes from concept hulls” in the ⋯ menu does every building at once. Only the shape transfers — the area stays locked to the envelope.'],
      ['Interior sketch', 'Placed envelopes show their rooms as shaded cells (the 👁 dock button toggles it). Cells are AREA-TRUE: each one is sized to its room’s share of the programme, positioned from the Concept layout — so the sketch reads as a plan. Every cell turns red-dashed when the storey doesn’t fit the envelope. Click a cell to select its room (the Link tool works on cells too); dragging a cell moves the whole building; a selected room’s linked partners get a teal outline.'],
      ['Re-plan a room', 'Drag a cell’s dot to move the room inside its envelope — the cells re-balance live, and the move saves back to the Concept view and pins the room there.'],
      ['One storey at a time', 'With levels assigned, the Interior selector in the toolbar picks which storey’s rooms fill each envelope (ground by default — a floor plate holds one storey, so there is no “all floors” overlay). Rooms without a level count as ground.'],
      ['Circulation', 'The ⤨ % field on a selected envelope reserves a circulation share of the gross footprint (empty = the project’s net:gross default, 0 = off). It grosses up the required footprint and hatches the interior the room cells leave free.'],
      ['Building links', 'Room relationships that cross buildings roll up into building-to-building links between the envelopes (hover one for the count), and the ◈ badge grades them in metres — so the site layout answers the Concept’s demands.'],
      ['Site & scale', '⧉ Layers imports site plans / satellite images; calibrate one to set the real scale (or pick a preset). North, the scale bar and the metric grid follow.'],
      ['Authored, always', 'There is no simulation here — nothing ever moves by itself. Overlapping footprints get a red dashed warning outline instead of being pushed apart.'],
      ['Precision', 'Drags snap to neighbour edges/corners and to the metric grid (two toggles in the dock; Alt = finer). Arrow keys nudge 1 m, Shift-arrows 0.1 m. The ⟲ handle rotates a footprint (Shift = 15°) — or type exact degrees in the action bar’s ⟲ field.'],
    ],
  },
  {
    env: 'building',
    title: 'Building — floors & massing',
    items: [
      ['Block up', 'Rooms enter this environment via the tray’s Block up: each building’s rooms are packed per floor INSIDE its envelope outline, linked rooms seeded next to each other (anything that genuinely doesn’t fit parks just below the envelope).'],
      ['Rectangles', 'Every room is an area-locked rectangle: drag a corner handle to change its proportions (the target area holds, the opposite corner stays pinned), ⟲ 90° turns it.'],
      ['Floors', 'You land on one floor at a time — the Floors menu (or the Stacking rail) switches storeys; “All floors”, stacked and 3-D views are read-only overviews.'],
      ['Focus', 'Click a building in the Stacking rail to fade everything else; its master-plan envelope shows as a dashed underlay to arrange rooms inside.'],
      ['Stacking rail', 'Per building: gross area per floor as a bar chart, the envelope footprint it must fit (red when a storey exceeds it), click a row to edit that floor.'],
      ['Vertical links', 'A room linked to another floor wears an ↑/↓/↕ tab — green when the pair stacks in plan (stairs/lifts line up), red when it doesn’t. Click the tab to jump to the partner’s floor with it selected.'],
      ['Heights', 'Storey heights live at the top of the Stacking rail (per level, in metres; 3.5 m default). A selected room’s ↥ field sets its own clear height — taller than its storey reads as a double-height / multi-floor volume in 3-D. Heights need the drawing scale to show at true proportion.'],
      ['3-D', 'Stacked · 3D is a WebGL model — orbit, zoom, switch camera presets, floor spacing via the ⇕ slider, site image on the ground floor. With a scale set, storeys stack at their real heights.'],
    ],
  },
  {
    env: null,
    title: 'Output',
    items: [
      ['PDF sheet', '↓ PDF exports the open environment: the concept diagram as an NTS sheet, master plan and floor sheets scale-accurate with title block, scale bar and north.'],
      ['Drawing set', '↓ Set exports everything at once — concept sheet, master plan sheet and one sheet per floor — as a single PDF, built from each environment’s saved layout.'],
      ['PNG', '↓ PNG captures the current view at 2×, including the 3-D view.'],
      ['Undo / redo', 'Moves, placements, links, shapes and area edits are undoable — ↶/↷ or Ctrl+Z / Ctrl+Shift+Z. History is per environment session.'],
    ],
  },
];

export default function HelpPanel({ env = 'concept', onClose }) {
  // The current environment's section floats to the top of the grid.
  const sections = [...SECTIONS].sort((a, b) => (b.env === env ? 1 : 0) - (a.env === env ? 1 : 0));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Diagram — shortcuts &amp; how it works</h2>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
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
        <div className="help-grid">
          {sections.map((sec) => (
            <div key={sec.title} className="help-section">
              <h3>
                {sec.title}
                {sec.env === env && <span className="help-here"> · you are here</span>}
              </h3>
              <dl>
                {sec.items.map(([term, desc]) => (
                  <div key={term} className="help-item">
                    <dt>{term}</dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
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
