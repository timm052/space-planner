import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtArea, areaToM2, distToMeters, distUnit, leafSpaces, rootContainer } from '../compute.js';
// pdfExport is lazy-loaded on demand — keeps jsPDF out of the initial bundle.
import { useHistory } from '../useHistory.js';
import { SCALE_PRESETS, ratioToScale, scaleToRatio, zoomAbout } from '../scale.js';
import { pinsOf, filterCss,
  parsePoly, normalizePolygon, polygonPath, regularPolygon,
  polygonArea, smoothPolygonPoints } from '../geometry.js';
import { edgeGap, adjacencyScore, closestInstancePair } from '../adjacency.js';
import { pinPatch } from '../pins.js';
import { orderedLevels, levelRankMap } from '../floors.js';
import { buildStackScene, build3DScene } from './diagram/scenes.js';
import * as selection from './diagram/selection.js';
import * as linking from './diagram/linking.js';
import * as layerTools from './diagram/layerTools.js';
import { useDiagramPrefs } from '../hooks/useDiagramPrefs.js';
import { useViewport, W, H } from '../hooks/useViewport.js';
import { useImageDims } from '../hooks/useImageDims.js';
import { useImageData, seedImageData } from '../hooks/useImageData.js';
import { useTickStore } from '../hooks/useTick.js';
import { useSimulation } from '../hooks/useSimulation.js';
import { bakeImage } from '../imageUtils.js';
import HelpPanel from './HelpPanel.jsx';
import NorthRose from './diagram/NorthRose.jsx';
import MatrixPanel from './diagram/MatrixPanel.jsx';
import DiagramRail from './diagram/DiagramRail.jsx';
import DiagramCanvas from './diagram/DiagramCanvas.jsx';
import SelectionHud from './diagram/SelectionHud.jsx';
import { StageTopbar, MorePopover, ToolDock } from './diagram/DiagramToolbar.jsx';
import { LayersPopover, SatellitePanel, ScalePanel } from './diagram/LayersPanel.jsx';
import StagePopover from './diagram/StagePopover.jsx';
import { Empty } from './ui.jsx';

const PALETTE = ['#e8b04b', '#5b9dd9', '#4cc38a', '#c678dd', '#e5707a', '#56b6c2', '#d19a66', '#98c379', '#7aa2f7', '#f7768e'];
const SAT_CANVAS = 768;

// BubbleTab unmounts when you leave the Diagram tab, which would otherwise lose
// every non-pinned bubble's position and let the sim re-scatter them on return.
// This module-level cache keeps the last layout per project for the session.
const layoutCache = new Map(); // projectId → Map(instanceKey → {x,y})

