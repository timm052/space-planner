import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useTheme } from './theme.jsx';
import ProjectList from './components/ProjectList.jsx';
import ProjectView from './components/ProjectView.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import { Banner } from './components/ui.jsx';

function BrandLogo() {
  // Amber rounded square holding a 4-cell drafting glyph (3 plates + a bubble).
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="8" height="8" rx="1.5" fill="var(--accent-ink)" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" fill="var(--accent-ink)" opacity=".45" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" fill="var(--accent-ink)" opacity=".45" />
        <circle cx="17" cy="17" r="4" fill="var(--accent-ink)" />
      </svg>
    </span>
  );
}

function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      <button className={mode === 'dark' ? 'active' : ''} onClick={() => setMode('dark')}>
        Dark
      </button>
      <button className={mode === 'light' ? 'active' : ''} onClick={() => setMode('light')}>
        Light
      </button>
      <button className={mode === 'auto' ? 'active' : ''} onClick={() => setMode('auto')} title="Follow the system theme">
        Auto
      </button>
    </div>
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
        <div className="topbar-right">
          <nav className="topnav">
            <button className={`navlink ${page === 'projects' && !inProject ? 'active' : ''}`} onClick={goHome}>
              Projects
            </button>
            <button className={`navlink ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
              Settings
            </button>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main className="main">
        {error && (
          <div className="scroll">
            <div className="page">
              <Banner>{error}</Banner>
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
