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
      ['Edit area', 'The Areas panel on the right edits areas in a list — bubbles resize as you type.'],
    ],
  },
  {
    title: 'Relationships',
    items: [
      ['Link', 'Click one bubble, then another, to connect them. Each click cycles desired → required → removed.'],
      ['Group', 'In the Brief tab, drag a space onto a building to nest it, or onto the top-level zone to ungroup.'],
      ['Lines', 'Required links are solid and pull rooms close; desired links are dashed and looser. Click a line to cycle it.'],
    ],
  },
  {
    title: 'Scale & images',
    items: [
      ['Scale', 'Pick a standard scale (1:200…1:2000). Bubbles and images are drawn true-to-size and the PDF matches.'],
      ['Layers', 'Add a satellite image (by address) and/or import a site plan. Each is calibrated on its own, then both share the diagram scale and line up.'],
      ['Calibrate', 'Click Calibrate on a layer, mark a known distance on the image, and enter its real length.'],
      ['Move layer', 'Use Move on a layer to nudge it into alignment with the other.'],
    ],
  },
  {
    title: 'View & output',
    items: [
      ['Pan', 'The view is locked by default. Toggle Pan, then drag the canvas. Recentre returns to the middle.'],
      ['North', 'Drag the compass rose (top-right of the canvas) to set project north. Double-click it to reset to up.'],
      ['PDF', 'Export a scale-accurate PDF with the background images, scale bar, north arrow and a title block.'],
      ['Auto-layout', 'Turn it off to place every bubble by hand — positions are saved exactly where you drop them.'],
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
