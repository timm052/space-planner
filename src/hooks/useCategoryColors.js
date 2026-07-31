import { useEffect, useMemo, useState } from 'react';
import { rootContainer, isContainerKind } from '../compute.js';
import { STATUS_LABEL, STATUS_HEX, STATUS_ORDER as STATUS_KEYS } from '../viz.js';

// Fixed default colours for the compliance-status colour mode (recolourable
// via the legend like any label). Sourced from viz.js so the diagram lens, the
// Brief lens and every data screen share ONE status palette. Hexes, not CSS
// vars — the canvas label-ink math needs literal colours.
const STATUS_COLORS = Object.fromEntries(STATUS_KEYS.map((k) => [STATUS_LABEL[k], STATUS_HEX[k]]));
const STATUS_ORDER = STATUS_KEYS.map((k) => STATUS_LABEL[k]); // label order for legend sort

/**
 * Colour + grouping logic for the diagram: how a room maps to a colour group
 * (by category or building), the spatial clustering key the force layout uses,
 * and the custom per-label colours (persisted JSON merged with optimistic
 * edits). Extracted verbatim from BubbleTab — no behaviour change.
 *
 * @param {object} params
 * @param {object}   params.project     - Current project (category_colors JSON, id).
 * @param {Array}    params.leaves      - Leaf spaces.
 * @param {Map}      params.byId        - Map<spaceId, space>.
 * @param {string}   params.colorBy     - 'department' | 'building'.
 * @param {boolean}  params.hasBuildings - Whether the program has buildings/groups.
 * @param {function} params.saveProject - Persist project fields (from useSpaceEditing).
 * @param {React.MutableRefObject} params.debouncers - Shared debounce-timer bag.
 * @param {string[]} params.palette     - Fallback colour palette.
 */
export function useCategoryColors({ project, leaves, byId, colorBy, statusOf = null, hasBuildings, saveProject, debouncers, palette }) {
  const [localColors, setLocalColors] = useState({}); // optimistic category colour overrides
  // Reset optimistic colours when switching projects (matches BubbleTab's
  // project-change reset for history + poly overrides).
  useEffect(() => setLocalColors({}), [project.id]);

  const groupKey = (s) => {
    // A building envelope (a container drawn in the master plan) is its own
    // group — it IS the building, whichever colour mode is active.
    if (isContainerKind(s)) return s.name;
    if (colorBy === 'status' && statusOf) return statusOf(s);
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
    if (isContainerKind(s)) return s.name;
    if (!hasBuildings) return s.department || 'General';
    const root = rootContainer(s, byId);
    return root ? root.name : 'Unassigned';
  };
  const groups = [...new Set(leaves.map(groupKey))];
  // Status groups read as a fixed scale, not encounter order.
  if (colorBy === 'status') groups.sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b));
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
    if (STATUS_COLORS[label]) return STATUS_COLORS[label];
    const i = groups.indexOf(label);
    if (i >= 0) return palette[i % palette.length];
    // Stable fallback for labels outside the current colour grouping (e.g. a
    // building name while colouring by category).
    let h = 0;
    for (let k = 0; k < label.length; k++) h = (h * 31 + label.charCodeAt(k)) | 0;
    return palette[Math.abs(h) % palette.length];
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

  return { groupKey, clusterKey, groups, departments, colorForLabel, colorOf, setCategoryColor };
}
