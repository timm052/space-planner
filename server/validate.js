/**
 * Lightweight validation helpers for Express route handlers.
 * Zero external dependencies — pure guards that map bad values to safe defaults.
 */

/**
 * Returns `val` if it is contained in `allowed`, otherwise `fallback`.
 * Use for enum fields so unknown client values are silently clamped.
 */
export function oneOf(val, allowed, fallback) {
  return allowed.has(val) ? val : fallback;
}

/**
 * Clamps `val` to the range [min, max], returning `fallback` for non-finite input.
 */
export function clampNum(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Returns a 400 response and null if `val` is falsy/blank.
 * Returns `val.trim()` otherwise.
 * Usage: const name = requireStr(req.body.name, 'Space name', res); if (!name) return;
 */
export function requireStr(val, fieldLabel, res) {
  if (!val || !String(val).trim()) {
    res.status(400).json({ error: `${fieldLabel} is required` });
    return null;
  }
  return String(val).trim();
}
