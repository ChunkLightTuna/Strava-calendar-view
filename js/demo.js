// Deterministic sample data so visitors can see the calendar without
// connecting anything. Seeded PRNG keeps the demo stable across reloads.

import { encodePolyline } from './polyline.js';

function mulberry32(seed) {
  return function next() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEMPLATES = [
  { type: 'Run', names: ['Morning Run', 'Lunch Run', 'Evening Run', 'Tempo Tuesday', 'Long Run'], km: [4, 21], pace: 330, hr: [145, 172], watts: 0 },
  { type: 'Ride', names: ['Morning Ride', 'Commute', 'Gravel Loop', 'Sunday Spin'], km: [15, 90], pace: 110, hr: [130, 158], watts: [150, 240] },
  { type: 'Ride', names: ['Interval Session', 'Group Ride'], km: [30, 70], pace: 100, hr: [140, 165], watts: [180, 260] },
  { type: 'Swim', names: ['Pool Swim', 'Open Water'], km: [1, 3], pace: 1500, hr: [120, 145], watts: 0 },
  { type: 'Hike', names: ['Ridge Hike', 'Forest Walk'], km: [5, 14], pace: 700, hr: [95, 120], watts: 0 },
  { type: 'WeightTraining', names: ['Gym Session', 'Strength'], km: [0, 0], pace: 0, hr: [100, 125], watts: 0 },
  { type: 'Kayaking', names: ['River Paddle'], km: [5, 12], pace: 420, hr: [110, 135], watts: 0 },
];

// Wobbly loop around a start point, sized so its circumference roughly
// matches the activity distance. Good enough to demo the route map.
function demoRoute(rand, distanceM) {
  const startLat = 47.37 + (rand() - 0.5) * 0.1; // around Zürich
  const startLng = 8.54 + (rand() - 0.5) * 0.15;
  const radiusDeg = (distanceM / (2 * Math.PI)) / 111320; // meters → degrees lat
  const kx = Math.cos((startLat * Math.PI) / 180);
  const points = [];
  const n = 48;
  const phase = rand() * Math.PI * 2;
  const squish = 0.6 + rand() * 0.6;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble = 1 + 0.16 * Math.sin(3 * a + phase) + 0.09 * Math.sin(7 * a - phase);
    const r = radiusDeg * wobble;
    points.push([
      startLat + r * Math.sin(a) * squish,
      startLng + (r * Math.cos(a)) / kx,
    ]);
  }
  return encodePolyline(points);
}

export function demoActivities() {
  const rand = mulberry32(20260720);
  const activities = [];
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  let id = 1;
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const r = rand();
    if (r < 0.32) continue; // rest day
    const count = r > 0.92 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const t = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
      const km = t.km[0] + rand() * (t.km[1] - t.km[0]);
      const distance = Math.round(km * 1000);
      const movingTime = t.pace ? Math.round(km * t.pace * (0.9 + rand() * 0.2)) : Math.round(2400 + rand() * 2400);
      const avgHr = Math.round(t.hr[0] + rand() * (t.hr[1] - t.hr[0]));
      const avgWatts = t.watts ? Math.round(t.watts[0] + rand() * (t.watts[1] - t.watts[0])) : 0;
      activities.push({
        id: `demo-${id++}`,
        name: t.names[Math.floor(rand() * t.names.length)],
        type: t.type,
        start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), i === 0 ? 7 : 18, Math.floor(rand() * 50)).getTime(),
        distance,
        movingTime,
        elapsedTime: Math.round(movingTime * 1.06),
        elevation: t.type === 'Hike' || t.type === 'Ride' ? Math.round(km * (8 + rand() * 15)) : Math.round(km * 3),
        avgSpeed: distance && movingTime ? distance / movingTime : 0,
        maxSpeed: distance && movingTime ? (distance / movingTime) * (1.4 + rand() * 0.4) : 0,
        avgHr,
        maxHr: Math.round(avgHr * (1.1 + rand() * 0.08)),
        avgWatts,
        wWatts: avgWatts ? Math.round(avgWatts * (1.04 + rand() * 0.06)) : 0,
        maxWatts: avgWatts ? Math.round(avgWatts * (2.2 + rand() * 1.2)) : 0,
        estWatts: false,
        polyline: distance > 0 && t.type !== 'Swim' && t.type !== 'WeightTraining'
          ? demoRoute(rand, distance)
          : null,
      });
    }
  }
  return activities;
}
