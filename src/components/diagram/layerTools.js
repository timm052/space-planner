// Image-layer tool modes — pure transitions, no React (same convention as
// selection.js, but these never produce fx).
//
// The three tools are mutually exclusive: calibrating (two-point scale
// marking), moving, and rotating a layer. `scalePoints` doubles as the
// "calibrating" flag: an array while marking (0–2 points), null otherwise.

export const initialLayerTools = Object.freeze({
  calibrateLayer: null, // image id being calibrated
  moveLayer: null, // image id being moved by dragging the canvas
  rotateLayer: null, // image id being rotated by dragging the canvas
  scalePoints: null, // [ {x,y}, ... ] while calibrating, else null
  scaleDistance: '', // the typed real-world distance between the two points
});

/** Begin calibrating a layer: exclusive with move/rotate, resets the marking. */
export function startCalibrate(lt, id) {
  return { ...lt, calibrateLayer: id, moveLayer: null, rotateLayer: null, scalePoints: [], scaleDistance: '' };
}

/** Record a calibration click (ignored once both points are placed). */
export function addScalePoint(lt, p) {
  if (!lt.scalePoints || lt.scalePoints.length >= 2) return lt;
  return { ...lt, scalePoints: [...lt.scalePoints, p] };
}

export function setScaleDistance(lt, value) {
  return { ...lt, scaleDistance: value };
}

/** Leave calibration (Cancel, or after a successful apply). */
export function endCalibrate(lt) {
  return { ...lt, calibrateLayer: null, scalePoints: null, scaleDistance: '' };
}

/** Toggle move mode for a layer (exclusive with rotate). */
export function toggleMove(lt, id) {
  return { ...lt, rotateLayer: null, moveLayer: lt.moveLayer === id ? null : id };
}

/** Toggle rotate mode for a layer (exclusive with move). */
export function toggleRotate(lt, id) {
  return { ...lt, moveLayer: null, rotateLayer: lt.rotateLayer === id ? null : id };
}

/** A layer was deleted: drop whichever tool mode referenced it. */
export function layerDeleted(lt, id) {
  let next = lt;
  if (lt.moveLayer === id) next = { ...next, moveLayer: null };
  if (lt.rotateLayer === id) next = { ...next, rotateLayer: null };
  if (lt.calibrateLayer === id) next = { ...next, calibrateLayer: null, scalePoints: null };
  return next;
}

/**
 * Metres-per-natural-pixel from a finished calibration: the marked distance in
 * diagram units, projected back to the image's natural pixels via the drawn
 * rect width. Returns null unless both points are placed, the distance is a
 * positive number of metres, and the points are meaningfully apart.
 */
export function computeMpp({ points, meters, rectW, naturalW }) {
  if (!points || points.length !== 2) return null;
  const [a, b] = points;
  const dUnits = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(meters > 0) || dUnits < 2 || !(rectW > 0) || !(naturalW > 0)) return null;
  const naturalPx = (dUnits / rectW) * naturalW;
  return meters / naturalPx;
}
