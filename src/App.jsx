import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import ProjectList from './components/ProjectList.jsx';
import ProjectView from './components/ProjectView.jsx';
import SettingsPage from './components/SettingsPage.jsx';

function BrandLogo() {
  // A drafting mark: nested plan squares with an adjacency bubble + link.
  return (
    <svg className="brand-logo" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="27" height="27" rx="6" stroke="var(--accent)" strokeWidth="2" />
      <rect x="8" y="8" width="9" height="9" rx="2" stroke="var(--muted)" strokeWidth="1.6" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="var(--muted)" strokeWidth="1.6" />
      <circle cx="22" cy="22" r="4" fill="var(--accent)" />
    </svg>
  );
}

export default function App() {
  const [projects, setProjects] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState('projects'); // 'projects' | 'settings'
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function goHome() {
    setPage('projects');
    setSelectedId(null);
    refresh();
  }

  const inProject = page === 'projects' && selectedId != null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={goHome} role="button" tabIndex={0}>
          <BrandLogo />
          <div className="brand-text">
            <span className="brand-name">
              Brief<b>Track</b>
            </span>
            <span className="brand-tag">Programme Studio</span>
          </div>
        </div>
        <nav className="topnav">
          <button className={`navlink ${page === 'projects' && !inProject ? 'active' : ''}`} onClick={goHome}>
            Projects
          </button>
          <button className={`navlink ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
            Settings
          </button>
        </nav>
      </header>

      <main className="main">
        {error && (
          <div className="scroll">
            <div className="page">
              <div className="banner error">{error}</div>
            </div>
          </div>
        )}
        {page === 'settings' ? (
          <div className="scroll">
            <SettingsPage />
          </div>
        ) : inProject ? (
          <ProjectView projectId={selectedId} onBack={goHome} />
        ) : (
          <div className="scroll">
            <ProjectList projects={projects} onOpen={setSelectedId} onChanged={refresh} />
          </div>
        )}
      </main>
    </div>
  );
}
