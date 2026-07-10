import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtArea, areaToM2, distToMeters, distUnit, leafSpaces, rootContainer, isContainerKind } from '../compute.js';
// pdfExport is lazy-loaded on demand — keeps jsPDF out of the initial bundle.
import { useHistory } from '../useHistory.js';
import { SCALE_PRESETS, ratioToScale, scaleToRatio, zoomAbout } from '../scale.js';
import { pinsOf, filterCss, parsePoly, regularPolygon, outlinePoints, polygonArea, polygonCentroid, hullOfDiscs, simplifyOutline, normalizePolygon, powerCells, balanceCellWeights, pointInPolygon, closestPointOnPolygon } from '../geometry.js';
import { pinPatch } from '../pins.js';
import { edgeGap, adjacencyScore, closestInstancePair, aggregateByRoot, CONCEPT_THRESHOLDS_U } from '../adjacency.js';
import { orderedLevels, levelRankMap } from '../floors.js';
import { buildStackScene, build3DScene } from './diagram/scenes.js';
import * as selection from './diagram/selection.js';
import * as linking from './diagram/linking.js';
import * as layerTools from './diagram/layerTools.js';
import { useDiagramPrefs } from '../hooks/useDiagramPrefs.js';
import { useViewport, W, H } from '../hooks/useViewport.js';
import { useImageDims } from '../hooks/useImageDims.js';
import { useImageData } from '../hooks/useImageData.js';
import { useTickStore } from '../hooks/useTick.js';
import { useSimulation } from '../hooks/useSimulation.js';
import { useSpaceEditing } from '../hooks/useSpaceEditing.js';
import { usePins } from '../hooks/usePins.js';
import { useLinks } from '../hooks/useLinks.js';
import { useCategoryColors } from '../hooks/useCategoryColors.js';
import { usePolyEditing } from '../hooks/usePolyEditing.js';
import { useImageLayers } from '../hooks/useImageLayers.js';
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

// Floor-to-floor height assumed for any storey without an explicit entry in
// projects.level_heights (metres).
const DEFAULT_STOREY_M = 3.5;

// Capability table — what each diagram environment offers. The single source
// of truth for the per-env feature gates (see `caps` below).
const ENV_CAPS = {
  concept: {
    geometry: 'bubble', sim: true, pin: true, forces: true, autoLayout: true,
    layers: 'none', floors: false, scaleUi: false, north: false, snap: false,
    rotate: 'none', resize: false, shapeTools: false, tray: null, adjacency: 'topological',
  },
  masterplan: {
    geometry: 'auto', sim: false, pin: false, forces: false, autoLayout: false,
    layers: 'edit', floors: false, scaleUi: true, north: true, snap: true,
    rotate: 'free', resize: false, shapeTools: true, tray: 'plan', adjacency: 'metric',
  },
  building: {
    geometry: 'box', sim: false, pin: false, forces: false, autoLayout: false,
    layers: 'view', floors: true, scaleUi: true, north: true, snap: true,
    rotate: '90', resize: true, shapeTools: false, tray: 'block', adjacency: 'metric',
  },
};

// BubbleTab unmounts when you leave the Diagram tab, which would otherwise lose
// every non-pinned bubble's position and let the sim re-scatter them on return.
// This module-level cache keeps the last layout per project for the session.
const layoutCache = new Map(); // projectId → Map(instanceKey → {x,y})
// Each environment also keeps its own pan framing for the session — the site
// framing that suits the Master plan rarely suits the scale-free Concept.
const viewCache = new Map(); // `projectId:env` → {x,y}

