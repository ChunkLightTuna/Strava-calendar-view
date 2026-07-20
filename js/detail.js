// Activity detail modal: route map + full stats. Leaflet (+ OpenStreetMap
// tiles) is loaded lazily from CDN only when an activity with a route is
// opened; if that fails (offline, blocked CDN) we fall back to a plain SVG
// outline of the route.

import { decodePolyline } from './polyline.js';
import {
  sportGroup, formatDistance, formatDuration, formatElevation,
  formatPace, formatSpeed, formatHr, formatWatts,
} from './sports.js';

const LEAFLET_VERSION = '1.9.4';
let leafletPromise = null;
let map = null;
let routeLayer = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const fail = (why) => { leafletPromise = null; reject(new Error(why)); };
      const timer = setTimeout(() => fail('Leaflet load timed out'), 6000);
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
      document.head.appendChild(css);
      const script = document.createElement('script');
      script.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
      script.onload = () => { clearTimeout(timer); resolve(window.L); };
      script.onerror = () => { clearTimeout(timer); fail('Leaflet failed to load'); };
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

function routeSvg(points) {
  // Equirectangular projection, scaled so the route keeps its shape.
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((latMid * Math.PI) / 180);
  const xs = points.map((p) => p[1] * kx);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxLat - minLat, 1e-6);
  const size = 260;
  const scale = (size - 24) / Math.max(w, h);
  const d = points.map((p, i) => {
    const x = 12 + (p[1] * kx - minX) * scale + (size - 24 - w * scale) / 2;
    const y = 12 + (maxLat - p[0]) * scale + (size - 24 - h * scale) / 2;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join('');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'route-svg');
  svg.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  return svg;
}

async function renderMap(container, encodedPolyline) {
  const points = decodePolyline(encodedPolyline);
  if (points.length < 2) { container.hidden = true; return; }
  container.hidden = false;
  container.replaceChildren();
  try {
    const L = await loadLeaflet();
    map = L.map(container, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    routeLayer = L.polyline(points, { color: '#eb6834', weight: 4, opacity: 0.9 }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [20, 20] });
  } catch {
    container.appendChild(routeSvg(points)); // offline/CDN-blocked fallback
  }
}

function destroyMap() {
  if (map) { map.remove(); map = null; routeLayer = null; }
}

function statRows(activity, units) {
  const group = sportGroup(activity.type);
  const speedLed = group.key === 'ride' || group.key === 'winter' || group.key === 'paddle';
  return [
    ['Distance', formatDistance(activity.distance, units)],
    ['Moving time', formatDuration(activity.movingTime)],
    ['Elapsed time', activity.elapsedTime !== activity.movingTime ? formatDuration(activity.elapsedTime) : null],
    ['Avg speed', speedLed ? formatSpeed(activity.avgSpeed, units) : null],
    ['Max speed', speedLed ? formatSpeed(activity.maxSpeed, units) : null],
    ['Pace', group.key === 'run' || group.key === 'walk' ? formatPace(activity.distance, activity.movingTime, units) : null],
    ['Elevation gain', formatElevation(activity.elevation, units)],
    ['Avg heart rate', formatHr(activity.avgHr)],
    ['Max heart rate', formatHr(activity.maxHr)],
    ['Avg power', formatWatts(activity.avgWatts, { estimated: activity.estWatts })],
    ['Weighted power', formatWatts(activity.wWatts)],
    ['Max power', formatWatts(activity.maxWatts)],
  ].filter(([, v]) => v);
}

export function openDetail(activity, units) {
  const dialog = document.getElementById('detail-modal');
  const group = sportGroup(activity.type);

  document.getElementById('detail-title').textContent = activity.name || group.label;
  const start = new Date(activity.start);
  document.getElementById('detail-sub').innerHTML =
    `<i class="dot dot-${group.key}"></i> ${activity.type} · ` +
    `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ` +
    `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

  const stats = document.getElementById('detail-stats');
  stats.replaceChildren();
  for (const [label, value] of statRows(activity, units)) {
    const item = document.createElement('div');
    item.className = 'detail-stat';
    const k = document.createElement('span'); k.className = 'detail-stat-k'; k.textContent = label;
    const v = document.createElement('span'); v.className = 'detail-stat-v'; v.textContent = value;
    item.append(k, v);
    stats.appendChild(item);
  }

  const link = document.getElementById('detail-strava-link');
  const isApiId = typeof activity.id === 'number' || /^\d+$/.test(activity.id ?? '');
  link.hidden = !isApiId;
  if (isApiId) link.href = `https://www.strava.com/activities/${activity.id}`;

  const mapEl = document.getElementById('detail-map');
  destroyMap();
  if (activity.polyline) {
    renderMap(mapEl, activity.polyline);
  } else {
    mapEl.hidden = true;
    mapEl.replaceChildren();
  }

  dialog.showModal();
}

export function wireDetailModal() {
  const dialog = document.getElementById('detail-modal');
  dialog.addEventListener('close', () => {
    destroyMap();
    document.getElementById('detail-map').replaceChildren();
  });
  // Click on the backdrop closes the dialog
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
