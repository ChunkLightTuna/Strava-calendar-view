// Deterministic sample data so visitors can see the calendar without
// connecting anything. Seeded PRNG keeps the demo stable across reloads.

function mulberry32(seed) {
  return function next() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEMPLATES = [
  { type: 'Run', names: ['Morning Run', 'Lunch Run', 'Evening Run', 'Tempo Tuesday', 'Long Run'], km: [4, 21], pace: 330 },
  { type: 'Ride', names: ['Morning Ride', 'Commute', 'Gravel Loop', 'Sunday Spin'], km: [15, 90], pace: 110 },
  { type: 'Swim', names: ['Pool Swim', 'Open Water'], km: [1, 3], pace: 1500 },
  { type: 'Hike', names: ['Ridge Hike', 'Forest Walk'], km: [5, 14], pace: 700 },
  { type: 'WeightTraining', names: ['Gym Session', 'Strength'], km: [0, 0], pace: 0 },
  { type: 'Kayaking', names: ['River Paddle'], km: [5, 12], pace: 420 },
];

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
      activities.push({
        id: `demo-${id++}`,
        name: t.names[Math.floor(rand() * t.names.length)],
        type: t.type,
        start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), i === 0 ? 7 : 18, Math.floor(rand() * 50)).getTime(),
        distance,
        movingTime,
        elapsedTime: Math.round(movingTime * 1.06),
        elevation: t.type === 'Hike' || t.type === 'Ride' ? Math.round(km * (8 + rand() * 15)) : Math.round(km * 3),
      });
    }
  }
  return activities;
}
