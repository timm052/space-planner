import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'brieftrack.theme';
const ThemeContext = createContext({ theme: 'dark', setTheme: () => {}, toggle: () => {} });

function initialTheme() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  }
  return 'dark';
}

// Provides the dark/light theme and persists the choice. The token sets live in
// styles.css under :root[data-theme='…']; here we just set the attribute.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
