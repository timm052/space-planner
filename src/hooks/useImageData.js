import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Session-wide pixel cache: image id → data URL.
//
// GET /api/projects/:id ships image *metadata* only (the client re-fetches it
// after every mutation), while pixels are immutable after upload — so each
// image's data URL is downloaded at most once per session through
// GET /api/images/:id/data and kept here at module level.
const dataCache = new Map();
// In-flight fetches by id — effects re-run (refetches, StrictMode) before the
// first response lands, so the promise itself must be deduped, not just the result.
const inFlight = new Map();

function fetchImageData(id) {
  if (dataCache.has(id)) return Promise.resolve(dataCache.get(id));
  if (!inFlight.has(id)) {
    inFlight.set(
      id,
      api
        .getImageData(id)
        .then((r) => {
          dataCache.set(id, r.image);
          return r.image;
        })
        .finally(() => inFlight.delete(id))
    );
  }
  return inFlight.get(id);
}

// Seed the cache when the client already holds the data URL (right after an
// upload / satellite fetch) so the first render doesn't wait on a round trip.
export function seedImageData(id, dataUrl) {
  dataCache.set(id, dataUrl);
}

/**
 * Resolves data URLs for a list of image-metadata rows.
 * Returns { data: Map<id, dataURL>, version } — `version` bumps when a fetch
 * lands, so memos deriving from the cache know to recompute.
 */
export function useImageData(images) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    const missing = (images || []).filter((im) => !dataCache.has(im.id));
    if (missing.length === 0) return;
    Promise.allSettled(missing.map((im) => fetchImageData(im.id))).then(() => {
      if (alive) setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, [images]);

  return { data: dataCache, version };
}
