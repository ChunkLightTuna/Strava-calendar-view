// Strava OAuth + API client — fully in-browser ("bring your own app").
// The visitor supplies their own Strava API application's client ID/secret;
// both stay in localStorage and are only ever sent to strava.com, which
// permits CORS on its OAuth and API endpoints.

const LS = {
  creds: 'scv.credentials',
  token: 'scv.token',
  cachePrefix: 'scv.cache.',
};

const CURRENT_MONTH_TTL_MS = 15 * 60 * 1000;

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
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch { /* no body */ }
      if (res.status === 429) throw new Error('Strava rate limit reached — try again in ~15 minutes.');
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Strava rejected the request (${res.status}${detail ? `: ${detail}` : ''}). ` +
          'This usually means the authorization is missing activity permissions — click "Connect Strava" ' +
          'and re-authorize, keeping the "View data about your activities" checkboxes ticked.');
      }
      throw new Error(`Strava API error (${res.status}${detail ? `: ${detail}` : ''}).`);
    }
    const batch = await res.json();
    all.push(...batch.map(compact));
    if (batch.length < 200) break;
  }
  return all;
}

// Fetch a calendar month's activities, with a localStorage cache: past months
// are stable and cached indefinitely; the current month refreshes after a
// short TTL or on demand (force=true).
export async function activitiesForMonth(year, month, { force = false } = {}) {
  const key = `${LS.cachePrefix}${year}-${String(month + 1).padStart(2, '0')}`;
  const now = Date.now();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);
  const isPast = monthEnd.getTime() < now;

  const cached = readJson(key);
  if (cached && !force && (isPast || now - cached.fetchedAt < CURRENT_MONTH_TTL_MS)) {
    return cached.activities;
  }
  if (monthStart.getTime() > now) return []; // future month — nothing to fetch

  // Pad a day each side so timezone offsets between UTC epochs and the
  // athlete's local days can't drop edge activities; render filters by day.
  const after = Math.floor(monthStart.getTime() / 1000) - 86400;
  const before = Math.floor(monthEnd.getTime() / 1000) + 86400;
  const activities = await fetchRange(after, before);
  writeJson(key, { fetchedAt: now, activities });
  return activities;
}
