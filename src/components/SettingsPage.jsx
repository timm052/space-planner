import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Banner, Empty } from './ui.jsx';
import { BENCHMARKS, parseBenchmarks } from '../benchmarks.js';

// Deep copy so edits never mutate the shared built-in library.
const cloneLib = (lib) => lib.map((g) => ({ type: g.type, items: g.items.map((it) => ({ ...it })) }));

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved'
  const [error, setError] = useState(null);
  // Benchmark library editor state: the working copy plus whether it is a
  // custom library (false = tracking the built-ins, saved as '').
  const [lib, setLib] = useState(null);
  const [custom, setCustom] = useState(false);
  const [benchType, setBenchType] = useState('');

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      const stored = parseBenchmarks(s.benchmarks);
      setLib(cloneLib(stored || BENCHMARKS));
      setCustom(!!stored);
      setBenchType((stored || BENCHMARKS)[0]?.type || '');
    }).catch((e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setStatus('saving');
    setError(null);
    try {
      const cleaned = lib
        .map((g) => ({ ...g, items: g.items.filter((it) => it.label.trim() && Number(it.m2) > 0) }))
        .filter((g) => g.type.trim() && g.items.length > 0);
      const next = await api.saveSettings({
        ...settings,
        benchmarks: custom ? JSON.stringify(cleaned) : '',
      });
      setSettings(next);
      setStatus('saved');
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setError(err.message);
      setStatus(null);
    }
  }

  if (error && !settings) return <Banner>{error}</Banner>;
  if (!settings || !lib) return <Empty>Loading settings…</Empty>;

  const set = (key) => (e) => setSettings({ ...settings, [key]: e.target.value });

  // ---- benchmark editor helpers (all mark the library custom) ----
  const group = lib.find((g) => g.type === benchType) || lib[0];
  const editLib = (fn) => { setCustom(true); setLib((cur) => { const next = cloneLib(cur); fn(next); return next; }); };
  const setItem = (ix, field, value) =>
    editLib((next) => { const g = next.find((x) => x.type === group.type); if (g) g.items[ix][field] = value; });
  const addItem = () =>
    editLib((next) => { const g = next.find((x) => x.type === group.type); if (g) g.items.push({ label: '', m2: 10, per: 'unit', v: null }); });
  const removeItem = (ix) =>
    editLib((next) => { const g = next.find((x) => x.type === group.type); if (g) g.items.splice(ix, 1); });
  const addType = () => {
    const name = window.prompt('New building type');
    if (!name || !name.trim()) return;
    const t = name.trim();
    if (lib.some((g) => g.type.toLowerCase() === t.toLowerCase())) { setBenchType(lib.find((g) => g.type.toLowerCase() === t.toLowerCase()).type); return; }
    editLib((next) => next.push({ type: t, items: [{ label: '', m2: 10, per: 'unit', v: null }] }));
    setBenchType(t);
  };
  const removeType = () => {
    if (lib.length <= 1 || !window.confirm(`Remove the "${group.type}" benchmarks?`)) return;
    const remaining = lib.filter((g) => g.type !== group.type);
    editLib((next) => next.splice(next.findIndex((g) => g.type === group.type), 1));
    setBenchType(remaining[0].type);
  };
  const resetLib = () => {
    if (custom && !window.confirm('Discard the custom library and return to the built-in benchmarks?')) return;
    setLib(cloneLib(BENCHMARKS));
    setCustom(false);
    setBenchType(BENCHMARKS[0].type);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Application-wide defaults. Existing projects keep their own values.</p>
        </div>
      </div>

      <form className="card settings-form" onSubmit={save}>
        <h2 className="settings-sec-title">New-project defaults</h2>

        <div className="settings-grid">
          <label>
            Units
            <select value={settings.default_units} onChange={set('default_units')}>
              <option value="m2">Metric — m² / m</option>
              <option value="ft2">Imperial — ft² / ft</option>
            </select>
            <span className="muted">Used for new projects and their scale/distance inputs.</span>
          </label>

          <label>
            Area tolerance (%)
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={settings.default_tolerance}
              onChange={set('default_tolerance')}
            />
            <span className="muted">How far a designed area may drift from the brief before it is flagged.</span>
          </label>

          <label>
            Net : gross efficiency target (%)
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={settings.default_grossing}
              onChange={set('default_grossing')}
            />
            <span className="muted">The wall-to-wall efficiency your designs should achieve.</span>
          </label>

          <label>
            Circulation allowance (%)
            <input
              type="number"
              min="0"
              max="60"
              step="1"
              value={settings.default_circulation ?? ''}
              placeholder="—"
              onChange={set('default_circulation')}
            />
            <span className="muted">Corridors, cores &amp; structure as a share of gross. Blank = set per project later (Brief tab).</span>
          </label>
        </div>

        <h2 className="settings-sec-title">Benchmark library</h2>
        <p className="muted settings-sec-sub">
          The space-planning allowances offered in every project&rsquo;s Brief tab
          {custom ? ' — customised' : ' — the built-in set'}. Projects can override this with their own library from the Benchmarks card.
        </p>

        <div className="bench-editor">
          <div className="bench-editor-bar">
            <select value={group.type} onChange={(e) => setBenchType(e.target.value)} aria-label="Building type">
              {lib.map((g) => <option key={g.type} value={g.type}>{g.type}</option>)}
            </select>
            <button className="btn small ghost" type="button" onClick={addType}>＋ Type</button>
            <button className="btn small ghost" type="button" onClick={removeType} disabled={lib.length <= 1}>✕ Type</button>
            <span className="bench-editor-spacer" />
            <button className="btn small ghost" type="button" onClick={resetLib} disabled={!custom} title="Return to the built-in benchmark set">↺ Built-in defaults</button>
          </div>
          <div className="bench-editor-head">
            <span>Allowance</span><span>m²</span><span>per</span><span>@variable</span><span />
          </div>
          {group.items.map((it, ix) => (
            <div className="bench-editor-row" key={ix}>
              <input value={it.label} placeholder="e.g. Meeting room" onChange={(e) => setItem(ix, 'label', e.target.value)} />
              <input type="number" min="0.01" step="any" value={it.m2} onChange={(e) => setItem(ix, 'm2', Number(e.target.value))} />
              <input value={it.per} placeholder="unit" onChange={(e) => setItem(ix, 'per', e.target.value)} />
              <input value={it.v || ''} placeholder="—" onChange={(e) => setItem(ix, 'v', e.target.value.trim() ? (e.target.value.trim().startsWith('@') ? e.target.value.trim() : `@${e.target.value.trim()}`) : null)} />
              <button className="row-btn danger" type="button" title="Remove this allowance" onClick={() => removeItem(ix)}>✕</button>
            </div>
          ))}
          <button className="btn small ghost bench-add" type="button" onClick={addItem}>＋ Allowance</button>
          <p className="muted settings-sec-sub">Values are m² — converted for imperial projects at display time. A @variable makes the copied formula scale (e.g. <code>=@staff * 8</code>).</p>
        </div>

        {error && <div className="field-error">{error}</div>}
        <div className="form-actions">
          <button className="btn primary" disabled={status === 'saving'}>
            {status === 'saving' ? 'Saving…' : 'Save settings'}
          </button>
          {status === 'saved' && <span className="ok-text">Saved ✓</span>}
        </div>
      </form>
    </div>
  );
}
