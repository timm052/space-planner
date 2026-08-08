import { useState } from 'react';
import StagePopover from './StagePopover.jsx';

/**
 * Title-block fields for the exported sheet.
 *
 * Every sheet left the office carrying only the project name, the stage and
 * today's date. BS EN ISO 7200 treats the identification number, the revision
 * index, the date of issue and the responsible people as mandatory data fields
 * of a title block — without them two prints of the same drawing a month apart
 * are indistinguishable, and nobody can cite the sheet in a letter.
 *
 * Free text throughout: suitability/status codes differ by office (BS 1192
 * S0–S7, "PRELIMINARY", "FOR CONSTRUCTION"), and imposing one is worse than
 * letting the user type theirs.
 */
const FIELDS = [
  { key: 'drawing_number', label: 'Drawing number', placeholder: 'e.g. 1234-XX-00-DR-A-1001', wide: true },
  { key: 'revision', label: 'Revision', placeholder: 'P02' },
  { key: 'issue_status', label: 'Status', placeholder: 'Preliminary' },
  { key: 'drawn_by', label: 'Drawn by', placeholder: 'Initials' },
  { key: 'checked_by', label: 'Checked by', placeholder: 'Initials' },
  { key: 'issue_date', label: 'Issue date', placeholder: 'today', type: 'date', wide: true },
];

export default function TitleBlockPanel({ project, onSave, onClose }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, project[f.key] || '']))
  );
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function save() {
    onSave(Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key].trim()])));
    onClose();
  }

  return (
    <StagePopover className="titleblock-popover" title="Title block" onClose={onClose}>
      <p className="popover-note">
        Printed on every PDF, SVG, .ai and DXF sheet. Blank fields are left off the block.
      </p>
      <div className="titleblock-grid">
        {FIELDS.map((f) => (
          <label key={f.key} className={f.wide ? 'wide' : ''}>
            <span>{f.label}</span>
            <input
              className="ctrl-input"
              type={f.type || 'text'}
              value={form[f.key]}
              placeholder={f.placeholder}
              onChange={set(f.key)}
            />
          </label>
        ))}
      </div>
      <div className="popover-actions">
        <button className="btn small primary" type="button" onClick={save}>Save</button>
        <button className="btn small ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
    </StagePopover>
  );
}
