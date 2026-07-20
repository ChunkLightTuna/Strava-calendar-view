// Build complete activities from standalone GPX/TCX/FIT files — the export
// formats of Garmin, COROS, Wahoo, Suunto, and every other head unit. FIT
// files carry a session summary (sport, distance, time, HR, power); for
// GPX/TCX the stats are derived from the trackpoints.

import { gunzip, parseFitData, toPolyline } from './routes.js';

export function isActivityFile(name) {
  return /\.(gpx|tcx|fit)(\.gz)?$/i.test(name);
}

const FIT_EPOCH_OFFSET_S = 631065600; // 1989-12-31T00:00:00Z

const FIT_SPORTS = {
  1: 'Run', 2: 'Ride', 5: 'Swim', 10: 'Workout', 11: 'Walk', 12: 'NordicSki',
  13: 'AlpineSki', 14: 'Snowboard', 15: 'Rowing', 17: 'Hike', 19: 'Canoeing',
  21: 'EBikeRide', 30: 'InlineSkate', 31: 'RockClimbing', 32: 'Sail',
  33: 'IceSkate', 35: 'Snowshoe', 37: 'StandUpPaddling', 38: 'Surfing',
  41: 'Kayaking', 43: 'Windsurf', 44: 'Kitesurf',
};

const TYPE_WORDS = [
  [/run/i, 'Run'], [/(cycl|bik|ride)/i, 'Ride'], [/swim/i, 'Swim'],
  [/hik/i, 'Hike'], [/walk/i, 'Walk'], [/row/i, 'Rowing'], [/kayak/i, 'Kayaking'],
  [/ski/i, 'NordicSki'], [/snowboard/i, 'Snowboard'], [/strength|weight|gym/i, 'WeightTraining'],
];

function typeFromText(...candidates) {
  for (const text of candidates) {
    if (!text) continue;
    for (const [re, type] of TYPE_WORDS) {
      if (re.test(text)) return type;
    }
  }
  return 'Workout';
}

