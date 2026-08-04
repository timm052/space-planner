import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtArea, fmtPct, briefNet } from '../compute.js';
import BriefTab from './BriefTab.jsx';
import { Overlay } from './ui.jsx';

// The "Design" tab: the live areas that drive the diagram, plus design
// OPTIONS — named saves of the whole design (rooms + links) so Option A/B
// schemes can be compared against one Brief and swapped in.
export default function DesignTab({
  project, spaces, briefSpaces = [], snapshots, onChanged,
  selectedSpaceId, onSelectSpace, onPullToBrief,
}) {
  const [showOptions, setShowOptions] = useState(false);
  const actions = (
    <button
      className="btn small"
      type="button"
      onClick={() => setShowOptions(true)}
      title="Save, compare and switch design options (Option A / B)"
    >
      ◧ Options
    </button>
  );
  return (
    <>
      <BriefTab
        project={project}
        spaces={spaces}
        briefSpaces={briefSpaces}
        snapshots={snapshots}
        onChanged={onChanged}
        selectedSpaceId={selectedSpaceId}
        onSelectSpace={onSelectSpace}
        onPullToBrief={onPullToBrief}
        programActions={actions}
      />
      {showOptions && (
        <OptionsDialog project={project} briefSpaces={briefSpaces} onChanged={onChanged} onClose={() => setShowOptions(false)} />
      )}
    </>
  );
}

function OptionsDialog({ project, briefSpaces, onChanged, onClose }) {
  const [opts, setOpts] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null); // option row being loaded
  const [saveFirst, setSaveFirst] = useState(true);
  const [saveName, setSaveName] = useState('');
  const [result, setResult] = useState(null);
  const briefTotal = briefNet(briefSpaces);

  useEffect(() => {
    let alive = true;
    api.options(project.id).then((o) => alive && setOpts(o)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [project.id]);

  async function refresh() {
    setOpts(await api.options(project.id));
  }
  async function save() {
    const label = name.trim() || `Option ${String.fromCharCode(65 + Math.min(25, opts?.length || 0))}`;
    setBusy(true); setError(null);
    try { await api.saveOption(project.id, label); setName(''); await refresh(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function remove(opt) {
    if (!window.confirm(`Delete option "${opt.name}"?`)) return;
    setError(null);
    try { await api.deleteOption(opt.id); await refresh(); }
    catch (e) { setError(e.message); }
  }
  function startLoad(opt) {
    setConfirming(opt);
    setSaveFirst(true);
    setSaveName(`Before ${opt.name}`);
    setResult(null);
  }
  async function confirmLoad() {
    setBusy(true); setError(null);
    try {
      const r = await api.loadOption(project.id, confirming.id, saveFirst ? { saveCurrentAs: saveName.trim() || `Before ${confirming.name}` } : {});
      setResult({ ...r, name: confirming.name });
      setConfirming(null);
      await refresh();
      onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <Overlay title="Design options" onClose={onClose}>
      <p className="modal-body">
        Save the current design as a named option, then switch between options. Rooms are matched by
        name and parent when switching, so milestone records for matched rooms are kept.
      </p>
      {error && <p className="modal-error">{error}</p>}
      {result && (
        <p className="modal-note" style={{ color: 'var(--good)' }}>
          Loaded “{result.name}” — {result.updated} room{result.updated === 1 ? '' : 's'} kept, {result.added} added, {result.deleted} removed
          {result.lostAreas > 0 ? ` (${result.lostAreas} recorded milestone area${result.lostAreas === 1 ? '' : 's'} went with the removed rooms)` : ''}.
        </p>
      )}
      <div className="diff-list">
        {!opts ? (
          <p className="modal-body" style={{ padding: 0 }}>Loading…</p>
        ) : opts.length === 0 ? (
          <p className="modal-note" style={{ padding: 0 }}>No options saved yet.</p>
        ) : (
          <div className="diff-section">
            {opts.map((o) => {
              const vs = briefTotal > 0 ? (o.net - briefTotal) / briefTotal : null;
              return (
                <div className="diff-row" key={o.id} style={{ cursor: 'default' }}>
                  <span className="diff-name">
                    {o.name}
                    <span className="muted"> · {o.created_at?.slice(0, 10)} · {o.room_count} rooms</span>
                  </span>
                  <span className="diff-val">
                    {fmtArea(o.net, project.units)}{vs != null ? ` · vs Brief ${fmtPct(vs)}` : ''}
                  </span>
                  <button className="btn small ghost" type="button" onClick={() => startLoad(o)} title="Replace the current design with this option">Load</button>
                  <button className="row-btn danger" type="button" onClick={() => remove(o)} title="Delete option">✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {confirming ? (
        <div className="modal-fields" style={{ flexDirection: 'column', gap: 8 }}>
          <p className="modal-note" style={{ padding: 0 }}>
            Load <b>{confirming.name}</b>? The current design will be replaced (matched rooms keep their
            placement history; unmatched ones are removed).
          </p>
          <label className="import-group">
            <input type="checkbox" checked={saveFirst} onChange={(e) => setSaveFirst(e.target.checked)} />
            Save the current design first as
            <input
              style={{ flex: 1, minWidth: 120 }}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              disabled={!saveFirst}
            />
          </label>
          <div className="modal-actions" style={{ padding: 0 }}>
            <button className="btn primary" type="button" disabled={busy} onClick={confirmLoad}>
              {busy ? 'Loading…' : `Load ${confirming.name}`}
            </button>
            <button className="btn ghost" type="button" onClick={() => setConfirming(null)}>Back</button>
          </div>
        </div>
      ) : (
        <div className="modal-fields">
          <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              placeholder={`Option ${String.fromCharCode(65 + Math.min(25, opts?.length || 0))}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            />
            <button className="btn small primary" type="button" disabled={busy} onClick={save} title="Save the current design as a new option">
              ⊕ Save current
            </button>
          </label>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn ghost" type="button" onClick={onClose}>Close</button>
      </div>
    </Overlay>
  );
}
