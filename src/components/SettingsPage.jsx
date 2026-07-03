import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Banner, Empty } from './ui.jsx';

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved'
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch((e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setStatus('saving');
    setError(null);
    try {
      setSettings(await api.saveSettings(settings));
      setStatus('saved');
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setError(err.message);
      setStatus(null);
    }
  }

  if (error && !settings) return <Banner>{error}</Banner>;
  if (!settings) return <Empty>Loading settings…</Empty>;

  const set = (key) => (e) => setSettings({ ...settings, [key]: e.target.value });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Defaults applied to new projects. Existing projects keep their own values.</p>
        </div>
      </div>

      <form className="card settings-form" onSubmit={save}>
        <label>
          Default units
          <select value={settings.default_units} onChange={set('default_units')}>
            <option value="m2">Metric — m² / m</option>
            <option value="ft2">Imperial — ft² / ft</option>
          </select>
          <span className="muted">Used for new projects and their scale/distance inputs.</span>
        </label>

        <label>
          Default area tolerance (%)
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
          Default net : gross efficiency target (%)
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
