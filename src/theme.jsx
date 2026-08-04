import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'brieftrack.theme';
const ThemeContext = createContext({ theme: 'dark', mode: 'dark', setMode: () => {} });

function initialMode() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light' || saved === 'auto') return saved;
  }
  return 'auto';
}

function systemTheme() {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

// Provides the resolved dark/light theme plus the chosen MODE (dark | light |
// auto — auto follows the OS). The token sets live in tokens.css under
// :root[data-theme='…']; here we just set the attribute. Consumers read
// `theme` (always resolved to dark/light — canvas label inks depend on it).
export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);
  const [sysTheme, setSysTheme] = useState(systemTheme);

  // Track the OS preference while in auto mode.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSysTheme(mq.matches ? 'light' : 'dark');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const theme = mode === 'auto' ? sysTheme : mode;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [mode]);

  // Back-compat: setTheme('dark'|'light') still works as an explicit mode.
  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, setTheme: setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
