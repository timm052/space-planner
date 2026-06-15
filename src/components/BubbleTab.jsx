import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtArea, areaToM2, distToMeters, distUnit, leafSpaces, rootContainer } from '../compute.js';
import { exportDiagramPdf } from '../pdfExport.js';
import { useHistory } from '../useHistory.js';
import { SCALE_PRESETS, ratioToScale, scaleToRatio, zoomAbout } from '../scale.js';
import { convexHull, smoothHullPath, pinsOf, filterCss, IMAGE_FILTERS } from '../geometry.js';
import HelpPanel from './HelpPanel.jsx';

// Logical design canvas — the world anchor for spawning, gravity and image
// centring. The *visible* viewBox is sized to the container (see vb), so a big
// screen simply shows more of this world.
const W = 900;
const H = 620;
const PALETTE = ['#e8b04b', '#5b9dd9', '#4cc38a', '#c678dd', '#e5707a', '#56b6c2', '#d19a66', '#98c379', '#7aa2f7', '#f7768e'];
const SAT_CANVAS = 768;

// BubbleTab unmounts when you leave the Diagram tab, which would otherwise lose
// every non-pinned bubble's position and let the sim re-scatter them on return.
// This module-level cache keeps the last layout per project for the session.
const layoutCache = new Map(); // projectId → Map(instanceKey → {x,y})

