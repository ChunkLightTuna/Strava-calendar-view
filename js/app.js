// App controller: wires data sources (Strava API / CSV / demo) to the
// calendar renderer and handles all UI events.

import * as strava from './strava.js';
import { parseActivitiesCsv } from './csv.js';
import { renderCalendar, renderLegend, renderSummary, monthTitle } from './calendar.js';
import { demoActivities } from './demo.js';
import { openDetail, wireDetailModal } from './detail.js';
import { openZip } from './zip.js';
import { routeFromFile } from './routes.js';
import { renderStats } from './stats.js';

const LS_SETTINGS = 'scv.settings';
const LS_CSV = 'scv.csvData';
const LS_SOURCE = 'scv.source';

const $ = (id) => document.getElementById(id);

const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  source: null, // 'api' | 'csv' | 'demo'
  csvActivities: null,
  zip: null, // open export archive (this session only — File handles don't persist)
  zipRoot: '',
  routeCache: new Map(),
  demoData: null,
  sportFilter: 'all',
  settings: { units: 'imperial', weekStart: 0, theme: 'auto' },
};

// ---------- settings ----------

function loadSettings() {
  try {
    Object.assign(state.settings, JSON.parse(localStorage.getItem(LS_SETTINGS)) || {});
  } catch { /* defaults */ }
  applyTheme();
}

function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch { /* ok */ }
}

function applyTheme() {
  const { theme } = state.settings;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

// ---------- notices ----------

let noticeTimer;
function showNotice(message) {
  const node = $('notice');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { node.hidden = true; }, 12000);
}

// ---------- data ----------

async function activitiesForCurrentMonth({ force = false } = {}) {
  if (state.source === 'api') {
    return strava.activitiesForMonth(state.year, state.month, { force });
  }
  if (state.source === 'csv') return state.csvActivities ?? [];
  if (state.source === 'demo') return (state.demoData ??= demoActivities());
  return [];
}

