import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { buildCsv } from '../compute.js';
import Dashboard from './Dashboard.jsx';
import BubbleTab from './BubbleTab.jsx';
import BriefTab from './BriefTab.jsx';
import SnapshotsTab from './SnapshotsTab.jsx';

const TABS = ['Dashboard', 'Bubble Diagram', 'Brief', 'Milestones'];

export default function ProjectView({ projectId, onBack }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('Bubble Diagram');
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api.getProject(projectId));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) return <div className="scroll"><div className="page"><div className="banner error">{error}</div></div></div>;
  if (!data) return <div className="scroll"><div className="page"><div className="empty">Loading project…</div></div></div>;

  const { project, spaces, snapshots, adjacencies = [] } = data;

  function exportCsv() {
    const csv = buildCsv(project, spaces, snapshots);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^\w-]+/g, '_')}_area_schedule.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const isDiagram = tab === 'Bubble Diagram';

  return (
    <div className="project-view">
      <div className="project-bar">
        <button className="btn back" onClick={onBack} title="Back to all projects">
          ‹ Projects
        </button>
        <div className="project-bar-id">
          <h1 title={project.name}>{project.name}</h1>
          <span className="sub">
            {project.client || 'No client'} · {project.stage} · ±{Math.round(project.tolerance * 100)}%
          </span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'Bubble Diagram' ? 'Diagram' : t}
              {t === 'Brief' && <span className="tab-count">{spaces.length}</span>}
              {t === 'Milestones' && <span className="tab-count">{snapshots.length}</span>}
            </button>
          ))}
        </nav>
        <div className="project-bar-actions">
          <button className="btn small" onClick={exportCsv} title="Export the area schedule as CSV">
            ⤓ CSV
          </button>
        </div>
      </div>

      <div className={`project-content ${isDiagram ? 'full' : ''}`}>
        {tab === 'Dashboard' && (
          <div className="page">
            <Dashboard project={project} spaces={spaces} snapshots={snapshots} />
          </div>
        )}
        {isDiagram && (
          <BubbleTab project={project} spaces={spaces} adjacencies={adjacencies} onChanged={refresh} />
        )}
        {tab === 'Brief' && (
          <div className="page">
            <BriefTab project={project} spaces={spaces} onChanged={refresh} />
          </div>
        )}
        {tab === 'Milestones' && (
          <div className="page">
            <SnapshotsTab project={project} spaces={spaces} snapshots={snapshots} onChanged={refresh} />
          </div>
        )}
      </div>
    </div>
  );
}
