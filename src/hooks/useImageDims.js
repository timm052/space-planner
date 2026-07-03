import { useEffect, useState } from 'react';

/**
 * Measures the natural pixel dimensions of each image layer (once per image).
 * Returns a map of { [imageId]: { w, h } }.
 *
 * @param {Array} imgLayers - Array of image layer objects with `.id` and `.image` (data URL).
 */
export function useImageDims(imgLayers) {
  const [dims, setDims] = useState({});

  useEffect(() => {
    for (const im of imgLayers) {
      if (dims[im.id] || !im.image) continue; // pixels may still be in flight
      const img = new Image();
      img.onload = () =>
        setDims((d) => ({ ...d, [im.id]: { w: img.naturalWidth, h: img.naturalHeight } }));
      img.src = im.image;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgLayers]);

  return dims;
}