// Bake rotation (clockwise deg) and/or a CSS filter into a data URL on a canvas
// sized to the rotated bounding box — keeps the PDF export scale-accurate.
function bakeImage(dataUrl, deg, filter) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const rad = (deg * Math.PI) / 180;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const cw = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)));
      const ch = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const ctx = c.getContext('2d');
      if (filter && filter !== 'none') ctx.filter = filter;
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -w / 2, -h / 2);
      resolve({ dataUrl: c.toDataURL('image/png'), canvasW: cw, canvasH: ch, naturalW: w });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export default function BubbleTab({ project, spaces, adjacencies, images = [], onChanged }) {
  const [selected, setSelected] = useState(null);
  const [selectedInst, setSelectedInst] = useState(0); // which instance of the selected space
  const [, setTick] = useState(0);
  const [error, setError] = useState(null);
  const [scalePoints, setScalePoints] = useState(null);
  const [scaleDistance, setScaleDistance] = useState('');
  const [calibrateLayer, setCalibrateLayer] = useState(null); // image id being calibrated
  const [moveLayer, setMoveLayer] = useState(null); // image id being moved
  const [rotateLayer, setRotateLayer] = useState(null); // image id being rotated by mouse
  const [panel, setPanel] = useState(null); // 'layers' | 'sat' | null
  const [satQuery, setSatQuery] = useState('');
  const [satZoom, setSatZoom] = useState(18);
  const [satBusy, setSatBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [split, setSplit] = useState(() => localStorage.getItem('brieftrack.split') !== '0');
  const [colorBy, setColorBy] = useState('department');
  const [drafts, setDrafts] = useState({});
  const [panMode, setPanMode] = useState(false);
  const [multi, setMulti] = useState(() => new Set()); // selected instance keys for batch ops
  const [catDraft, setCatDraft] = useState(''); // batch category/department assignment input
  const [localColors, setLocalColors] = useState({}); // optimistic category colour overrides
  const [marquee, setMarquee] = useState(null); // { x0,y0,x1,y1 } in svg coords while selecting
  const [hulls, setHulls] = useState(() => localStorage.getItem('brieftrack.hulls') === '1');
  const [hullPad, setHullPad] = useState(() => Number(localStorage.getItem('brieftrack.hullpad')) || 26);
  const [showMatrix, setShowMatrix] = useState(false);
  const [railW, setRailW] = useState(() => Number(localStorage.getItem('brieftrack.railw')) || 340);
  const [areaMode, setAreaMode] = useState('category'); // Areas panel grouping
  const [collapsed, setCollapsed] = useState(() => new Set()); // collapsed Areas groups
  const [view, setViewState] = useState({ x: project.view_x || 0, y: project.view_y || 0 });
  const [dims, setDims] = useState({}); // image id → { w, h } natural pixel size
  const [vb, setVb] = useState({ w: W, h: H }); // visible viewBox size = container pixels

  const viewRef = useRef(view);
  const setView = (v) => {
    viewRef.current = v;
    setViewState(v);
  };
  const draftTimers = useRef(new Map());
  const nodesRef = useRef(new Map());
  // Start idle if we have a cached layout to restore (avoids a re-scatter on
  // tab return); otherwise energise so the first layout settles.
  const alphaRef = useRef(layoutCache.has(project.id) ? 0 : 1);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const layerMoveRef = useRef(null);
  const rotateRef = useRef(null); // { id, startAngle, startRot } while rotating an image by mouse
  const svgRef = useRef(null);
  const stageRef = useRef(null);
  const lastClickRef = useRef({ key: null, t: 0 });
  const pinOverride = useRef(new Map());
  const fileRef = useRef(null);
  const debouncers = useRef({});
  const migratedRef = useRef(false);
  const hoverRef = useRef(null); // { space, idx } currently under the cursor
  const marqueeRef = useRef(null); // { sx, sy, additive } while drag-selecting
  const adjRef = useRef(adjacencies); // latest adjacencies, for history closures
  adjRef.current = adjacencies;

  const history = useHistory();
  // Reset history + optimistic colours when switching projects.
  useEffect(() => {
    history.clear();
    setLocalColors({});
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = project.units;
  const simEnabled = !!project.sim_enabled;

  // ---------- image layers (multiple, ordered bottom→top) ----------
  // Copy so optimistic move/rotate/opacity edits can mutate in place between
  // refetches (the `images` prop is stable until onChanged re-fetches).
  const imgLayers = useMemo(() => (images || []).map((im) => ({ ...im })), [images]);
  const imgById = useMemo(() => new Map(imgLayers.map((im) => [im.id, im])), [imgLayers]);

  // Scale auto-fit uses the first visible, calibrated image.
  const primaryImg = imgLayers.find((im) => im.visible && im.mpp > 0 && dims[im.id]);
  const fitScale = primaryImg ? (dims[primaryImg.id].w * primaryImg.mpp) / W : null;
  const displayScale = project.display_scale > 0 ? project.display_scale : null;
  const effScale = displayScale ?? fitScale;

  // Measure natural image sizes (once per image).
  useEffect(() => {
    for (const im of imgLayers) {
      if (dims[im.id]) continue;
      const img = new Image();
      img.onload = () => setDims((d) => ({ ...d, [im.id]: { w: img.naturalWidth, h: img.naturalHeight } }));
      img.src = im.image;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgLayers]);

  // Track the canvas size so the diagram fills the available space.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 1 && r.height > 1) {
        setVb((prev) => (Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1 ? prev : { w: Math.round(r.width), h: Math.round(r.height) }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Placement rectangle (in diagram units) for an image layer.
  function layerRect(im) {
    const nd = im && dims[im.id];
    if (!im || !nd) return null;
    const aspect = nd.h / nd.w;
    const wU = im.mpp > 0 && effScale ? (nd.w * im.mpp) / effScale : W;
    const hU = wU * aspect;
    const cx = W / 2 + (im.x || 0);
    const cy = H / 2 + (im.y || 0);
    return { x: cx - wU / 2, y: cy - hU / 2, w: wU, h: hU, cx, cy, rot: im.rot || 0, opacity: im.opacity, dataUrl: im.image };
  }

  // ---------- spaces / instances (leaves only) ----------
  const leaves = useMemo(() => leafSpaces(spaces), [spaces]);
  const byId = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const hasBuildings = spaces.some((s) => s.kind === 'building' || s.kind === 'group');

  const groupKey = (s) => {
    if (colorBy === 'building') {
      const root = rootContainer(s, byId);
      return root ? root.name : 'Unassigned';
    }
    return s.department || 'General';
  };
  const groups = [...new Set(leaves.map(groupKey))];
  // All department names (the categories), regardless of the current colour mode.
  const departments = [...new Set(leaves.map((s) => s.department || 'General'))];

  // Custom category/building colours: persisted JSON map merged with optimistic edits.
  const savedColors = useMemo(() => {
    try {
      return JSON.parse(project.category_colors || '{}') || {};
    } catch {
      return {};
    }
  }, [project.category_colors]);
  const effColors = { ...savedColors, ...localColors };
  const colorForLabel = (label) => {
    if (effColors[label]) return effColors[label];
    const i = groups.indexOf(label);
    if (i >= 0) return PALETTE[i % PALETTE.length];
    // Stable fallback for labels outside the current colour grouping (e.g. a
    // building name while colouring by category).
    let h = 0;
    for (let k = 0; k < label.length; k++) h = (h * 31 + label.charCodeAt(k)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
  };
  const colorOf = (s) => colorForLabel(groupKey(s));

  function setCategoryColor(label, color) {
    setLocalColors((m) => {
      const next = { ...m, [label]: color };
      clearTimeout(debouncers.current.catcolor);
      debouncers.current.catcolor = setTimeout(
        () => saveProject({ category_colors: JSON.stringify({ ...savedColors, ...next }) }, { silent: true }),
        250
      );
      return next;
    });
  }

  const instances = useMemo(
    () =>
      leaves.flatMap((s) =>
        Array.from({ length: Math.max(1, s.count || 1) }, (_, i) => ({ s, i, key: `${s.id}:${i}` }))
      ),
    [leaves]
  );

  const ea = (s) => {
    const draft = drafts[s.id];
    return draft !== undefined && draft !== '' ? Number(draft) || 0 : s.target_area;
  };
  const maxEach = Math.max(...leaves.map(ea), 1);
  const radiusOf = (s) => {
    if (effScale) return Math.max(7, Math.sqrt(areaToM2(ea(s), units) / Math.PI) / effScale);
    return 16 + 50 * Math.sqrt(ea(s) / maxEach);
  };

  const instPin = (s, i) => {
    const key = `${s.id}:${i}`;
    if (pinOverride.current.has(key)) return pinOverride.current.get(key);
    return pinsOf(s)[i] ?? null;
  };
  const anyPinned = (s) =>
    Array.from({ length: Math.max(1, s.count || 1) }, (_, i) => i).some((i) => instPin(s, i));

  useEffect(() => setView({ x: project.view_x || 0, y: project.view_y || 0 }), [project.id]); // eslint-disable-line
  useEffect(() => () => Object.values(debouncers.current).forEach(clearTimeout), []);

  // Keyboard shortcuts: P pins/unpins, B toggles box/bubble for the hovered space.
  useEffect(() => {
    function onKey(e) {
      if (e.target.matches?.('input, select, textarea')) return;
      const h = hoverRef.current;
      if (!h) return;
      const key = e.key.toLowerCase();
      if (key === 'p') {
        e.preventDefault();
        // Per-instance: P pins just the bubble under the cursor. Shift+P pins all.
        if (e.shiftKey) savePinAll(h.space, !anyPinned(h.space));
        else savePin(h.space, h.idx, !instPin(h.space, h.idx));
      } else if (key === 'b') {
        e.preventDefault();
        toggleShape(h.space);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces]);

  // Global shortcuts: undo/redo, clear selection, delete the multi-selection.
  useEffect(() => {
    function onKey(e) {
      if (e.target.matches?.('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? history.redo() : history.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
      } else if (e.key === 'Escape') {
        if (multi.size) setMulti(new Set());
        setSelected(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && multi.size) {
        e.preventDefault();
        multiDelete();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi]);

  const shapeOf = (s) => (s.shape === 'box' ? 'box' : 'bubble');

  // Apply field updates to a space and refetch. Returns a promise.
  async function applySpace(id, fields) {
    await api.updateSpace(id, fields);
    onChanged();
  }
  // Apply now and push an undo/redo entry capturing the previous values.
  async function commitSpace(space, fields, label) {
    const before = {};
    for (const k of Object.keys(fields)) before[k] = space[k] ?? null;
    history.record({ label, undo: () => applySpace(space.id, before), redo: () => applySpace(space.id, fields) });
    setError(null);
    try {
      await applySpace(space.id, fields);
    } catch (e) {
      setError(e.message);
    }
  }
  // Batch the same kind of change across many spaces as one undoable step.
  async function commitMany(changes, label) {
    if (changes.length === 0) return;
    const run = (pick) => async () => {
      for (const c of changes) await api.updateSpace(c.id, pick(c));
      onChanged();
    };
    history.record({ label, undo: run((c) => c.before), redo: run((c) => c.after) });
    setError(null);
    try {
      await run((c) => c.after)();
    } catch (e) {
      setError(e.message);
    }
  }

  function toggleShape(space) {
    commitSpace(space, { shape: shapeOf(space) === 'box' ? 'bubble' : 'box' }, 'shape');
  }
  async function convertAll(shape) {
    const changes = leaves
      .filter((s) => shapeOf(s) !== shape)
      .map((s) => ({ id: s.id, before: { shape: shapeOf(s) }, after: { shape } }));
    await commitMany(changes, 'convert all');
  }

  // Keep simulation nodes in sync with the leaves (per instance). New nodes seed
  // from a pin, then the saved layout cache, then a spawn ring; only genuinely
  // new (uncached, unpinned) nodes re-energise the sim.
  useEffect(() => {
    const nodes = nodesRef.current;
    const cache = layoutCache.get(project.id);
    const keys = new Set(instances.map((o) => o.key));
    let newSpawn = false;
    for (const key of [...nodes.keys()]) if (!keys.has(key)) nodes.delete(key);
    instances.forEach((o, idx) => {
      if (nodes.has(o.key)) return;
      const pin = pinsOf(o.s)[o.i] ?? null;
      const cached = cache?.get(o.key);
      if (pin) nodes.set(o.key, { x: pin.x, y: pin.y, vx: 0, vy: 0 });
      else if (cached) nodes.set(o.key, { x: cached.x, y: cached.y, vx: 0, vy: 0 });
      else {
        const angle = (idx / Math.max(instances.length, 1)) * Math.PI * 2;
        nodes.set(o.key, { x: W / 2 + Math.cos(angle) * 190 + o.i * 9, y: H / 2 + Math.sin(angle) * 150 + o.i * 9, vx: 0, vy: 0 });
        newSpawn = true;
      }
    });
    pinOverride.current.clear();
    if (newSpawn) alphaRef.current = 1;
    setTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces]);

  // Persist the current layout when leaving the tab / switching projects.
  useEffect(() => {
    const pid = project.id;
    return () => {
      const m = new Map();
      for (const [k, n] of nodesRef.current) m.set(k, { x: n.x, y: n.y });
      layoutCache.set(pid, m);
    };
  }, [project.id]);

  useEffect(() => {
    alphaRef.current = Math.max(alphaRef.current, 0.6);
  }, [adjacencies]);
  useEffect(() => {
    alphaRef.current = Math.max(alphaRef.current, 0.35);
  }, [drafts]);

  function closestPair(sa, sb) {
    const nodes = nodesRef.current;
    let best = null;
    for (let i = 0; i < Math.max(1, sa.count || 1); i++) {
      const a = nodes.get(`${sa.id}:${i}`);
      if (!a) continue;
      for (let j = 0; j < Math.max(1, sb.count || 1); j++) {
        const b = nodes.get(`${sb.id}:${j}`);
        if (!b) continue;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (!best || d < best.d) best = { a, b, d, ai: i, bi: j };
      }
    }
    return best;
  }

  // Force simulation.
  useEffect(() => {
    let raf;
    const held = (key) => {
      const d = dragRef.current;
      return !!d && (d.key === key || (d.groupSet != null && d.groupSet.has(key)));
    };
    const fixedInst = (o) => held(o.key) || !!instPin(o.s, o.i);

    const simulate = (alpha) => {
      const nodes = nodesRef.current;
      const arr = instances.map((o) => ({ ...o, n: nodes.get(o.key), r: radiusOf(o.s) })).filter((o) => o.n);

      const cents = new Map();
      for (const o of arr) {
        const c = cents.get(groupKey(o.s)) || { x: 0, y: 0, n: 0 };
        c.x += o.n.x;
        c.y += o.n.y;
        c.n++;
        cents.set(groupKey(o.s), c);
      }
      for (const o of arr) {
        if (fixedInst(o)) continue;
        const c = cents.get(groupKey(o.s));
        o.n.vx += (c.x / c.n - o.n.x) * 0.012 * alpha;
        o.n.vy += (c.y / c.n - o.n.y) * 0.012 * alpha;
        o.n.vx += (W / 2 - o.n.x) * 0.006 * alpha;
        o.n.vy += (H / 2 - o.n.y) * 0.006 * alpha;
      }

      for (const s of leaves) {
        const count = Math.max(1, s.count || 1);
        if (count < 2) continue;
        const r = radiusOf(s);
        for (let i = 0; i < count - 1; i++) {
          const a = nodes.get(`${s.id}:${i}`);
          const b = nodes.get(`${s.id}:${i + 1}`);
          if (!a || !b) continue;
          const rest = r * 2 + 10;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const f = ((d - rest) / d) * 0.04 * alpha;
          if (!held(`${s.id}:${i}`) && !instPin(s, i)) ((a.vx += dx * f), (a.vy += dy * f));
          if (!held(`${s.id}:${i + 1}`) && !instPin(s, i + 1)) ((b.vx -= dx * f), (b.vy -= dy * f));
        }
      }

      for (const l of adjacencies) {
        const sa = byId.get(l.space_a);
        const sb = byId.get(l.space_b);
        if (!sa || !sb) continue;
        const pair = closestPair(sa, sb);
        if (!pair) continue;
        const rest = radiusOf(sa) + radiusOf(sb) + (l.strength === 'required' ? 14 : 70);
        const k = l.strength === 'required' ? 0.05 : 0.018;
        const dx = pair.b.x - pair.a.x;
        const dy = pair.b.y - pair.a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = ((d - rest) / d) * k * alpha;
        if (!held(`${sa.id}:${pair.ai}`) && !instPin(sa, pair.ai)) ((pair.a.vx += dx * f), (pair.a.vy += dy * f));
        if (!held(`${sb.id}:${pair.bi}`) && !instPin(sb, pair.bi)) ((pair.b.vx -= dx * f), (pair.b.vy -= dy * f));
      }

      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          let dx = b.n.x - a.n.x;
          let dy = b.n.y - a.n.y;
          let d = Math.hypot(dx, dy);
          if (d === 0) ((dx = Math.random() - 0.5), (dy = Math.random() - 0.5), (d = Math.hypot(dx, dy)));
          const minD = a.r + b.r + (effScale ? 4 : 12);
          const aF = fixedInst(a);
          const bF = fixedInst(b);
          if (aF && bF) continue;
          if (d < minD) {
            const push = ((minD - d) / d) * 0.45;
            if (!aF) ((a.n.x -= dx * push * (bF ? 2 : 1)), (a.n.y -= dy * push * (bF ? 2 : 1)));
            if (!bF) ((b.n.x += dx * push * (aF ? 2 : 1)), (b.n.y += dy * push * (aF ? 2 : 1)));
          } else if (d < minD + 60) {
            const f = (800 * alpha) / (d * d);
            if (!aF) ((a.n.vx -= (dx / d) * f), (a.n.vy -= (dy / d) * f));
            if (!bF) ((b.n.vx += (dx / d) * f), (b.n.vy += (dy / d) * f));
          }
        }
      }

      for (const o of arr) {
        if (held(o.key)) ((o.n.vx = 0), (o.n.vy = 0));
        else {
          const pin = instPin(o.s, o.i);
          if (pin) ((o.n.x = pin.x), (o.n.y = pin.y), (o.n.vx = 0), (o.n.vy = 0));
          else {
            o.n.vx *= 0.55;
            o.n.vy *= 0.55;
            o.n.x += o.n.vx;
            o.n.y += o.n.vy;
          }
        }
      }
    };

    const step = () => {
      if (simEnabled && (alphaRef.current > 0.012 || dragRef.current)) {
        simulate(Math.max(alphaRef.current, dragRef.current ? 0.3 : 0));
        if (!dragRef.current) alphaRef.current *= 0.99;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, adjacencies, simEnabled, effScale, drafts, colorBy]);

  // ---------- viewBox geometry ----------
  // Visible viewBox is sized to the container; its origin keeps the logical
  // canvas centred (and is backward-compatible when vb == W×H).
  const originX = W / 2 - vb.w / 2 + view.x;
  const originY = H / 2 - vb.h / 2 + view.y;

  function toSvgCoords(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: originX + ((e.clientX - rect.left) * vb.w) / rect.width,
      y: originY + ((e.clientY - rect.top) * vb.h) / rect.height,
    };
  }

  // ---------- pointer handling ----------
  const angleDeg = (cx, cy, p) => (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;

  function onSvgPointerDown(e) {
    if (scalePoints) return onSvgScaleClick(e);
    if (rotateLayer) {
      const im = imgById.get(rotateLayer);
      if (im) {
        const c = toSvgCoords(e);
        rotateRef.current = { id: rotateLayer, startAngle: angleDeg(W / 2 + (im.x || 0), H / 2 + (im.y || 0), c), startRot: im.rot || 0 };
      }
      return;
    }
    if (moveLayer) {
      const im = imgById.get(moveLayer);
      if (im) layerMoveRef.current = { id: moveLayer, sx: e.clientX, sy: e.clientY, lx: im.x || 0, ly: im.y || 0 };
      return;
    }
    if (panMode) {
      if (!dragRef.current) panRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    // Empty-canvas drag = marquee multi-select (a bubble press sets dragRef first).
    if (!dragRef.current) {
      const p = toSvgCoords(e);
      marqueeRef.current = { sx: p.x, sy: p.y, additive: e.shiftKey };
      setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  }

  function onMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    if (layerMoveRef.current) {
      const m = layerMoveRef.current;
      const im = imgById.get(m.id);
      if (im) {
        im.x = m.lx + ((e.clientX - m.sx) * vb.w) / rect.width;
        im.y = m.ly + ((e.clientY - m.sy) * vb.h) / rect.height;
        setTick((t) => t + 1);
      }
      return;
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
      return;
    }
    if (panRef.current) {
      setView({
        x: panRef.current.vx - ((e.clientX - panRef.current.sx) * vb.w) / rect.width,
        y: panRef.current.vy - ((e.clientY - panRef.current.sy) * vb.h) / rect.height,
      });
      return;
    }
    if (marqueeRef.current) {
      const p = toSvgCoords(e);
      setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
      return;
    }
    if (!dragRef.current) return;
    const drag = dragRef.current;
    const { x, y } = toSvgCoords(e);
    if (drag.starts) {
      // Group drag: translate every selected node by the same delta.
      const dx = x - drag.anchor.x;
      const dy = y - drag.anchor.y;
      drag.moved = Math.hypot(dx, dy);
      for (const s of drag.starts) {
        const n = nodesRef.current.get(s.key);
        if (n) ((n.x = s.x + dx), (n.y = s.y + dy));
      }
      setTick((t) => t + 1);
      return;
    }
    const node = nodesRef.current.get(drag.key);
    if (!node) return;
    drag.moved += Math.hypot(x - node.x, y - node.y);
    node.x = x;
    node.y = y;
    setTick((t) => t + 1);
  }

  async function onUp() {
    if (marqueeRef.current) {
      finishMarquee();
      return;
    }
    if (layerMoveRef.current) {
      const m = layerMoveRef.current;
      layerMoveRef.current = null;
      const im = imgById.get(m.id);
      if (im) {
        try { await api.updateImage(m.id, { x: im.x, y: im.y }); onChanged(); } catch (e) { setError(e.message); }
      }
      return;
    }
    if (rotateRef.current) {
      const rr = rotateRef.current;
      rotateRef.current = null;
      const im = imgById.get(rr.id);
      if (im) {
        try { await api.updateImage(rr.id, { rot: im.rot }); onChanged(); } catch (e) { setError(e.message); }
      }
      return;
    }
    if (panRef.current) {
      commitView(viewRef.current);
      panRef.current = null;
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    alphaRef.current = Math.max(alphaRef.current, 0.3);
    if (!drag) return;
    if (drag.starts) {
      // Group drag: pin every moved bubble where it was dropped (one undo step).
      if (drag.moved >= 6) await pinKeys(drag.starts.map((s) => s.key));
      return;
    }
    const space = byId.get(drag.spaceId);
    if (!space) return;
    if (drag.moved >= 6) {
      // Dragging a bubble pins it (so it stays where you drop it).
      if (!simEnabled || instPin(space, drag.idx)) await savePin(space, drag.idx, true);
      return;
    }
    await handleBubbleClick(drag.spaceId, drag.idx);
  }

  function onBubbleDown(e, o) {
    if (scalePoints || panMode || moveLayer || rotateLayer) return;
    if (e.shiftKey) {
      // Shift-click toggles a bubble in the multi-selection (no drag, no marquee).
      e.stopPropagation();
      toggleMulti(o.key);
      return;
    }
    try {
      e.target.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    // Drag moves a group when: the bubble is in a multi-selection, OR it's an
    // 'attached' parent (then its children move with it).
    let groupKeys = null;
    if (multi.has(o.key) && multi.size > 1) groupKeys = [...multi];
    else if (o.s.child_mode === 'attached' && spaces.some((x) => x.parent_id === o.s.id)) {
      const keys = descendantInstanceKeys(o.s.id);
      if (keys.length > 1) groupKeys = keys;
    }
    let starts = null, anchor = null, groupSet = null;
    if (groupKeys) {
      anchor = toSvgCoords(e);
      groupSet = new Set(groupKeys);
      starts = groupKeys
        .map((k) => {
          const n = nodesRef.current.get(k);
          return n ? { key: k, x: n.x, y: n.y } : null;
        })
        .filter(Boolean);
    }
    dragRef.current = { key: o.key, spaceId: o.s.id, idx: o.i, moved: 0, starts, anchor, groupSet };
  }

  function commitView(v) {
    clearTimeout(debouncers.current.view);
    debouncers.current.view = setTimeout(() => saveProject({ view_x: v.x, view_y: v.y }, { silent: true }), 500);
  }

  async function savePin(space, idx, pinned) {
    const key = `${space.id}:${idx}`;
    const node = nodesRef.current.get(key);
    const pins = { ...pinsOf(space) };
    if (pinned && node) ((pins[idx] = { x: node.x, y: node.y }), pinOverride.current.set(key, pins[idx]));
    else ((delete pins[idx]), pinOverride.current.set(key, null));
    const before = { pin_json: space.pin_json ?? null, pin_x: space.pin_x ?? null, pin_y: space.pin_y ?? null };
    const after = { pin_json: JSON.stringify(pins), pin_x: null, pin_y: null };
    history.record({ label: pinned ? 'pin' : 'unpin', undo: () => applySpace(space.id, before), redo: () => applySpace(space.id, after) });
    setError(null);
    try {
      await applySpace(space.id, after);
    } catch (err) {
      setError(err.message);
    }
  }

  // Pin/unpin every instance of a space at once (so a multiplied space stays put).
  async function savePinAll(space, pinned) {
    const count = Math.max(1, space.count || 1);
    const pins = {};
    for (let i = 0; i < count; i++) {
      const key = `${space.id}:${i}`;
      if (pinned) {
        const n = nodesRef.current.get(key);
        if (n) ((pins[i] = { x: n.x, y: n.y }), pinOverride.current.set(key, pins[i]));
      } else {
        pinOverride.current.set(key, null);
      }
    }
    const before = { pin_json: space.pin_json ?? null, pin_x: space.pin_x ?? null, pin_y: space.pin_y ?? null };
    const after = { pin_json: JSON.stringify(pins), pin_x: null, pin_y: null };
    history.record({ label: pinned ? 'pin all' : 'unpin all', undo: () => applySpace(space.id, before), redo: () => applySpace(space.id, after) });
    setError(null);
    try {
      await applySpace(space.id, after);
    } catch (err) {
      setError(err.message);
    }
  }

  // ---------- multi-select (marquee + shift-click) ----------
  function toggleMulti(key) {
    setMulti((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const multiList = () =>
    [...multi]
      .map((k) => {
        const [id, i] = k.split(':');
        return { id: Number(id), i: Number(i), space: byId.get(Number(id)) };
      })
      .filter((o) => o.space);

  function finishMarquee() {
    const m = marqueeRef.current;
    const box = marquee;
    marqueeRef.current = null;
    setMarquee(null);
    if (!box || !m) return;
    const minX = Math.min(box.x0, box.x1), maxX = Math.max(box.x0, box.x1);
    const minY = Math.min(box.y0, box.y1), maxY = Math.max(box.y0, box.y1);
    // A near-zero drag is a click on empty canvas → clear selection.
    if (maxX - minX < 4 && maxY - minY < 4) {
      if (!m.additive) (setMulti(new Set()), setSelected(null));
      return;
    }
    const hit = new Set(m.additive ? multi : []);
    for (const o of instances) {
      const n = nodesRef.current.get(o.key);
      if (n && n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) hit.add(o.key);
    }
    setMulti(hit);
  }

  async function multiPin(pinned) {
    const bySpace = new Map();
    for (const { id, i, space } of multiList()) {
      if (!bySpace.has(id)) bySpace.set(id, { space, idxs: [] });
      bySpace.get(id).idxs.push(i);
    }
    const changes = [];
    for (const { space, idxs } of bySpace.values()) {
      const before = { pin_json: space.pin_json ?? null, pin_x: space.pin_x ?? null, pin_y: space.pin_y ?? null };
      const pins = { ...pinsOf(space) };
      for (const i of idxs) {
        if (pinned) {
          const n = nodesRef.current.get(`${space.id}:${i}`);
          if (n) pins[i] = { x: n.x, y: n.y };
        } else delete pins[i];
      }
      changes.push({ id: space.id, before, after: { pin_json: JSON.stringify(pins), pin_x: null, pin_y: null } });
    }
    await commitMany(changes, pinned ? 'pin selection' : 'unpin selection');
  }
  // Instance keys for a space and all its (leaf) descendants — used to drag an
  // 'attached' parent together with its children.
  function descendantInstanceKeys(spaceId) {
    const ids = new Set([spaceId]);
    let added = true;
    while (added) {
      added = false;
      for (const s of spaces) {
        if (s.parent_id != null && ids.has(s.parent_id) && !ids.has(s.id)) (ids.add(s.id), (added = true));
      }
    }
    return instances.filter((o) => ids.has(o.s.id)).map((o) => o.key);
  }
  // Pin a set of instance keys at their current positions, in one undo step.
  async function pinKeys(keys) {
    const bySpace = new Map();
    for (const k of keys) {
      const [id, i] = k.split(':');
      const sp = byId.get(Number(id));
      if (!sp) continue;
      if (!bySpace.has(sp.id)) bySpace.set(sp.id, { space: sp, idxs: [] });
      bySpace.get(sp.id).idxs.push(Number(i));
    }
    const changes = [];
    for (const { space, idxs } of bySpace.values()) {
      const before = { pin_json: space.pin_json ?? null, pin_x: space.pin_x ?? null, pin_y: space.pin_y ?? null };
      const pins = { ...pinsOf(space) };
      for (const i of idxs) {
        const n = nodesRef.current.get(`${space.id}:${i}`);
        if (n) pins[i] = { x: n.x, y: n.y };
      }
      changes.push({ id: space.id, before, after: { pin_json: JSON.stringify(pins), pin_x: null, pin_y: null } });
    }
    await commitMany(changes, 'move group');
  }

  async function multiShape(shape) {
    const ids = [...new Set(multiList().map((o) => o.id))];
    const changes = ids.map((id) => ({ id, before: { shape: shapeOf(byId.get(id)) }, after: { shape } }));
    await commitMany(changes, 'shape selection');
  }
  // Assign the selected bubbles to a category (department) — typing a new name
  // creates it. Colour by department to see the grouping update.
  async function multiSetCategory(name) {
    const dept = name.trim();
    if (!dept) return;
    const ids = [...new Set(multiList().map((o) => o.id))];
    const changes = ids
      .map((id) => ({ id, before: { department: byId.get(id).department }, after: { department: dept } }))
      .filter((c) => c.before.department !== c.after.department);
    await commitMany(changes, 'set category');
    setCatDraft('');
  }
  async function multiDelete() {
    const ids = [...new Set(multiList().map((o) => o.id))];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} space${ids.length > 1 ? 's' : ''} from the brief? Their recorded areas and links are removed too.`)) return;
    setError(null);
    try {
      for (const id of ids) await api.deleteSpace(id);
      setMulti(new Set());
      history.clear(); // deletions invalidate recorded closures referencing these spaces
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  function toggleHulls() {
    setHulls((v) => {
      localStorage.setItem('brieftrack.hulls', v ? '0' : '1');
      return !v;
    });
  }
  function setHullSize(v) {
    setHullPad(v);
    localStorage.setItem('brieftrack.hullpad', String(v));
  }
  function toggleCollapse(key) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function setBubbleStyle(v) {
    saveProject({ bubble_style: v });
  }
  // Drag the rail's left edge to resize it (persisted).
  function startRailResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = railW;
    const clamp = (w) => Math.max(260, Math.min(680, w));
    const onMove = (ev) => setRailW(clamp(startW + (startX - ev.clientX)));
    const onUp = (ev) => {
      const w = clamp(startW + (startX - ev.clientX));
      localStorage.setItem('brieftrack.railw', String(w));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function handleBubbleClick(spaceId, idx = 0) {
    setError(null);
    if (selected == null) return (setSelected(spaceId), setSelectedInst(idx));
    if (selected === spaceId) {
      // Same space: re-target a different instance, or deselect if it's the same one.
      if (selectedInst !== idx) return setSelectedInst(idx);
      return setSelected(null);
    }
    await cyclePair(selected, spaceId);
    setSelected(null);
  }

  // findPair reads the latest adjacencies via a ref so history closures stay
  // correct after a refetch reassigns adjacency ids.
  const findPair = (a, b) =>
    adjRef.current.find((l) => (l.space_a === a && l.space_b === b) || (l.space_a === b && l.space_b === a));

  // Drive a pair to a target strength: null (none) | 'desired' | 'required'.
  async function setPair(a, b, target) {
    const existing = findPair(a, b);
    if (target == null) {
      if (existing) await api.deleteAdjacency(existing.id);
    } else if (!existing) {
      await api.createAdjacency(project.id, { space_a: a, space_b: b, strength: target });
    } else if (existing.strength !== target) {
      await api.updateAdjacency(existing.id, { strength: target });
    }
    onChanged();
  }

  async function cyclePair(a, b) {
    const cur = findPair(a, b)?.strength ?? null;
    const next = cur == null ? 'desired' : cur === 'desired' ? 'required' : null;
    history.record({ label: 'link', undo: () => setPair(a, b, cur), redo: () => setPair(a, b, next) });
    setError(null);
    try {
      await setPair(a, b, next);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onLinkClick(l) {
    await cyclePair(l.space_a, l.space_b);
  }

  async function saveProject(fields, { silent } = {}) {
    if (!silent) setError(null);
    try {
      await api.updateProject(project.id, fields);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

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
        await api.createImage(project.id, {
          kind: 'custom',
          name: (file.name || 'Imported image').replace(/\.[^.]+$/, ''),
          image: reader.result,
          opacity: 0.6,
          visible: 1,
        });
        setPanel('layers');
        onChanged();
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsDataURL(file);
  }

  // Optimistically update an image field, then debounce-save it.
  function layerSlider(im, field, v) {
    setError(null);
    im[field] = v;
    setTick((t) => t + 1);
    const key = `img${im.id}_${field}`;
    clearTimeout(debouncers.current[key]);
    debouncers.current[key] = setTimeout(
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
      if (moveLayer === id) setMoveLayer(null);
      if (rotateLayer === id) setRotateLayer(null);
      if (calibrateLayer === id) (setCalibrateLayer(null), setScalePoints(null));
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  function startCalibrate(id) {
    setPanel(null);
    setMoveLayer(null);
    setRotateLayer(null);
    setCalibrateLayer(id);
    setScalePoints([]);
    setScaleDistance('');
  }

  function onSvgScaleClick(e) {
    if (!scalePoints || scalePoints.length >= 2) return;
    setScalePoints([...scalePoints, toSvgCoords(e)]);
  }

  async function applyScale() {
    const [a, b] = scalePoints;
    const dUnits = Math.hypot(b.x - a.x, b.y - a.y);
    const meters = distToMeters(Number(scaleDistance), units);
    const im = imgById.get(calibrateLayer);
    const rect = layerRect(im);
    const nd = im && dims[im.id];
    if (!(meters > 0) || dUnits < 2 || !rect || !nd) return setError('Pick two points and enter a positive distance.');
    const naturalPx = (dUnits / rect.w) * nd.w;
    const mpp = meters / naturalPx;
    setScalePoints(null);
    setScaleDistance('');
    setCalibrateLayer(null);
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
      await api.createImage(project.id, {
        kind: 'satellite',
        name: 'Satellite',
        image: canvas.toDataURL('image/jpeg', 0.85),
        mpp: metersPerPixel,
        attribution: `Imagery © Esri World Imagery · ${loc.display}`,
        opacity: 0.55,
        visible: 1,
      });
      setPanel('layers');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSatBusy(false);
    }
  }

  // ---------- scale & split ----------
  async function onScaleSelect(value) {
    const oldS = effScale;
    const newS = value === 'auto' ? fitScale : ratioToScale(Number(value));
    const f = oldS > 0 && newS > 0 ? oldS / newS : 1;
    const fields = { display_scale: value === 'auto' ? null : ratioToScale(Number(value)) };

    if (Math.abs(f - 1) > 1e-9) {
      // Uniform zoom about the viewport centre keeps bubbles aligned with images.
      const A = { x: viewRef.current.x + W / 2, y: viewRef.current.y + H / 2 };
      const tx = (p) => zoomAbout(p, A, f);
      for (const n of nodesRef.current.values()) {
        const t = tx(n);
        n.x = t.x;
        n.y = t.y;
      }
      const pinUpdates = [];
      for (const s of leaves) {
        const pins = pinsOf(s);
        if (Object.keys(pins).length === 0) continue;
        const np = {};
        for (const [i, p] of Object.entries(pins)) {
          np[i] = tx(p);
          pinOverride.current.set(`${s.id}:${i}`, np[i]);
        }
        pinUpdates.push({ id: s.id, pin_json: JSON.stringify(np) });
      }
      // Image layers zoom about the same anchor so they stay aligned with bubbles.
      const imageUpdates = imgLayers.map((im) => {
        const c = tx({ x: W / 2 + (im.x || 0), y: H / 2 + (im.y || 0) });
        return { id: im.id, x: c.x - W / 2, y: c.y - H / 2 };
      });
      try {
        for (const u of pinUpdates) await api.updateSpace(u.id, { pin_json: u.pin_json, pin_x: null, pin_y: null });
        for (const u of imageUpdates) await api.updateImage(u.id, { x: u.x, y: u.y });
      } catch (err) {
        setError(err.message);
      }
    }
    await saveProject(fields);
  }
  function toggleSplit() {
    const next = !split;
    setSplit(next);
    localStorage.setItem('brieftrack.split', next ? '1' : '0');
  }
  function onAreaDraft(space, value) {
    setDrafts((d) => ({ ...d, [space.id]: value }));
    clearTimeout(draftTimers.current.get(space.id));
    const before = space.target_area;
    draftTimers.current.set(
      space.id,
      setTimeout(async () => {
        const area = Number(value);
        if (!(area > 0) || area === before) return;
        history.record({
          label: 'area',
          undo: () => applySpace(space.id, { target_area: before }),
          redo: () => applySpace(space.id, { target_area: area }),
        });
        try {
          await api.updateSpace(space.id, { target_area: area });
          setDrafts((d) => {
            const next = { ...d };
            delete next[space.id];
            return next;
          });
          onChanged();
        } catch (err) {
          setError(err.message);
        }
      }, 700)
    );
  }

  function setNorth(deg) {
    const d = ((deg % 360) + 360) % 360;
    clearTimeout(debouncers.current.north);
    debouncers.current.north = setTimeout(() => saveProject({ north_deg: d }, { silent: true }), 250);
  }

  // ---------- PDF ----------
  async function exportPdf() {
    const nodes = nodesRef.current;
    const bubbles = instances
      .map((o) => {
        const n = nodes.get(o.key);
        if (!n) return null;
        const count = Math.max(1, o.s.count || 1);
        return {
          x: n.x,
          y: n.y,
          r: radiusOf(o.s),
          box: shapeOf(o.s) === 'box',
          color: colorOf(o.s),
          opacity: project.bubble_opacity ?? 0.32,
          label: o.s.name + (count > 1 ? ` ${o.i + 1}` : ''),
          sublabel: fmtArea(ea(o.s), units),
        };
      })
      .filter(Boolean);
    if (bubbles.length === 0) return setError('Nothing to export yet.');

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of bubbles) {
      minX = Math.min(minX, b.x - b.r);
      minY = Math.min(minY, b.y - b.r);
      maxX = Math.max(maxX, b.x + b.r);
      maxY = Math.max(maxY, b.y + b.r);
    }
    const pad = 40;
    const bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };

    const sceneLayers = [];
    for (const im of imgLayers) {
      if (!im.visible) continue;
      const r = layerRect(im);
      if (!r) continue;
      const fcss = filterCss(im.filter);
      if (!r.rot && (!im.filter || fcss === 'none')) {
        sceneLayers.push({ dataUrl: r.dataUrl, x: r.x, y: r.y, w: r.w, h: r.h, opacity: r.opacity });
        continue;
      }
      // Bake rotation + filter into the image so the PDF stays scale-accurate.
      const baked = await bakeImage(r.dataUrl, r.rot, fcss);
      if (!baked) continue;
      const unitsPerPx = r.w / baked.naturalW;
      const bw = baked.canvasW * unitsPerPx;
      const bh = baked.canvasH * unitsPerPx;
      sceneLayers.push({ dataUrl: baked.dataUrl, x: r.cx - bw / 2, y: r.cy - bh / 2, w: bw, h: bh, opacity: r.opacity });
    }

    const links = adjacencies
      .map((l) => {
        const sa = byId.get(l.space_a);
        const sb = byId.get(l.space_b);
        if (!sa || !sb) return null;
        const pair = closestPair(sa, sb);
        if (!pair) return null;
        return { x1: pair.a.x, y1: pair.a.y, x2: pair.b.x, y2: pair.b.y, strength: l.strength };
      })
      .filter(Boolean);

    const ratioLabel = effScale ? scaleLabelFor(effScale) : 'NTS';
    try {
      exportDiagramPdf({
        bounds,
        layers: sceneLayers,
        links,
        bubbles,
        bubbleStyle,
        scale: effScale ? { ratioLabel, scaleBar: scaleBar ? { lenUnits: scaleBar.len, label: scaleBar.label } : null } : null,
        north: { deg: project.north_deg || 0 },
        title: {
          name: project.name,
          client: project.client,
          stage: project.stage,
          scaleLabel: ratioLabel,
          date: new Date().toISOString().slice(0, 10),
        },
      });
    } catch (err) {
      setError(`PDF export failed: ${err.message}`);
    }
  }

  // ---------- derived render values ----------
  if (spaces.length === 0)
    return <div className="stage-empty"><div className="empty">Define the brief first — the bubble diagram is drawn from its spaces.</div></div>;
  if (leaves.length === 0)
    return <div className="stage-empty"><div className="empty">This program only has containers. Add spaces inside them in the Brief tab.</div></div>;

  const nodes = nodesRef.current;
  const presets = SCALE_PRESETS[units === 'ft2' ? 'ft2' : 'm2'];

  function scaleLabelFor(S) {
    const ratio = scaleToRatio(S);
    const preset = presets.find(([r]) => Math.abs(r - ratio) / r < 0.02);
    return preset ? preset[1] : `≈ 1:${ratio}`;
  }

  let scaleBar = null;
  if (effScale) {
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const cand = nice
      .map((v) => ({ label: `${v} ${distUnit(units)}`, len: distToMeters(v, units) / effScale }))
      .filter((c) => c.len >= 90 && c.len <= 220);
    if (cand.length) scaleBar = cand[0];
  }

  const scaleValue = displayScale ? String(scaleToRatio(displayScale)) : 'auto';
  const viewMoved = Math.abs(view.x) > 0.5 || Math.abs(view.y) > 0.5;
  const hasImage = imgLayers.length > 0;
  const attributionLayer = imgLayers.find((im) => im.visible && im.attribution);
  const imgTransform = (r) => (r.rot ? `rotate(${r.rot} ${r.cx} ${r.cy})` : undefined);
  const bubbleStyle = project.bubble_style || 'solid';
  const selectedSpace = selected != null ? byId.get(selected) : null;
  // When a space is selected, the Relationships panel narrows to its links.
  const relList = selectedSpace ? adjacencies.filter((l) => l.space_a === selected || l.space_b === selected) : adjacencies;

  // Areas panel: building → level → spaces (for the building display mode).
  const areaTree = (() => {
    const m = new Map();
    for (const s of leaves) {
      const root = rootContainer(s, byId);
      const b = root ? root.name : 'Unassigned';
      const lvl = s.level || '';
      if (!m.has(b)) m.set(b, new Map());
      const lm = m.get(b);
      if (!lm.has(lvl)) lm.set(lvl, []);
      lm.get(lvl).push(s);
    }
    return m;
  })();
  const areaRow = (s) => (
    <div key={s.id} className={`split-row ${selected === s.id ? 'selected' : ''}`} onClick={() => setSelected(selected === s.id ? null : s.id)}>
      <span className="split-name" title={s.name}>
        {anyPinned(s) && <span className="split-pin">◉</span>}
        {s.name}
        {s.count > 1 ? ` ×${s.count}` : ''}
      </span>
      <input type="number" min="0.1" step="any" value={drafts[s.id] ?? s.target_area} onChange={(e) => onAreaDraft(s, e.target.value)} onClick={(e) => e.stopPropagation()} />
      <span className="split-total">{fmtArea((s.count || 1) * ea(s), units)}</span>
    </div>
  );

  return (
    <div
      className={`diagram-layout ${split ? '' : 'norail'}`}
      style={{ '--rail-w': `${railW}px` }}
    >
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {showMatrix && (
        <MatrixPanel leaves={leaves} adjacencies={adjacencies} colorOf={colorOf} onCycle={cyclePair} onClose={() => setShowMatrix(false)} />
      )}

      <div className="diagram-main">
        <div className="diagram-toolbar">
          <div className="toolbar-group">
            <label className="switch" title="When on, bubbles auto-arrange and avoid overlaps. Turn off to place them by hand.">
              <input type="checkbox" checked={simEnabled} onChange={(e) => saveProject({ sim_enabled: e.target.checked ? 1 : 0 })} />
              Auto-layout
            </label>
            <button className={`btn small ${panMode ? 'on' : ''}`} onClick={() => (setPanMode((v) => !v), setMoveLayer(null), setRotateLayer(null))} title="Toggle panning — drag the canvas to move the view.">
              ✋ Pan
            </button>
            {viewMoved && (
              <button className="btn small ghost" onClick={() => ((setView({ x: 0, y: 0 })), commitView({ x: 0, y: 0 }))} title="Recentre the view">
                ⌖ Recentre
              </button>
            )}
          </div>
          <div className="toolbar-sep" />
          <div className="toolbar-group">
            <button className="btn small ghost" onClick={history.undo} disabled={!history.canUndo} title={history.canUndo ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}>
              ↶ Undo
            </button>
            <button className="btn small ghost" onClick={history.redo} disabled={!history.canRedo} title={history.canRedo ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}>
              ↷ Redo
            </button>
          </div>
          <div className="toolbar-sep" />
          <div className="toolbar-group">
            <label className="scale-label" title="Drawing scale. Bubbles and images draw true-to-scale; the PDF matches.">
              Scale
              <select className="scale-select" value={scaleValue} onChange={(e) => onScaleSelect(e.target.value)}>
                <option value="auto">{fitScale ? 'Auto (fit image)' : 'Relative'}</option>
                {presets.map(([r, label]) => (
                  <option key={r} value={r}>
                    {label}
                  </option>
                ))}
                {scaleValue !== 'auto' && !presets.some(([r]) => String(r) === scaleValue) && (
                  <option value={scaleValue}>≈ 1:{scaleValue}</option>
                )}
              </select>
            </label>
            {hasBuildings && (
              <label className="scale-label" title="Colour bubbles by category or by building.">
                Colour
                <select className="scale-select" value={colorBy} onChange={(e) => setColorBy(e.target.value)}>
                  <option value="department">Category</option>
                  <option value="building">Building</option>
                </select>
              </label>
            )}
          </div>
          <div className="toolbar-sep" />
          <div className="toolbar-group">
            <button className={`btn small ${panel === 'layers' ? 'on' : ''}`} onClick={() => setPanel(panel === 'layers' ? null : 'layers')} title="Satellite & imported images, each with its own scale and rotation.">
              🗺 Layers
            </button>
            <button className={`btn small ${split ? 'on' : ''}`} onClick={toggleSplit} title="Show or hide the Areas & Relationships panel.">
              ◫ Panel
            </button>
          </div>
          <div className="toolbar-sep" />
          <div className="toolbar-group">
            <button className="btn small" onClick={() => convertAll(leaves.every((s) => shapeOf(s) === 'box') ? 'bubble' : 'box')} title="Convert every space to boxes (or back to bubbles)">
              {leaves.every((s) => shapeOf(s) === 'box') ? '○ All bubbles' : '▢ All boxes'}
            </button>
            <label className="scale-label" title="How bubbles are drawn">
              Style
              <select className="scale-select" value={bubbleStyle} onChange={(e) => setBubbleStyle(e.target.value)}>
                <option value="solid">Solid</option>
                <option value="outline">Outline</option>
                <option value="sketch">Sketch</option>
              </select>
            </label>
            <button className={`btn small ${hulls ? 'on' : ''}`} onClick={toggleHulls} title="Show a soft hull behind each category group (building hulls always show).">
              ⬡ Categories
            </button>
            {(hulls || hasBuildings) && (
              <label className="hull-size" title="Hull padding around the bubbles">
                <input type="range" min="6" max="80" step="2" value={hullPad} onChange={(e) => setHullSize(Number(e.target.value))} />
              </label>
            )}
            <button className={`btn small ${showMatrix ? 'on' : ''}`} onClick={() => setShowMatrix(true)} title="Edit relationships as an adjacency matrix.">
              ▦ Matrix
            </button>
          </div>
          <div className="toolbar-spacer" />
          <div className="toolbar-group">
            <button className="btn small" onClick={exportPdf} title="Export a scale-accurate PDF with the background images.">
              ⤓ PDF
            </button>
            <button className="btn small ghost" onClick={() => setShowHelp(true)} title="How the bubble diagram works">
              ?
            </button>
          </div>
        </div>

        <div className="bubble-stage" ref={stageRef}>
          {error && (
            <div className="stage-popover" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {error}
              <button className="btn small ghost" style={{ float: 'right' }} onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {panel === 'layers' && (
            <div className="stage-popover layers-popover">
              <div className="layers-panel-head">
                <h3>Image layers</h3>
                <button className="btn small ghost" onClick={() => setPanel(null)}>✕</button>
              </div>
              <div className="layers-list">
                {imgLayers.length === 0 && <div className="empty small">No images yet — add a site plan or satellite below.</div>}
                {imgLayers.map((im) => (
                  <LayerRow
                    key={im.id}
                    title={`${im.kind === 'satellite' ? '🛰' : '🖼'} ${im.name || (im.kind === 'satellite' ? 'Satellite' : 'Image')}`}
                    layer={im}
                    dims={dims[im.id]}
                    units={units}
                    calibrated={im.mpp > 0}
                    onToggleVisible={(v) => toggleLayerVisible(im, v)}
                    onOpacity={(v) => layerSlider(im, 'opacity', v)}
                    onRotate={(v) => layerSlider(im, 'rot', v)}
                    onCalibrate={() => startCalibrate(im.id)}
                    onMove={() => ((setRotateLayer(null)), setMoveLayer(moveLayer === im.id ? null : im.id))}
                    moving={moveLayer === im.id}
                    onRotateMode={() => ((setMoveLayer(null)), setRotateLayer(rotateLayer === im.id ? null : im.id))}
                    rotating={rotateLayer === im.id}
                    onFilter={(v) => layerSlider(im, 'filter', v)}
                    onDelete={() => deleteImageLayer(im.id)}
                  />
                ))}
              </div>
              <div className="layers-add">
                <button className="btn small" onClick={() => fileRef.current?.click()}>＋ Add image</button>
                <button className="btn small" onClick={() => setPanel('sat')}>＋ Add satellite</button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
              <p className="hint" style={{ margin: '6px 2px 0' }}>
                Add as many images as you like. Calibrate each on its own and they share the diagram scale.
                Use <strong>Move</strong> and <strong>Rotate</strong> (then drag the canvas) to align a layer.
              </p>
            </div>
          )}

          {panel === 'sat' && (
            <form className="stage-popover sat-panel" onSubmit={fetchSatellite}>
              <input placeholder="Site address or place (e.g. 1 Macquarie St, Sydney)" value={satQuery} onChange={(e) => setSatQuery(e.target.value)} required />
              <select value={satZoom} onChange={(e) => setSatZoom(e.target.value)}>
                <option value="16">Wide (~1.5 km)</option>
                <option value="17">Area (~750 m)</option>
                <option value="18">Site (~380 m)</option>
                <option value="19">Close (~190 m)</option>
              </select>
              <button className="btn primary small" disabled={satBusy}>
                {satBusy ? 'Fetching…' : 'Fetch imagery'}
              </button>
              <button type="button" className="btn small ghost" onClick={() => setPanel('layers')}>
                Cancel
              </button>
            </form>
          )}

          {scalePoints && (
            <div className="stage-popover scale-panel">
              {scalePoints.length < 2 ? (
                <span>
                  Calibrating <strong>{imgById.get(calibrateLayer)?.name || 'image'}</strong> — click{' '}
                  {scalePoints.length === 0 ? 'the first' : 'the second'} point of a known distance on it.
                </span>
              ) : (
                <>
                  <span>Distance between the points:</span>
                  <input type="number" min="0.1" step="any" autoFocus value={scaleDistance} onChange={(e) => setScaleDistance(e.target.value)} placeholder={distUnit(units)} />
                  <span>{distUnit(units)}</span>
                  <button className="btn primary small" onClick={applyScale}>
                    Apply
                  </button>
                </>
              )}
              <button className="btn small ghost" onClick={() => ((setScalePoints(null), setCalibrateLayer(null)))}>
                Cancel
              </button>
            </div>
          )}

          <div className="stage-legend">
            {groups.map((g) => (
              <span key={g} className="legend-item">
                <label className="legend-swatch" style={{ background: colorForLabel(g) }} title={`Recolour “${g}”`}>
                  <input type="color" value={colorForLabel(g)} onChange={(e) => setCategoryColor(g, e.target.value)} />
                </label>
                {g}
              </span>
            ))}
          </div>

          <svg
            ref={svgRef}
            viewBox={`${originX} ${originY} ${vb.w} ${vb.h}`}
            className={`bubble-svg ${scalePoints ? 'scaling' : ''} ${panMode || moveLayer || rotateLayer ? 'panning' : ''}`}
            onPointerDown={onSvgPointerDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <defs>
              <filter id="sketchy" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n" />
                <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </defs>
            {imgLayers.map((im) => {
              if (!im.visible) return null;
              const r = layerRect(im);
              if (!r) return null;
              const active = moveLayer === im.id || rotateLayer === im.id;
              return (
                <image
                  key={im.id}
                  href={im.image}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  opacity={im.opacity}
                  preserveAspectRatio="none"
                  transform={imgTransform(r)}
                  style={im.filter ? { filter: filterCss(im.filter) } : undefined}
                  className={active ? 'layer-active' : ''}
                />
              );
            })}

            {(() => {
              // Building hulls always show (when buildings exist); category hulls
              // are optional via the ⬡ Categories toggle.
              const out = [];
              const addHulls = (keyFn, cls, withLabel) => {
                const byG = new Map();
                for (const o of instances) {
                  const n = nodes.get(o.key);
                  if (!n) continue;
                  const g = keyFn(o.s);
                  if (g == null) continue;
                  if (!byG.has(g)) byG.set(g, []);
                  const r = radiusOf(o.s) + hullPad;
                  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4)
                    byG.get(g).push({ x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r });
                }
                for (const [g, pts] of byG) {
                  const hull = convexHull(pts);
                  const d = smoothHullPath(hull);
                  if (!d) continue;
                  const color = colorForLabel(g);
                  out.push(<path key={`${cls}:${g}`} d={d} className={`group-hull ${cls}`} fill={color} stroke={color} />);
                  if (withLabel) {
                    const top = hull.reduce((m, p) => (p.y < m.y ? p : m), hull[0]);
                    out.push(
                      <text key={`lbl:${g}`} x={top.x} y={top.y - 4} textAnchor="middle" className="hull-label" fill={color}>
                        {g}
                      </text>
                    );
                  }
                }
              };
              if (hasBuildings) addHulls((s) => { const root = rootContainer(s, byId); return root ? root.name : null; }, 'building-hull', true);
              if (hulls) addHulls((s) => s.department || 'General', 'cat-hull', false);
              return out;
            })()}

            {scalePoints &&
              scalePoints.map((p, i) => (
                <g key={i} className="scale-point">
                  <circle cx={p.x} cy={p.y} r="6" />
                  <circle cx={p.x} cy={p.y} r="2" />
                </g>
              ))}
            {scalePoints?.length === 2 && (
              <line x1={scalePoints[0].x} y1={scalePoints[0].y} x2={scalePoints[1].x} y2={scalePoints[1].y} className="scale-line" />
            )}

            {adjacencies.map((l) => {
              const sa = byId.get(l.space_a);
              const sb = byId.get(l.space_b);
              if (!sa || !sb) return null;
              const pair = closestPair(sa, sb);
              if (!pair) return null;
              return (
                <g key={l.id} className="link-hit" onClick={() => onLinkClick(l)}>
                  <line x1={pair.a.x} y1={pair.a.y} x2={pair.b.x} y2={pair.b.y} className="link-hitarea" />
                  <line x1={pair.a.x} y1={pair.a.y} x2={pair.b.x} y2={pair.b.y} className={`link ${l.strength}`} />
                </g>
              );
            })}

            {instances.map((o) => {
              const n = nodes.get(o.key);
              if (!n) return null;
              const { s, i } = o;
              const r = radiusOf(s);
              const isSel = selected === s.id && (Math.max(1, s.count || 1) === 1 || selectedInst === i);
              const pinned = !!instPin(s, i);
              const inMulti = multi.has(o.key);
              const count = Math.max(1, s.count || 1);
              const box = shapeOf(s) === 'box';
              const side = r * Math.sqrt(Math.PI); // square of equal area
              const fillOp = isSel ? Math.min((project.bubble_opacity ?? 0.32) + 0.25, 1) : pinned ? Math.min((project.bubble_opacity ?? 0.32) + 0.1, 1) : project.bubble_opacity ?? 0.32;
              const sw = isSel ? 3 : pinned ? 2.5 : 1.5;
              const outline = bubbleStyle === 'outline';
              const sketch = bubbleStyle === 'sketch';
              const fillOpEff = outline ? 0 : fillOp;
              const swEff = outline ? sw + 1 : sw;
              const shapeFilter = sketch ? 'url(#sketchy)' : undefined;
              return (
                <g
                  key={o.key}
                  data-space-id={s.id}
                  data-instance={i}
                  className={`bubble ${isSel ? 'selected' : ''} ${inMulti ? 'multi' : ''}`}
                  transform={`translate(${n.x}, ${n.y})`}
                  onPointerDown={(e) => onBubbleDown(e, o)}
                  onPointerEnter={() => (hoverRef.current = { space: s, idx: i })}
                  onPointerLeave={() => (hoverRef.current?.space.id === s.id && hoverRef.current?.idx === i ? (hoverRef.current = null) : null)}
                >
                  <title>
                    {s.name}
                    {count > 1 ? ` ${i + 1} of ${count}` : ''} — {fmtArea(ea(s), units)} · P pin · B box
                  </title>
                  {pinned &&
                    (box ? (
                      <rect x={-side / 2 - 5} y={-side / 2 - 5} width={side + 10} height={side + 10} rx="3" className="pin-ring" />
                    ) : (
                      <circle r={r + 5} className="pin-ring" />
                    ))}
                  {inMulti &&
                    (box ? (
                      <rect x={-side / 2 - 7} y={-side / 2 - 7} width={side + 14} height={side + 14} rx="4" className="multi-ring" />
                    ) : (
                      <circle r={r + 7} className="multi-ring" />
                    ))}
                  {box ? (
                    <rect x={-side / 2} y={-side / 2} width={side} height={side} rx={Math.min(4, side / 8)} fill={colorOf(s)} fillOpacity={fillOpEff} stroke={colorOf(s)} strokeWidth={swEff} filter={shapeFilter} />
                  ) : (
                    <circle r={r} fill={colorOf(s)} fillOpacity={fillOpEff} stroke={colorOf(s)} strokeWidth={swEff} filter={shapeFilter} />
                  )}
                  <text textAnchor="middle" dy={r > 26 ? -2 : r > 13 ? 3 : r + 11} className="bubble-name" style={{ fontSize: Math.max(9, Math.min(14, r / 3.2)) }}>
                    {s.name}
                    {count > 1 ? ` ${i + 1}` : ''}
                  </text>
                  {r > 26 && (
                    <text textAnchor="middle" dy={14} className="bubble-area">
                      {fmtArea(ea(s), units)}
                    </text>
                  )}
                </g>
              );
            })}

            {scaleBar && (
              <g className="scale-bar" transform={`translate(${originX + 20}, ${originY + vb.h - 24})`}>
                <rect x="-8" y="-16" width={scaleBar.len + 150} height="30" rx="4" className="scale-bar-bg" />
                <line x1="0" y1="0" x2={scaleBar.len} y2="0" />
                <line x1="0" y1="-5" x2="0" y2="5" />
                <line x1={scaleBar.len} y1="-5" x2={scaleBar.len} y2="5" />
                <text x={scaleBar.len + 8} y="4">
                  {scaleBar.label} · {scaleLabelFor(effScale)}
                </text>
              </g>
            )}

            {attributionLayer && (
              <text x={originX + vb.w - 8} y={originY + vb.h - 8} textAnchor="end" className="attribution">
                {attributionLayer.attribution}
              </text>
            )}

            {marquee && (
              <rect
                className="marquee"
                x={Math.min(marquee.x0, marquee.x1)}
                y={Math.min(marquee.y0, marquee.y1)}
                width={Math.abs(marquee.x1 - marquee.x0)}
                height={Math.abs(marquee.y1 - marquee.y0)}
              />
            )}
          </svg>

          <NorthRose deg={project.north_deg || 0} onSet={setNorth} />

          {(() => {
            const sel = selected != null ? byId.get(selected) : null;
            const selCount = sel ? Math.max(1, sel.count || 1) : 1;
            const selInstPinned = sel ? !!instPin(sel, selectedInst) : false;
            const allPinned = sel ? Array.from({ length: selCount }, (_, i) => i).every((i) => instPin(sel, i)) : false;
            const selBox = sel ? shapeOf(sel) === 'box' : false;
            return (
              <div className="stage-fabs">
                <button
                  className={`fab ${selInstPinned ? 'active' : ''}`}
                  disabled={!sel}
                  onClick={() => sel && savePin(sel, selectedInst, !selInstPinned)}
                  title={sel ? `${selInstPinned ? 'Unpin' : 'Pin'} ${sel.name}${selCount > 1 ? ` ${selectedInst + 1}` : ''} (or press P over a bubble)` : 'Tap a bubble first, then pin it'}
                >
                  📌<span className="fab-label">{selInstPinned ? 'Unpin' : 'Pin'}</span>
                </button>
                {sel && selCount > 1 && (
                  <button
                    className={`fab ${allPinned ? 'active' : ''}`}
                    onClick={() => savePinAll(sel, !allPinned)}
                    title={`${allPinned ? 'Unpin' : 'Pin'} all ${selCount} ${sel.name} rooms (Shift+P)`}
                  >
                    📌<span className="fab-label">{allPinned ? 'Unpin all' : 'Pin all'}</span>
                  </button>
                )}
                <button
                  className={`fab ${selBox ? 'active' : ''}`}
                  disabled={!sel}
                  onClick={() => sel && toggleShape(sel)}
                  title={sel ? `Switch ${sel.name} to a ${selBox ? 'bubble' : 'box'} (or press B over a bubble)` : 'Tap a bubble first, then change its shape'}
                >
                  {selBox ? '○' : '▢'}<span className="fab-label">{selBox ? 'Bubble' : 'Box'}</span>
                </button>
                <div className="fab-hint">{sel ? sel.name + (selCount > 1 ? ` ${selectedInst + 1}` : '') : 'tap a bubble'}</div>
              </div>
            );
          })()}

          {multi.size > 0 && (
            <div className="multi-bar">
              <span className="multi-count">{multi.size} selected</span>
              <button className="btn small" onClick={() => multiPin(true)} title="Pin every selected bubble where it sits">📌 Pin</button>
              <button className="btn small" onClick={() => multiPin(false)} title="Unpin the selected bubbles">Unpin</button>
              <button className="btn small" onClick={() => multiShape('box')} title="Make the selected spaces boxes">▢ Box</button>
              <button className="btn small" onClick={() => multiShape('bubble')} title="Make the selected spaces bubbles">○ Bubble</button>
              <span className="multi-sep" />
              <input
                className="multi-cat"
                list="diagram-categories"
                placeholder="Category…"
                value={catDraft}
                onChange={(e) => setCatDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') multiSetCategory(catDraft); }}
                title="Assign the selected bubbles to a category (type a new name to create it)"
              />
              <datalist id="diagram-categories">
                {departments.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
              <button className="btn small" onClick={() => multiSetCategory(catDraft)} disabled={!catDraft.trim()} title="Set the category of the selected bubbles">
                Set
              </button>
              <span className="multi-sep" />
              <button className="btn small ghost danger" onClick={multiDelete} title="Delete the selected spaces from the brief">✕ Delete</button>
              <button className="btn small ghost" onClick={() => setMulti(new Set())} title="Clear the selection (Esc)">Clear</button>
            </div>
          )}

          <div className="stage-hint">
            {rotateLayer
              ? 'Rotating image — drag the canvas to turn it. Toggle Rotate off when done.'
              : moveLayer
              ? 'Moving image layer — drag the canvas to reposition it.'
              : panMode
              ? 'Pan mode — drag the canvas. Toggle Pan off to edit bubbles.'
              : multi.size > 0
              ? `${multi.size} selected — drag any selected bubble to move them together · set category / pin / box above · Esc to clear`
              : 'Drag to move · hover + P to pin · hover + B for box · click two bubbles to link · drag empty canvas to multi-select' +
                (effScale ? ` · ${scaleLabelFor(effScale)}` : '') +
                (hasImage ? '' : ' · add a site image under Layers')}
          </div>
        </div>
      </div>

      {split && (
        <aside className="diagram-rail">
          <button className="rail-close" onClick={toggleSplit} title="Close panel">▾ Close panel</button>
          <div className="rail-resizer" onPointerDown={startRailResize} title="Drag to resize the panel" />
          <section className="rail-section areas">
            <div className="rail-head">
              <h3>Areas</h3>
              {hasBuildings && (
                <div className="seg small">
                  <button className={`seg-btn ${areaMode === 'category' ? 'active' : ''}`} onClick={() => setAreaMode('category')}>Category</button>
                  <button className={`seg-btn ${areaMode === 'building' ? 'active' : ''}`} onClick={() => setAreaMode('building')}>Building</button>
                </div>
              )}
            </div>
            <div className="split-rows">
              {areaMode === 'building' && hasBuildings
                ? [...areaTree.entries()].map(([b, levels]) => {
                    const bKey = `b:${b}`;
                    const open = !collapsed.has(bKey);
                    const bSpaces = [...levels.values()].flat();
                    const bTotal = bSpaces.reduce((t, s) => t + (s.count || 1) * ea(s), 0);
                    const multiLevel = levels.size > 1 || ![...levels.keys()].every((k) => k === '');
                    return (
                      <div key={bKey} className="split-group">
                        <div className="split-dept building" onClick={() => toggleCollapse(bKey)}>
                          <span className="collapse-caret">{open ? '▾' : '▸'}</span>
                          <span className="legend-dot" style={{ background: colorForLabel(b) }} />
                          🏢 {b}
                          <span className="split-grouptotal">{fmtArea(bTotal, units)}</span>
                        </div>
                        {open &&
                          [...levels.entries()].map(([lvl, list]) => (
                            <div key={lvl} className="split-level-group">
                              {multiLevel && <div className="split-level">{lvl || 'Unassigned level'}</div>}
                              {list.map((s) => areaRow(s))}
                            </div>
                          ))}
                      </div>
                    );
                  })
                : groups.map((g) => {
                    const gKey = `c:${g}`;
                    const open = !collapsed.has(gKey);
                    const list = leaves.filter((s) => groupKey(s) === g);
                    const gTotal = list.reduce((t, s) => t + (s.count || 1) * ea(s), 0);
                    return (
                      <div key={gKey} className="split-group">
                        <div className="split-dept" onClick={() => toggleCollapse(gKey)}>
                          <span className="collapse-caret">{open ? '▾' : '▸'}</span>
                          <span className="legend-dot" style={{ background: colorForLabel(g) }} />
                          {g}
                          <span className="split-grouptotal">{fmtArea(gTotal, units)}</span>
                        </div>
                        {open && list.map((s) => areaRow(s))}
                      </div>
                    );
                  })}
            </div>
            <div className="split-foot">
              <span>Net total</span>
              <strong>{fmtArea(leaves.reduce((t, s) => t + (s.count || 1) * ea(s), 0), units)}</strong>
            </div>
          </section>

          <section className="rail-section rel">
            <div className="rail-head">
              <h3>Relationships</h3>
              <span className="muted">
                {selectedSpace ? `${relList.length} · ${selectedSpace.name}` : adjacencies.length}
              </span>
            </div>
            {selectedSpace && (
              <div className="rel-filter">
                Showing links for <strong>{selectedSpace.name}</strong>
                <button className="btn small ghost" onClick={() => setSelected(null)}>show all</button>
              </div>
            )}
            {relList.length === 0 ? (
              <div className="empty small">{selectedSpace ? 'No links for this space yet — click another bubble to connect them.' : 'Click two bubbles to link them.'}</div>
            ) : (
              <table className="rail-rel">
                <tbody>
                  {relList.map((l) => {
                    const a = byId.get(l.space_a);
                    const b = byId.get(l.space_b);
                    if (!a || !b) return null;
                    return (
                      <tr key={l.id}>
                        <td className="rel-pair">
                          <b>{a.name}</b> ↔ <b>{b.name}</b>
                        </td>
                        <td style={{ width: 96 }}>
                          <select value={l.strength} onChange={async (e) => ((await api.updateAdjacency(l.id, { strength: e.target.value })), onChanged())} className="strength-select">
                            <option value="required">Required</option>
                            <option value="desired">Desired</option>
                          </select>
                        </td>
                        <td style={{ width: 28 }} className="row-actions">
                          <button className="btn small ghost danger" onClick={async () => ((await api.deleteAdjacency(l.id)), onChanged())}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </aside>
      )}
    </div>
  );
}

function LayerRow({ title, layer, dims, units, calibrated, onToggleVisible, onOpacity, onRotate, onCalibrate, onMove, moving, onRotateMode, rotating, onFilter, onDelete }) {
  let scaleNote = '';
  if (calibrated && dims) {
    const realW = dims.w * layer.mpp;
    scaleNote = `${Math.round(realW).toLocaleString()} ${distUnit(units)}`;
  }
  return (
    <div className="layer-row">
      <div className="layer-head">
        <label className="switch" title="Show or hide this layer">
          <input type="checkbox" checked={!!layer.visible} onChange={(e) => onToggleVisible(e.target.checked)} />
          <span className="layer-name">{title}</span>
        </label>
        <span className={`layer-cal ${calibrated ? 'ok' : 'warn'}`} title={calibrated ? `${scaleNote} wide` : 'Not calibrated — use 📏 to set the scale'}>
          {calibrated ? scaleNote : 'uncal.'}
        </span>
        <button className="btn small ghost danger layer-del" onClick={onDelete} title="Remove this image">✕</button>
      </div>
      <div className="layer-ctrls">
        <span className="opacity-mini" title="Opacity">
          ◐
          <input type="range" min="0.1" max="1" step="0.05" value={layer.opacity} onChange={(e) => onOpacity(Number(e.target.value))} />
        </span>
        <span className="rot-field" title="Rotation in degrees (clockwise)">
          ⟳
          <input type="number" step="1" value={Math.round(layer.rot || 0)} onChange={(e) => onRotate(((Number(e.target.value) % 360) + 360) % 360)} />
        </span>
        <select className="filter-select" value={layer.filter || ''} onChange={(e) => onFilter(e.target.value)} title="Diagrammatic filter">
          {IMAGE_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button className="btn small" onClick={onCalibrate} title="Calibrate scale — mark a known distance">📏</button>
        <button className={`btn small ${moving ? 'on' : ''}`} onClick={onMove} title="Move — then drag the canvas">✥</button>
        <button className={`btn small ${rotating ? 'on' : ''}`} onClick={onRotateMode} title="Rotate — then drag the canvas">⟲</button>
      </div>
    </div>
  );
}

function MatrixPanel({ leaves, adjacencies, colorOf, onCycle, onClose }) {
  const strengthOf = (a, b) => {
    const l = adjacencies.find(
      (x) => (x.space_a === a && x.space_b === b) || (x.space_a === b && x.space_b === a)
    );
    return l?.strength ?? null;
  };
  const glyph = { required: '●', desired: '○' };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal matrix-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Adjacency matrix</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <p className="hint">
          Click a cell to cycle the relationship: blank → <b>○ desired</b> → <b>● required</b> → blank. Changes
          sync with the diagram and are undoable.
        </p>
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th className="corner" />
                {leaves.map((s) => (
                  <th key={s.id} className="mcol" title={s.name}>
                    <span>{s.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaves.map((row, ri) => (
                <tr key={row.id}>
                  <th className="mrow" title={row.name}>
                    <span className="legend-dot" style={{ background: colorOf(row) }} />
                    {row.name}
                  </th>
                  {leaves.map((col, ci) => {
                    if (ci === ri) return <td key={col.id} className="mdiag" />;
                    if (ci > ri) return <td key={col.id} className="mvoid" />;
                    const st = strengthOf(row.id, col.id);
                    return (
                      <td
                        key={col.id}
                        className={`mcell ${st || ''}`}
                        title={`${row.name} ↔ ${col.name}`}
                        onClick={() => onCycle(row.id, col.id)}
                      >
                        {glyph[st] || ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function NorthRose({ deg, onSet }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const [live, setLive] = useState(null);
  const shown = live ?? deg;
  function angleFrom(e) {
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const a = (Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180) / Math.PI;
    const norm = ((a % 360) + 360) % 360;
    setLive(norm);
    onSet(norm);
  }
  const rotate = (shown * 1).toFixed(2);
  return (
    <div
      ref={ref}
      className="north-rose"
      title={`Project north — drag to set (currently ${Math.round(shown)}°). Double-click to reset to up.`}
      onPointerDown={(e) => ((dragging.current = true), e.currentTarget.setPointerCapture?.(e.pointerId), angleFrom(e))}
      onPointerMove={(e) => dragging.current && angleFrom(e)}
      onPointerUp={() => ((dragging.current = false), setLive(null))}
      onDoubleClick={() => (setLive(0), onSet(0))}
    >
      <svg viewBox="-22 -22 44 44">
        <circle r="20" className="rose-bg" />
        <g transform={`rotate(${rotate})`}>
          <polygon points="0,-16 5,4 0,0 -5,4" className="rose-needle-n" />
          <polygon points="0,16 5,0 0,4 -5,0" className="rose-needle-s" />
          <text y="-11" className="rose-n">
            N
          </text>
        </g>
      </svg>
      <span className="rose-deg">{Math.round(shown)}°</span>
    </div>
  );
}
