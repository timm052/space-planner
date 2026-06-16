// Modal overlay explaining the bubble diagram. Kept content-only so it stays
// easy to extend as features grow.
const SECTIONS = [
  {
    title: 'Bubbles',
    items: [
      ['Size', 'Each bubble is a room, sized by its target area. Spaces with a count show one bubble per room.'],
      ['Move', 'Drag a bubble to reposition it. With Auto-layout on, others flow around it.'],
      ['Pin', 'Hover a bubble and press P (or select it and use the Pin button) to pin/unpin it. Pinned bubbles wear a dashed ring and never move.'],
      ['Box', 'Hover a bubble and press B to switch it between a circle and an equal-area square. Use “All boxes / All bubbles” to convert every space at once.'],
      ['Multi-select', 'Drag across empty canvas to marquee-select bubbles, or Shift-click to add/remove them. A toolbar lets you pin, box or delete the whole selection at once. Esc clears it.'],
      ['Move together', 'With several bubbles selected, drag any one of them to move the whole group; they pin where you drop them.'],
      ['Categories', 'Bubbles colour by category. Recolour any category by clicking its legend swatch. Select bubbles and use the Category box to reassign them — typing a new name creates that category.'],
      ['Style', 'Choose how bubbles are drawn: Solid, Outline, or a hand-drawn Sketch look.'],
      ['Nesting', 'In the Brief, a space with children can be a grouping (areas sum), keep its children Within its own area, or Attached so they move with it on the diagram.'],
      ['Edit area', 'The Areas panel edits areas in a list — collapse categories, or switch to Building mode to see them by building and level. Bubbles resize as you type.'],
    ],
  },
  {
    title: 'Relationships',
    items: [
      ['Link', 'Click one bubble, then another, to connect them. Each click cycles desired → required → removed.'],
      ['Matrix', 'Open ▦ Matrix for the classic triangular adjacency grid — click a cell to cycle the same desired → required → none.'],
      ['Group', 'In the Brief tab, drag a space onto a building to nest it, or onto the top-level zone to ungroup.'],
      ['Group hulls', 'Toggle ⬡ Groups to draw a soft hull behind each department or building so containment reads at a glance.'],
      ['Lines', 'Required links are solid and pull rooms close; desired links are dashed and looser. Click a line to cycle it.'],
      ['Adjacency score', 'With a scale set, the ◈ Adjacency badge shows what share of your relationships are actually satisfied (bubbles placed adjacent), weighting required links double. Click it to highlight the unmet links in red.'],
    ],
  },
  {
    title: 'Scale & images',
    items: [
      ['Scale', 'Pick a standard scale (1:200…1:2000). Bubbles and images are drawn true-to-size and the PDF matches.'],
      ['Layers', 'Add a satellite image (by address) and/or import a site plan. Each is calibrated on its own, then both share the diagram scale and line up.'],
      ['Calibrate', 'Click Calibrate on a layer, mark a known distance on the image, and enter its real length.'],
      ['Move layer', 'Use Move on a layer to nudge it, or Rotate then drag the canvas to turn it. Add as many images as you like.'],
      ['Filters', 'Apply a diagrammatic filter to any image (grayscale, blueprint, faded, high-contrast, ink) — it carries through to the PDF.'],
    ],
  },
  {
    title: 'View & output',
    items: [
      ['Floors', 'When the brief uses levels, the ▤ Floors menu switches between all floors together, one floor at a time, or the floor plans stacked — offset apart, or overlaid on top of each other to compare footprints. Stacked views are read-only — pick a single floor to edit.'],
      ['Pan', 'The view is locked by default. Toggle Pan, then drag the canvas. Recentre returns to the middle.'],
      ['North', 'Drag the compass rose (top-right of the canvas) to set project north. Double-click it to reset to up.'],
      ['PDF', 'Export a scale-accurate PDF with the background images, scale bar, north arrow and a title block.'],
      ['Auto-layout', 'Turn it off to place every bubble by hand — positions are saved exactly where you drop them.'],
      ['Undo / redo', 'Pin, move, link, shape and area edits are undoable — use the ↶/↷ buttons or Ctrl+Z / Ctrl+Shift+Z.'],
    ],
  },
];

export default function HelpPanel({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Bubble diagram — how it works</h2>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="help-grid">
          {SECTIONS.map((sec) => (
            <div key={sec.title} className="help-section">
              <h3>{sec.title}</h3>
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
