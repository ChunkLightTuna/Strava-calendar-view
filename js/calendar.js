// Calendar grid + monthly summary rendering. Pure DOM, no dependencies.

import {
  sportGroup, groupsInOrder, isDistanceGroup,
  formatDistance, formatDuration, formatElevation, formatPace, formatSpeed, formatHr, formatWatts,
} from './sports.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function monthTitle(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function chipMeta(activity, units) {
  return formatDistance(activity.distance, units) ?? formatDuration(activity.movingTime || activity.elapsedTime);
}

function tooltipHtml(activity, units) {
  const group = sportGroup(activity.type);
  const time = new Date(activity.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const speedLed = group.key === 'ride' || group.key === 'winter' || group.key === 'paddle';
  const rows = [
    ['Distance', formatDistance(activity.distance, units)],
    ['Time', formatDuration(activity.movingTime || activity.elapsedTime)],
    ['Speed', speedLed ? formatSpeed(activity.avgSpeed, units) : null],
    ['Pace', group.key === 'run' ? formatPace(activity.distance, activity.movingTime, units) : null],
    ['Heart rate', formatHr(activity.avgHr)],
    ['Power', formatWatts(activity.avgWatts, { estimated: activity.estWatts })],
    ['Elevation', formatElevation(activity.elevation, units)],
  ].filter(([, v]) => v);
  const dl = rows.map(([k, v]) => `<span class="tt-k">${k}</span><span class="tt-v">${v}</span>`).join('');
  return `<strong>${escapeHtml(activity.name || group.label)}</strong>` +
    `<span class="tt-type"><i class="dot dot-${group.key}"></i>${escapeHtml(activity.type)} · ${time}</span>` +
    (dl ? `<span class="tt-grid">${dl}</span>` : '');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function renderCalendar(container, { year, month, activities, units, weekStart, onActivityClick }) {
  container.replaceChildren();

  const byDay = new Map();
  for (const a of activities) {
    const d = new Date(a.start);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = dayKey(d);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(a);
  }
  byDay.forEach((list) => list.sort((x, y) => x.start - y.start));

  const headRow = el('div', 'cal-head');
  for (let i = 0; i < 7; i++) {
    headRow.appendChild(el('div', 'cal-head-cell', WEEKDAYS[(weekStart + i) % 7]));
  }
  container.appendChild(headRow);

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - weekStart + 7) % 7;
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const todayKey = dayKey(new Date());

  const grid = el('div', 'cal-grid');
  grid.setAttribute('role', 'rowgroup');
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - lead + 1;
    const cell = el('div', 'cal-cell');
    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.classList.add('cal-cell-blank');
      grid.appendChild(cell);
      continue;
    }
    const date = new Date(year, month, dayNum);
    const key = dayKey(date);
    if (key === todayKey) cell.classList.add('cal-cell-today');

    const num = el('span', 'cal-daynum', String(dayNum));
    if (key === todayKey) num.setAttribute('aria-label', `${dayNum}, today`);
    cell.appendChild(num);

    for (const activity of byDay.get(key) ?? []) {
      const group = sportGroup(activity.type);
      const chip = el('button', `chip chip-${group.key}`);
      chip.type = 'button';
      chip.addEventListener('click', () => onActivityClick?.(activity));
      chip.appendChild(el('span', 'chip-icon', group.icon));
      const body = el('span', 'chip-body');
      body.appendChild(el('span', 'chip-name', activity.name || group.label));
      const meta = chipMeta(activity, units);
      if (meta) body.appendChild(el('span', 'chip-meta', meta));
      chip.appendChild(body);
      chip.dataset.tooltip = tooltipHtml(activity, units);
      cell.appendChild(chip);
    }
    grid.appendChild(cell);
  }
  container.appendChild(grid);
}

export function renderLegend(container, activities) {
  container.replaceChildren();
  const present = new Set(activities.map((a) => sportGroup(a.type).key));
  for (const group of groupsInOrder()) {
    if (!present.has(group.key)) continue;
    const item = el('span', 'legend-item');
    item.appendChild(el('i', `dot dot-${group.key}`));
    item.appendChild(el('span', null, group.label));
    container.appendChild(item);
  }
}

export function renderSummary(container, { year, month, activities, units }) {
  container.replaceChildren();
  const inMonth = activities.filter((a) => {
    const d = new Date(a.start);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const totals = new Map();
  for (const a of inMonth) {
    const group = sportGroup(a.type);
    if (!totals.has(group.key)) totals.set(group.key, { group, count: 0, distance: 0, time: 0, elevation: 0 });
    const t = totals.get(group.key);
    t.count += 1;
    t.distance += a.distance || 0;
    t.time += a.movingTime || a.elapsedTime || 0;
    t.elevation += a.elevation || 0;
  }

  const allTime = inMonth.reduce((s, a) => s + (a.movingTime || a.elapsedTime || 0), 0);
  const overall = el('div', 'tile tile-total');
  overall.appendChild(el('span', 'tile-label', 'This month'));
  overall.appendChild(el('span', 'tile-value', `${inMonth.length} ${inMonth.length === 1 ? 'activity' : 'activities'}`));
  overall.appendChild(el('span', 'tile-sub', formatDuration(allTime) ?? '—'));
  container.appendChild(overall);

  for (const group of groupsInOrder()) {
    const t = totals.get(group.key);
    if (!t) continue;
    const tile = el('div', 'tile');
    const label = el('span', 'tile-label');
    label.appendChild(el('i', `dot dot-${group.key}`));
    label.appendChild(document.createTextNode(` ${group.label}`));
    tile.appendChild(label);
    const lead = isDistanceGroup(group.key) && t.distance > 0
      ? formatDistance(t.distance, units)
      : formatDuration(t.time) ?? `${t.count}×`;
    tile.appendChild(el('span', 'tile-value', lead));
    const subParts = [`${t.count}×`];
    if (isDistanceGroup(group.key) && t.distance > 0 && formatDuration(t.time)) subParts.push(formatDuration(t.time));
    if (t.elevation >= 10) subParts.push(`↑ ${formatElevation(t.elevation, units)}`);
    tile.appendChild(el('span', 'tile-sub', subParts.join(' · ')));
    container.appendChild(tile);
  }
}