export default function BubbleTab({ project, spaces, adjacencies, images = [], onChanged, selectedSpaceId = null, onSelectSpace }) {
  // Selection + link-tool state lives in one pure state machine (see
  // diagram/selection.js and diagram/linking.js). Transitions are applied via
  // applySel() below; the destructure keeps every read site unchanged.
  const [sel, setSel] = useState(selection.initialSelection);
  const { tool, selected, selectedInst, multi, selLink, linkFrom, linkKind } = sel;
  // Image-layer tool modes (calibrate / move / rotate) — same pattern.
  const [lt, setLt] = useState(layerTools.initialLayerTools);
  const { calibrateLayer, moveLayer, rotateLayer, scalePoints, scaleDistance } = lt;
  // Animation ticks bypass React state: the sim/drags mutate nodesRef then
  // bump this store, re-rendering ONLY the <TickLayer> canvas below — not the
  // toolbar/rail/popover chrome. Same call signature as the old setTick.
  const tickStore = useTickStore();
  const setTick = tickStore.bump;
  const [, forceChrome] = useState(0); // re-render chrome for optimistic in-place edits (layer sliders)
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null); // 'layers' | 'sat' | null
  const [satQuery, setSatQuery] = useState('');
  const [satZoom, setSatZoom] = useState(18);
  const [satBusy, setSatBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [catDraft, setCatDraft] = useState(''); // batch category/department assignment input
  const [localColors, setLocalColors] = useState({}); // optimistic category colour overrides
  const [marquee, setMarquee] = useState(null); // { x0,y0,x1,y1 } in svg coords while selecting
  const [showMatrix, setShowMatrix] = useState(false);
  const [highlightGaps, setHighlightGaps] = useState(false); // flag unmet adjacencies on the diagram
  const [editShape, setEditShape] = useState(null); // space id whose polygon is being edited
  const [spaceHeld, setSpaceHeld] = useState(false); // transient pan while Space is held
  // View preferences (split rail, colour mode, hulls, floor view, cameras,
  // auto-layout forces, …) live in one hook; persisted keys round-trip
  // through prefs.js. The destructure keeps every read site unchanged.
  const { view: viewPrefs, setPref } = useDiagramPrefs();
  const { split, colorBy, hulls, hullPad, railW, areaMode, collapsed,
    floorView, floorGap, stackCam, stackImages, cam3d, nodeForce, buildingForce } = viewPrefs;

  // Apply a selection transition: set the next state and run its declared
  // effects. The refs let event handlers (some registered with narrow effect
  // deps) always read the LATEST state, and chained transitions within one
  // event see each other's result before React re-renders. fx runs outside
  // any setState updater so StrictMode's double-invoke can't repeat it.
  const selRef = useRef(sel);
  selRef.current = sel;
  function applySel(transition) {
    const { sel: next, fx } = transition(selRef.current);
    selRef.current = next;
    setSel(next);
    for (const f of fx) {
      if (f.type === 'notify') onSelectSpace?.(f.id);
      else if (f.type === 'maybeCreateLink' && !findPair(f.a, f.b)) createLink(f.a, f.b, f.kind);
    }
  }
  const ltRef = useRef(lt);
  ltRef.current = lt;
  function applyLt(transition) {
    const next = transition(ltRef.current);
    ltRef.current = next;
    setLt(next);
  }

  const draftTimers = useRef(new Map());
  const nodesRef = useRef(new Map());
  // Start idle if we have a cached layout to restore (avoids a re-scatter on
  // tab return); otherwise energise so the first layout settles.
  const alphaRef = useRef(layoutCache.has(project.id) ? 0 : 1);
  const dragRef = useRef(null);
  const polyDragRef = useRef(null); // { space, vi } while dragging a polygon vertex handle
  const panRef = useRef(null);
  const layerMoveRef = useRef(null);
  const rotateRef = useRef(null); // { id, startAngle, startRot } while rotating an image by mouse
  const pinOverride = useRef(new Map());
  const fileRef = useRef(null);
  const debouncers = useRef({});
  const hoverRef = useRef(null); // { space, idx } currently under the cursor
  const marqueeRef = useRef(null); // { sx, sy, additive } while drag-selecting
  const adjRef = useRef(adjacencies); // latest adjacencies, for history closures
  adjRef.current = adjacencies;

  // Refs needed by hooks must be declared before those hooks.
  const svgRef = useRef(null);
  const stageRef = useRef(null);

  // Viewport: vb tracks the SVG container size; view is the pan offset.
  const { vb, view, viewRef, setView } = useViewport(project, stageRef);

  // Image natural dimensions — measured lazily as images load.
  // ---------- image layers (multiple, ordered bottom→top) ----------
  // The `images` prop is metadata only; pixels resolve through the session
  // cache (fetched once per image). Copy so optimistic move/rotate/opacity
  // edits can mutate in place between refetches (the prop is stable until
  // onChanged re-fetches).
  const { data: imageData, version: imageDataVersion } = useImageData(images);
  const imgLayers = useMemo(
    () => (images || []).map((im) => ({ ...im, image: imageData.get(im.id) ?? null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images, imageDataVersion]
  );
  const imgById = useMemo(() => new Map(imgLayers.map((im) => [im.id, im])), [imgLayers]);

  const dims = useImageDims(imgLayers);

  const history = useHistory();
  // Reset history + optimistic colours when switching projects.
  useEffect(() => {
    history.clear();
    setLocalColors({});
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = project.units;

  // Auto-layout is a MOMENTARY action, not a persistent toggle. Pressing it
  // re-energises the force sim for a single settling pass that cools to a stop
  // (the hook clears `autoRunRef` once it settles). Leaving the sim permanently
  // on made rooms keep drifting after every edit. Genuinely new rooms still
  // auto-settle on spawn (see the [spaces] effect below).
  const autoRunRef = useRef(false);
  const [autoRunning, setAutoRunning] = useState(false);
  function runAutoLayout() {
    autoRunRef.current = true;
    setAutoRunning(true);
    alphaRef.current = 1;
  }


  // Scale auto-fit uses the first visible, calibrated image.
  const primaryImg = imgLayers.find((im) => im.visible && im.mpp > 0 && dims[im.id]);
  const fitScale = primaryImg ? (dims[primaryImg.id].w * primaryImg.mpp) / W : null;
  const displayScale = project.display_scale > 0 ? project.display_scale : null;
  const effScale = displayScale ?? fitScale;



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
  // Spatial clustering for the force layout — always by building (so the two
  // buildings settle into clearly separated clusters that match their hulls),
  // independent of how bubbles are coloured. Falls back to category when a
  // project has no buildings.
  const clusterKey = (s) => {
    if (!hasBuildings) return s.department || 'General';
    const root = rootContainer(s, byId);
    return root ? root.name : 'Unassigned';
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

  // Storey labels present in the program, ground → up. Drives the floor switcher.
  const levels = useMemo(() => orderedLevels(leaves), [leaves]);
  const levelRank = useMemo(() => levelRankMap(levels), [levels]);
  const hasLevels = levels.length >= 2;
  // A previously-selected level may vanish (e.g. project change); fall back to all.
  const floorMode =
    floorView === 'offset' || floorView === 'overlaid' || floorView === '3d' || floorView === 'all' || levels.includes(floorView)
      ? floorView
      : 'all';
  useEffect(() => setPref('floorView', 'all'), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leave shape-edit mode when the selection moves to another space.
  useEffect(() => {
    if (editShape != null && editShape !== selected) setEditShape(null);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const ea = (s) => {
    const draft = drafts[s.id];
    return draft !== undefined && draft !== '' ? Number(draft) || 0 : s.target_area;
  };
  const maxEach = Math.max(...leaves.map(ea), 1);
  const radiusOf = (s) => {
    if (effScale) return Math.max(7, Math.sqrt(areaToM2(ea(s), units) / Math.PI) / effScale);
    return 16 + 50 * Math.sqrt(ea(s) / maxEach);
  };

  // A room's SAVED position (persists to pin_json, seeds the sim node). Set by
  // dragging; it does NOT lock the room. pinOverride holds the optimistic value
  // before a refetch. An entry may carry `locked: true`.
  const savedOf = (s, i) => {
    const key = `${s.id}:${i}`;
    if (pinOverride.current.has(key)) return pinOverride.current.get(key);
    return pinsOf(s)[i] ?? null;
  };
  // LOCKED = protected from auto-layout + shows the pin marker. Toggled only by
  // the Pin button / P. A saved-but-unlocked room stays where it was dropped but
  // is free to be rearranged by an auto-layout pass.
  const instLocked = (s, i) => !!savedOf(s, i)?.locked;
  // The simulation's fixed point exists only while a room is locked.
  const instPin = (s, i) => (instLocked(s, i) ? savedOf(s, i) : null);
  const anyPinned = (s) =>
    Array.from({ length: Math.max(1, s.count || 1) }, (_, i) => i).some((i) => instLocked(s, i));

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

  // Global shortcuts: tools (V/L/A), undo/redo, clear selection, delete, Space-pan.
  useEffect(() => {
    function onKey(e) {
      if (e.target.matches?.('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      // Hold Space → transient pan gesture (so empty-canvas drag stays marquee).
      if (e.code === 'Space' && !mod) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? history.redo() : history.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
      } else if (e.key.toLowerCase() === 'v' && !mod) {
        applySel((s) => linking.setTool(s, 'select'));
      } else if (e.key.toLowerCase() === 'l' && !mod) {
        applySel((s) => linking.setTool(s, 'link'));
      } else if (e.key.toLowerCase() === 'a' && !mod) {
        runAutoLayout();
      } else if (e.key === 'Escape') {
        applySel(selection.escape);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && multi.size) {
        e.preventDefault();
        multiDelete();
      }
    }
    function onKeyUp(e) {
      if (e.code === 'Space') setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi]);

  // Effective pan state: panning while the Space key is held.
  const panActive = spaceHeld;

  // Shared selection sync (Diagram ↔ Brief). Inbound only: an external
  // selection (e.g. a Brief tile) drives the canvas selection. This effect
  // can't loop — setSelected doesn't change selectedSpaceId. Outbound
  // propagation is event-driven via pickSpace()/clearPick() at the actual
  // selection points, which avoids an effect feedback cycle.
  useEffect(() => {
    applySel((s) => selection.applyExternal(s, selectedSpaceId));

  }, [selectedSpaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Select a space and notify the shared state (no-ops to onSelectSpace are cheap).
  const pickSpace = (id, inst = 0) => applySel((s) => selection.pick(s, id, inst));
  const clearPick = () => applySel(selection.clearPick);

  const shapeOf = (s) => {
    if (s.shape === 'poly' && parsePoly(s)) return 'poly';
    return s.shape === 'box' ? 'box' : 'bubble';
  };

  // On-screen area of any shape, in diagram-units². All shapes share this so a
  // bubble, box and polygon for the same space cover the same footprint area.
  const areaUnits = (s) => Math.PI * radiusOf(s) ** 2;
  // Normalized verts for a space, preferring the live drag override (so a vertex
  // being dragged updates the outline before it's committed).
  const liveNormOf = (s) => {
    const d = polyDragRef.current;
    if (d && d.space.id === s.id) return d.verts;
    return parsePoly(s);
  };
  // Polygons render as smooth, bubble-like blobs (a dense sampled curve through
  // the corners) — straight edges are reserved for box mode.
  const SMOOTH_SEG = 14;
  // Scale factor that makes the *rendered* (curved) outline's area exactly equal
  // areaUnits(s) — the area lock. We divide by the normalized curve's area k so a
  // bulgy curve still encloses the correct footprint regardless of the outline.
  const polyScaleOf = (s) => {
    const np = liveNormOf(s);
    if (!np) return null;
    const k = polygonArea(smoothPolygonPoints(np, SMOOTH_SEG)) || polygonArea(np) || 1;
    return Math.sqrt(areaUnits(s) / k);
  };
  // Dense, area-locked curve points for rendering/extrusion/PDF, centred at origin.
  const polyVertsOf = (s) => {
    const np = liveNormOf(s);
    if (!np) return null;
    const f = polyScaleOf(s);
    return smoothPolygonPoints(np, SMOOTH_SEG).map((p) => ({ x: p.x * f, y: p.y * f }));
  };
  // The corner vertices (for edit handles), scaled by the same factor so they sit
  // on the rendered curve's control points.
  const polyHandlesOf = (s) => {
    const np = liveNormOf(s);
    if (!np) return null;
    const f = polyScaleOf(s);
    return np.map((p) => ({ x: p.x * f, y: p.y * f }));
  };
  // A selection/pin/multi outline that HUGS a custom (poly) room instead of a
  // bounding box: the room's own curve scaled outward by ~pad px about its
  // centroid (≈ origin, since poly verts are centred on the node).
  const polyRingPath = (verts, pad) => {
    let cx = 0, cy = 0;
    for (const p of verts) ((cx += p.x), (cy += p.y));
    cx /= verts.length; cy /= verts.length;
    let avgR = 0;
    for (const p of verts) avgR += Math.hypot(p.x - cx, p.y - cy);
    avgR = avgR / verts.length || 1;
    const f = (avgR + pad) / avgR;
    return polygonPath(verts.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f })));
  };

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

  // ---------- freeform (custom) polygon shapes ----------
  // Convert a space to a polygon (seeding a default outline if it has none) and
  // open vertex-edit mode. Toggling off when it's already the edit target.
  function editCustomShape(space) {
    if (editShape === space.id) return setEditShape(null);
    if (shapeOf(space) === 'poly') return setEditShape(space.id);
    commitSpace(
      space,
      { shape: 'poly', shape_json: JSON.stringify(parsePoly(space) || regularPolygon(6)) },
      'custom shape'
    );
    setEditShape(space.id);
  }
  // Persist a new normalized outline for a space (undoable).
  function savePoly(space, normVerts, label = 'shape') {
    const before = { shape: space.shape, shape_json: space.shape_json ?? null };
    const after = { shape: 'poly', shape_json: JSON.stringify(normalizePolygon(normVerts)) };
    history.record({ label, undo: () => applySpace(space.id, before), redo: () => applySpace(space.id, after) });
    setError(null);
    applySpace(space.id, after).catch((e) => setError(e.message));
  }
  // Insert a vertex at the midpoint of edge i→i+1 (in normalized space).
  function addPolyVertex(space, edgeIndex) {
    const np = parsePoly(space);
    if (!np) return;
    const a = np[edgeIndex], b = np[(edgeIndex + 1) % np.length];
    const next = [...np];
    next.splice(edgeIndex + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    savePoly(space, next, 'add vertex');
  }
  // Remove a vertex (keeps at least a triangle).
  function removePolyVertex(space, vi) {
    const np = parsePoly(space);
    if (!np || np.length <= 3) return;
    savePoly(space, np.filter((_, i) => i !== vi), 'remove vertex');
  }
  // The instance node a polygon's edit handles are anchored to.
  const editAnchorInst = (space) => (selected === space.id ? selectedInst : 0);
  function onPolyVertexDown(e, space, vi) {
    e.stopPropagation();
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    const np = parsePoly(space);
    if (!np) return;
    polyDragRef.current = { space, vi, verts: np.map((p) => ({ ...p })), moved: 0 };
  }

  // Keep simulation nodes in sync with the leaves (per instance). Existing nodes
  // seed from a pin, then the saved layout cache. A genuinely-new room is dropped
  // into free space NEAR its building's existing rooms (inside the cluster if
  // there's room, otherwise just outside its edge); a room belonging to a
  // brand-new building lands near the existing buildings. Auto-layout is NEVER
  // started here — it only runs when the user triggers it (A / the Auto-layout
  // button), so opening the tab never rearranges the diagram.
  useEffect(() => {
    const nodes = nodesRef.current;
    const cache = layoutCache.get(project.id);
    const keys = new Set(instances.map((o) => o.key));
    for (const key of [...nodes.keys()]) if (!keys.has(key)) nodes.delete(key);

    // 1. Seed pinned + cached nodes first so new rooms can be placed relative to
    //    the rooms that already have a home.
    const pending = [];
    const pendingKeys = new Set();
    instances.forEach((o) => {
      if (nodes.has(o.key)) return;
      const pin = pinsOf(o.s)[o.i] ?? null;
      const cached = cache?.get(o.key);
      if (pin) nodes.set(o.key, { x: pin.x, y: pin.y, vx: 0, vy: 0 });
      else if (cached) nodes.set(o.key, { x: cached.x, y: cached.y, vx: 0, vy: 0 });
      else ((pending.push(o), pendingKeys.add(o.key)));
    });

    // 2. Place genuinely-new rooms in free space near their building.
    if (pending.length) {
      const gap = effScale ? 14 : 20;
      const occupied = []; // discs already placed: {x, y, r}
      const members = new Map(); // building key → placed positions in that building
      for (const o of instances) {
        if (pendingKeys.has(o.key)) continue;
        const n = nodes.get(o.key);
        if (!n) continue;
        occupied.push({ x: n.x, y: n.y, r: radiusOf(o.s) });
        const ck = clusterKey(o.s);
        if (!members.has(ck)) members.set(ck, []);
        members.get(ck).push(n);
      }
      const centroid = (arr) => ({
        x: arr.reduce((t, p) => t + p.x, 0) / arr.length,
        y: arr.reduce((t, p) => t + p.y, 0) / arr.length,
      });
      const overall = occupied.length ? centroid(occupied) : { x: W / 2, y: H / 2 };
      const fits = (x, y, r) => occupied.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + gap);
      // Spiral outward from a centre until an unoccupied spot is found.
      const freeSpot = (c, r) => {
        if (fits(c.x, c.y, r)) return { x: c.x, y: c.y };
        for (let ring = 1; ring < 80; ring++) {
          const rad = ring * (r + gap);
          const steps = Math.max(8, Math.round((2 * Math.PI * rad) / (r * 1.4 + gap)));
          for (let s = 0; s < steps; s++) {
            const a = (s / steps) * 2 * Math.PI + ring * 0.6;
            const x = c.x + Math.cos(a) * rad;
            const y = c.y + Math.sin(a) * rad;
            if (fits(x, y, r)) return { x, y };
          }
        }
        return { x: c.x, y: c.y };
      };
      for (const o of pending) {
        const r = radiusOf(o.s);
        const ck = clusterKey(o.s);
        const mem = members.get(ck);
        // Existing building → aim at its centroid; new building → near the rest.
        const center = mem && mem.length ? centroid(mem) : overall;
        const pos = freeSpot(center, r);
        nodes.set(o.key, { x: pos.x, y: pos.y, vx: 0, vy: 0 });
        occupied.push({ x: pos.x, y: pos.y, r });
        if (!members.has(ck)) members.set(ck, []);
        members.get(ck).push(pos);
      }
    }
    pinOverride.current.clear();
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
  // Force strengths persist via setPref. NOTE: persisting must never start an
  // auto pass — the live pass is triggered from the slider onChange (a real
  // user action) via nudgeLayout() instead.
  // Re-energise the sim for a brief settling pass (used when a force slider moves).
  const nudgeLayout = () => {
    alphaRef.current = Math.max(alphaRef.current, 0.5);
    autoRunRef.current = true;
    setAutoRunning(true);
  };

  // Force simulation — delegated to the hook. radiusOf/groupKey/instPin are
  // ref-wrapped inside useSimulation so they are always fresh without needing
  // to be listed in the effect deps.
  useSimulation({ instances, leaves, adjacencies, byId, autoRunRef, setAutoRunning, effScale, nodesRef, alphaRef, dragRef, radiusOf, instPin, groupKey, clusterKey, nodeForce, buildingForce, setTick });

  // Closest instance pair between two spaces — used by PDF export, adjacency
  // rendering, and the scale bar. Reads nodesRef so it is always current.
  const closestPair = (sa, sb) => closestInstancePair(nodesRef.current, sa, sb);

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
    if (panActive) {
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
    if (polyDragRef.current) {
      const d = polyDragRef.current;
      const node = nodesRef.current.get(`${d.space.id}:${editAnchorInst(d.space)}`);
      if (node) {
        const { x, y } = toSvgCoords(e);
        const f = polyScaleOf(d.space) || 1;
        d.verts[d.vi] = { x: (x - node.x) / f, y: (y - node.y) / f };
        d.moved += 1;
        setTick((t) => t + 1);
      }
      return;
    }
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
    if (polyDragRef.current) {
      const d = polyDragRef.current;
      polyDragRef.current = null;
      if (d.moved > 0) savePoly(d.space, d.verts, 'reshape');
      else setTick((t) => t + 1);
      return;
    }
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
      // Dragging SAVES the room's position (so it stays where you drop it and
      // reloads there) but does NOT lock it — locking is deliberate (Pin / P).
      await saveDragPos(space, drag.idx);
      return;
    }
    await handleBubbleClick(drag.spaceId, drag.idx);
  }

  function onBubbleDown(e, o) {
    if (scalePoints || panActive || moveLayer || rotateLayer) return;
    if (e.shiftKey) {
      // Shift-click toggles a bubble in the multi-selection (no drag, no marquee).
      e.stopPropagation();
      applySel((s) => selection.shiftToggle(s, o.key));
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

  // Fresh position from the sim node, falling back to the previous pin.
  const nodePos = (space, i, prev) => {
    const n = nodesRef.current.get(`${space.id}:${i}`);
    return n ? { x: n.x, y: n.y } : prev ? { x: prev.x, y: prev.y } : null;
  };
  // Apply a pinPatch: optimistic overrides + undoable persist.
  async function commitPinPatch(space, patch, label) {
    for (const [i, p] of Object.entries(patch.touched)) pinOverride.current.set(`${space.id}:${i}`, p);
    history.record({ label, undo: () => applySpace(space.id, patch.before), redo: () => applySpace(space.id, patch.after) });
    setError(null);
    try {
      await applySpace(space.id, patch.after);
    } catch (err) {
      setError(err.message);
    }
  }

  // Persist a room's position after a drag WITHOUT changing its locked state
  // (a locked room dragged stays locked at its new spot; an unlocked one stays
  // unlocked). This is what makes drags survive a reload without pinning.
  async function saveDragPos(space, idx) {
    if (!nodesRef.current.get(`${space.id}:${idx}`)) return;
    const patch = pinPatch(space, [idx], (i, prev) => {
      const pos = nodePos(space, i, prev);
      return instLocked(space, i) ? { ...pos, locked: true } : pos;
    });
    await commitPinPatch(space, patch, 'move');
  }

  // Lock/unlock a single instance (Pin button / P). Locking captures the current
  // position; unlocking keeps the position but frees it for auto-layout.
  async function savePin(space, idx, locked) {
    const patch = pinPatch(space, [idx], (i, prev) => {
      const pos = nodePos(space, i, prev);
      return pos ? (locked ? { ...pos, locked: true } : pos) : null;
    });
    await commitPinPatch(space, patch, locked ? 'pin' : 'unpin');
  }

  // Pin/unpin every instance of a space at once (so a multiplied space stays put).
  async function savePinAll(space, locked) {
    const idxs = Array.from({ length: Math.max(1, space.count || 1) }, (_, i) => i);
    const patch = pinPatch(space, idxs, (i, prev) => {
      const pos = nodePos(space, i, prev);
      return pos ? (locked ? { ...pos, locked: true } : pos) : null;
    });
    await commitPinPatch(space, patch, locked ? 'pin all' : 'unpin all');
  }

  // ---------- multi-select (marquee + shift-click) ----------
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
    // A near-zero drag is a click on empty canvas → clear selection.
    if (selection.isClickBox(box)) {
      applySel((s) => selection.emptyCanvasClick(s, m.additive));
      return;
    }
    const hits = selection.hitsInBox(instances, (k) => nodesRef.current.get(k), box);
    applySel((s) => selection.marqueeEnd(s, hits, m.additive));
  }

  // Group instance keys by space → { space, idxs } (for batch pin edits).
  function groupKeysBySpace(keys) {
    const bySpace = new Map();
    for (const k of keys) {
      const [id, i] = String(k).split(':');
      const space = byId.get(Number(id));
      if (!space) continue;
      if (!bySpace.has(space.id)) bySpace.set(space.id, { space, idxs: [] });
      bySpace.get(space.id).idxs.push(Number(i));
    }
    return [...bySpace.values()];
  }

  async function multiPin(locked) {
    const changes = groupKeysBySpace([...multi]).map(({ space, idxs }) => {
      const patch = pinPatch(space, idxs, (i, prev) => {
        const pos = nodePos(space, i, prev);
        return pos ? (locked ? { ...pos, locked: true } : pos) : null;
      });
      return { id: space.id, before: patch.before, after: patch.after };
    });
    await commitMany(changes, locked ? 'pin selection' : 'unpin selection');
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
  // Save a set of instance keys at their current positions (group drag),
  // preserving each pin's locked flag, in one undo step.
  async function pinKeys(keys) {
    const changes = groupKeysBySpace(keys).map(({ space, idxs }) => {
      const patch = pinPatch(space, idxs, (i, prev) => {
        const n = nodesRef.current.get(`${space.id}:${i}`);
        if (!n) return prev; // no node → keep the pin as it was
        return prev?.locked ? { x: n.x, y: n.y, locked: true } : { x: n.x, y: n.y };
      });
      return { id: space.id, before: patch.before, after: patch.after };
    });
    await commitMany(changes, 'move group');
  }

  async function multiShape(shape) {
    const ids = [...new Set(multiList().map((o) => o.id))];
    const changes = ids.map((id) => ({ id, before: { shape: shapeOf(byId.get(id)) }, after: { shape } }));
    await commitMany(changes, 'shape selection');
  }
  // Give every selected space a custom polygon (seeding a default outline where
  // one isn't already present) in a single undo step.
  async function multiCustomShape() {
    const ids = [...new Set(multiList().map((o) => o.id))];
    const changes = ids.map((id) => {
      const s = byId.get(id);
      return {
        id,
        before: { shape: s.shape, shape_json: s.shape_json ?? null },
        after: { shape: 'poly', shape_json: JSON.stringify(parsePoly(s) || regularPolygon(6)) },
      };
    });
    await commitMany(changes, 'custom shape selection');
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
      applySel(selection.afterMultiDelete);
      history.clear(); // deletions invalidate recorded closures referencing these spaces
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  // Delete a single space from the brief (action-bar ⌫).
  async function removeSpace(space) {
    if (!space) return;
    if (!window.confirm(`Delete "${space.name}" from the brief? Its recorded areas and links are removed too.`)) return;
    setError(null);
    try {
      await api.deleteSpace(space.id);
      applySel(selection.afterRemoveSelected);
      history.clear();
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  const toggleHulls = () => setPref('hulls', !hulls);
  const setHullSize = (v) => setPref('hullPad', v);
  function toggleCollapse(key) {
    const next = new Set(collapsed);
    next.has(key) ? next.delete(key) : next.add(key);
    setPref('collapsed', next);
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
    const onMove = (ev) => setPref('railW', clamp(startW + (startX - ev.clientX)), { persist: false });
    const onUp = (ev) => {
      setPref('railW', clamp(startW + (startX - ev.clientX)));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function handleBubbleClick(spaceId, idx = 0) {
    setError(null);
    // Link mode: pick a first room, then a second to connect them (the
    // maybeCreateLink fx creates the adjacency unless the pair exists).
    // Select mode: select / retarget instance / deselect.
    if (selRef.current.tool === 'link') applySel((s) => linking.linkClick(s, spaceId));
    else applySel((s) => selection.selectClick(s, spaceId, idx));
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

  // Create or set a pair to a strength (undoable). Used by Link mode + action bar.
  async function setLinkStrength(a, b, strength) {
    const cur = findPair(a, b)?.strength ?? null;
    if (cur === strength) return;
    history.record({ label: strength ? 'link' : 'remove link', undo: () => setPair(a, b, cur), redo: () => setPair(a, b, strength) });
    setError(null);
    try {
      await setPair(a, b, strength);
    } catch (err) {
      setError(err.message);
    }
  }
  const createLink = (a, b, strength = 'desired') => setLinkStrength(a, b, strength);
  async function removeSelLink() {
    if (!selLink) return;
    await setLinkStrength(selLink.space_a, selLink.space_b, null);
    applySel(linking.clearSelLink);
  }

  // Clicking a link selects it (Select mode) → shows the link action bar.
  const onLinkClick = (l) => applySel((s) => linking.selectLink(s, l));

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

  function onSvgScaleClick(e) {
    applyLt((l) => layerTools.addScalePoint(l, toSvgCoords(e)));
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
          np[i] = p.locked ? { ...tx(p), locked: true } : tx(p);
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
  const toggleSplit = () => setPref('split', !split);
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

  // ---------- PNG ----------
  // WYSIWYG capture of the current view at 2×. In the 3-D floor mode the
  // WebGL canvas is grabbed directly; otherwise the SVG is rasterized.
  async function exportPng() {
    setError(null);
    try {
      // Dynamic import keeps the rasterizer out of the initial bundle.
      const { exportDiagramPng } = await import('../pngExport.js');
      const glCanvas =
        hasLevels && floorMode === '3d' ? stageRef.current?.querySelector('.stage-3d canvas') : null;
      const background =
        getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#11151c';
      await exportDiagramPng({
        svgEl: svgRef.current,
        glCanvas,
        background,
        scale: 2,
        fileName: `${project.name.replace(/[^\w-]+/g, '_')}_diagram.png`,
      });
    } catch (err) {
      setError(`PNG export failed: ${err.message}`);
    }
  }

  // ---------- PDF ----------
  async function exportPdf() {
    const nodes = nodesRef.current;
    const bubbles = instances
      .map((o) => {
        const n = nodes.get(o.key);
        if (!n) return null;
        const count = Math.max(1, o.s.count || 1);
        const kind = shapeOf(o.s);
        return {
          x: n.x,
          y: n.y,
          r: radiusOf(o.s),
          box: kind === 'box',
          // Poly verts in absolute diagram units (already centred at origin).
          poly: kind === 'poly' ? polyVertsOf(o.s).map((p) => ({ x: n.x + p.x, y: n.y + p.y })) : null,
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
      if (b.poly) {
        for (const p of b.poly) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
      } else {
        minX = Math.min(minX, b.x - b.r);
        minY = Math.min(minY, b.y - b.r);
        maxX = Math.max(maxX, b.x + b.r);
        maxY = Math.max(maxY, b.y + b.r);
      }
    }
    const pad = 40;
    const bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };

    const sceneLayers = [];
    for (const im of imgLayers) {
      if (!im.visible || !im.image) continue; // pixels may still be loading
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
      // Dynamic import keeps jsPDF out of the initial bundle.
      const { exportDiagramPdf } = await import('../pdfExport.js');
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
    return <div className="stage-empty"><Empty>Define the brief first — the bubble diagram is drawn from its spaces.</Empty></div>;
  if (leaves.length === 0)
    return <div className="stage-empty"><Empty>This program only has containers. Add spaces inside them in the Brief tab.</Empty></div>;

  const nodes = nodesRef.current;
  const presets = SCALE_PRESETS[units === 'ft2' ? 'ft2' : 'm2'];

  // Adjacency compliance — how well the current layout honours the declared
  // relationships. Needs a real scale (gaps are judged in metres). Positional,
  // so it is NOT computed on the chrome render path: the toolbar badge
  // recomputes it on throttled sim ticks (AdjacencyBadge) and the SVG derives
  // unmet links per tick inside the TickLayer, only while highlighting.
  const computeAdjacency = () =>
    adjacencyScore(
      effScale
        ? adjacencies
            .map((l) => {
              const sa = byId.get(l.space_a);
              const sb = byId.get(l.space_b);
              if (!sa || !sb) return null;
              const pair = closestPair(sa, sb);
              if (!pair) return null;
              return { id: l.id, strength: l.strength, gap: edgeGap(pair.d, radiusOf(sa), radiusOf(sb)) * effScale };
            })
            .filter(Boolean)
        : []
    );
  const showScore = effScale && adjacencies.length > 0;

  // ---- Floor view: all together / one level / stacked isometric planes ----
  // Each floor is a flat plane shown isometrically. 'offset' raises each storey
  // onto its own plane (a stacked 3D look); 'overlaid' puts them all on the same
  // plane (superimposed) to compare footprints.
  const levelOf = (s) => (s.level || '').trim();
  const stackMode = hasLevels && (floorMode === 'offset' || floorMode === 'overlaid');
  // In non-stack modes, levelVisible filters which storey is shown. The stacked
  // view renders its own isometric scene below (stackScene), so the normal
  // hull/link/bubble passes are skipped while it's active.
  const levelVisible = (s) => !hasLevels || floorMode === 'all' || levelOf(s) === floorMode;
  const rankOf = (s) => levelRank.get(levelOf(s)) ?? 0;

  // Scene builders live in diagram/scenes.js (pure, unit-testable). These
  // thin wrappers feed them the component's live helpers; they are called
  // inside the canvas TickLayer so they read fresh node positions each frame.
  const makeStackScene = () =>
    buildStackScene({ nodes, instances, levels, levelRank, radiusOf, levelOf, floorMode, floorGap, stackCam, palette: PALETTE });

  const is3D = hasLevels && floorMode === '3d';

  const make3DScene = () => {
    let groundImage = null;
    if (stackImages) {
      const im = imgLayers.find((x) => x.visible && x.image);
      const r = im ? layerRect(im) : null;
      if (im && r) groundImage = { href: im.image, x: r.x, y: r.y, w: r.w, h: r.h };
    }
    return build3DScene({
      nodes, instances, levels, levelRank, radiusOf, levelOf, palette: PALETTE,
      adjacencies, byId, rankOf, shapeOf, polyVertsOf, colorOf, groundImage,
    });
  };

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
  // Adjacency strength tallies for the rail header (e.g. "6 req · 10 des").
  const reqCount = adjacencies.filter((l) => l.strength === 'required').length;
  const desCount = adjacencies.length - reqCount;

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
        <div className="bubble-stage" ref={stageRef}>
          <StageTopbar
            hasBuildings={hasBuildings}
            colorBy={colorBy}
            setPref={setPref}
            hasLevels={hasLevels}
            floorMode={floorMode}
            levels={levels}
            scaleValue={scaleValue}
            presets={presets}
            fitScale={fitScale}
            onScaleSelect={onScaleSelect}
            panel={panel}
            setPanel={setPanel}
            history={history}
            showScore={showScore}
            tickStore={tickStore}
            computeAdjacency={computeAdjacency}
            adjDataKey={`${adjacencies.length}:${spaces.length}:${effScale ?? 0}`}
            highlightGaps={highlightGaps}
            onToggleGaps={() => setHighlightGaps((v) => !v)}
            onExportPng={exportPng}
            onExportPdf={exportPdf}
            onHelp={() => setShowHelp(true)}
          />

          {panel === 'more' && (
            <MorePopover
              nodeForce={nodeForce}
              buildingForce={buildingForce}
              setPref={setPref}
              nudgeLayout={nudgeLayout}
              bubbleStyle={bubbleStyle}
              setBubbleStyle={setBubbleStyle}
              allBoxes={leaves.every((s) => shapeOf(s) === 'box')}
              convertAll={convertAll}
              hulls={hulls}
              toggleHulls={toggleHulls}
              hasBuildings={hasBuildings}
              hullPad={hullPad}
              setHullSize={setHullSize}
              showMatrix={showMatrix}
              onShowMatrix={() => setShowMatrix(true)}
              split={split}
              toggleSplit={toggleSplit}
              hasLevels={hasLevels}
              floorMode={floorMode}
              floorGap={floorGap}
              is3D={is3D}
              cam3d={cam3d}
              stackMode={stackMode}
              stackCam={stackCam}
              stackImages={stackImages}
              hasImages={imgLayers.length > 0}
            />
          )}
          <ToolDock
            tool={tool}
            onTool={(t) => applySel((s) => linking.setTool(s, t))}
            autoRunning={autoRunning}
            onAutoLayout={runAutoLayout}
            onRecentre={() => { setView({ x: 0, y: 0 }); commitView({ x: 0, y: 0 }); }}
          />
          {error && (
            <StagePopover className="error" onClose={() => setError(null)}>
              {error}
            </StagePopover>
          )}

          {panel === 'layers' && (
            <LayersPopover
              imgLayers={imgLayers}
              dims={dims}
              units={units}
              moveLayer={moveLayer}
              rotateLayer={rotateLayer}
              onToggleVisible={toggleLayerVisible}
              onOpacity={(im, v) => layerSlider(im, 'opacity', v)}
              onRotate={(im, v) => layerSlider(im, 'rot', v)}
              onFilter={(im, v) => layerSlider(im, 'filter', v)}
              onCalibrate={startCalibrate}
              onToggleMove={(id) => applyLt((l) => layerTools.toggleMove(l, id))}
              onToggleRotate={(id) => applyLt((l) => layerTools.toggleRotate(l, id))}
              onDelete={deleteImageLayer}
              fileRef={fileRef}
              onUpload={onUpload}
              onAddSatellite={() => setPanel('sat')}
              onClose={() => setPanel(null)}
            />
          )}

          {panel === 'sat' && (
            <SatellitePanel
              satQuery={satQuery}
              setSatQuery={setSatQuery}
              satZoom={satZoom}
              setSatZoom={setSatZoom}
              satBusy={satBusy}
              onFetch={fetchSatellite}
              onCancel={() => setPanel('layers')}
            />
          )}

          {scalePoints && (
            <ScalePanel
              scalePoints={scalePoints}
              layerName={imgById.get(calibrateLayer)?.name}
              scaleDistance={scaleDistance}
              units={units}
              onDistance={(v) => applyLt((l) => layerTools.setScaleDistance(l, v))}
              onApply={applyScale}
              onCancel={() => applyLt(layerTools.endCalibrate)}
            />
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

          {/* Everything inside DiagramCanvas re-renders on animation ticks (sim
              frames, drags) without touching the chrome above — see useTick.js. */}
          <DiagramCanvas
            tickStore={tickStore}
            stackMode={stackMode}
            is3D={is3D}
            floorMode={floorMode}
            hulls={hulls}
            hullPad={hullPad}
            hasBuildings={hasBuildings}
            highlightGaps={highlightGaps}
            effScale={effScale}
            floorGap={floorGap}
            stackImages={stackImages}
            cam3d={cam3d}
            bubbleStyle={bubbleStyle}
            bubbleOpacity={project.bubble_opacity}
            panActive={panActive}
            tool={tool}
            svgRef={svgRef}
            originX={originX}
            originY={originY}
            vb={vb}
            units={units}
            nodes={nodes}
            instances={instances}
            adjacencies={adjacencies}
            byId={byId}
            imgLayers={imgLayers}
            selected={selected}
            selectedInst={selectedInst}
            multi={multi}
            selLink={selLink}
            editShape={editShape}
            marquee={marquee}
            scalePoints={scalePoints}
            moveLayer={moveLayer}
            rotateLayer={rotateLayer}
            scaleBar={scaleBar}
            attributionLayer={attributionLayer}
            makeStackScene={makeStackScene}
            make3DScene={make3DScene}
            computeAdjacency={computeAdjacency}
            layerRect={layerRect}
            imgTransform={imgTransform}
            levelVisible={levelVisible}
            clusterKey={clusterKey}
            radiusOf={radiusOf}
            colorForLabel={colorForLabel}
            colorOf={colorOf}
            rankOf={rankOf}
            closestPair={closestPair}
            shapeOf={shapeOf}
            polyVertsOf={polyVertsOf}
            polyHandlesOf={polyHandlesOf}
            polyRingPath={polyRingPath}
            areaUnits={areaUnits}
            editAnchorInst={editAnchorInst}
            instPin={instPin}
            ea={ea}
            scaleLabelFor={scaleLabelFor}
            onSvgPointerDown={onSvgPointerDown}
            onMove={onMove}
            onUp={onUp}
            onBubbleDown={onBubbleDown}
            onLinkClick={onLinkClick}
            onPolyVertexDown={onPolyVertexDown}
            addPolyVertex={addPolyVertex}
            removePolyVertex={removePolyVertex}
            hoverRef={hoverRef}
          />

          {hasLevels && floorMode !== 'all' && (
            <div className="floor-caption">
              {stackMode ? (floorMode === 'offset' ? '▤ Floors — offset' : '▤ Floors — overlaid') : `▤ ${floorMode}`}
              {stackMode && <span className="floor-caption-sub">view only — switch to a single floor to edit</span>}
            </div>
          )}

          <NorthRose deg={project.north_deg || 0} onSet={setNorth} />

          {/* One contextual action bar (bottom-centre) — or the hint when
              nothing is selected. */}
          <SelectionHud
            selLink={selLink}
            byId={byId}
            findPair={findPair}
            onSetLinkStrength={setLinkStrength}
            onRemoveLink={removeSelLink}
            tool={tool}
            linkFrom={linkFrom}
            linkKind={linkKind}
            onLinkKind={(k) => applySel((s) => linking.setLinkKind(s, k))}
            multi={multi}
            onMultiPin={multiPin}
            onMultiShape={multiShape}
            onMultiCustomShape={multiCustomShape}
            catDraft={catDraft}
            setCatDraft={setCatDraft}
            onMultiSetCategory={multiSetCategory}
            onMultiDelete={multiDelete}
            departments={departments}
            selectedSpace={selectedSpace}
            selectedInst={selectedInst}
            instPin={instPin}
            shapeOf={shapeOf}
            editShape={editShape}
            colorOf={colorOf}
            ea={ea}
            units={units}
            onPin={savePin}
            onToggleShape={toggleShape}
            onEditShape={editCustomShape}
            onSetCategory={(space, v) => commitSpace(space, { department: v }, 'set category')}
            onRemoveSpace={removeSpace}
            rotateLayer={rotateLayer}
            moveLayer={moveLayer}
            panActive={panActive}
            effScale={effScale}
            scaleLabelFor={scaleLabelFor}
          />
        </div>
      </div>

      {split && (
        <DiagramRail
          units={units}
          leaves={leaves}
          byId={byId}
          hasBuildings={hasBuildings}
          groups={groups}
          groupKey={groupKey}
          areaTree={areaTree}
          areaMode={areaMode}
          setAreaMode={(m) => setPref('areaMode', m)}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
          colorForLabel={colorForLabel}
          colorOf={colorOf}
          ea={ea}
          drafts={drafts}
          onAreaDraft={onAreaDraft}
          anyPinned={anyPinned}
          selected={selected}
          selectedSpace={selectedSpace}
          pickSpace={pickSpace}
          clearPick={clearPick}
          relList={relList}
          reqCount={reqCount}
          desCount={desCount}
          onChanged={onChanged}
          toggleSplit={toggleSplit}
          startRailResize={startRailResize}
        />
      )}
    </div>
  );
}
