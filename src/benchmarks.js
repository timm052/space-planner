// Space-planning benchmarks — typical net-area allowances by building type.
// Values are m² (converted for ft² projects at display time). Indicative
// planning figures only, not code minima. `v` names the project variable the
// allowance is usually driven by (null = a fixed room allowance); the Brief
// tab builds a ready-to-paste formula from it.

export const BENCHMARKS = [
  {
    type: 'Workplace',
    items: [
      { label: 'Open-plan workstation', m2: 8, per: 'person', v: '@staff' },
      { label: 'Private office', m2: 12, per: 'person', v: '@offices' },
      { label: 'Meeting room (6–8 seats)', m2: 20, per: 'room', v: '@meetingRooms' },
      { label: 'Collaboration / breakout', m2: 2, per: 'person', v: '@staff' },
      { label: 'Reception & waiting', m2: 30, per: 'entry', v: null },
      { label: 'Server / comms room', m2: 15, per: 'floor', v: null },
    ],
  },
  {
    type: 'Library',
    items: [
      { label: 'Open collection', m2: 0.09, per: 'volume', v: '@volumes' },
      { label: 'Reading seat', m2: 3.3, per: 'seat', v: '@readerSeats' },
      { label: 'Public computer station', m2: 4, per: 'station', v: '@pcs' },
      { label: "Children's area", m2: 3, per: 'child seat', v: '@childSeats' },
      { label: 'Staff workroom', m2: 10, per: 'staff', v: '@staff' },
    ],
  },
  {
    type: 'School',
    items: [
      { label: 'General classroom', m2: 2, per: 'pupil', v: '@pupils' },
      { label: 'Science lab', m2: 2.8, per: 'pupil', v: '@labPupils' },
      { label: 'Assembly / multi-use hall', m2: 0.65, per: 'pupil', v: '@pupils' },
      { label: 'Library / resource centre', m2: 0.3, per: 'pupil', v: '@pupils' },
      { label: 'Staff room', m2: 3, per: 'teacher', v: '@teachers' },
    ],
  },
  {
    type: 'Healthcare',
    items: [
      { label: 'Consult / exam room', m2: 16, per: 'room', v: '@consultRooms' },
      { label: 'Single inpatient bedroom', m2: 25, per: 'bed', v: '@beds' },
      { label: 'Waiting area', m2: 1.4, per: 'person', v: '@waiting' },
      { label: 'Treatment room', m2: 18, per: 'room', v: '@treatRooms' },
    ],
  },
  {
    type: 'Residential',
    items: [
      { label: 'Studio apartment', m2: 37, per: 'unit', v: '@studios' },
      { label: '1-bed apartment (2 person)', m2: 50, per: 'unit', v: '@oneBeds' },
      { label: '2-bed apartment (4 person)', m2: 70, per: 'unit', v: '@twoBeds' },
      { label: 'Communal amenity', m2: 1, per: 'resident', v: '@residents' },
    ],
  },
  {
    type: 'Assembly',
    items: [
      { label: 'Auditorium (fixed seats)', m2: 0.8, per: 'seat', v: '@seats' },
      { label: 'Flat-floor hall (standing)', m2: 0.5, per: 'person', v: '@capacity' },
      { label: 'Dining (table service)', m2: 1.4, per: 'diner', v: '@diners' },
      { label: 'Commercial kitchen', m2: 0.35, per: 'diner', v: '@diners' },
      { label: 'Foyer / gathering', m2: 0.3, per: 'seat', v: '@seats' },
    ],
  },
];

// Parse a stored benchmark library (JSON text) into the canonical shape, or
// null when the text is missing/invalid/empty. Bad rows are dropped, not fatal:
// a hand-edited library shouldn't take the whole card down.
export function parseBenchmarks(text) {
  if (!text) return null;
  let raw;
  try { raw = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
  if (!Array.isArray(raw)) return null;
  const groups = raw
    .filter((g) => g && typeof g.type === 'string' && g.type.trim() && Array.isArray(g.items))
    .map((g) => ({
      type: g.type.trim(),
      items: g.items
        .filter((it) => it && typeof it.label === 'string' && it.label.trim() && Number.isFinite(Number(it.m2)) && Number(it.m2) > 0)
        .map((it) => ({
          label: it.label.trim(),
          m2: Number(it.m2),
          per: typeof it.per === 'string' && it.per.trim() ? it.per.trim() : 'unit',
          v: typeof it.v === 'string' && it.v.trim().startsWith('@') ? it.v.trim() : null,
        })),
    }))
    .filter((g) => g.items.length > 0);
  return groups.length > 0 ? groups : null;
}

// The library a project actually sees: its own override, else the app-settings
// library, else the built-ins.
export function effectiveBenchmarks(projectJson, settingsJson) {
  return parseBenchmarks(projectJson) || parseBenchmarks(settingsJson) || BENCHMARKS;
}

const FT2_PER_M2 = 10.7639;

// The benchmark value in the project's units, sensibly rounded.
export function benchValue(item, units) {
  const raw = units === 'ft2' ? item.m2 * FT2_PER_M2 : item.m2;
  return raw >= 10 ? Math.round(raw) : Math.round(raw * 100) / 100;
}

// A ready-to-paste area formula for the benchmark, in project units.
export function benchFormula(item, units) {
  const val = benchValue(item, units);
  return item.v ? `=${item.v} * ${val}` : `=${val}`;
}
