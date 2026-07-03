// Per-browser UI preferences, persisted in localStorage under one namespace.
// Only lightweight view state belongs here (panel sizes, toggles) — anything
// that is part of the project travels through the API instead.
const NS = 'brieftrack.';

export const prefs = {
  get(key, fallback = null) {
    const v = localStorage.getItem(NS + key);
    return v == null ? fallback : v;
  },
  getNum(key, fallback) {
    const v = localStorage.getItem(NS + key);
    return v == null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
  },
  getBool(key, fallback) {
    const v = localStorage.getItem(NS + key);
    return v == null ? fallback : v === '1';
  },
  set(key, value) {
    localStorage.setItem(NS + key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  },
};