function haversineM([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// stats from a [lat, lon] track + parallel arrays of time(ms)/elevation(m)
function trackStats(points, times, eles) {
  const stats = { distance: 0, elapsedTime: 0, movingTime: 0, elevation: 0 };
  for (let i = 1; i < points.length; i++) {
    stats.distance += haversineM(points[i - 1], points[i]);
  }
  const t = times.filter((v) => v != null);
  if (t.length >= 2) {
    stats.elapsedTime = Math.round((t[t.length - 1] - t[0]) / 1000);
    for (let i = 1; i < t.length; i++) {
      const dt = (t[i] - t[i - 1]) / 1000;
      if (dt > 0 && dt <= 15) stats.movingTime += dt; // gaps count as paused
    }
    stats.movingTime = Math.round(stats.movingTime) || stats.elapsedTime;
  }
  const e = eles.filter((v) => v != null);
  for (let i = 1; i < e.length; i++) {
    const gain = e[i] - e[i - 1];
    if (gain > 0.5) stats.elevation += gain;
  }
  stats.elevation = Math.round(stats.elevation);
  return stats;
}

function average(list) {
  const vals = list.filter((v) => v != null && v > 0);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

function fromGpx(text, filename) {
  const points = [];
  const times = [];
  const eles = [];
  const hrs = [];
  for (const m of text.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const lat = /\blat="(-?[\d.]+)"/.exec(m[1]);
    const lon = /\blon="(-?[\d.]+)"/.exec(m[1]);
    if (!lat || !lon) continue;
    points.push([Number(lat[1]), Number(lon[1])]);
    const time = /<time>([^<]+)<\/time>/.exec(m[2]);
    times.push(time ? Date.parse(time[1]) : null);
    const ele = /<ele>(-?[\d.]+)<\/ele>/.exec(m[2]);
    eles.push(ele ? Number(ele[1]) : null);
    const hr = /<(?:\w+:)?hr>(\d+)<\/(?:\w+:)?hr>/.exec(m[2]);
    hrs.push(hr ? Number(hr[1]) : null);
  }
  if (points.length < 2) return null;
  const stats = trackStats(points, times, eles);
  const name = /<name>(?:<!\[CDATA\[)?([^<\]]+)/.exec(text)?.[1]?.trim();
  const typeTag = /<type>(?:<!\[CDATA\[)?([^<\]]+)/.exec(text)?.[1];
  const start = times.find((v) => v != null);
  if (!start) return null;
  return {
    name: name || '', type: typeFromText(typeTag, name, filename), start,
    ...stats,
    avgHr: Math.round(average(hrs)),
    maxHr: Math.max(0, ...hrs.filter((v) => v != null)),
    polyline: toPolyline(points),
  };
}

function fromTcx(text, filename) {
  const points = [];
  const times = [];
  const eles = [];
  const hrs = [];
  const watts = [];
  for (const m of text.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g)) {
    const block = m[1];
    const lat = /<LatitudeDegrees>(-?[\d.]+)</.exec(block);
    const lon = /<LongitudeDegrees>(-?[\d.]+)</.exec(block);
    if (lat && lon) points.push([Number(lat[1]), Number(lon[1])]);
    const time = /<Time>([^<]+)</.exec(block);
    times.push(time ? Date.parse(time[1]) : null);
    const ele = /<AltitudeMeters>(-?[\d.]+)</.exec(block);
    eles.push(ele ? Number(ele[1]) : null);
    const hr = /<HeartRateBpm>[\s\S]*?<Value>(\d+)</.exec(block);
    hrs.push(hr ? Number(hr[1]) : null);
    const w = /<(?:\w+:)?Watts>(\d+)</.exec(block);
    watts.push(w ? Number(w[1]) : null);
  }
  // lap summaries are authoritative when present
  let lapDist = 0;
  let lapTime = 0;
  for (const lap of text.matchAll(/<Lap\b[\s\S]*?<\/Lap>/g)) {
    lapTime += Number(/<TotalTimeSeconds>([\d.]+)</.exec(lap[0])?.[1] ?? 0);
    lapDist += Number(/<DistanceMeters>([\d.]+)</.exec(lap[0])?.[1] ?? 0);
  }
  const start = Date.parse(/<Id>([^<]+)<\/Id>/.exec(text)?.[1] ?? '') || times.find((v) => v != null);
  if (!start) return null;
  const stats = trackStats(points, times, eles);
  if (lapDist > 0) stats.distance = lapDist;
  if (lapTime > 0) { stats.movingTime = Math.round(lapTime); stats.elapsedTime ||= Math.round(lapTime); }
  if (!stats.distance && !stats.movingTime && !stats.elapsedTime) return null;
  const sport = /<Activity Sport="([^"]+)"/.exec(text)?.[1];
  return {
    name: '', type: typeFromText(sport, filename), start,
    ...stats,
    avgHr: Math.round(average(hrs)),
    maxHr: Math.max(0, ...hrs.filter((v) => v != null)),
    avgWatts: Math.round(average(watts)),
    maxWatts: Math.max(0, ...watts.filter((v) => v != null)),
    polyline: points.length >= 2 ? toPolyline(points) : null,
  };
}

function fromFit(bytes, filename) {
  const { points, session, firstTimestamp, lastTimestamp } = parseFitData(bytes);
  const startFit = session?.startTime ?? firstTimestamp;
  if (startFit == null) return null;
  const elapsed = session?.elapsed != null ? session.elapsed / 1000
    : (lastTimestamp != null && firstTimestamp != null ? lastTimestamp - firstTimestamp : 0);
  const timer = session?.timer != null ? session.timer / 1000 : elapsed;
  let distance = session?.distance != null ? session.distance / 100 : 0;
  if (!distance && points.length >= 2) {
    for (let i = 1; i < points.length; i++) distance += haversineM(points[i - 1], points[i]);
  }
  return {
    name: '',
    type: session?.sport != null ? (FIT_SPORTS[session.sport] ?? 'Workout') : typeFromText(filename),
    start: (startFit + FIT_EPOCH_OFFSET_S) * 1000,
    distance: Math.round(distance),
    movingTime: Math.round(timer),
    elapsedTime: Math.round(elapsed),
    elevation: session?.ascent ?? 0,
    avgHr: session?.avgHr ?? 0,
    maxHr: session?.maxHr ?? 0,
    avgWatts: session?.avgPower ?? 0,
    maxWatts: session?.maxPower ?? 0,
    polyline: toPolyline(points),
  };
}

// filename + raw bytes → normalized activity object (or null if unreadable)
export async function activityFromFile(filename, bytes) {
  let data = bytes;
  let name = filename.toLowerCase();
  if (name.endsWith('.gz')) {
    data = await gunzip(data);
    name = name.slice(0, -3);
  }
  let activity = null;
  if (name.endsWith('.fit')) activity = fromFit(data, filename);
  else if (name.endsWith('.gpx')) activity = fromGpx(new TextDecoder().decode(data), filename);
  else if (name.endsWith('.tcx')) activity = fromTcx(new TextDecoder().decode(data), filename);
  if (!activity || !Number.isFinite(activity.start)) return null;
  const base = filename.split('/').pop().replace(/\.(gpx|tcx|fit)(\.gz)?$/i, '');
  return {
    id: null,
    avgHr: 0,
    maxHr: 0,
    avgWatts: 0,
    maxWatts: 0,
    wWatts: 0,
    estWatts: false,
    maxSpeed: 0,
    elevation: 0,
    file: '',
    ...activity,
    name: activity.name || base,
    avgSpeed: activity.distance && activity.movingTime ? activity.distance / activity.movingTime : 0,
  };
}
