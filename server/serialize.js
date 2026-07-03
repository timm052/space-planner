// Response shaping: keep heavy base64 payloads out of the JSON the client
// re-fetches after every mutation. Image pixels travel once through
// GET /api/images/:id/data; everything else is metadata.

// Legacy single-layer data-URL columns. The pixels were folded into the
// `images` table by migrateImages() (db.js); the columns stay in the DB
// (additive-only rule) but must never travel to the client.
export function publicProject(row) {
  if (!row) return row;
  const { bg_image: _bg, sat_image: _sat, ...pub } = row;
  return pub;
}

// Every images column except `image` (the data URL).
export const IMAGE_META_COLS =
  'id, project_id, kind, name, mpp, opacity, visible, x, y, rot, sort_order, attribution, filter';
