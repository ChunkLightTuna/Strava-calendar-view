// Strava OAuth + API client — fully in-browser ("bring your own app").
// The visitor supplies their own Strava API application's client ID/secret;
// both stay in localStorage and are only ever sent to strava.com, which
// permits CORS on its OAuth and API endpoints.

import { makeMonthCache } from './monthcache.js';

const LS = {
  creds: 'scv.credentials',
  token: 'scv.token',
  cachePrefix: 'scv.cache.',
};

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota — cache is optional */ }
}

export function getCredentials() { return readJson(LS.creds); }
export function setCredentials(clientId, clientSecret) {
  writeJson(LS.creds, { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() });
}
export function getToken() { return readJson(LS.token); }
export function isConnected() { return Boolean(getToken()?.refresh_token); }

export function disconnect() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('scv.')) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

function redirectUri() {
  return location.origin + location.pathname;
}

export function beginAuthorization() {
  const creds = getCredentials();
  if (!creds) throw new Error('No API credentials saved.');
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem('scv.oauthState', state);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    // force: always show the consent screen, so a re-connect can repair a
    // previous authorization that was granted without the activity scopes
    approval_prompt: 'force',
    scope: 'read,activity:read_all',
    state,
  });
  location.href = `https://www.strava.com/oauth/authorize?${params}`;
}

async function tokenRequest(body) {
  const creds = getCredentials();
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      ...body,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Strava token request failed (${res.status}). ${text.slice(0, 200)}`);
  }
  const token = await res.json();
  // Refresh responses don't echo the granted scope — carry it forward.
  const prev = getToken();
  if (prev?.grantedScope && !token.grantedScope) token.grantedScope = prev.grantedScope;
  writeJson(LS.token, token);
  return token;
}

// Strava appends the actually-granted scopes to the callback URL; the athlete
// can untick the activity checkboxes on the consent screen, in which case the
// token can never read activities (the API answers 401/403).
export function hasActivityScope() {
  const scope = getToken()?.grantedScope;
  return scope ? /activity:read/.test(scope) : true; // unknown → assume ok
}

// Call on page load: if we just came back from Strava with ?code=, finish the
// exchange and clean the URL. Returns true when a new connection was made.
export async function handleOAuthCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) {
    if (params.get('error')) {
      history.replaceState(null, '', redirectUri());
      throw new Error(`Strava authorization was declined (${params.get('error')}).`);
    }
    return false;
  }
  const expected = sessionStorage.getItem('scv.oauthState');
  sessionStorage.removeItem('scv.oauthState');
  const grantedScope = params.get('scope') || '';
  history.replaceState(null, '', redirectUri());
  if (expected && params.get('state') !== expected) {
    throw new Error('OAuth state mismatch — please try connecting again.');
  }
  await tokenRequest({ code, grant_type: 'authorization_code' });
  const token = getToken();
  if (token) { token.grantedScope = grantedScope; writeJson(LS.token, token); }
  return true;
}

async function accessToken() {
  let token = getToken();
  if (!token) throw new Error('Not connected to Strava.');
  if ((token.expires_at ?? 0) * 1000 < Date.now() + 5 * 60 * 1000) {
    token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
  }
  return token.access_token;
}

// Turn a Strava API error response into a message that names the actual
// problem. The important case: Strava deactivates API applications whose
// owner has no active Strava subscription (a Developer Program requirement
// since ~2026), and reports it only as an opaque 403.
async function interpretApiError(res) {
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  const errors = body?.errors ?? [];
  const detail = [body?.message, ...errors.map((e) => `${e.resource}.${e.field}: ${e.code}`)]
    .filter(Boolean).join('; ');

  if (res.status === 429) {
    return new Error('Strava rate limit reached — try again in ~15 minutes.');
  }
  if (errors.some((e) => e.resource === 'Application' && e.field === 'Status' && e.code === 'Inactive')) {
    return new Error('Your Strava API application is inactive. Strava requires the app owner to have ' +
      'an active Strava subscription for API access — subscribe and reactivate the app at ' +
      'strava.com/settings/api. No subscription? Load your Strava export CSV instead ' +
      '(Strava Settings → My Account → Download Request) — that works without one.');
  }
  if (errors.some((e) => /activity/.test(e.field ?? '') || e.field === 'access_token')
      || res.status === 401 || res.status === 403) {
    return new Error(`Strava rejected the request (${res.status}${detail ? `: ${detail}` : ''}). ` +
      'If this mentions permissions, click "Connect Strava" and re-authorize, keeping the ' +
      '"View data about your activities" checkboxes ticked.');
  }
  return new Error(`Strava API error (${res.status}${detail ? `: ${detail}` : ''}).`);
}

// Probe the connection: what did Strava grant, and which endpoints work?
// /athlete needs only the 'read' scope; /athlete/activities needs activity:read.
export async function diagnostics() {
  const report = {
    athlete: getToken()?.athlete ? `${getToken().athlete.firstname ?? ''} ${getToken().athlete.lastname ?? ''}`.trim() : null,
    grantedScope: getToken()?.grantedScope || '(not recorded — authorized before this feature)',
    checks: [],
  };
  let token;
  try {
    token = await accessToken();
  } catch (err) {
    report.checks.push({ name: 'Token refresh', status: '—', ok: false, message: err.message });
    return report;
  }
  for (const [name, url] of [
    ['Profile (read scope)', 'https://www.strava.com/api/v3/athlete'],
    ['Activities (activity:read scope)', 'https://www.strava.com/api/v3/athlete/activities?per_page=1'],
  ]) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      let message = '';
      if (!res.ok) {
        try {
          const body = await res.json();
          message = [body.message, ...(body.errors ?? []).map((e) => `${e.resource}.${e.field}: ${e.code}`)].filter(Boolean).join('; ');
        } catch { /* no body */ }
      }
      report.checks.push({ name, status: res.status, ok: res.ok, message });
    } catch (err) {
      report.checks.push({ name, status: 'network', ok: false, message: err.message });
    }
  }
  return report;
}

function compact(activity) {
  return {
    id: activity.id,
    name: activity.name,
    type: activity.sport_type || activity.type,
    // start_date_local is the athlete's wall-clock time; anchor it as-is so
    // the activity lands on the day the athlete experienced.
    start: Date.parse(String(activity.start_date_local).replace(/Z$/, '')),
    distance: activity.distance || 0,
    movingTime: activity.moving_time || 0,
    elapsedTime: activity.elapsed_time || 0,
    elevation: activity.total_elevation_gain || 0,
    avgSpeed: activity.average_speed || 0,
    maxSpeed: activity.max_speed || 0,
    avgHr: activity.average_heartrate || 0,
    maxHr: activity.max_heartrate || 0,
    avgWatts: activity.average_watts || 0,
    wWatts: activity.weighted_average_watts || 0,
    maxWatts: activity.max_watts || 0,
    // device_watts=false means Strava estimated the power figures
    estWatts: activity.average_watts ? activity.device_watts === false : false,
    polyline: activity.map?.summary_polyline || null,
  };
}

async function fetchRange(afterEpochS, beforeEpochS) {
  const token = await accessToken();
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({
      after: String(afterEpochS), before: String(beforeEpochS),
      per_page: '200', page: String(page),
    });
    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await interpretApiError(res);
    const batch = await res.json();
    all.push(...batch.map(compact));
    if (batch.length < 200) break;
  }
  return all;
}

export const activitiesForMonth = makeMonthCache(LS.cachePrefix, fetchRange);
