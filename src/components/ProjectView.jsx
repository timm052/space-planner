import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { buildCsv } from '../compute.js';
import Dashboard from './Dashboard.jsx';
import BubbleTab from './BubbleTab.jsx';
import DesignTab from './DesignTab.jsx';
import ProgramTab from './ProgramTab.jsx';
import SnapshotsTab from './SnapshotsTab.jsx';
import HelpPanel from './HelpPanel.jsx';
import { Banner, Empty } from './ui.jsx';

// "Brief" = the independent agreed programme (brief_spaces). "Design" = the
// live areas that drive the diagram (spaces). Order follows the workflow:
// overview → agree the brief → develop the design → arrange it → record it.
const TABS = ['Dashboard', 'Brief', 'Design', 'Bubble Diagram', 'Milestones'];

export default function ProjectView({ projectId, onBack }) {
  const [data, setData] = useState(null);
  // Brief-first: a fresh project (no design yet) opens on the Brief; established
  // projects keep the Diagram default. `tabState` null = use that heuristic.
  const [tabState, setTab] = useState(null);
  const [error, setError] = useState(null);
  // Shared selection: a space selected on the Diagram highlights in the Brief
  // (and vice-versa). null = nothing selected.
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

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

  const { project, spaces, brief_spaces = [], snapshots, adjacencies = [], brief_adjacencies = [], images = [] } = data;
  const tab = tabState ?? (spaces.length === 0 ? 'Brief' : 'Bubble Diagram');

  function exportCsv() {
    const csv = buildCsv(project, spaces, snapshots, brief_spaces);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^\w-]+/g, '_')}_area_schedule.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const isDiagram = tab === 'Bubble Diagram';

  // Select a space and reveal it on the Diagram — the data screens' "jump to
  // the diagram" affordance, matching the diagram's own click-to-pan rows.
  function goToDiagram(spaceId) {
    setSelectedSpaceId(spaceId);
    setTab('Bubble Diagram');
  }

  // Empty states offer a way to the tab that fixes them ('Brief' | 'Design').
  const goTab = (t) => setTab(t);

  // Copy one diagram room's programme into the Brief (the reverse of "overwrite").
  async function pullToBrief(spaceId) {
    try { await api.pullToBrief(project.id, spaceId); await refresh(); }
    catch (e) { setError(e.message); }
  }

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
            <button
              key={t}
              className={`tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'Bubble Diagram' ? 'Diagram' : t}
              {t === 'Brief' && <span className="tab-count">{brief_spaces.length}</span>}
              {t === 'Design' && <span className="tab-count">{spaces.length}</span>}
              {t === 'Milestones' && <span className="tab-count">{snapshots.length}</span>}
            </button>
          ))}
        </nav>
        <div className="project-bar-actions">
          <button className="btn small" onClick={exportCsv} title="Export the area schedule as CSV">
            ⤓ CSV
          </button>
          <button className="btn small ghost" onClick={() => setShowHelp(true)} title="Workflow guide & help for this page" aria-label="Help">
            ?
          </button>
        </div>
      </div>

      {showHelp && (
        <HelpPanel
          page={isDiagram ? 'diagram' : tab.toLowerCase()}
          onClose={() => setShowHelp(false)}
        />
      )}

      <div className={`project-content ${isDiagram ? 'full' : ''}`}>
        {tab === 'Dashboard' && (
          <Dashboard
            project={project}
            spaces={spaces}
            briefSpaces={brief_spaces}
            snapshots={snapshots}
            selectedSpaceId={selectedSpaceId}
            onGoToDiagram={goToDiagram}
            onGoTab={goTab}
          />
        )}
        {isDiagram && (
          <BubbleTab
            project={project}
            spaces={spaces}
            adjacencies={adjacencies}
            images={images}
            snapshots={snapshots}
            onChanged={refresh}
            selectedSpaceId={selectedSpaceId}
            onSelectSpace={setSelectedSpaceId}
            onPullToBrief={pullToBrief}
            onGoTab={goTab}
          />
        )}
        {tab === 'Brief' && (
          <ProgramTab
            project={project}
            briefSpaces={brief_spaces}
            designCount={spaces.length}
            designSpaces={spaces}
            designAdjacencies={adjacencies}
            briefAdjacencies={brief_adjacencies}
            onChanged={refresh}
          />
        )}
        {tab === 'Design' && (
          <DesignTab
            project={project}
            spaces={spaces}
            briefSpaces={brief_spaces}
            snapshots={snapshots}
            onChanged={refresh}
            selectedSpaceId={selectedSpaceId}
            onSelectSpace={setSelectedSpaceId}
            onPullToBrief={pullToBrief}
          />
        )}
        {tab === 'Milestones' && (
          <SnapshotsTab
            project={project}
            spaces={spaces}
            briefSpaces={brief_spaces}
            snapshots={snapshots}
            onChanged={refresh}
            selectedSpaceId={selectedSpaceId}
            onGoToDiagram={goToDiagram}
            onGoTab={goTab}
          />
        )}
      </div>
    </div>
  );
}
