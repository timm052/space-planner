import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { buildCsv } from '../compute.js';
import Dashboard from './Dashboard.jsx';
import BubbleTab from './BubbleTab.jsx';
import LegacyDiagramTab from './LegacyDiagramTab.jsx';
import BriefTab from './BriefTab.jsx';
import SnapshotsTab from './SnapshotsTab.jsx';
import { Banner, Empty } from './ui.jsx';

const TABS = ['Dashboard', 'Bubble Diagram', 'Brief', 'Milestones'];
// Frozen pre-refactor diagram, revealed by the dev toggle for side-by-side
// comparison with the live (decomposed) diagram. See LegacyDiagramTab.jsx.
const LEGACY_TAB = 'Diagram (Legacy)';

export default function ProjectView({ projectId, onBack }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('Bubble Diagram');
  const [error, setError] = useState(null);
  // Dev toggle (persisted) that reveals the frozen legacy diagram tab.
  const [devMode, setDevMode] = useState(() => localStorage.getItem('bt_dev') === '1');
  useEffect(() => {
    localStorage.setItem('bt_dev', devMode ? '1' : '0');
  }, [devMode]);
  // If the legacy tab is showing and dev mode is turned off, fall back.
  useEffect(() => {
    if (!devMode && tab === LEGACY_TAB) setTab('Bubble Diagram');
  }, [devMode, tab]);
  // Shared selection: a space selected on the Diagram highlights in the Brief
  // (and vice-versa). null = nothing selected.
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);

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

  if (error) return <div className="scroll"><div className="page"><Banner>{error}</Banner></div></div>;
  if (!data) return <div className="scroll"><div className="page"><Empty>Loading project…</Empty></div></div>;

  const { project, spaces, snapshots, adjacencies = [], images = [] } = data;

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
  const isLegacyDiagram = tab === LEGACY_TAB;
  const navTabs = devMode ? [...TABS, LEGACY_TAB] : TABS;

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
          {navTabs.map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? 'active' : ''} ${t === LEGACY_TAB ? 'tab-legacy' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'Bubble Diagram' ? 'Diagram' : t}
              {t === 'Brief' && <span className="tab-count">{spaces.length}</span>}
              {t === 'Milestones' && <span className="tab-count">{snapshots.length}</span>}
            </button>
          ))}
        </nav>
        <div className="project-bar-actions">
          <button
            className={`btn small ${devMode ? 'on' : ''}`}
            onClick={() => setDevMode((v) => !v)}
            title="Dev: reveal the frozen legacy diagram tab for side-by-side comparison"
            aria-pressed={devMode}
          >
            🧪 Dev
          </button>
          <button className="btn small" onClick={exportCsv} title="Export the area schedule as CSV">
            ⤓ CSV
          </button>
        </div>
      </div>

      <div className={`project-content ${isDiagram || isLegacyDiagram ? 'full' : ''}`}>
        {tab === 'Dashboard' && (
          <Dashboard project={project} spaces={spaces} snapshots={snapshots} />
        )}
        {isDiagram && (
          <BubbleTab
            project={project}
            spaces={spaces}
            adjacencies={adjacencies}
            images={images}
            onChanged={refresh}
            selectedSpaceId={selectedSpaceId}
            onSelectSpace={setSelectedSpaceId}
          />
        )}
        {isLegacyDiagram && (
          <LegacyDiagramTab
            project={project}
            spaces={spaces}
            adjacencies={adjacencies}
            images={images}
            onChanged={refresh}
            selectedSpaceId={selectedSpaceId}
            onSelectSpace={setSelectedSpaceId}
          />
        )}
        {tab === 'Brief' && (
          <BriefTab
            project={project}
            spaces={spaces}
            onChanged={refresh}
            selectedSpaceId={selectedSpaceId}
            onSelectSpace={setSelectedSpaceId}
          />
        )}
        {tab === 'Milestones' && (
          <SnapshotsTab project={project} spaces={spaces} snapshots={snapshots} onChanged={refresh} />
        )}
      </div>
    </div>
  );
}
