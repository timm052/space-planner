import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtArea } from '../compute.js';

const STAGES = ['Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'On Site'];

export default function ProjectList({ projects, onOpen, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', client: '', stage: 'Concept', units: 'm2' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [defaults, setDefaults] = useState(null);

  // New projects start from the user's saved preferences.
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setDefaults(s);
        setForm((f) => ({ ...f, units: s.default_units || 'm2' }));
      })
      .catch(() => {});
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api.createProject({
        ...form,
        tolerance: defaults ? Number(defaults.default_tolerance) / 100 : 0.05,
        grossing_target: defaults ? Number(defaults.default_grossing) / 100 : 0.7,
      });
      setShowForm(false);
      setForm({ name: '', client: '', stage: 'Concept', units: defaults?.default_units || 'm2' });
      await onChanged();
      onOpen(p.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id, name) {
    if (!window.confirm(`Delete project "${name}" and all its data?`)) return;
    await api.deleteProject(id);
    onChanged();
  }

  if (projects == null) return <div className="empty">Loading projects…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="sub">Track designed areas against the client brief at every milestone.</p>
        </div>
        <button className="btn primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New Project'}
        </button>
      </div>

      {showForm && (
        <form className="card form-grid" onSubmit={create}>
          <label>
            Project name
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Hillside Primary School"
              required
            />
          </label>
          <label>
            Client
            <input
              value={form.client}
              onChange={(e) => setForm({ ...form, client: e.target.value })}
              placeholder="e.g. Dept. of Education"
            />
          </label>
          <label>
            Stage
            <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Units
            <select value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })}>
              <option value="m2">m²</option>
              <option value="ft2">ft²</option>
            </select>
          </label>
          {error && <div className="field-error">{error}</div>}
          <div className="form-actions">
            <button className="btn primary" disabled={busy}>
              Create project
            </button>
          </div>
        </form>
      )}

      {projects.length === 0 ? (
        <div className="empty">No projects yet — create one to start tracking your brief.</div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <div
              key={p.id}
              className="card project-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(p.id);
                }
              }}
            >
              <div className="project-card-head">
                <h2>{p.name}</h2>
                <button
                  className="btn ghost danger small"
                  title="Delete project"
                  aria-label={`Delete project ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(p.id, p.name);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="project-client">{p.client || 'No client set'}</div>
              <div className="chips">
                <span className="chip">{p.stage}</span>
                <span className="chip">{p.space_count} spaces</span>
                <span className="chip">{p.snapshot_count} milestones</span>
              </div>
              <div className="project-net">
                Brief net target: <strong>{p.target_net ? fmtArea(p.target_net, p.units) : '—'}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