// Any month's activities, for the statistics comparisons. API months come
// from the per-month cache; local sources are filtered in memory.
async function monthActivities(year, month) {
  if (state.source === 'api') {
    try { return await strava.activitiesForMonth(year, month); } catch { return []; }
  }
  const all = state.source === 'csv' ? (state.csvActivities ?? [])
    : state.source === 'demo' ? (state.demoData ??= demoActivities()) : [];
  return all.filter((a) => {
    const d = new Date(a.start);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

let statsSeq = 0;
async function renderStatsSection() {
  const mySeq = ++statsSeq;
  const container = $('stats');
  if (state.source === null) { container.replaceChildren(); return; }
  try {
    const block = await renderStats({
      year: state.year,
      month: state.month,
      units: state.settings.units,
      weekStart: Number(state.settings.weekStart),
      sportFilter: state.sportFilter,
      getMonth: monthActivities,
      onFilterChange: (value) => { state.sportFilter = value; renderStatsSection(); },
    });
    if (mySeq !== statsSeq) return; // superseded by a newer render
    container.replaceChildren(block);
  } catch { /* stats are best-effort; the calendar shows data errors */ }
}

let renderSeq = 0;
async function render({ force = false } = {}) {
  const seq = ++renderSeq;
  $('month-title').textContent = monthTitle(state.year, state.month);
  $('empty-state').hidden = state.source !== null;
  $('calendar-section').hidden = state.source === null;
  $('btn-refresh').hidden = state.source !== 'api';

  const badge = $('source-badge');
  badge.hidden = state.source === null;
  badge.textContent = { api: 'Strava API', csv: 'CSV export', demo: 'Demo data' }[state.source] ?? '';

  if (state.source === null) return;

  let activities = [];
  try {
    activities = await activitiesForCurrentMonth({ force });
  } catch (err) {
    showNotice(err.message || String(err));
  }
  if (seq !== renderSeq) return; // a newer render superseded this one

  const opts = {
    year: state.year,
    month: state.month,
    activities,
    units: state.settings.units,
    weekStart: Number(state.settings.weekStart),
    onActivityClick: async (activity) => {
      await resolveRoute(activity);
      openDetail(activity, state.settings.units);
    },
  };
  renderCalendar($('calendar'), opts);
  renderLegend($('legend'), activities.filter((a) => {
    const d = new Date(a.start);
    return d.getFullYear() === state.year && d.getMonth() === state.month;
  }));
  renderSummary($('summary'), opts);
  renderStatsSection();
}

function setSource(source) {
  state.source = source;
  try {
    if (source) localStorage.setItem(LS_SOURCE, source);
    else localStorage.removeItem(LS_SOURCE);
  } catch { /* ok */ }
  render();
}

// ---------- CSV loading ----------

function loadCsvText(text, { persist = true } = {}) {
  const activities = parseActivitiesCsv(text);
  state.csvActivities = activities;
  if (persist) {
    try { localStorage.setItem(LS_CSV, JSON.stringify(activities)); }
    catch { showNotice('Export loaded (too large to remember across reloads — re-drop the file next visit).'); }
  }
  const latest = activities[activities.length - 1];
  const d = new Date(latest.start);
  state.year = d.getFullYear();
  state.month = d.getMonth();
  setSource('csv');
  showNotice(`Loaded ${activities.length.toLocaleString()} activities from your export.`);
}

async function handleZip(file) {
  const zip = await openZip(file);
  const csvName = zip.entries.has('activities.csv')
    ? 'activities.csv'
    : [...zip.entries.keys()].find((n) => n.endsWith('/activities.csv'));
  if (!csvName) throw new Error('No activities.csv inside that archive — is it the Strava export ZIP?');
  const csvText = new TextDecoder().decode(await zip.extract(csvName));
  state.zip = zip;
  state.zipRoot = csvName.slice(0, csvName.length - 'activities.csv'.length);
  state.routeCache = new Map();
  loadCsvText(csvText);
  showNotice(`Loaded ${state.csvActivities.length.toLocaleString()} activities from your export — ` +
    'open an activity to see its route from the archive’s GPX/TCX/FIT files. ' +
    '(Routes need the ZIP: after a reload, drop it again.)');
}

function handleFile(file) {
  if (!file) return;
  const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
  const load = isZip ? handleZip(file) : file.text().then((text) => loadCsvText(text));
  load.catch((err) => showNotice(`Couldn't read that file: ${err.message || err}`));
}

// For CSV/ZIP activities the route lives in the archive; extract and parse it
// the first time that activity's detail view is opened.
async function resolveRoute(activity) {
  if (activity.polyline || !state.zip || !activity.file) return;
  if (state.routeCache.has(activity.file)) {
    activity.polyline = state.routeCache.get(activity.file);
    return;
  }
  let polyline = null;
  try {
    let name = state.zipRoot + activity.file;
    if (!state.zip.entries.has(name)) {
      name = [...state.zip.entries.keys()].find((n) => n.endsWith(activity.file)) ?? name;
    }
    polyline = await routeFromFile(activity.file, await state.zip.extract(name));
  } catch { /* unreadable route file — show stats without a map */ }
  state.routeCache.set(activity.file, polyline);
  activity.polyline = polyline;
}

// ---------- wiring ----------

function moveMonth(delta, { animate = false } = {}) {
  const d = new Date(state.year, state.month + delta, 1);
  state.year = d.getFullYear();
  state.month = d.getMonth();
  if (animate) {
    const cal = $('calendar');
    cal.classList.remove('slide-from-right', 'slide-from-left');
    void cal.offsetWidth; // restart the animation
    cal.classList.add(delta > 0 ? 'slide-from-right' : 'slide-from-left');
  }
  render();
}

function openConnectModal() {
  const creds = strava.getCredentials();
  $('input-client-id').value = creds?.clientId ?? '';
  $('input-client-secret').value = creds?.clientSecret ?? '';
  $('callback-domain').textContent = location.hostname || 'localhost';
  $('connect-modal').showModal();
}

function wireEvents() {
  $('btn-prev').addEventListener('click', () => moveMonth(-1));
  $('btn-next').addEventListener('click', () => moveMonth(1));
  $('btn-today').addEventListener('click', () => {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    render();
  });
  $('btn-refresh').addEventListener('click', () => render({ force: true }));

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, dialog')) return;
    if (e.key === 'ArrowLeft') moveMonth(-1);
    if (e.key === 'ArrowRight') moveMonth(1);
  });

  // Swipe left/right on the calendar to change months. Passive listeners and
  // a direction check keep vertical scrolling untouched.
  const cal = $('calendar');
  let swipeStart = null;
  cal.addEventListener('touchstart', (e) => {
    swipeStart = e.touches.length === 1
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
      : null;
  }, { passive: true });
  cal.addEventListener('touchend', (e) => {
    if (!swipeStart) return;
    const dx = e.changedTouches[0].clientX - swipeStart.x;
    const dy = e.changedTouches[0].clientY - swipeStart.y;
    const dt = Date.now() - swipeStart.t;
    swipeStart = null;
    if (dt > 600) return; // slow drag, not a swipe
    if (Math.abs(dx) < 60) return; // too short to be intentional
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // mostly a vertical scroll
    moveMonth(dx < 0 ? 1 : -1, { animate: true });
  }, { passive: true });
  cal.addEventListener('touchcancel', () => { swipeStart = null; }, { passive: true });
  cal.addEventListener('animationend', () => cal.classList.remove('slide-from-right', 'slide-from-left'));

  // Connect flow — an existing connection without activity scopes needs a
  // fresh authorization, so fall through to the modal in that case.
  const openConnect = () => {
    if (strava.isConnected() && strava.hasActivityScope()) { setSource('api'); return; }
    openConnectModal();
  };
  $('btn-connect').addEventListener('click', openConnect);
  $('btn-connect-hero').addEventListener('click', openConnect);
  $('connect-modal').addEventListener('close', () => {
    if ($('connect-modal').returnValue !== 'connect') return;
    strava.setCredentials($('input-client-id').value, $('input-client-secret').value);
    try {
      strava.beginAuthorization();
    } catch (err) {
      showNotice(err.message || String(err));
    }
  });

  // CSV flow
  const pickFile = () => $('file-input').click();
  $('btn-csv').addEventListener('click', pickFile);
  $('btn-csv-hero').addEventListener('click', pickFile);
  $('file-input').addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });

  // Drag & drop anywhere on the page
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    $('drop-overlay').hidden = false;
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('drop-overlay').hidden = true;
    handleFile(e.dataTransfer?.files?.[0]);
  });

  // Demo
  $('link-demo').addEventListener('click', (e) => {
    e.preventDefault();
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    setSource('demo');
  });

  // Settings
  $('btn-settings').addEventListener('click', () => {
    $('select-units').value = state.settings.units;
    $('select-week-start').value = String(state.settings.weekStart);
    $('select-theme').value = state.settings.theme;
    $('settings-modal').showModal();
  });
  const applySettingsFromForm = () => {
    state.settings.units = $('select-units').value;
    state.settings.weekStart = Number($('select-week-start').value);
    state.settings.theme = $('select-theme').value;
    saveSettings();
    applyTheme();
    render();
  };
  ['select-units', 'select-week-start', 'select-theme'].forEach((id) =>
    $(id).addEventListener('change', applySettingsFromForm));

  $('btn-diagnostics').addEventListener('click', async () => {
    const out = $('diag-output');
    out.hidden = false;
    out.textContent = 'Running…';
    if (!strava.isConnected()) {
      out.textContent = 'Not connected to Strava (CSV/demo data doesn’t use the API).';
      return;
    }
    const report = await strava.diagnostics();
    out.replaceChildren();
    const line = (text, ok) => {
      const div = document.createElement('div');
      div.className = ok === false ? 'diag-fail' : 'diag-ok';
      div.textContent = text;
      out.appendChild(div);
    };
    if (report.athlete) line(`Athlete: ${report.athlete}`);
    line(`Granted scopes: ${report.grantedScope}`);
    for (const c of report.checks) {
      line(`${c.name}: ${c.ok ? `OK (${c.status})` : `FAILED (${c.status}${c.message ? ` — ${c.message}` : ''})`}`, c.ok);
    }
  });

  $('btn-disconnect').addEventListener('click', () => {
    if (!confirm('Clear the Strava connection, saved credentials, and cached data from this browser?')) return;
    strava.disconnect();
    try { localStorage.removeItem(LS_CSV); localStorage.removeItem(LS_SOURCE); } catch { /* ok */ }
    state.csvActivities = null;
    $('settings-modal').close();
    setSource(null);
  });

  // Tooltips for activity chips
  const tooltip = $('tooltip');
  document.addEventListener('pointerover', (e) => {
    const chip = e.target.closest?.('[data-tooltip]');
    if (!chip) return;
    tooltip.innerHTML = chip.dataset.tooltip;
    tooltip.hidden = false;
    positionTooltip(e);
  });
  document.addEventListener('pointermove', (e) => {
    if (!tooltip.hidden && e.target.closest?.('[data-tooltip]')) positionTooltip(e);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest?.('[data-tooltip]')) tooltip.hidden = true;
  });
  function positionTooltip(e) {
    const pad = 14;
    const rect = tooltip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }
}

// ---------- startup ----------

async function init() {
  loadSettings();
  wireEvents();
  wireDetailModal();
  document.getElementById('btn-detail-close').addEventListener('click', () => $('detail-modal').close());

  let justConnected = false;
  try {
    justConnected = await strava.handleOAuthCallback();
  } catch (err) {
    showNotice(err.message || String(err));
  }

  let savedSource = null;
  try { savedSource = localStorage.getItem(LS_SOURCE); } catch { /* ok */ }

  if (justConnected && !strava.hasActivityScope()) {
    showNotice('Connected to Strava, but without permission to read activities — ' +
      'click "Connect Strava" again and keep the "View data about your activities" checkboxes ticked.');
  }
  if (justConnected || (savedSource === 'api' && strava.isConnected())) {
    setSource('api');
    return;
  }
  if (savedSource === 'csv') {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_CSV));
      if (Array.isArray(saved) && saved.length) {
        state.csvActivities = saved;
        setSource('csv');
        return;
      }
    } catch { /* fall through */ }
  }
  if (savedSource === 'demo') {
    setSource('demo');
    return;
  }
  render();
}

init();
