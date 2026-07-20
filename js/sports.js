// Sport-type grouping, colors, and formatting helpers.
// Colors are categorical slots from a CVD-validated palette; each group keeps
// its slot regardless of which groups appear in a given month (color follows
// the entity, never its rank). Chips always carry a text label, so identity
// never depends on color alone.

const GROUPS = [
  { key: 'run',      label: 'Run',      icon: '\u{1F3C3}' },
  { key: 'ride',     label: 'Ride',     icon: '\u{1F6B4}' },
  { key: 'paddle',   label: 'Water',    icon: '\u{1F6A3}' },
  { key: 'walk',     label: 'Walk/Hike', icon: '\u{1F6B6}' },
  { key: 'swim',     label: 'Swim',     icon: '\u{1F3CA}' },
  { key: 'strength', label: 'Fitness',  icon: '\u{1F3CB}️' },
  { key: 'winter',   label: 'Winter',   icon: '⛷️' },
  { key: 'other',    label: 'Other',    icon: '⭐' },
];

const TYPE_TO_GROUP = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run', Treadmill: 'run', Wheelchair: 'run',
  Ride: 'ride', VirtualRide: 'ride', GravelRide: 'ride', MountainBikeRide: 'ride',
  EBikeRide: 'ride', EMountainBikeRide: 'ride', Handcycle: 'ride', Velomobile: 'ride',
  Kayaking: 'paddle', Rowing: 'paddle', VirtualRow: 'paddle', Canoeing: 'paddle',
  StandUpPaddling: 'paddle', Surfing: 'paddle', Kitesurf: 'paddle', Windsurf: 'paddle', Sail: 'paddle',
  Walk: 'walk', Hike: 'walk', RockClimbing: 'walk',
  Swim: 'swim',
  Workout: 'strength', WeightTraining: 'strength', Crossfit: 'strength', HighIntensityIntervalTraining: 'strength',
  Yoga: 'strength', Pilates: 'strength', Elliptical: 'strength', StairStepper: 'strength',
  AlpineSki: 'winter', BackcountrySki: 'winter', NordicSki: 'winter', RollerSki: 'winter',
  Snowboard: 'winter', IceSkate: 'winter', Snowshoe: 'winter',
};

export function sportGroup(type) {
  const normalized = String(type || '').replace(/[\s-]/g, '');
  const group = TYPE_TO_GROUP[normalized]
    ?? Object.entries(TYPE_TO_GROUP).find(([k]) => k.toLowerCase() === normalized.toLowerCase())?.[1]
    ?? 'other';
  return GROUPS.find((g) => g.key === group);
}

export function groupsInOrder() {
  return GROUPS;
}

// A group counts as "distance sport" when totals should lead with km/mi.
const DISTANCE_GROUPS = new Set(['run', 'ride', 'paddle', 'walk', 'swim', 'winter']);
export function isDistanceGroup(key) {
  return DISTANCE_GROUPS.has(key);
}

const M_PER_MI = 1609.344;

export function formatDistance(meters, units) {
  if (!meters) return null;
  if (units === 'imperial') {
    const mi = meters / M_PER_MI;
    return `${mi >= 100 ? Math.round(mi) : mi.toFixed(1)} mi`;
  }
  const km = meters / 1000;
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`;
}

export function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}

export function formatElevation(meters, units) {
  if (!meters) return null;
  if (units === 'imperial') return `${Math.round(meters * 3.28084)} ft`;
  return `${Math.round(meters)} m`;
}

export function formatPace(meters, seconds, units) {
  if (!meters || !seconds) return null;
  const perUnit = seconds / (units === 'imperial' ? meters / M_PER_MI : meters / 1000);
  const m = Math.floor(perUnit / 60);
  const s = Math.round(perUnit % 60);
  return `${m}:${String(s).padStart(2, '0')} /${units === 'imperial' ? 'mi' : 'km'}`;
}
