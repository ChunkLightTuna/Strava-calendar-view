// intervals.icu API client — the free hub that auto-syncs from Garmin,
// COROS, Wahoo, Suunto, Polar, etc. Auth is a personal API key over HTTP
// Basic (username "API_KEY"); the API sends CORS headers, so a static site
// can call it directly. Docs: https://intervals.icu/settings (Developer).

import { makeMonthCache } from './monthcache.js';
import { toPolyline } from './routes.js';

const BASE = 'https://intervals.icu/api/v1';
const LS_CREDS = 'scv.icu';

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

export function getCredentials() { return readJson(LS_CREDS); }

export function setCredentials(athleteId, apiKey) {
  let id = String(athleteId).trim();
  if (/^\d+$/.test(id)) id = `i${id}`; // settings page shows ids like i12345
  try {
    localStorage.setItem(LS_CREDS, JSON.stringify({ athleteId: id, apiKey: String(apiKey).trim() }));
  } catch { /* private mode — works for the session via in-page state anyway */ }
}

export function isConnected() { return Boolean(getCredentials()?.apiKey); }

function authHeader() {
  return `Basic ${btoa(`API_KEY:${getCredentials().apiKey}`)}`;
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch { /* no body */ }
    if (res.status === 401 || res.status === 403) {
      throw new Error('intervals.icu rejected the API key — check it in Settings on intervals.icu (Developer Settings).');
    }
    if (res.status === 404) {
      throw new Error('intervals.icu athlete not found — check the Athlete ID (looks like i12345).');
    }
    if (res.status === 429) {
      throw new Error('intervals.icu rate limit reached — try again in a minute.');
    }
    throw new Error(`intervals.icu API error (${res.status}${detail ? `: ${detail}` : ''}).`);
  }
  return res.json();
}

function isoDate(epochS) {
  return new Date(epochS * 1000).toISOString().slice(0, 10);
}

function compact(a) {
  const distance = a.distance || 0;
  const movingTime = a.moving_time || 0;
  return {
    id: a.id,
    name: a.name || '',
    type: a.type || 'Workout',
    // start_date_local is wall-clock; anchor as-is like the Strava source
    start: Date.parse(String(a.start_date_local || a.start_date).replace(/Z$/, '')),
    distance,
    movingTime,
    elapsedTime: a.elapsed_time || 0,
    elevation: a.total_elevation_gain || 0,
    avgSpeed: a.average_speed || (distance && movingTime ? distance / movingTime : 0),
    maxSpeed: a.max_speed || 0,
    avgHr: a.average_heartrate || 0,
    maxHr: a.max_heartrate || 0,
    avgWatts: a.icu_average_watts ?? a.average_watts ?? 0,
    wWatts: a.icu_weighted_avg_watts ?? a.weighted_average_watts ?? 0,
    maxWatts: a.max_watts ?? 0,
    estWatts: false,
    polyline: null, // fetched on demand from the GPS stream
    url: `https://intervals.icu/activities/${a.id}`,
    routeSource: 'icu',
  };
}

async function fetchRange(afterEpochS, beforeEpochS) {
  const { athleteId } = getCredentials();
  const list = await apiGet(`/athlete/${encodeURIComponent(athleteId)}/activities` +
    `?oldest=${isoDate(afterEpochS)}&newest=${isoDate(beforeEpochS)}`);
  if (!Array.isArray(list)) throw new Error('Unexpected response from intervals.icu.');
  return list.map(compact).filter((a) => Number.isFinite(a.start));
}

export const activitiesForMonth = makeMonthCache('scv.icuCache.', fetchRange);

// GPS route for the detail map, from the activity's latlng stream.
export async function fetchRoute(activityId) {
  try {
    const streams = await apiGet(`/activity/${encodeURIComponent(activityId)}/streams?types=latlng`);
    const latlng = (Array.isArray(streams) ? streams : []).find((s) => s.type === 'latlng');
    const points = (latlng?.data ?? []).filter((p) => Array.isArray(p) && p.length === 2);
    return points.length >= 2 ? toPolyline(points) : null;
  } catch {
    return null; // no GPS (trainer ride, pool swim) or stream unavailable
  }
}
