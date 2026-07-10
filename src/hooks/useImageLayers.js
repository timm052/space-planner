import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { distToMeters } from '../compute.js';
import { W, H } from './useViewport.js';
import { seedImageData } from './useImageData.js';
import * as layerTools from '../components/diagram/layerTools.js';

const SAT_CANVAS = 768;

const angleDeg = (cx, cy, p) => (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;

/**
 * Image-layer editing for the diagram (destined for the Master Plan
 * environment): upload / satellite fetch, per-layer opacity·filter·visibility,
 * move / rotate an image, and two-point scale calibration. Extracted verbatim
 * from BubbleTab — no behaviour change.
 *
 * The image DATA (imgLayers / imgById / dims / layerRect) stays in the shell,
 * since the canvas, PDF export and scale all read it; this hook takes it as
 * input. The three pointer modes (scale-click, move-layer, rotate-layer)
 * integrate with the shell's onSvgPointerDown/onMove/onUp switchyard via the
 * layerPointer* delegates, which return true when a layer gesture handled the
 * event so the shell can early-return.
 *
 * @param {object} params
 * @param {object}   params.project     - Current project (createImage, id).
 * @param {string}   params.units       - Project units (for calibration metres).
 * @param {function} params.onChanged   - Refetch trigger after a write.
 * @param {function} params.setError    - Error-message state setter.
 * @param {function} params.setTick     - Canvas re-render trigger.
 * @param {function} params.setPanel    - Stage popover setter ('layers' | 'sat' | …).
 * @param {Map}      params.imgById     - Map<imageId, layer> (mutated in place for optimistic edits).
 * @param {object}   params.dims        - Natural image dimensions by id.
 * @param {function} params.layerRect   - (layer) → placement rectangle in diagram units.
 * @param {function} params.toSvgCoords - Map a pointer event to diagram coords.
 * @param {React.MutableRefObject} params.svgRef - The canvas <svg> element ref.
 * @param {object}   params.vb          - Current viewBox size { w, h }.
 */
export function useImageLayers({
  project, units, onChanged, setError, setTick, setPanel,
  imgById, dims, layerRect, toSvgCoords, svgRef, vb,
}) {
  // Debounce timers for optimistic layer-slider saves, owned here (cleared on
  // unmount) rather than shared with the rest of BubbleTab's debounce bag.
  const sliderTimers = useRef({});
  useEffect(() => () => Object.values(sliderTimers.current).forEach(clearTimeout), []);
  // Image-layer tool modes (calibrate / move / rotate).
  const [lt, setLt] = useState(layerTools.initialLayerTools);
  const { calibrateLayer, moveLayer, rotateLayer, scalePoints, scaleDistance } = lt;
  const ltRef = useRef(lt);
  ltRef.current = lt;
  function applyLt(transition) {
    const next = transition(ltRef.current);
    ltRef.current = next;
    setLt(next);
  }

  const [satQuery, setSatQuery] = useState('');
  const [satZoom, setSatZoom] = useState(18);
  const [satBusy, setSatBusy] = useState(false);
  const [, forceChrome] = useState(0); // re-render chrome for optimistic in-place edits (layer sliders)

  const layerMoveRef = useRef(null);
  const rotateRef = useRef(null); // { id, startAngle, startRot } while rotating an image by mouse

  // ---------- image layer actions ----------
  function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) return setError('Image is too large (12 MB max).');
    const reader = new FileReader();
    reader.onload = async () => {
      setError(null);
      try {
        const created = await api.createImage(project.id, {
          kind: 'custom',
          name: (file.name || 'Imported image').replace(/\.[^.]+$/, ''),
          image: reader.result,
          opacity: 0.6,
          visible: 1,
        });
        seedImageData(created.id, reader.result); // avoid re-downloading what we just sent
        setPanel('layers');
        onChanged();
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsDataURL(file);
  }

  // Optimistically update an image field, then debounce-save it.
  // Bumps chrome state too (not just the canvas tick) so the LayerRow slider
  // in the popover tracks the drag.
  function layerSlider(im, field, v) {
    setError(null);
    im[field] = v;
    setTick((t) => t + 1);
    forceChrome((n) => n + 1);
    const key = `img${im.id}_${field}`;
    clearTimeout(sliderTimers.current[key]);
    sliderTimers.current[key] = setTimeout(
      () => api.updateImage(im.id, { [field]: v }).then(onChanged).catch((e) => setError(e.message)),
      250
    );
  }

  function toggleLayerVisible(im, v) {
    api.updateImage(im.id, { visible: v ? 1 : 0 }).then(onChanged).catch((e) => setError(e.message));
  }

  async function deleteImageLayer(id) {
    setError(null);
    try {
      await api.deleteImage(id);
      applyLt((l) => layerTools.layerDeleted(l, id));
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  function startCalibrate(id) {
    setPanel(null);
    applyLt((l) => layerTools.startCalibrate(l, id));
  }

  async function applyScale() {
    const im = imgById.get(calibrateLayer);
    const rect = layerRect(im);
    const nd = im && dims[im.id];
    const mpp = layerTools.computeMpp({
      points: scalePoints,
      meters: distToMeters(Number(scaleDistance), units),
      rectW: rect?.w,
      naturalW: nd?.w,
    });
    if (mpp == null) return setError('Pick two points and enter a positive distance.');
    applyLt(layerTools.endCalibrate);
    try {
      await api.updateImage(im.id, { mpp });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function fetchSatellite(e) {
    e.preventDefault();
    setSatBusy(true);
    setError(null);
    try {
      const loc = await api.geocode(satQuery);
      const z = Number(satZoom);
      const n = 2 ** z;
      const latR = (loc.lat * Math.PI) / 180;
      const xt = ((loc.lon + 180) / 360) * n;
      const yt = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
      const px = xt * 256;
      const py = yt * 256;
      const x0 = px - SAT_CANVAS / 2;
      const y0 = py - SAT_CANVAS / 2;
      const canvas = document.createElement('canvas');
      canvas.width = SAT_CANVAS;
      canvas.height = SAT_CANVAS;
      const ctx = canvas.getContext('2d');
      const loadTile = (tx, ty) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ img, tx, ty });
          img.onerror = () => reject(new Error('Tile failed to load'));
          img.src = `/api/tile/${z}/${tx}/${ty}`;
        });
      const jobs = [];
      for (let tx = Math.floor(x0 / 256); tx * 256 < x0 + SAT_CANVAS; tx++)
        for (let ty = Math.floor(y0 / 256); ty * 256 < y0 + SAT_CANVAS; ty++) jobs.push(loadTile(tx, ty));
      for (const { img, tx, ty } of await Promise.all(jobs)) ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0);
      const metersPerPixel = (156543.03392 * Math.cos(latR)) / 2 ** z;
      const satUrl = canvas.toDataURL('image/jpeg', 0.85);
      const created = await api.createImage(project.id, {
        kind: 'satellite',
        name: 'Satellite',
        image: satUrl,
        mpp: metersPerPixel,
        attribution: `Imagery © Esri World Imagery · ${loc.display}`,
        opacity: 0.55,
        visible: 1,
      });
      seedImageData(created.id, satUrl); // avoid re-downloading what we just sent
      setPanel('layers');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSatBusy(false);
    }
  }

  // ---------- pointer delegates (called by the shell switchyard) ----------
  // Begin a layer gesture. Returns true when a layer tool mode owns this press.
  function layerPointerDown(e) {
    if (scalePoints) {
      applyLt((l) => layerTools.addScalePoint(l, toSvgCoords(e)));
      return true;
    }
    if (rotateLayer) {
      const im = imgById.get(rotateLayer);
      if (im) {
        const c = toSvgCoords(e);
        rotateRef.current = { id: rotateLayer, startAngle: angleDeg(W / 2 + (im.x || 0), H / 2 + (im.y || 0), c), startRot: im.rot || 0 };
      }
      return true;
    }
    if (moveLayer) {
      const im = imgById.get(moveLayer);
      if (im) layerMoveRef.current = { id: moveLayer, sx: e.clientX, sy: e.clientY, lx: im.x || 0, ly: im.y || 0 };
      return true;
    }
    return false;
  }
  // Continue a move / rotate gesture. Returns true when one is in flight.
  function layerPointerMove(e) {
    if (layerMoveRef.current) {
      const m = layerMoveRef.current;
      const im = imgById.get(m.id);
      if (im) {
        const rect = svgRef.current.getBoundingClientRect();
        im.x = m.lx + ((e.clientX - m.sx) * vb.w) / rect.width;
        im.y = m.ly + ((e.clientY - m.sy) * vb.h) / rect.height;
        setTick((t) => t + 1);
      }
      return true;
    }
    if (rotateRef.current) {
      const rr = rotateRef.current;
      const im = imgById.get(rr.id);
      if (im) {
        const c = toSvgCoords(e);
        const ang = angleDeg(W / 2 + (im.x || 0), H / 2 + (im.y || 0), c);
        im.rot = (((rr.startRot + (ang - rr.startAngle)) % 360) + 360) % 360;
        setTick((t) => t + 1);
      }
      return true;
    }
    return false;
  }
  // Commit a move / rotate gesture. Returns true when one was released.
  async function layerPointerUp() {
    if (layerMoveRef.current) {
      const m = layerMoveRef.current;
      layerMoveRef.current = null;
      const im = imgById.get(m.id);
      if (im) {
        try { await api.updateImage(m.id, { x: im.x, y: im.y }); onChanged(); } catch (e) { setError(e.message); }
      }
      return true;
    }
    if (rotateRef.current) {
      const rr = rotateRef.current;
      rotateRef.current = null;
      const im = imgById.get(rr.id);
      if (im) {
        try { await api.updateImage(rr.id, { rot: im.rot }); onChanged(); } catch (e) { setError(e.message); }
      }
      return true;
    }
    return false;
  }

  return {
    // layer-tool modes + transition applier
    calibrateLayer, moveLayer, rotateLayer, scalePoints, scaleDistance, applyLt,
    // satellite panel state
    satQuery, setSatQuery, satZoom, setSatZoom, satBusy,
    // actions
    onUpload, layerSlider, toggleLayerVisible, deleteImageLayer, startCalibrate, applyScale, fetchSatellite,
    // pointer delegates
    layerPointerDown, layerPointerMove, layerPointerUp,
  };
}
