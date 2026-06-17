import { Router } from 'express';

const router = Router();

// GET /api/geocode?q= — Nominatim proxy.
// Server-side so we can set a proper User-Agent header (required by OSM ToS).
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query is required' });
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'BriefTrack/1.0 (local architecture planning app)' } }
    );
    if (!r.ok) throw new Error(`Geocoder returned ${r.status}`);
    const results = await r.json();
    if (!results.length) return res.status(404).json({ error: `No location found for "${q}"` });
    const { lat, lon, display_name } = results[0];
    res.json({ lat: Number(lat), lon: Number(lon), display: display_name });
  } catch (err) {
    res.status(502).json({ error: `Geocoding failed: ${err.message}` });
  }
});

// GET /api/tile/:z/:x/:y — Esri World Imagery tile proxy.
// Keeps the browser canvas same-origin (untainted) so toDataURL works for PDF export.
router.get('/tile/:z/:x/:y', async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 20) {
    return res.status(400).json({ error: 'Invalid tile coordinates' });
  }
  try {
    const r = await fetch(
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    );
    if (!r.ok) return res.status(502).json({ error: `Tile fetch failed (${r.status})` });
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: `Tile fetch failed: ${err.message}` });
  }
});

export default router;