export default function BubbleTab({ project, spaces, adjacencies, images = [], onChanged, selectedSpaceId = null, onSelectSpace }) {
  // Selection + link-tool state lives in one pure state machine (see
  // diagram/selection.js and diagram/linking.js). Transitions are applied via
  // applySel() below; the destructure keeps every read site unchanged.
  const [sel, setSel] = useState(selection.initialSelection);
  const { tool, selected, selectedInst, multi, selLink, linkFrom, linkKind } = sel;
  // Diagram environment (persisted per project, projects.diagram_env). Phase 1:
  // 'concept' is the bubble/relationship workspace — boxes, custom shapes, image
  // layers and floors are gated off (isConcept). 'masterplan' and 'building'
  // temporarily fall back to the full mixed view. See
  // docs/diagram-environments-plan.md.
  const [env, setEnv] = useState(project.diagram_env || 'concept');
  const isConcept = env === 'concept';
  // Master plan is a static, authored environment: positions live in a separate
  // plan_json (independent of concept's pin_json), the force sim is off, and
  // drags persist to plan_json. Phase 2.
  const isMasterplan = env === 'masterplan';
  // Building is the massing environment: boxes only, positions in their own
  // block_json, force sim off, floors + stacking. Like Master plan it is an
  // AUTHORED (static) environment — `isStatic` groups the mechanics both share
  // (no sim, drags persist, grid snap + alignment guides). Phase 3.
  const isBuilding = env === 'building';
  const isStatic = isMasterplan || isBuilding;
  // The per-instance layout column owned by the current authored environment.
  const layoutCol = isBuilding ? 'block_json' : 'plan_json';
  // What each environment offers — one declarative table instead of scattered
  // per-feature ternaries (see docs/diagram-environments-plan.md, Phase 4a).
  //   geometry:  what shapeOf returns ('auto' = drawn footprint else bubble)
  //   layers:    'edit' (full layer UI) · 'view' (render only) · 'none'
  //   rotate:    'free' (drag handle) · '90' (quarter-turn button) · 'none'
  //   tray:      which promotion tray shows ('plan' = place on site,
  //              'block' = block up into floors)
  //   adjacency: how the compliance score is judged
  const caps = ENV_CAPS[env] ?? ENV_CAPS.concept;
  // Animation ticks bypass React state: the sim/drags mutate nodesRef then
  // bump this store, re-rendering ONLY the <TickLayer> canvas below — not the
  // toolbar/rail/popover chrome. Same call signature as the old setTick.
  const tickStore = useTickStore();
  const setTick = tickStore.bump;
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null); // 'layers' | 'sat' | null
  const [showHelp, setShowHelp] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [catDraft, setCatDraft] = useState(''); // batch category/department assignment input
  const [marquee, setMarquee] = useState(null); // { x0,y0,x1,y1 } in svg coords while selecting
  const [showMatrix, setShowMatrix] = useState(false);
  const [highlightGaps, setHighlightGaps] = useState(false); // flag unmet adjacencies on the diagram
  const [spaceHeld, setSpaceHeld] = useState(false); // transient pan while Space is held
  const [hintDismissed, setHintDismissed] = useState({}); // per project+env empty-state hints closed this session
  // View preferences (split rail, colour mode, hulls, floor view, cameras,
  // auto-layout forces, …) live in one hook; persisted keys round-trip
  // through prefs.js. The destructure keeps every read site unchanged.
  const { view: viewPrefs, setPref } = useDiagramPrefs();
  const { split, colorBy, hulls, hullPad, railW, collapsed,
    floorView, floorGap, stackCam, stackImages, cam3d, nodeForce, buildingForce, snapEdges, snapGrid, interior, interiorLevel } = viewPrefs;

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
  const draftTimers = useRef(new Map());
  const nodesRef = useRef(new Map());
  // Post-drop relaxation owed to the sim (see useSimulation): primed by onUp
  // when a dragged bubble lands so neighbours are pushed aside only once the
  // bubble is PLACED — never while it is carried. `hold` keeps the dropped
  // instances exactly where the user put them while neighbours yield.
  const relaxRef = useRef(null); // { frames, hold: Set<instanceKey> }
  // Start idle if we have a cached layout to restore (avoids a re-scatter on
  // tab return); otherwise energise so the first layout settles.
  const alphaRef = useRef(layoutCache.has(project.id) ? 0 : 1);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const pinOverride = useRef(new Map());
  const fileRef = useRef(null);
  const debouncers = useRef({});
  const hoverRef = useRef(null); // { space, idx } currently under the cursor
  const marqueeRef = useRef(null); // { sx, sy, additive } while drag-selecting
  const rotateRef = useRef(null); // { space, idx, key, cx, cy, startRot, startAng } while rotating a footprint
  const resizeRef = useRef(null); // { space, idx, key, edge, cx, cy, rot, target } while area-lock-resizing a box
  const alignRef = useRef([]); // active alignment guide lines ({x}|{y}) during a master-plan drag
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
  // Reset history when switching projects (optimistic colours reset inside
  // useCategoryColors; poly outline overrides inside usePolyEditing).
  useEffect(() => {
    history.clear();
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = project.units;

  // Write primitives (apply/commit/commitMany/saveProject) shared by every
  // editing handler below — see useSpaceEditing.
  const { applySpace, commitSpace, commitMany, saveProject } = useSpaceEditing({ project, history, onChanged, setError });

  // Keep the active environment in sync when switching projects, and persist
  // switches (optimistic — the segmented control updates instantly).
  useEffect(() => setEnv(project.diagram_env || 'concept'), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each environment keeps its own session layout (Concept and Master plan hold
  // different truths — an auto-layout pass must never disturb site placement).
  const cacheKeyFor = (e) => `${project.id}:${e}`;
  const stashLayout = (e) => {
    const m = new Map();
    for (const [k, n] of nodesRef.current) m.set(k, { x: n.x, y: n.y, rot: n.rot || 0, w: n.w, h: n.h, a: n.a });
    layoutCache.set(cacheKeyFor(e), m);
  };
  function switchEnv(next) {
    if (next === env) return;
    stashLayout(env); // remember where the current env's rooms are before re-seeding
    // Each env keeps its own framing: stash this env's pan, restore the next's.
    viewCache.set(cacheKeyFor(env), { ...viewRef.current });
    const v = viewCache.get(cacheKeyFor(next));
    if (v) setView(v);
    setEnv(next);
    setPanel(null); // close any layer/more popover that doesn't belong to the new env
    saveProject({ diagram_env: next }, { silent: true });
  }

  // Per-building focus in the Building env: the stacking rail is the
  // navigator — clicking a building fades everything else so one building's
  // floors can be arranged without the neighbours' noise.
  const [focusBuilding, setFocusBuilding] = useState(null); // root container id | null
  useEffect(() => setFocusBuilding(null), [project.id, env]);

  // Changing environment drops the selection — carried across envs it would
  // offer the wrong actions (a room selected in Concept isn't drawable in the
  // envelope plan). Guarded by a ref so mounting doesn't clear the shared
  // Brief → Diagram selection handoff.
  const envSelResetRef = useRef(env);
  useEffect(() => {
    if (envSelResetRef.current === env) return;
    envSelResetRef.current = env;
    applySel(selection.escape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env]);

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

  // Placement grid: a metric grid derived from the calibrated scale, used as a
  // *fallback* when a drag isn't snapping to a neighbour. Coarse (major cell) by
  // default; holding Alt snaps to a half-cell. The overlay shows only the major
  // cells (a faint reference field) — the primary snap is edge/corner alignment.
  const GRID_SUBDIV = 2;
  const planGrid = (() => {
    if (!caps.snap || !effScale) return null;
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    for (const v of nice) {
      const step = distToMeters(v, units) / effScale; // grid cell in diagram units
      if (step >= 46)
        return { meters: v, step, subdiv: GRID_SUBDIV, minorMeters: v / GRID_SUBDIV, minorStep: step / GRID_SUBDIV, label: `${v} ${distUnit(units)}` };
    }
    return null;
  })();
  // Snap a diagram-unit coordinate to the placement grid. Coarse (major cell) by
  // default; `fine` (Alt held) snaps to the subdivision. Identity when off.
  const snapToGrid = (v, fine) => {
    if (!planGrid) return v;
    const s = fine ? planGrid.minorStep : planGrid.step;
    return Math.round(v / s) * s;
  };
  // World-space half-extents (x, y) of a footprint as RENDERED — the real box
  // dimensions in the Building massing model (rescaled to the target area, with
  // 90° orientation), else the circle radius. Snapping uses these so boxes align
  // edge-to-edge and corner-to-corner, not by a phantom radius.
  const footHalf = (s, n) => {
    if (isBuilding) {
      const target = areaUnits(s);
      let hw, hh;
      if (n && n.w && n.h) {
        const aspect = n.w / n.h;
        const bh = Math.sqrt(target / aspect);
        hh = bh / 2;
        hw = (aspect * bh) / 2;
      } else {
        hw = hh = Math.sqrt(target) / 2;
      }
      return Math.round((n?.rot || 0) / 90) % 2 ? { x: hh, y: hw } : { x: hw, y: hh };
    }
    const r = radiusOf(s);
    return { x: r, y: r };
  };
  // Snap targets per axis: every other visible footprint's two edges + centre.
  // Each candidate carries the neighbour's PERPENDICULAR centre + half-extent, so
  // the guide can be drawn as a short segment spanning just the two boxes.
  const SNAP_TOL = 8; // diagram units — the reach of an edge/corner grab
  const neighbourEdges = (dragKey) => {
    const x = [], y = [];
    for (const o of instances) {
      if (o.key === dragKey || !levelVisible(o.s)) continue;
      const nn = nodesRef.current.get(o.key);
      if (!nn) continue;
      const h = footHalf(o.s, nn);
      for (const at of [nn.x - h.x, nn.x, nn.x + h.x]) x.push({ at, c: nn.y, h: h.y });
      for (const at of [nn.y - h.y, nn.y, nn.y + h.y]) y.push({ at, c: nn.x, h: h.x });
    }
    return { x, y };
  };
  // Resolve one axis. When object snap is on, try edge/corner alignment first (the
  // dragged box's own left / centre / right land on a neighbour edge → returns the
  // matched candidate). Otherwise, or when nothing aligns, fall back to the metric
  // grid if grid snap is on. `half` is the dragged half-extent on this axis.
  const resolveAxis = (center, half, cands, fine, useEdges, useGrid) => {
    if (useEdges) {
      let best = null;
      for (const off of [-half, 0, half]) for (const cand of cands) {
        const d = cand.at - (center + off);
        if (Math.abs(d) <= SNAP_TOL && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, cand };
      }
      if (best) return { val: center + best.d, cand: best.cand };
    }
    return { val: useGrid ? snapToGrid(center, fine) : center, cand: null };
  };



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

  // Image-layer editing (upload / satellite / calibrate / move / rotate) — see
  // useImageLayers. The image DATA above stays in the shell; the hook owns the
  // tool modes + gestures. Its layerPointer* delegates plug into the pointer
  // switchyard below. Destructured names match the original call sites.
  const {
    calibrateLayer, moveLayer, rotateLayer, scalePoints, scaleDistance, applyLt,
    satQuery, setSatQuery, satZoom, setSatZoom, satBusy,
    onUpload, layerSlider, toggleLayerVisible, deleteImageLayer, startCalibrate, applyScale, fetchSatellite,
    layerPointerDown, layerPointerMove, layerPointerUp,
  } = useImageLayers({
    project, units, onChanged, setError, setTick, setPanel,
    imgById, dims, layerRect, toSvgCoords, svgRef, vb,
  });

  // ---------- spaces / instances (leaves only) ----------
  const leaves = useMemo(() => leafSpaces(spaces), [spaces]);
  const byId = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const hasBuildings = spaces.some((s) => s.kind === 'building' || s.kind === 'group');

  // Envelope master plan: with buildings in the brief, the master plan places
  // building ENVELOPES (one footprint per building), not individual rooms —
  // rooms belong to the floor plans (Building env). Flat programs (no
  // containers) keep room-level placement.
  const isEnvelope = isMasterplan && hasBuildings;
  // Top-level containers that actually hold rooms — the "buildings" the
  // envelope master plan and the Building env's block-up flow operate on.
  const buildingRoots = useMemo(() => {
    if (!hasBuildings) return [];
    const ids = new Set();
    for (const l of leaves) {
      const r = rootContainer(l, byId);
      if (r) ids.add(r.id);
    }
    return spaces.filter((s) => ids.has(s.id));
  }, [hasBuildings, spaces, leaves, byId]);
  // The master plan's drawable units: every building, plus rooms outside one.
  const mpUnits = useMemo(
    () => (hasBuildings ? [...buildingRoots, ...leaves.filter((l) => !rootContainer(l, byId))] : leaves),
    [hasBuildings, buildingRoots, leaves, byId]
  );
  // What the CURRENT environment draws and drags.
  const planUnits = isEnvelope ? mpUnits : leaves;

  // Per-instance authored layouts, parsed from their columns. Master plan owns
  // plan_json (room-level, or the building container rows in envelope mode),
  // Building owns block_json; each is independent of concept's pin_json.
  // `authoredPinsOf` reads whichever the current environment owns.
  const planPinsOf = (s) => { try { return JSON.parse(s.plan_json || '{}') || {}; } catch { return {}; } };
  const blockPinsOf = (s) => { try { return JSON.parse(s.block_json || '{}') || {}; } catch { return {}; } };
  const authoredPinsOf = (s) => (isBuilding ? blockPinsOf(s) : planPinsOf(s));

  // Room position + pin/lock persistence, and adjacency (link) editing — both
  // extracted to hooks; the destructured names match the original call sites.
  const { instPin, anyPinned, saveDragPos, savePin, savePinAll, multiPin, pinKeys, commitPinPatch } =
    usePins({ nodesRef, pinOverride, byId, history, applySpace, commitMany, setError, multi });
  const { findPair, cyclePair, setLinkStrength, createLink } =
    useLinks({ project, adjRef, history, onChanged, setError });

  // Colour groups, spatial clustering key, and custom per-label colours — see
  // useCategoryColors. Destructured names match the original call sites.
  const { groupKey, clusterKey, groups, departments, colorForLabel, colorOf, setCategoryColor } =
    useCategoryColors({ project, leaves, byId, colorBy, hasBuildings, saveProject, debouncers, palette: PALETTE });

  const instances = useMemo(
    () =>
      planUnits.flatMap((s) =>
        Array.from({ length: Math.max(1, s.count || 1) }, (_, i) => ({ s, i, key: `${s.id}:${i}` }))
      ),
    [planUnits]
  );

  // Storey labels present in the program, ground → up. Drives the floor switcher.
  const levels = useMemo(() => orderedLevels(leaves), [leaves]);
  const levelRank = useMemo(() => levelRankMap(levels), [levels]);
  // Levels as the 3-D scene sees them: rooms without a storey label count as a
  // ground storey of their own, so every room is modelled (a program with no
  // levels at all becomes one implicit ground floor).
  const levels3d = useMemo(
    () => (leaves.some((s) => !(s.level || '').trim()) ? ['', ...levels] : levels),
    [leaves, levels]
  );
  const levelRank3d = useMemo(() => levelRankMap(levels3d), [levels3d]);
  // Storey heights (metres): projects.level_heights JSON map, 3.5 m for any
  // level not listed (see heightOfLevel below with the other floor helpers).
  const levelHeights = useMemo(() => {
    try { return JSON.parse(project.level_heights || '{}') || {}; } catch { return {}; }
  }, [project.level_heights]);
  const lvlHRef = useRef(null); // pending level_heights edits within the save debounce
  // Floors + stacking belong to the Building environment only; Concept and Master
  // plan always show all levels flat and hide the floor switcher / 3-D.
  const hasLevels = levels.length >= 2 && caps.floors;
  // A previously-selected level may vanish (e.g. project change); fall back to all.
  const floorMode =
    isBuilding && (floorView === 'offset' || floorView === 'overlaid' || floorView === '3d' || floorView === 'all' || levels.includes(floorView))
      ? floorView
      : 'all';
  useEffect(() => setPref('floorView', 'all'), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Building's primary state is editing ONE floor: entering it (or opening a
  // multi-level project in it) lands on the ground floor; "all"/stacked are opt-in
  // overviews the user selects. Only fires on env / project change, so a manual
  // "All floors" choice sticks.
  useEffect(() => {
    if (isBuilding && levels.length >= 2 && floorView === 'all') setPref('floorView', levels[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, project.id]);

  const leafEa = (s) => {
    const draft = drafts[s.id];
    return draft !== undefined && draft !== '' ? Number(draft) || 0 : s.target_area;
  };
  // Envelope areas (project units). A building's REQUIRED footprint is its
  // biggest storey — the smallest ground its massing can stand on. Its DRAWN
  // area is whatever the envelope was set to (plan slot `a`, stored in project
  // units so a scale change never corrupts it), defaulting to required — so
  // an untouched envelope keeps tracking the brief, and one the user has
  // claimed shows a deficit the moment the brief outgrows it.
  const footprintPU = (c) => {
    const byLvl = new Map();
    for (const l of leaves) {
      if (rootContainer(l, byId)?.id !== c.id) continue;
      const k = (l.level || '').trim();
      byLvl.set(k, (byLvl.get(k) || 0) + Math.max(1, l.count || 1) * leafEa(l));
    }
    return byLvl.size ? Math.max(...byLvl.values()) : 0;
  };
  const envelopeDrawnPU = (c) => {
    const a = planPinsOf(c)[0]?.a;
    return a > 0 ? a : null;
  };
  // Circulation share of a building's GROSS footprint: the container row's
  // own circ_pct, else the project default (1 − net:gross target); 0 = off.
  const circOf = (c) => {
    const v = c?.circ_pct;
    const share = v != null ? Number(v) : Math.max(0, 1 - (project.grossing_target || 1));
    return Math.min(0.6, Math.max(0, share)) || 0;
  };
  // Required GROSS footprint: the biggest storey grossed up for circulation —
  // net rooms alone never fill a floor plate; corridors need their share.
  const footprintGrossPU = (c) => footprintPU(c) / (1 - circOf(c));
  // `ea` resolves ANY drawable unit — room or building envelope — so radius,
  // areaUnits and the poly area lock work unchanged on envelopes.
  const ea = (s) => (isContainerKind(s) ? envelopeDrawnPU(s) ?? footprintGrossPU(s) : leafEa(s));
  const maxEach = Math.max(...planUnits.map(ea), 1);
  const radiusOf = (s) => {
    // Concept is scale-free: bubble radius stays RELATIVE to the largest room, so
    // a project's calibrated scale never sizes the relationship diagram. Master
    // plan / Building are metric (radius derived from the real area at scale).
    if (effScale && !isConcept) return Math.max(7, Math.sqrt(areaToM2(ea(s), units) / Math.PI) / effScale);
    return 16 + 50 * Math.sqrt(ea(s) / maxEach);
  };

  useEffect(() => () => Object.values(debouncers.current).forEach(clearTimeout), []);

  // Keyboard shortcut: P pins/unpins the hovered room (Concept only — the
  // authored envs have no sim to protect against). Geometry is decided by the
  // environment now, so the old B (box) toggle is gone.
  useEffect(() => {
    function onKey(e) {
      if (e.target.matches?.('input, select, textarea')) return;
      const h = hoverRef.current;
      if (!h) return;
      if (e.key.toLowerCase() === 'p' && caps.pin) {
        e.preventDefault();
        // Per-instance: P pins just the bubble under the cursor. Shift+P pins all.
        if (e.shiftKey) savePinAll(h.space, !anyPinned(h.space));
        else savePin(h.space, h.idx, !instPin(h.space, h.idx));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, env]);

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
      } else if (e.key.toLowerCase() === 'a' && !mod && caps.autoLayout) {
        runAutoLayout(); // authored Master plan / Building have no auto-layout
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
  }, [multi, env]);

  // Arrow-key nudge — precision placement in the authored Master-plan / Building
  // envs. The selection (single room or multi) steps by 1 m (Shift = 0.1 m) once a
  // scale is set, else a small pixel step; persists to the layout col (debounced).
  useEffect(() => {
    if (!isStatic) return undefined;
    function onKey(e) {
      if (e.target.matches?.('input, select, textarea')) return;
      if (!e.key.startsWith('Arrow')) return;
      const keys = multi.size > 0 ? [...multi] : selected != null ? [`${selected}:${selectedInst}`] : [];
      if (!keys.length) return;
      e.preventDefault();
      const step = e.shiftKey ? (effScale ? 0.1 / effScale : 1) : effScale ? 1 / effScale : 4;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      for (const k of keys) {
        const n = nodesRef.current.get(k);
        if (n) ((n.x += dx), (n.y += dy));
      }
      setTick((t) => t + 1);
      clearTimeout(debouncers.current.nudge);
      debouncers.current.nudge = setTimeout(() => savePlanKeys(keys), 350);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic, selected, selectedInst, multi, effScale]);

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
    // Geometry is decided by the ENVIRONMENT, not per space: Concept is
    // bubbles-only, Building is boxes-only (the massing model), Master plan is
    // 'auto' — a drawn footprint (room outline or building envelope) renders
    // as the polygon, anything not yet drawn stays a bubble; never a box.
    if (caps.geometry === 'bubble') return 'bubble';
    if (caps.geometry === 'box') return 'box';
    return s.shape === 'poly' && parsePoly(s) ? 'poly' : 'bubble';
  };

  // On-screen area of any shape, in diagram-units². All shapes share this so a
  // bubble, box and polygon for the same space cover the same footprint area.
  const areaUnits = (s) => Math.PI * radiusOf(s) ** 2;

  // Where a poly edit's node-recentre persists: the authored envs own their
  // layout column (an envelope's position lives in plan_json), Concept pins.
  // Same { before, after, touched } contract as pinPatch; authored slots keep
  // their extra fields (rot / a / w / h) and only the position is rewritten.
  const polyPosPatch = (space, idxs, nextPos) => {
    if (!isStatic) return pinPatch(space, idxs, nextPos);
    const pins = { ...authoredPinsOf(space) };
    const touched = {};
    for (const i of idxs) {
      const p = nextPos(i, pins[i] ?? null);
      pins[i] = { ...(pins[i] || {}), x: p.x, y: p.y };
      touched[i] = pins[i];
    }
    return { before: { [layoutCol]: space[layoutCol] ?? null }, after: { [layoutCol]: JSON.stringify(pins) }, touched };
  };

  // Custom-shape (polygon) geometry + vertex editing — see usePolyEditing. The
  // shell keeps shapeOf/areaUnits (shared) and passes them in; the poly pointer
  // flow is delegated below via polyPointerMove/polyPointerUp. Destructured
  // names match the original call sites.
  const {
    editShape, polyVertsOf, polyHandlesOf, polyRingPath,
    editCustomShape, editAnchorInst, addPolyVertex, removePolyVertex,
    cycleCornerStyle, setCornerStyleAll,
    onPolyVertexDown, polyPointerMove, polyPointerUp,
  } = usePolyEditing({
    project, nodesRef, pinOverride, history, applySpace, commitSpace, setError,
    setTick, toSvgCoords, shapeOf, areaUnits, selected, selectedInst,
    posPatch: polyPosPatch,
  });

  // Seed order per environment: an authored env falls back through the earlier
  // stages (block → plan → concept), so entering it starts every room where it
  // last lived, then diverges as it is authored.
  const persistedPos = (s, i) => {
    if (isBuilding) return (blockPinsOf(s)[i] ?? planPinsOf(s)[i] ?? pinsOf(s)[i]) ?? null;
    if (isMasterplan) return (planPinsOf(s)[i] ?? pinsOf(s)[i]) ?? null;
    return pinsOf(s)[i] ?? null;
  };
  // Tracks which environment the live node map is seeded for; an env switch
  // re-seeds every node from the new environment's layout.
  const seededEnvRef = useRef(env);

  // Persist an authored drop to the active layout column (undoable). Independent
  // of the other environments' layouts. Build a slot from a live node, carrying
  // size / rotation / drawn envelope area when set.
  const planSlot = (n) => ({
    x: n.x, y: n.y,
    ...(n.w ? { w: n.w, h: n.h } : {}),
    ...(n.rot ? { rot: Math.round(n.rot) } : {}),
    ...(n.a > 0 ? { a: Math.round(n.a) } : {}),
  });
  // Placing a building on the site seeds its envelope outline — a hexagon
  // area-locked to the required footprint, ready for vertex editing. Returns
  // the extra shape fields for the write (null when nothing to seed).
  const envelopeSeed = (space) =>
    isEnvelope && isContainerKind(space) && !(space.shape === 'poly' && parsePoly(space))
      ? { shape: 'poly', shape_json: JSON.stringify(regularPolygon(6)) }
      : null;
  const envelopeSeedBefore = (space) => ({ shape: space.shape ?? null, shape_json: space.shape_json ?? null });
  const writeSlot = (space, idx, label) => {
    const n = nodesRef.current.get(`${space.id}:${idx}`);
    if (!n) return null;
    const seed = envelopeSeed(space);
    const before = { [layoutCol]: space[layoutCol] ?? null, ...(seed ? envelopeSeedBefore(space) : {}) };
    const after = { [layoutCol]: JSON.stringify({ ...authoredPinsOf(space), [idx]: planSlot(n) }), ...(seed || {}) };
    history.record({ label, undo: () => applySpace(space.id, before), redo: () => applySpace(space.id, after) });
    return after;
  };
  async function savePlanPos(space, idx) {
    const after = writeSlot(space, idx, 'move');
    if (!after) return;
    setError(null);
    try { await applySpace(space.id, after); } catch (e) { setError(e.message); }
  }
  // Persist a rotation to the active layout column (undoable) — position preserved.
  async function savePlanRot(space, idx) {
    const after = writeSlot(space, idx, 'rotate');
    if (!after) return;
    setError(null);
    try { await applySpace(space.id, after); } catch (e) { setError(e.message); }
  }

  // Rotate a placed footprint by dragging its rotate handle (Shift = 15° snap).
  // Master-plan only; the handle is drawn just above box/poly shapes. Grabs its
  // own pointer and routes move/up through the shell switchyard (like poly).
  function rotHandleDown(e, o) {
    e.stopPropagation();
    const n = nodesRef.current.get(o.key);
    if (!n) return;
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    const p = toSvgCoords(e);
    rotateRef.current = { space: o.s, idx: o.i, key: o.key, cx: n.x, cy: n.y, startRot: n.rot || 0, startAng: Math.atan2(p.y - n.y, p.x - n.x), moved: false };
  }
  function rotPointerMove(e) {
    const rd = rotateRef.current;
    if (!rd) return false;
    const p = toSvgCoords(e);
    const ang = Math.atan2(p.y - rd.cy, p.x - rd.cx);
    let deg = rd.startRot + ((ang - rd.startAng) * 180) / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15; // 15° increments with Shift
    const n = nodesRef.current.get(rd.key);
    if (n) { n.rot = ((deg % 360) + 360) % 360; rd.moved = true; }
    setTick((t) => t + 1);
    return true;
  }
  async function rotPointerUp() {
    const rd = rotateRef.current;
    if (!rd) return false;
    rotateRef.current = null;
    if (rd.moved) await savePlanRot(rd.space, rd.idx);
    return true;
  }
  // Building boxes rotate in 90° steps (orthogonal massing, not free rotation):
  // the action bar's ⟲ button turns the selected box a quarter turn.
  async function rotate90(space, idx) {
    const n = nodesRef.current.get(`${space.id}:${idx}`);
    if (!n) return;
    n.rot = ((Math.round((n.rot || 0) / 90) * 90 + 90) % 360);
    setTick((t) => t + 1);
    await savePlanRot(space, idx);
  }

  // Area-locked box resize from a CORNER handle. The rescale happens FROM the
  // SELECTED corner: that corner is pinned in place while the opposite corner
  // tracks the pointer, and the room's target footprint area is always held (so a
  // corner drag sets the rectangle's aspect, not its area). Building only.
  // `scx, scy` ∈ {-1,+1} are the grabbed corner's signs.
  const MIN_SIDE = 8; // diagram units — keeps a resized box from collapsing
  function resizeHandleDown(e, o, scx, scy) {
    e.stopPropagation();
    const n = nodesRef.current.get(o.key);
    if (!n) return;
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    const target = areaUnits(o.s); // π r² — the area the rectangle must hold
    // Seed w/h from the current equal-area square the first time it's resized.
    if (!n.w || !n.h) { const s = Math.sqrt(target); n.w = s; n.h = s; }
    const h = footHalf(o.s, n);
    const p0 = toSvgCoords(e);
    resizeRef.current = {
      space: o.s, idx: o.i, key: o.key, rot: n.rot || 0, target, scx, scy,
      gx: n.x + scx * h.x, gy: n.y + scy * h.y, // grabbed corner — the pivot, stays put
      ox: n.x - scx * h.x, oy: n.y - scy * h.y, // opposite corner at grab
      px: p0.x, py: p0.y, moved: false,
    };
  }
  function resizePointerMove(e) {
    const rd = resizeRef.current;
    if (!rd) return false;
    const n = nodesRef.current.get(rd.key);
    if (!n) return true;
    const p = toSvgCoords(e);
    // The opposite corner tracks the pointer's movement; the grabbed corner stays
    // pinned. The grabbed→opposite rectangle's aspect is held while area locks.
    const ox = rd.ox + (p.x - rd.px), oy = rd.oy + (p.y - rd.py);
    const a = (-rd.rot * Math.PI) / 180;
    const vx = ox - rd.gx, vy = oy - rd.gy;
    const lx = vx * Math.cos(a) - vy * Math.sin(a);
    const ly = vx * Math.sin(a) + vy * Math.cos(a);
    const aspect = Math.max(Math.abs(lx), MIN_SIDE) / Math.max(Math.abs(ly), MIN_SIDE);
    n.h = Math.sqrt(rd.target / aspect);
    n.w = aspect * n.h;
    const hi = rd.target / MIN_SIDE; // cap so neither side collapses below MIN_SIDE
    if (n.w > hi) { n.w = hi; n.h = rd.target / n.w; }
    if (n.h > hi) { n.h = hi; n.w = rd.target / n.h; }
    // Reposition so the SELECTED corner stays put (footHalf gives the new world
    // half-extents, so this works at any orientation).
    const h = footHalf(rd.space, n);
    n.x = rd.gx - rd.scx * h.x;
    n.y = rd.gy - rd.scy * h.y;
    rd.moved = true;
    setTick((t) => t + 1);
    return true;
  }
  async function resizePointerUp() {
    const rd = resizeRef.current;
    if (!rd) return false;
    resizeRef.current = null;
    if (rd.moved) await savePlanPos(rd.space, rd.idx); // planSlot carries w/h
    return true;
  }
  // Group-drop variant: one undoable step across every moved instance's plan_json.
  async function savePlanKeys(keys) {
    const bySpace = new Map();
    for (const k of keys) {
      const [id, i] = String(k).split(':');
      const space = byId.get(Number(id));
      if (!space) continue;
      if (!bySpace.has(space.id)) bySpace.set(space.id, { space, idxs: [] });
      bySpace.get(space.id).idxs.push(Number(i));
    }
    const changes = [...bySpace.values()].map(({ space, idxs }) => {
      const next = { ...authoredPinsOf(space) };
      for (const i of idxs) {
        const n = nodesRef.current.get(`${space.id}:${i}`);
        if (n) next[i] = planSlot(n);
      }
      const seed = envelopeSeed(space);
      return {
        id: space.id,
        before: { [layoutCol]: space[layoutCol] ?? null, ...(seed ? envelopeSeedBefore(space) : {}) },
        after: { [layoutCol]: JSON.stringify(next), ...(seed || {}) },
      };
    });
    await commitMany(changes, 'move group');
  }

  // Resize an envelope by the numbers: sets the DRAWN footprint area (project
  // units) its outline is area-locked to. The badge compares it against the
  // required footprint; the outline rescales immediately.
  async function saveEnvelopeArea(space, idx, value) {
    const v = Number(value);
    const n = nodesRef.current.get(`${space.id}:${idx}`);
    if (!(v > 0) || !n) return;
    n.a = v;
    setTick((t) => t + 1);
    const after = writeSlot(space, idx, 'envelope area');
    if (!after) return;
    setError(null);
    try { await applySpace(space.id, after); } catch (e) { setError(e.message); }
  }

  // The building a drawable unit belongs to (null for floating rooms).
  const rootIdOf = (s) => rootContainer(s, byId)?.id ?? null;

  // ---------- envelope ⇄ concept hull ----------
  // The concept view draws a hull around each building's bubbles; these
  // actions reshape a building's ENVELOPE to that hull — the same padded
  // discs the canvas hull uses (concept positions + relative radii), taken
  // to a concave hull and simplified to an editable vertex count. Only
  // the SHAPE transfers (normalized); the envelope's drawn area stays locked
  // to `a` / the required footprint.
  // The padded concept discs (bubble + hull padding) of a building's rooms —
  // the raw material both the hull match and the Voronoi seed mapping use.
  function conceptDiscsOf(c, { placeMissing = false } = {}) {
    const cache = layoutCache.get(cacheKeyFor('concept'));
    const maxLeaf = Math.max(...leaves.map(leafEa), 1);
    const rOf = (s) => 16 + 50 * Math.sqrt(leafEa(s) / maxLeaf); // concept (relative) radius
    const discs = [];
    const missing = [];
    for (const l of leaves) {
      if (rootContainer(l, byId)?.id !== c.id) continue;
      const pins = pinsOf(l);
      for (let i = 0; i < Math.max(1, l.count || 1); i++) {
        // Concept position: the saved pin, else this session's concept layout.
        const p = pins[i] ?? (isConcept ? nodesRef.current.get(`${l.id}:${i}`) : cache?.get(`${l.id}:${i}`));
        if (p) discs.push({ x: p.x, y: p.y, r: rOf(l) + hullPad, s: l, i });
        else missing.push({ l, i });
      }
    }
    // The interior sketch must show EVERY room, even before the Concept view
    // has ever been arranged — rooms without a concept position land on a
    // deterministic golden-angle spiral around the others. Their cell SIZE
    // comes from the power weights, so the crude position only decides which
    // neighbours the cell touches. (Hull matching deliberately does not pass
    // this flag — a hull of synthetic positions would be meaningless.)
    if (placeMissing && missing.length) {
      const cx = discs.length ? discs.reduce((t, d) => t + d.x, 0) / discs.length : W / 2;
      const cy = discs.length ? discs.reduce((t, d) => t + d.y, 0) / discs.length : H / 2;
      missing.forEach(({ l, i }, k) => {
        const a = k * 2.39996; // golden angle
        const rr = k === 0 && !discs.length ? 0 : 40 * Math.sqrt(k + 1);
        discs.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, r: rOf(l) + hullPad, s: l, i });
      });
    }
    return discs;
  }
  function conceptHullOutline(c) {
    const hull = hullOfDiscs(conceptDiscsOf(c));
    return hull.length >= 3 ? normalizePolygon(simplifyOutline(hull, 12)) : null;
  }
  const hullFields = (c) => {
    const hull = conceptHullOutline(c);
    return hull ? { shape: 'poly', shape_json: JSON.stringify(hull) } : null;
  };
  async function matchEnvelopeToHull(space) {
    const after = hullFields(space);
    if (!after) {
      setError(`No concept layout found for ${space.name}'s rooms yet — arrange (or just open) the Concept view first.`);
      return;
    }
    await commitSpace(space, after, 'envelope from concept hull');
  }
  async function matchAllEnvelopesToHulls() {
    const changes = buildingRoots
      .map((c) => {
        const after = hullFields(c);
        return after ? { id: c.id, before: { shape: c.shape ?? null, shape_json: c.shape_json ?? null }, after } : null;
      })
      .filter(Boolean);
    if (!changes.length) {
      setError('No concept layouts to take hulls from yet — arrange the Concept view first.');
      return;
    }
    await commitMany(changes, 'envelopes from concept hulls');
  }

  // ---------- Voronoi interior (envelope master plan) ----------
  // While placing envelopes the rooms would vanish; instead each envelope is
  // partitioned into room cells — a Voronoi diagram clipped to the envelope,
  // seeded by the rooms' CONCEPT positions pushed through the same transform
  // the hull match implies (concept hull → envelope outline). The seeds are
  // draggable; a drop inverse-maps to concept coordinates and saves the
  // room's pin, so the edit shows up in the Concept view (and pins the room
  // there — otherwise the sim would erase it).
  const seedRef = useRef(null); // { key, spaceId, idx, rootId, moved } while dragging a seed
  const seedOverride = useRef(new Map()); // instanceKey → world {x,y} until the pin round-trips
  useEffect(() => { seedOverride.current.clear(); }, [spaces, env, project.id]);
  // The storey the interior sketch shows. The envelope is ONE floor plate, so
  // a multi-level program always shows a single storey (ground by default —
  // there is no "all floors" overlay; that would draw a fiction). Rooms with
  // no level assigned count as ground, matching the 3-D view's convention.
  const interiorStorey = levels.length >= 2 ? (levels.includes(interiorLevel) ? interiorLevel : levels[0]) : null;
  const interiorStoreyOf = (s) => (s.level || '').trim() || levels[0];
  // Balanced power-diagram weights per building — cached because they are
  // invariant under rigid motion (dragging/rotating an envelope moves seeds
  // and boundary together), keyed by everything that DOES change the relative
  // geometry. Re-balanced live (warm-started) while a seed is dragged.
  const cellWeightsRef = useRef(new WeakMap()); // interiorFrames → Map(key → weights[])
  // Per-building concept frame (discs + hull centroid/area) — the static part
  // of the seed mapping, recomputed only when the brief/pins change.
  const interiorFrames = useMemo(() => {
    if (!isEnvelope) return null;
    const m = new Map();
    for (const c of buildingRoots) {
      const discs = conceptDiscsOf(c, { placeMissing: true });
      if (!discs.length) continue;
      const hull = hullOfDiscs(discs);
      if (hull.length < 3) continue;
      m.set(c.id, { discs, hc: polygonCentroid(hull), hullArea: polygonArea(hull) });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnvelope, buildingRoots, spaces, hullPad, env]);
  // Live interior cells — called inside the canvas TickLayer so the cells track
  // the envelope during a drag. Null when the sketch is off / nothing to draw.
  function makeInterior() {
    if (!isEnvelope || !interior || !interiorFrames?.size) return null;
    const kM2 = areaToM2(1, units); // project-units → m² factor
    const out = [];
    for (const c of buildingRoots) {
      const fr = interiorFrames.get(c.id);
      const n = nodesRef.current.get(`${c.id}:0`);
      if (!fr || !n || !placedKeys.has(`${c.id}:0`)) continue;
      if (!(c.shape === 'poly' && parsePoly(c))) continue;
      const verts = polyVertsOf(c);
      if (!verts || verts.length < 3) continue;
      const rad = ((n.rot || 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const toWorld = (x, y) => ({ x: n.x + x * cos - y * sin, y: n.y + x * sin + y * cos });
      const boundary = verts.map((v) => toWorld(v.x, v.y));
      const f = Math.sqrt(areaUnits(c) / fr.hullArea);
      // Storey filter: one floor plate, one storey's rooms (see interiorStorey).
      // The mapping frame stays the whole building's hull, so seeds don't jump
      // when switching storeys.
      const discs = interiorStorey == null
        ? fr.discs
        : fr.discs.filter((d) => interiorStoreyOf(d.s) === interiorStorey);
      const seeds = discs.map((d) => {
        const key = `${d.s.id}:${d.i}`;
        let p = seedOverride.current.get(key) ?? toWorld((d.x - fr.hc.x) * f, (d.y - fr.hc.y) * f);
        if (!pointInPolygon(boundary, p)) {
          // Outside the drawn envelope (e.g. an unmatched hexagon) — clamp to
          // the boundary, nudged inward so the cell doesn't degenerate.
          const cp = closestPointOnPolygon(boundary, p);
          p = { x: cp.x + (n.x - cp.x) * 0.05, y: cp.y + (n.y - cp.y) * 0.05 };
        }
        return { x: p.x, y: p.y, s: d.s, i: d.i, key };
      });
      // AREA-TRUE cells: a power diagram whose weights are balanced so each
      // cell's share of the envelope matches the room's share of the storey's
      // programme — the sketch reads as a plan, not as proximity luck. Weights
      // are rigid-motion invariant, so the cache survives envelope drags;
      // dragging a seed re-balances live from the previous solution.
      // Balance on the BRIEF's areas (not the phantom-circle areaUnits, whose
      // relative-mode +16 base offset compresses the ratios).
      const targets = seeds.map((sd) => Math.max(leafEa(sd.s), 0.1));
      let byBuilding = cellWeightsRef.current.get(interiorFrames);
      if (!byBuilding) {
        byBuilding = new Map();
        cellWeightsRef.current.set(interiorFrames, byBuilding);
      }
      const wKey = `${c.id}|${interiorStorey ?? ''}|${Math.round(areaUnits(c))}|${c.shape_json || ''}|${targets.map((t) => Math.round(t)).join(',')}`;
      const draggingHere = seedRef.current?.rootId === c.id;
      let weights = byBuilding.get(wKey);
      if (!weights || draggingHere) {
        weights = balanceCellWeights(seeds, boundary, targets, draggingHere ? { iters: 14, initial: weights ?? null } : {});
        byBuilding.set(wKey, weights);
      }
      const cells = powerCells(seeds.map((sd, ix) => ({ ...sd, w: weights[ix] })), boundary);
      // Rooms linked to the current selection — their cells get a highlight so
      // re-planning a seed can aim at its partners.
      const relatedIds = selected != null
        ? new Set(adjacencies.flatMap((l) => (l.space_a === selected ? [l.space_b] : l.space_b === selected ? [l.space_a] : [])))
        : null;
      // Circulation (optional): each cell shrinks toward its seed to the
      // room's NET target area; the interstitial band left over renders as
      // hatched circulation. Off (0) → cells simply fill the envelope.
      const circ = circOf(c);
      const cellsOut = [];
      seeds.forEach((sd, ix) => {
        let cell = cells[ix];
        if (!cell) return;
        if (circ > 0) {
          const k = Math.min(1, Math.sqrt(areaUnits(sd.s) / (polygonArea(cell) || 1)));
          if (k < 1) cell = cell.map((p) => ({ x: sd.x + (p.x - sd.x) * k, y: sd.y + (p.y - sd.y) * k }));
        }
        const cellPU = effScale ? (polygonArea(cell) * effScale * effScale) / kM2 : null;
        const targetPU = leafEa(sd.s);
        cellsOut.push({
          key: sd.key, spaceId: sd.s.id, i: sd.i, rootId: c.id,
          name: `${sd.s.name}${Math.max(1, sd.s.count || 1) > 1 ? ` ${sd.i + 1}` : ''}`,
          color: colorOf(sd.s),
          poly: cell, seed: { x: sd.x, y: sd.y }, centre: polygonCentroid(cell),
          areaPU: cellPU, targetPU,
          tight: cellPU != null && cellPU < targetPU * 0.95,
          related: !!relatedIds?.has(sd.s.id) && sd.s.id !== selected,
        });
      });
      if (cellsOut.length) out.push({ rootId: c.id, cells: cellsOut, boundary, circ });
    }
    return out.length ? out : null;
  }
  // Pointer down on a room CELL: dragging still moves the building's envelope
  // (the cell is part of the building), but a plain click selects the ROOM —
  // so the sketch's rooms are pickable (rail/Brief sync, area editing, and the
  // Link tool works room-to-room straight from the site view).
  function cellPointerDown(e, cell) {
    const root = byId.get(cell.rootId);
    if (!root) return;
    onBubbleDown(e, { s: root, i: 0, key: `${cell.rootId}:0` }, { spaceId: cell.spaceId, idx: cell.i });
  }

  // Seed drag — grabbed on the canvas, routed through the pointer switchyard.
  function seedHandleDown(e, cell) {
    e.stopPropagation();
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    seedRef.current = { key: cell.key, spaceId: cell.spaceId, idx: cell.i, rootId: cell.rootId, moved: false };
  }
  function seedPointerMove(e) {
    const sd = seedRef.current;
    if (!sd) return false;
    seedOverride.current.set(sd.key, toSvgCoords(e));
    sd.moved = true;
    setTick((t) => t + 1);
    return true;
  }
  async function seedPointerUp() {
    const sd = seedRef.current;
    if (!sd) return false;
    seedRef.current = null;
    if (!sd.moved) {
      // A stationary press on the dot is a click — select the room, same as
      // clicking its cell.
      await handleBubbleClick(sd.spaceId, sd.idx);
      return true;
    }
    // Inverse-map the dropped seed to CONCEPT coordinates and save it as the
    // room's pin. The local override holds the seed in place until the new
    // pin round-trips (cleared when `spaces` refetches).
    const space = byId.get(sd.spaceId);
    const root = byId.get(sd.rootId);
    const fr = interiorFrames?.get(sd.rootId);
    const n = nodesRef.current.get(`${sd.rootId}:0`);
    const ov = seedOverride.current.get(sd.key);
    if (!space || !root || !fr || !n || !ov) return true;
    const rad = ((n.rot || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = ov.x - n.x, dy = ov.y - n.y;
    const f = Math.sqrt(areaUnits(root) / fr.hullArea);
    const cx = fr.hc.x + (dx * cos + dy * sin) / f;
    const cy = fr.hc.y + (-dx * sin + dy * cos) / f;
    const patch = pinPatch(space, [sd.idx], () => ({ x: cx, y: cy, locked: true }));
    await commitPinPatch(space, patch, 'move room (interior)');
    return true;
  }

  // "Block up" — the Master plan → Building promotion. Rooms without a block
  // slot are laid out per floor as a packed grid centred on the building's
  // envelope (falling back to its blocked rooms' centroid, then the canvas
  // centre), ordered so strongly-linked rooms land next to each other. Floors
  // share the same origin so the storeys stack. One undoable step.
  async function blockUp(rootId) {
    const mine = (o) => (rootId == null ? rootIdOf(o.s) == null : rootIdOf(o.s) === rootId);
    const targets = instances.filter((o) => mine(o) && !blockPinsOf(o.s)[o.i]);
    if (!targets.length) return;
    const root = rootId != null ? byId.get(rootId) : null;
    const slot = root ? planPinsOf(root)[0] : null;
    let anchor = slot ? { x: slot.x, y: slot.y } : null;
    if (!anchor) {
      const placed = instances
        .filter((o) => mine(o) && blockPinsOf(o.s)[o.i])
        .map((o) => nodesRef.current.get(o.key))
        .filter(Boolean);
      anchor = placed.length
        ? { x: placed.reduce((t, n) => t + n.x, 0) / placed.length, y: placed.reduce((t, n) => t + n.y, 0) / placed.length }
        : { x: W / 2, y: H / 2 };
    }
    // Adjacency-greedy order: start with the largest room, then repeatedly
    // append the room with the most declared links into what's already placed
    // — the concept graph reused as a one-shot seeding heuristic.
    const linkSet = new Set(adjacencies.flatMap((l) => [`${l.space_a}:${l.space_b}`, `${l.space_b}:${l.space_a}`]));
    const orderRooms = (list) => {
      const left = [...list].sort((a, b) => areaUnits(b.s) - areaUnits(a.s));
      const out = [];
      while (left.length) {
        let bestI = 0, bestScore = -1;
        for (let i = 0; i < left.length; i++) {
          const score = out.reduce((t, p) => t + (linkSet.has(`${left[i].s.id}:${p.s.id}`) ? 1 : 0), 0);
          if (score > bestScore) { bestScore = score; bestI = i; }
        }
        out.push(left.splice(bestI, 1)[0]);
      }
      return out;
    };
    // Shelf-packed grid per level, centred on the anchor.
    const gap = planGrid ? Math.min(planGrid.minorStep, 14) : 10;
    const byLevel = new Map();
    for (const o of targets) {
      const k = (o.s.level || '').trim();
      if (!byLevel.has(k)) byLevel.set(k, []);
      byLevel.get(k).push(o);
    }
    const moved = [];
    for (const list of byLevel.values()) {
      const ordered = orderRooms(list);
      const sides = ordered.map((o) => Math.sqrt(areaUnits(o.s)));
      const rowW = Math.max(Math.sqrt(sides.reduce((t, s) => t + s * s, 0)) * 1.35, ...sides);
      const rows = [];
      let x = 0, y = 0, rowH = 0, row = [];
      ordered.forEach((o, i) => {
        const side = sides[i];
        if (x > 0 && x + side > rowW + 1e-6) {
          rows.push({ row, w: x - gap, y });
          y += rowH + gap;
          x = 0; rowH = 0; row = [];
        }
        row.push({ o, side, x, y });
        x += side + gap;
        rowH = Math.max(rowH, side);
      });
      rows.push({ row, w: x - gap, y });
      const totalH = y + rowH;
      for (const r of rows) {
        for (const it of r.row) {
          const n = nodesRef.current.get(it.o.key);
          if (!n) continue;
          n.x = anchor.x - r.w / 2 + it.x + it.side / 2;
          n.y = anchor.y - totalH / 2 + it.y + it.side / 2;
          moved.push(it.o.key);
        }
      }
    }
    setTick((t) => t + 1);
    await savePlanKeys(moved); // Building env → writes block_json, one undo step
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
    // On an environment switch, drop the live layout so every room re-seeds from
    // the new environment's positions (its cache, else its persisted layout).
    if (seededEnvRef.current !== env) {
      nodes.clear();
      seededEnvRef.current = env;
    }
    const cache = layoutCache.get(cacheKeyFor(env));
    const keys = new Set(instances.map((o) => o.key));
    for (const key of [...nodes.keys()]) if (!keys.has(key)) nodes.delete(key);

    // 1. Seed placed + cached nodes first so new rooms can be placed relative to
    //    the rooms that already have a home.
    const pending = [];
    const pendingKeys = new Set();
    instances.forEach((o) => {
      if (nodes.has(o.key)) return;
      const pin = persistedPos(o.s, o.i);
      const cached = cache?.get(o.key);
      // rot / w / h ride along on the node (authored placement orientation + size);
      // they are only ever set for placed footprints (Master plan / Building).
      const src = pin || cached;
      if (src) nodes.set(o.key, { x: src.x, y: src.y, rot: src.rot || 0, w: src.w, h: src.h, a: src.a, vx: 0, vy: 0 });
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
  }, [spaces, env]);

  // Persist the current layout when leaving the tab / switching projects, under
  // the active environment's key (stashLayout mirrors this on an env switch).
  useEffect(() => {
    const key = cacheKeyFor(env);
    return () => {
      const m = new Map();
      for (const [k, n] of nodesRef.current) m.set(k, { x: n.x, y: n.y, rot: n.rot || 0, w: n.w, h: n.h, a: n.a });
      layoutCache.set(key, m);
    };
  }, [project.id, env]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Master plan is authored, not simulated — the force sim is off there so
  // nothing drifts. Concept (and Building's fallback) keep the sim.
  useSimulation({ enabled: caps.sim, instances, leaves, adjacencies, byId, autoRunRef, setAutoRunning, nodesRef, alphaRef, dragRef, relaxRef, radiusOf, instPin, groupKey, clusterKey, nodeForce, buildingForce, setTick });

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
  function onSvgPointerDown(e) {
    if (layerPointerDown(e)) return; // scale-click / move / rotate a layer — useImageLayers
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
    if (polyPointerMove(e)) return; // vertex drag — handled by usePolyEditing
    if (rotPointerMove(e)) return; // rotating a placed footprint
    if (resizePointerMove(e)) return; // area-lock resizing a building box
    if (seedPointerMove(e)) return; // dragging an interior room seed
    if (layerPointerMove(e)) return; // move / rotate a layer — handled by useImageLayers
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
      // Group drag: translate every selected node by the same delta. When snap is
      // on the delta lands on the grid, so the group moves in whole steps while
      // keeping its internal arrangement (Alt = finer).
      const doSnap = caps.snap && snapGrid; // group drag latches to the grid only
      const dx = doSnap ? snapToGrid(x - drag.anchor.x, e.altKey) : x - drag.anchor.x;
      const dy = doSnap ? snapToGrid(y - drag.anchor.y, e.altKey) : y - drag.anchor.y;
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
    // The grab offset is applied first so the point under the cursor stays put.
    const rawX = drag.offset ? x + drag.offset.x : x;
    const rawY = drag.offset ? y + drag.offset.y : y;
    let tx = rawX, ty = rawY;
    if (caps.snap && (snapEdges || snapGrid)) {
      // Snap each axis to a neighbour's edge/centre when close (with a guide line),
      // else to the metric grid — each snap type is independently toggleable. The
      // dragged box's own half-extents are the offsets, so its EDGES and CORNERS
      // latch onto neighbours (flush side-by-side, aligned, stacked).
      const half = footHalf(byId.get(drag.spaceId), node);
      const nb = neighbourEdges(drag.key);
      const gx = resolveAxis(rawX, half.x, nb.x, e.altKey, snapEdges, snapGrid);
      const gy = resolveAxis(rawY, half.y, nb.y, e.altKey, snapEdges, snapGrid);
      tx = gx.val; ty = gy.val;
      // Bounded guide segments: a vertical line at the aligned x spanning just the
      // dragged box and its matched neighbour (and likewise horizontally).
      const guides = [];
      if (gx.cand) guides.push({ x: gx.cand.at, y0: Math.min(ty - half.y, gx.cand.c - gx.cand.h), y1: Math.max(ty + half.y, gx.cand.c + gx.cand.h) });
      if (gy.cand) guides.push({ y: gy.cand.at, x0: Math.min(tx - half.x, gy.cand.c - gy.cand.h), x1: Math.max(tx + half.x, gy.cand.c + gy.cand.h) });
      alignRef.current = guides;
    }
    drag.moved += Math.hypot(tx - node.x, ty - node.y);
    node.x = tx;
    node.y = ty;
    setTick((t) => t + 1);
  }

  async function onUp() {
    if (polyPointerUp()) return; // vertex drag release — handled by usePolyEditing
    if (await rotPointerUp()) return; // rotate release — persist plan_json rot
    if (await resizePointerUp()) return; // box resize release — persist w/h to block_json
    if (await seedPointerUp()) return; // seed drop — save the room's concept pin
    if (marqueeRef.current) {
      finishMarquee();
      return;
    }
    if (await layerPointerUp()) return; // move / rotate layer release — useImageLayers
    if (panRef.current) {
      commitView(viewRef.current);
      panRef.current = null;
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    alphaRef.current = Math.max(alphaRef.current, 0.3);
    if (alignRef.current.length) { alignRef.current = []; setTick((t) => t + 1); } // drop the alignment guides
    if (!drag) return;
    if (drag.starts) {
      // Group drag: save every moved room where it was dropped (one undo step).
      if (drag.moved >= 6) {
        if (isStatic) {
          await savePlanKeys(drag.starts.map((s) => s.key)); // authored — no relaxation
        } else {
          relaxRef.current = { frames: 40, hold: drag.groupSet }; // neighbours yield at the drop
          await pinKeys(drag.starts.map((s) => s.key));
        }
      }
      return;
    }
    const space = byId.get(drag.spaceId);
    if (!space) return;
    if (drag.moved >= 6) {
      if (isStatic) {
        // Authored env: the drop IS the position (plan_json / block_json), the sim
        // is off, and neighbours never yield.
        await savePlanPos(space, drag.idx);
        return;
      }
      // Dragging SAVES the room's position (so it stays where you drop it and
      // reloads there) but does NOT lock it — locking is deliberate (Pin / P).
      relaxRef.current = { frames: 40, hold: new Set([drag.key]) }; // neighbours yield at the drop
      await saveDragPos(space, drag.idx);
      return;
    }
    await handleBubbleClick(drag.clickAs?.spaceId ?? drag.spaceId, drag.clickAs?.idx ?? drag.idx);
  }

  // `clickAs` (optional {spaceId, idx}) redirects a CLICK's selection while the
  // drag still moves `o` — a Voronoi cell drags its building's envelope, but a
  // plain click on it selects the ROOM the cell stands for.
  function onBubbleDown(e, o, clickAs = null) {
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
    let starts = null, anchor = null, groupSet = null, offset = null;
    if (groupKeys) {
      anchor = toSvgCoords(e);
      groupSet = new Set(groupKeys);
      starts = groupKeys
        .map((k) => {
          const n = nodesRef.current.get(k);
          return n ? { key: k, x: n.x, y: n.y } : null;
        })
        .filter(Boolean);
    } else {
      // Keep the grab point under the cursor: without this the bubble's CENTRE
      // snaps to the cursor on the first move — a visible jump when grabbed
      // near its edge. (Group drags already move by deltas from `anchor`.)
      const n = nodesRef.current.get(o.key);
      const p = toSvgCoords(e);
      if (n) offset = { x: n.x - p.x, y: n.y - p.y };
    }
    dragRef.current = { key: o.key, spaceId: o.s.id, idx: o.i, moved: 0, starts, anchor, groupSet, offset, clickAs };
  }

  function commitView(v) {
    clearTimeout(debouncers.current.view);
    debouncers.current.view = setTimeout(() => saveProject({ view_x: v.x, view_y: v.y }, { silent: true }), 500);
  }

  // Glide the view to a target pan (Recentre) instead of jumping. Honours
  // prefers-reduced-motion by snapping straight to the target.
  const viewTweenRef = useRef(null);
  useEffect(() => () => cancelAnimationFrame(viewTweenRef.current), []);
  function animateViewTo(target) {
    cancelAnimationFrame(viewTweenRef.current);
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setView(target);
      commitView(target);
      return;
    }
    const from = { ...viewRef.current };
    const dur = 260;
    const t0 = performance.now();
    const stepTween = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - p) ** 3; // ease-out cubic
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
      if (p < 1) viewTweenRef.current = requestAnimationFrame(stepTween);
      else commitView(target);
    };
    viewTweenRef.current = requestAnimationFrame(stepTween);
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

  async function removeSelLink() {
    if (!selLink) return;
    await setLinkStrength(selLink.space_a, selLink.space_b, null);
    applySel(linking.clearSelLink);
  }

  // Clicking a link selects it (Select mode) → shows the link action bar.
  // Aggregated building-to-building links (envelope master plan) are derived,
  // not stored — there is nothing to edit, so they don't select.
  const onLinkClick = (l) => {
    if (String(l.id).startsWith('agg:')) return;
    applySel((s) => linking.selectLink(s, l));
  };

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
      // Every persisted layout follows the zoom — concept pins AND the
      // authored plan/block slots (including building envelopes), for every
      // space row. Slot extras (rot, drawn area `a` in project units) are
      // scale-independent and ride along unchanged.
      const pinUpdates = [];
      for (const s of spaces) {
        const fields = {};
        const pins = pinsOf(s);
        if (Object.keys(pins).length) {
          const np = {};
          for (const [i, p] of Object.entries(pins)) {
            np[i] = p.locked ? { ...tx(p), locked: true } : tx(p);
            pinOverride.current.set(`${s.id}:${i}`, np[i]);
          }
          fields.pin_json = JSON.stringify(np);
          fields.pin_x = null;
          fields.pin_y = null;
        }
        for (const [col, parser] of [['plan_json', planPinsOf], ['block_json', blockPinsOf]]) {
          const slots = parser(s);
          if (!Object.keys(slots).length) continue;
          const np = {};
          for (const [i, p] of Object.entries(slots)) np[i] = { ...p, ...tx(p) };
          fields[col] = JSON.stringify(np);
        }
        if (Object.keys(fields).length) pinUpdates.push({ id: s.id, fields });
      }
      // Image layers zoom about the same anchor so they stay aligned with bubbles.
      const imageUpdates = imgLayers.map((im) => {
        const c = tx({ x: W / 2 + (im.x || 0), y: H / 2 + (im.y || 0) });
        return { id: im.id, x: c.x - W / 2, y: c.y - H / 2 };
      });
      try {
        for (const u of pinUpdates) await api.updateSpace(u.id, u.fields);
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

  // ---------- PDF sheets ----------
  // A sheet is one environment's drawing, built from PERSISTED layouts (the
  // live node map only for the environment currently on screen) — so the
  // drawing set can be exported from any env. Per-env defaults: the concept
  // sheet is NTS with no site image/north; master plan and building sheets
  // are scaled with the title block, scale bar and north arrow.
  function sheetObjects(kind, floor) {
    if (kind === 'masterplan') return mpUnits;
    if (kind === 'building' && floor != null) return leaves.filter((s) => (s.level || '').trim() === floor);
    return leaves;
  }
  function sheetPos(kind, s, i) {
    if (kind === env) {
      const n = nodesRef.current.get(`${s.id}:${i}`);
      if (n) return n;
    }
    if (kind === 'building') return blockPinsOf(s)[i] ?? planPinsOf(s)[i] ?? pinsOf(s)[i] ?? null;
    if (kind === 'masterplan') return planPinsOf(s)[i] ?? pinsOf(s)[i] ?? null;
    return pinsOf(s)[i] ?? null;
  }
  // A drawn outline (room poly or building envelope) as absolute sheet verts.
  const sheetPoly = (s, area, pos) => {
    if (!(s.shape === 'poly' && parsePoly(s))) return null;
    const pts = outlinePoints(parsePoly(s), 14);
    const k = polygonArea(pts) || 1;
    const f = Math.sqrt(area / k);
    const a = ((pos.rot || 0) * Math.PI) / 180;
    const c = Math.cos(a), sn = Math.sin(a);
    return pts.map((p) => {
      const x = p.x * f, y = p.y * f;
      return { x: pos.x + x * c - y * sn, y: pos.y + x * sn + y * c };
    });
  };
  // A building box as its (possibly rotated) rectangle corners.
  const sheetBoxPoly = (area, pos) => {
    const aspect = pos.w > 0 && pos.h > 0 ? pos.w / pos.h : 1;
    const bh = Math.sqrt(area / aspect), bw = aspect * bh;
    const a = ((pos.rot || 0) * Math.PI) / 180;
    const c = Math.cos(a), sn = Math.sin(a);
    return [[-bw / 2, -bh / 2], [bw / 2, -bh / 2], [bw / 2, bh / 2], [-bw / 2, bh / 2]]
      .map(([x, y]) => ({ x: pos.x + x * c - y * sn, y: pos.y + x * sn + y * c }));
  };
  async function buildSheetScene(kind, { floor = null } = {}) {
    const objects = sheetObjects(kind, floor);
    const metric = kind !== 'concept' && !!effScale;
    const maxRel = Math.max(...objects.map(ea), 1);
    const radius = (s) => (metric
      ? Math.max(7, Math.sqrt(areaToM2(ea(s), units) / Math.PI) / effScale)
      : 16 + 50 * Math.sqrt(ea(s) / maxRel));
    const bubbles = [];
    for (const s of objects) {
      const count = Math.max(1, s.count || 1);
      for (let i = 0; i < count; i++) {
        const pos = sheetPos(kind, s, i);
        if (!pos) continue;
        const r = radius(s);
        const area = Math.PI * r ** 2;
        const poly = kind === 'building'
          ? sheetBoxPoly(area, pos)
          : kind === 'masterplan' ? sheetPoly(s, area, pos) : null;
        bubbles.push({
          x: pos.x, y: pos.y, r,
          box: false,
          poly,
          color: colorOf(s),
          opacity: project.bubble_opacity ?? 0.32,
          label: s.name + (count > 1 ? ` ${i + 1}` : ''),
          sublabel: fmtArea(ea(s), units),
        });
      }
    }
    if (bubbles.length === 0) return null;

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

    // Site image layers belong to the master plan sheet only.
    const sceneLayers = [];
    if (kind === 'masterplan') {
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
    }

    // Relationship lines belong to the concept sheet (the other sheets are
    // dimensioned drawings, not diagrams). Endpoints resolve per-sheet.
    const links = kind !== 'concept' ? [] : adjacencies
      .map((l) => {
        const sa = byId.get(l.space_a);
        const sb = byId.get(l.space_b);
        if (!sa || !sb) return null;
        const a = sheetPos(kind, sa, 0);
        const b = sheetPos(kind, sb, 0);
        if (!a || !b) return null;
        return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, strength: l.strength };
      })
      .filter(Boolean);

    const ratioLabel = metric ? scaleLabelFor(effScale) : 'NTS';
    const sheet =
      kind === 'concept' ? 'Concept diagram'
      : kind === 'masterplan' ? (hasBuildings ? 'Master plan — building envelopes' : 'Master plan')
      : floor != null ? `Building — ${floor}` : 'Building massing';
    return {
      bounds,
      layers: sceneLayers,
      links,
      bubbles,
      bubbleStyle,
      scale: metric ? { ratioLabel, scaleBar: scaleBar ? { lenUnits: scaleBar.len, label: scaleBar.label } : null } : null,
      north: metric ? { deg: project.north_deg || 0 } : null,
      title: {
        name: project.name,
        client: project.client,
        stage: project.stage,
        sheet,
        scaleLabel: ratioLabel,
        date: new Date().toISOString().slice(0, 10),
      },
    };
  }

  // Export the CURRENT environment as one sheet (env-correct defaults).
  async function exportPdf() {
    setError(null);
    try {
      const floor = isBuilding && levels.includes(floorMode) ? floorMode : null;
      const scene = await buildSheetScene(env, { floor });
      if (!scene) return setError('Nothing to export yet.');
      // Dynamic import keeps jsPDF out of the initial bundle.
      const { exportDiagramPdf } = await import('../pdfExport.js');
      exportDiagramPdf(scene);
    } catch (err) {
      setError(`PDF export failed: ${err.message}`);
    }
  }

  // Export the DRAWING SET: concept sheet, master plan sheet (once anything is
  // placed) and one sheet per floor (once anything is blocked up), in one PDF.
  async function exportSet() {
    setError(null);
    try {
      const anySlot = (list, parser) => list.some((s) => Object.keys(parser(s)).length > 0);
      const sheets = [];
      const push = async (kind, opts) => {
        const sc = await buildSheetScene(kind, opts);
        if (sc) sheets.push(sc);
      };
      await push('concept');
      if (anySlot(mpUnits, planPinsOf)) await push('masterplan');
      if (anySlot(leaves, blockPinsOf)) {
        if (levels.length >= 2) for (const lvl of levels) await push('building', { floor: lvl });
        else await push('building');
      }
      if (!sheets.length) return setError('Nothing to export yet.');
      const { exportDrawingSet } = await import('../pdfExport.js');
      exportDrawingSet({ sheets, fileName: `${project.name.replace(/[^\w-]+/g, '_')}_drawing_set.pdf` });
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

  // Master-plan placement: an instance (room or building envelope) is "placed"
  // once it has a plan_json slot. Un-placed units still seed at their concept
  // position, but render as ghosts and list in the placement tray until
  // dropped (or "Place"-d) onto the site — placing a building also seeds its
  // envelope outline (see envelopeSeed).
  const placedKeys = new Set();
  const unplacedRooms = []; // [{ space, keys[] }] grouped by space
  if (isMasterplan) {
    const planCache = new Map();
    const planOf = (s) => { if (!planCache.has(s.id)) planCache.set(s.id, planPinsOf(s)); return planCache.get(s.id); };
    const bySpace = new Map();
    for (const o of instances) {
      if (planOf(o.s)[o.i]) { placedKeys.add(o.key); continue; }
      if (!bySpace.has(o.s.id)) bySpace.set(o.s.id, { space: o.s, keys: [] });
      bySpace.get(o.s.id).keys.push(o.key);
    }
    for (const v of bySpace.values()) unplacedRooms.push(v);
  }
  // Placing writes plan_json at the room's current (seeded) position — the same
  // authored write a drag makes, so a ghost becomes a solid placed footprint.
  const placeRooms = (keys) => savePlanKeys(keys);
  const placeAll = () => savePlanKeys(unplacedRooms.flatMap((r) => r.keys));

  // Building promotion tray: rooms without a block_json slot, grouped by
  // building — each group offers "Block up" (the per-floor grid seeder above).
  const unblockedGroups = []; // [{ rootId, name, count }]
  if (isBuilding) {
    const byRoot = new Map();
    for (const o of instances) {
      if (blockPinsOf(o.s)[o.i]) continue;
      const root = rootContainer(o.s, byId);
      const key = root ? root.id : null;
      if (!byRoot.has(key)) byRoot.set(key, { rootId: key, name: root ? root.name : 'Unassigned', count: 0 });
      byRoot.get(key).count++;
    }
    unblockedGroups.push(...byRoot.values());
  }

  // Pipeline status under the env switcher — how far each stage of the
  // brief → site → massing progression has got, independent of the current env.
  const slotStats = (list, parser) => {
    let placed = 0, total = 0;
    for (const s of list) {
      const pins = parser(s);
      const c = Math.max(1, s.count || 1);
      total += c;
      for (let i = 0; i < c; i++) if (pins[i]) placed++;
    }
    return { placed, total };
  };
  const leafInstCount = leaves.reduce((t, s) => t + Math.max(1, s.count || 1), 0);
  const mpStats = slotStats(mpUnits, planPinsOf);
  const blockStats = slotStats(leaves, blockPinsOf);
  const envStatus = {
    concept: `${leafInstCount} room${leafInstCount === 1 ? '' : 's'}`,
    masterplan: `${mpStats.placed}/${mpStats.total} placed`,
    building: `${blockStats.placed}/${blockStats.total} blocked`,
  };

  // Focus fade: with a building focused (stacking rail), everything else dims.
  const focusCheck = isBuilding && focusBuilding != null ? (s) => rootIdOf(s) === focusBuilding : null;

  // The master plan's envelopes drawn under the Building env as fixed context
  // — rooms are arranged inside their building's footprint. Only meaningful at
  // a real scale (the relative bubble sizing has no shared unit with them).
  const envelopeUnderlays = isBuilding && effScale
    ? buildingRoots
        .map((c) => {
          const slot = planPinsOf(c)[0];
          if (!slot || !(c.shape === 'poly' && parsePoly(c))) return null;
          return {
            id: c.id, name: c.name,
            x: slot.x, y: slot.y, rot: slot.rot || 0,
            verts: polyVertsOf(c),
            focused: focusBuilding === c.id,
          };
        })
        .filter(Boolean)
    : null;

  // Envelope feasibility readout: drawn vs required GROSS footprint per
  // building (the biggest storey plus its circulation share).
  const envelopeBadge = isEnvelope
    ? (s) => (isContainerKind(s) ? { drawn: ea(s), required: footprintGrossPU(s) } : null)
    : null;
  const selEnvelope =
    isEnvelope && selected != null && isContainerKind(byId.get(selected) || {})
      ? {
          drawn: ea(byId.get(selected)),
          required: footprintGrossPU(byId.get(selected)),
          circ: circOf(byId.get(selected)),
        }
      : null;

  // Per-env empty-state hint (dismissible per project+env for the session).
  const hintKey = `${project.id}:${env}`;
  let envHint = null;
  if (!hintDismissed[hintKey]) {
    if (isMasterplan && imgLayers.length === 0 && !displayScale) {
      envHint = {
        text: 'The master plan is a scaled site drawing — add a site plan or satellite image and calibrate it (or pick a drawing scale) to place footprints at real sizes.',
        action: { label: '⧉ Open layers', run: () => setPanel('layers') },
      };
    } else if (isBuilding && levels.length < 2) {
      envHint = { text: 'All rooms are on one level — assign levels in the Brief to unlock per-floor editing, the stacking readout and the 3-D massing view.' };
    } else if (isConcept && adjacencies.length === 0) {
      envHint = { text: 'No relationships declared yet — press L (Link tool), then click two rooms to say they belong near each other.' };
    } else if (isConcept && mpStats.placed === 0) {
      // Next stage in the pipeline: the relationships exist but nothing is on
      // the site yet — point at the Master plan.
      envHint = {
        text: 'Relationships in place? The next step is the Master plan — put the buildings on the scaled site.',
        action: { label: '▱ Master plan', run: () => switchEnv('masterplan') },
      };
    } else if (isMasterplan && mpStats.total > 0 && mpStats.placed === mpStats.total && blockStats.placed === 0) {
      envHint = {
        text: 'Everything is placed on the site — next, block the rooms up into floors in the Building environment.',
        action: { label: '▤ Building', run: () => switchEnv('building') },
      };
    }
  }

  // Adjacency compliance — how well the current layout honours the declared
  // relationships. Needs a real scale (gaps are judged in metres). Positional,
  // so it is NOT computed on the chrome render path: the toolbar badge
  // recomputes it on throttled sim ticks (AdjacencyBadge) and the SVG derives
  // unmet links per tick inside the TickLayer, only while highlighting.
  // Concept is scale-free, so its adjacency reading is graded in diagram
  // units against the sim's own rest gaps (CONCEPT_THRESHOLDS_U) — a link is
  // "met" when its bubbles sit where the springs put them. Master plan /
  // Building grade the real edge-to-edge gap in metres (needs a scale). Same
  // scorer, different gap unit + threshold.
  // The envelope master plan draws buildings, not rooms — room-to-room links
  // roll up into building-to-building pseudo-links (read-only), drawn between
  // the envelopes and graded like any other metric link. Rooms outside a
  // building keep their own links. Everywhere else this is just `adjacencies`.
  const mpUnitIdOf = (s) => rootContainer(s, byId)?.id ?? s.id;
  const displayAdjacencies = isEnvelope ? aggregateByRoot(adjacencies, byId, mpUnitIdOf) : adjacencies;

  const computeAdjacency = () => {
    const metric = !isConcept && effScale;
    if (!isConcept && !effScale) return adjacencyScore([]); // metric needs a scale
    const links = displayAdjacencies
      .map((l) => {
        const sa = byId.get(l.space_a);
        const sb = byId.get(l.space_b);
        if (!sa || !sb) return null;
        const pair = closestPair(sa, sb);
        if (!pair) return null;
        const gapU = edgeGap(pair.d, radiusOf(sa), radiusOf(sb));
        return { id: l.id, strength: l.strength, gap: metric ? gapU * effScale : gapU };
      })
      .filter(Boolean);
    // Scale-free: judge against the Concept sim's rest gaps (see adjacency.js).
    return adjacencyScore(links, metric ? undefined : { thresholds: CONCEPT_THRESHOLDS_U });
  };
  // Concept grades against the sim's rest gaps (no scale needed); Master plan /
  // Building grade metrically (needs a real scale). The envelope master plan
  // grades the rolled-up building-to-building links — hidden when every link
  // is internal to one building (nothing to grade between envelopes).
  const showScore = displayAdjacencies.length > 0 && (isConcept || !!effScale);

  // ---- Floor view: all together / one level / stacked isometric planes ----
  // Each floor is a flat plane shown isometrically. 'offset' raises each storey
  // onto its own plane (a stacked 3D look); 'overlaid' puts them all on the same
  // plane (superimposed) to compare footprints.
  const levelOf = (s) => (s.level || '').trim();
  // Storey-height helpers (the levelHeights map + lvlHRef live above the
  // empty-state returns with the other hooks). A space's own height_m
  // overrides its storey's clear height — that's how double-height and
  // multi-floor volumes are declared.
  const heightOfLevel = (label) => (Number(levelHeights[label]) > 0 ? Number(levelHeights[label]) : DEFAULT_STOREY_M);
  const roomHeightM = (s) => (Number(s.height_m) > 0 ? Number(s.height_m) : heightOfLevel(levelOf(s)));
  // Debounced save; a ref accumulates edits to several levels within the window.
  const setLevelHeight = (label, v) => {
    const cur = lvlHRef.current ?? { ...levelHeights };
    const n = Number(v);
    if (n > 0) cur[label] = n; else delete cur[label];
    lvlHRef.current = cur;
    clearTimeout(debouncers.current.lvlh);
    debouncers.current.lvlh = setTimeout(() => {
      saveProject({ level_heights: JSON.stringify(cur) });
      lvlHRef.current = null;
    }, 400);
  };
  const stackMode = hasLevels && (floorMode === 'offset' || floorMode === 'overlaid');
  // In non-stack modes, levelVisible filters which storey is shown. The stacked
  // view renders its own isometric scene below (stackScene), so the normal
  // hull/link/bubble passes are skipped while it's active.
  const levelVisible = (s) => !hasLevels || floorMode === 'all' || levelOf(s) === floorMode;
  const rankOf = (s) => levelRank.get(levelOf(s)) ?? 0;

  // Scene builders live in diagram/scenes.js (pure, unit-testable). These
  // thin wrappers feed them the component's live helpers; they are called
  // inside the canvas TickLayer so they read fresh node positions each frame.
  // Building focus carries into the stacked/3-D views: only the focused
  // building's rooms are modelled (the whole program otherwise).
  const sceneInstances = focusCheck ? instances.filter((o) => focusCheck(o.s)) : instances;

  const makeStackScene = () =>
    buildStackScene({ nodes, instances: sceneInstances, levels, levelRank, radiusOf, levelOf, floorMode, floorGap, stackCam, palette: PALETTE });

  // The 3-D massing view is not tied to multi-floor programs — a single-storey
  // brief extrudes at its real heights too. Multi-level-only modes (per-floor
  // editing, stacked offset/overlaid) stay behind hasLevels. levels3d /
  // levelRank3d live above the empty-state returns with the other hooks.
  const is3D = isBuilding && floorMode === '3d';
  const rankOf3d = (s) => levelRank3d.get(levelOf(s)) ?? 0;

  const make3DScene = () => {
    let groundImage = null;
    if (stackImages) {
      const im = imgLayers.find((x) => x.visible && x.image);
      const r = im ? layerRect(im) : null;
      if (im && r) groundImage = { href: im.image, x: r.x, y: r.y, w: r.w, h: r.h };
    }
    return build3DScene({
      nodes, instances: sceneInstances, levels: levels3d, levelRank: levelRank3d, radiusOf, levelOf, palette: PALETTE,
      adjacencies, byId, rankOf: rankOf3d, shapeOf, polyVertsOf, colorOf, groundImage,
      // Envelope outlines ground the massing on its master-plan footprint(s).
      envelopes: envelopeUnderlays?.filter((e) => !focusCheck || e.focused) ?? null,
      // Real storey heights: metres → diagram units (needs the drawing scale).
      mToU: effScale ? 1 / effScale : null,
      levelHeightM: heightOfLevel,
      roomHeightM,
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
  // In the envelope master plan only containers and floating rooms have drawn
  // geometry — a room selected via its interior cell (or the rail) gets the
  // data actions (area, category, delete) but no outline editing.
  const selIsDrawn =
    !isEnvelope || !selectedSpace || isContainerKind(selectedSpace) || !rootContainer(selectedSpace, byId);
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
  // Per-floor gross area per building — the Building rail's stacking readout.
  // Ordered top floor → ground so the bars read as a vertical stack. Each
  // building carries its root id (rail click → canvas focus) and its envelope
  // fit — the biggest storey against the master plan's drawn footprint.
  const rootIdByName = new Map(
    leaves.map((s) => { const r = rootContainer(s, byId); return r ? [r.name, r.id] : null; }).filter(Boolean)
  );
  const stackData = hasLevels
    ? [...areaTree.entries()].map(([building, lvlMap]) => {
        const rows = [...lvlMap.entries()].map(([lvl, list]) => ({
          lvl: lvl || 'Unassigned',
          raw: lvl,
          area: list.reduce((t, s) => t + (s.count || 1) * ea(s), 0),
        }));
        rows.sort((a, b) => (levelRank.get(b.raw) ?? -1) - (levelRank.get(a.raw) ?? -1));
        const rootId = rootIdByName.get(building) ?? null;
        const root = rootId != null ? byId.get(rootId) : null;
        const drawn = root ? ea(root) : null;
        const maxRow = Math.max(...rows.map((r) => r.area), 0);
        // The biggest storey must fit the envelope WITH its circulation share.
        const circ = root ? circOf(root) : 0;
        return {
          building,
          rootId,
          rows,
          total: rows.reduce((t, r) => t + r.area, 0),
          envelope: root ? { drawn, circ, over: maxRow / (1 - circ) > drawn + 0.5 } : null,
        };
      })
    : [];

  // Adjacency strength tallies for the rail header (e.g. "6 req · 10 des").
  const reqCount = adjacencies.filter((l) => l.strength === 'required').length;
  const desCount = adjacencies.length - reqCount;

  return (
    <div
      className={`diagram-layout ${split ? '' : 'norail'}`}
      style={{ '--rail-w': `${railW}px` }}
    >
      {showHelp && <HelpPanel env={env} onClose={() => setShowHelp(false)} />}
      {showMatrix && (
        <MatrixPanel leaves={leaves} adjacencies={adjacencies} colorOf={colorOf} onCycle={cyclePair} onClose={() => setShowMatrix(false)} />
      )}

      <div className="diagram-main">
        <div className="bubble-stage" ref={stageRef}>
          {/* Stage chrome: the topbar, its popovers and the under-bar row
              (tray · hint · north rose) stack in ONE flow column so they can
              never draw over each other, however narrow the stage gets. */}
          <div className="stage-chrome">
          <StageTopbar
            env={env}
            onEnv={switchEnv}
            envStatus={envStatus}
            showLayers={caps.layers === 'edit'}
            hasBuildings={hasBuildings}
            colorBy={colorBy}
            setPref={setPref}
            hasLevels={hasLevels}
            floorMode={floorMode}
            levels={levels}
            show3DToggle={isBuilding && !hasLevels}
            is3D={is3D}
            onToggle3D={() => setPref('floorView', is3D ? 'all' : '3d')}
            showScale={caps.scaleUi}
            scaleValue={scaleValue}
            presets={presets}
            fitScale={fitScale}
            onScaleSelect={onScaleSelect}
            interiorLevels={isEnvelope && interior && levels.length >= 2 ? levels : null}
            interiorLevel={interiorStorey ?? ''}
            onInteriorLevel={(v) => setPref('interiorLevel', v)}
            panel={panel}
            setPanel={setPanel}
            history={history}
            showScore={showScore}
            tickStore={tickStore}
            computeAdjacency={computeAdjacency}
            adjDataKey={`${env}:${adjacencies.length}:${spaces.length}:${effScale ?? 0}`}
            highlightGaps={highlightGaps}
            onToggleGaps={() => setHighlightGaps((v) => !v)}
            onExportPng={exportPng}
            onExportPdf={exportPdf}
            onExportSet={exportSet}
            onHelp={() => setShowHelp(true)}
          />

          {panel === 'more' && (
            <MorePopover
              onMatchHulls={isEnvelope ? matchAllEnvelopesToHulls : null}
              showForces={caps.forces}
              nodeForce={nodeForce}
              buildingForce={buildingForce}
              setPref={setPref}
              nudgeLayout={nudgeLayout}
              bubbleStyle={bubbleStyle}
              setBubbleStyle={setBubbleStyle}
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
          {error && (
            <StagePopover className="error" onClose={() => setError(null)}>
              {error}
            </StagePopover>
          )}

          {caps.layers === 'edit' && panel === 'layers' && (
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

          {caps.layers === 'edit' && panel === 'sat' && (
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

          {caps.layers === 'edit' && scalePoints && (
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

          {/* Under-bar row: tool dock · placement tray (left) · env hint
              (centred) · north rose (right). In flow below whatever the
              topbar/popovers occupy. */}
          <div className="stage-underbar">
            <ToolDock
              tool={tool}
              onTool={(t) => applySel((s) => linking.setTool(s, t))}
              autoRunning={autoRunning}
              onAutoLayout={runAutoLayout}
              showAutoLayout={caps.autoLayout}
              showSnap={caps.snap}
              snapEdges={snapEdges}
              snapGrid={snapGrid}
              onToggleSnapEdges={() => setPref('snapEdges', !snapEdges)}
              onToggleSnapGrid={() => setPref('snapGrid', !snapGrid)}
              showInterior={isEnvelope}
              interior={interior}
              onToggleInterior={() => setPref('interior', !interior)}
              onRecentre={() => animateViewTo({ x: 0, y: 0 })}
            />

            {/* Placement tray — units not yet drawn on the site (building
                envelopes, or rooms in a flat program). Each seeds at its
                concept position as a ghost; "Place" (or dragging it) authors
                it into plan_json — and seeds a building's envelope outline. */}
            {isMasterplan && unplacedRooms.length > 0 && (
              <div className="place-tray">
                <div className="place-tray-head">
                  <span className="place-tray-title">Unplaced · {unplacedRooms.reduce((t, r) => t + r.keys.length, 0)}</span>
                  <button className="place-all" onClick={placeAll}>Place all</button>
                </div>
                <div className="place-tray-list">
                  {unplacedRooms.map((r) => (
                    <button
                      key={r.space.id}
                      className="place-row"
                      onClick={() => placeRooms(r.keys)}
                      onMouseEnter={() => (hoverRef.current = { space: r.space, idx: 0 })}
                      title={`Place ${r.space.name} on the site${isContainerKind(r.space) ? ' (seeds its envelope outline)' : ''}`}
                    >
                      <span className="place-dot" style={{ background: colorOf(r.space) }} />
                      <span className="place-name">{isContainerKind(r.space) ? '🏢 ' : ''}{r.space.name}{r.keys.length > 1 ? ` ×${r.keys.length}` : ''}</span>
                      <span className="place-cta">Place</span>
                    </button>
                  ))}
                </div>
                <div className="place-tray-hint">or drag a ghost onto the site</div>
              </div>
            )}

            {/* Block-up tray — rooms without a Building-env slot yet, grouped
                by building. Block up lays each building's rooms out per floor
                as a packed grid at its envelope, adjacency-ordered. */}
            {isBuilding && unblockedGroups.length > 0 && (
              <div className="place-tray">
                <div className="place-tray-head">
                  <span className="place-tray-title">Not blocked up · {unblockedGroups.reduce((t, g) => t + g.count, 0)}</span>
                  {unblockedGroups.length > 1 && (
                    <button className="place-all" onClick={async () => { for (const g of unblockedGroups) await blockUp(g.rootId); }}>
                      Block up all
                    </button>
                  )}
                </div>
                <div className="place-tray-list">
                  {unblockedGroups.map((g) => (
                    <button
                      key={g.rootId ?? 'floating'}
                      className="place-row"
                      onClick={() => blockUp(g.rootId)}
                      title={`Lay out ${g.name}'s rooms per floor at its envelope`}
                    >
                      <span className="place-name">🏢 {g.name} ×{g.count}</span>
                      <span className="place-cta">Block up</span>
                    </button>
                  ))}
                </div>
                <div className="place-tray-hint">seeds a per-floor grid — linked rooms land together</div>
              </div>
            )}

            <div className="stage-underbar-mid">
              {/* Per-env empty-state hint — what this environment needs. */}
              {envHint && (
                <div className="env-hint">
                  <span className="env-hint-text">{envHint.text}</span>
                  {envHint.action && (
                    <button className="btn small" onClick={envHint.action.run}>{envHint.action.label}</button>
                  )}
                  <button
                    className="env-hint-close"
                    onClick={() => setHintDismissed((m) => ({ ...m, [hintKey]: true }))}
                    title="Dismiss"
                    aria-label="Dismiss hint"
                  >✕</button>
                </div>
              )}
            </div>

            {/* North orientation is a site concern — hidden in scale-free Concept. */}
            {caps.north && <NorthRose deg={project.north_deg || 0} onSet={setNorth} />}
          </div>
          </div>

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
            warnOverlaps={isStatic}
            adjActive={showScore}
            verticalAdj={isBuilding && !stackMode && levels.includes(floorMode)}
            showRotate={caps.rotate === 'free'}
            showResize={caps.resize}
            ghostUnplaced={isMasterplan}
            placedKeys={placedKeys}
            focusCheck={focusCheck}
            envelopeUnderlays={envelopeUnderlays}
            envelopeBadge={envelopeBadge}
            makeInterior={makeInterior}
            onSeedDown={seedHandleDown}
            onCellDown={cellPointerDown}
            alignGuides={alignRef}
            planGrid={snapGrid ? planGrid : null}
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
            adjacencies={displayAdjacencies}
            byId={byId}
            imgLayers={caps.layers === 'none' ? [] : imgLayers}
            selected={selected}
            selectedInst={selectedInst}
            multi={multi}
            selLink={selLink}
            editShape={editShape}
            marquee={marquee}
            scalePoints={scalePoints}
            moveLayer={moveLayer}
            rotateLayer={rotateLayer}
            scaleBar={caps.scaleUi ? scaleBar : null}
            attributionLayer={caps.layers === 'none' ? null : attributionLayer}
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
            onRotateHandleDown={rotHandleDown}
            onResizeHandleDown={resizeHandleDown}
            onLinkClick={onLinkClick}
            onPolyVertexDown={onPolyVertexDown}
            addPolyVertex={addPolyVertex}
            removePolyVertex={removePolyVertex}
            onCycleCorner={cycleCornerStyle}
            hoverRef={hoverRef}
          />

          {(hasLevels || is3D) && floorMode !== 'all' && (
            <div className="floor-caption">
              {stackMode
                ? (floorMode === 'offset' ? '▤ Floors — offset' : '▤ Floors — overlaid')
                : is3D ? '▲ 3-D massing'
                : `▤ ${floorMode}`}
              {(stackMode || is3D) && <span className="floor-caption-sub">view only — {hasLevels ? 'switch to a single floor to edit' : 'toggle 3-D off to edit'}</span>}
            </div>
          )}

          {/* One contextual action bar (bottom-centre) — or the hint when
              nothing is selected. */}
          <SelectionHud
            showShapeTools={caps.shapeTools && selIsDrawn}
            showRotate90={caps.rotate === '90'}
            onRotate90={rotate90}
            showPin={caps.pin}
            showHeight={isBuilding}
            heightOf={roomHeightM}
            onHeight={(space, v) => commitSpace(space, { height_m: Number(v) > 0 ? Number(v) : null }, 'set height')}
            envelope={selEnvelope}
            onEnvelopeArea={saveEnvelopeArea}
            onEnvelopeHull={matchEnvelopeToHull}
            onEnvelopeCirc={(space, v) =>
              commitSpace(
                space,
                { circ_pct: v === '' ? null : Math.min(60, Math.max(0, Number(v) || 0)) / 100 },
                'set circulation'
              )}
            onSetCorners={setCornerStyleAll}
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
            onMultiCustomShape={multiCustomShape}
            catDraft={catDraft}
            setCatDraft={setCatDraft}
            onMultiSetCategory={multiSetCategory}
            onMultiDelete={multiDelete}
            departments={departments}
            selectedSpace={selectedSpace}
            selectedInst={selectedInst}
            instPin={instPin}
            editShape={editShape}
            colorOf={colorOf}
            ea={ea}
            units={units}
            onPin={savePin}
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
          stackData={stackData}
          stackLevels={hasLevels ? levels : null}
          levelHeightOf={heightOfLevel}
          onLevelHeight={setLevelHeight}
          floorMode={floorMode}
          onPickFloor={(lvl) => setPref('floorView', lvl || 'all')}
          focusBuilding={focusBuilding}
          onFocusBuilding={(id) => setFocusBuilding((cur) => (cur === id ? null : id))}
          grouping={colorBy === 'building' && hasBuildings ? 'building' : 'category'}
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
