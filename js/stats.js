// Statistics block: month-to-date delta tiles, a cumulative comparison line
// chart (this month vs last month vs this month last year), and a 12-week
// volume trend. Hand-rolled SVG — data is a few thousand in-memory rows, so
// no query engine or chart library is warranted.

import {
  sportGroup, groupsInOrder, isDistanceGroup,
  formatDistance, formatDuration, formatElevation,
} from './sports.js';

const SVGNS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

// metric value of one activity, in display units (mi/km or hours)
function metricValue(activity, metric, units) {
  if (metric === 'time') return (activity.movingTime || activity.elapsedTime || 0) / 3600;
  return (activity.distance || 0) / (units === 'imperial' ? 1609.344 : 1000);
}

function metricLabel(metric, units) {
  return metric === 'time' ? 'hours' : (units === 'imperial' ? 'mi' : 'km');
}

function fmtMetric(v, metric, units) {
  if (metric === 'time') return `${v >= 10 ? Math.round(v) : v.toFixed(1)} h`;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units === 'imperial' ? 'mi' : 'km'}`;
}

function monthName(year, month, withYear) {
  return new Date(year, month, 1).toLocaleDateString(undefined,
    withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
}

function sumStats(activities) {
  const out = { count: 0, distance: 0, time: 0, elevation: 0 };
  for (const a of activities) {
    out.count += 1;
    out.distance += a.distance || 0;
    out.time += a.movingTime || a.elapsedTime || 0;
    out.elevation += a.elevation || 0;
  }
  return out;
}

function deltaSpan(cur, prev, label) {
  const wrap = el('span', 'delta-item');
  if (!(prev > 0)) {
    wrap.append(el('span', 'delta delta-na', '—'), ` vs ${label}`);
    return wrap;
  }
  const pct = ((cur - prev) / prev) * 100;
  const up = pct >= 0;
  const arrow = up ? '▲' : '▼';
  const span = el('span', `delta ${up ? 'delta-up' : 'delta-down'}`,
    `${arrow} ${Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(0)}%`);
  wrap.append(span, ` vs ${label}`);
  return wrap;
}

// ---------- cumulative comparison line chart ----------

function cumulativeSeries(activities, daysInMonth, lastDay, metric, units) {
  const perDay = new Array(daysInMonth).fill(0);
  for (const a of activities) {
    const day = new Date(a.start).getDate();
    if (day >= 1 && day <= daysInMonth) perDay[day - 1] += metricValue(a, metric, units);
  }
  const values = [];
  let acc = 0;
  for (let d = 0; d < Math.min(lastDay, daysInMonth); d++) {
    acc += perDay[d];
    values.push(acc);
  }
  return values;
}

function cumulativeChart({ series, daysInMonth, metric, units }) {
  const W = 560; const H = 240; const L = 46; const R = 16; const T = 16; const B = 28;
  const innerW = W - L - R; const innerH = H - T - B;
  const yMax = niceMax(Math.max(1e-9, ...series.map((s) => s.values.at(-1) ?? 0)));
  const x = (day) => L + ((day - 1) / Math.max(daysInMonth - 1, 1)) * innerW;
  const y = (v) => T + innerH - (v / yMax) * innerH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });

  for (const frac of [0, 0.5, 1]) {
    svg.appendChild(svgEl('line', {
      x1: L, x2: W - R, y1: y(yMax * frac), y2: y(yMax * frac),
      class: frac === 0 ? 'chart-baseline' : 'chart-grid',
    }));
    const label = svgEl('text', { x: L - 6, y: y(yMax * frac) + 3.5, class: 'chart-tick', 'text-anchor': 'end' });
    label.textContent = metric === 'time'
      ? `${Math.round(yMax * frac)}h`
      : `${Math.round(yMax * frac)}`;
    svg.appendChild(label);
  }
  for (const day of [1, 10, 20, daysInMonth]) {
    const tick = svgEl('text', { x: x(day), y: H - 8, class: 'chart-tick', 'text-anchor': 'middle' });
    tick.textContent = String(day);
    svg.appendChild(tick);
  }

  for (const s of series) {
    if (!s.values.length) continue;
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join('');
    svg.appendChild(svgEl('path', { d, class: `chart-line ${s.cls}`, fill: 'none' }));
  }

  // direct end labels, nudged apart if they collide
  const labels = series
    .filter((s) => s.values.length)
    .map((s) => ({ s, yPos: y(s.values.at(-1)), xPos: x(s.values.length) }))
    .sort((a, b) => a.yPos - b.yPos);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].yPos - labels[i - 1].yPos < 12) labels[i].yPos = labels[i - 1].yPos + 12;
  }
  for (const { s, yPos, xPos } of labels) {
    const text = svgEl('text', {
      x: Math.min(xPos + 5, W - R - 2), y: Math.min(yPos + 3.5, H - B - 2),
      class: `chart-label ${s.cls}`,
    });
    text.textContent = s.label;
    svg.appendChild(text);
  }

  // hover layer: one column per day with all series' values
  for (let day = 1; day <= daysInMonth; day++) {
    const rows = series
      .filter((s) => s.values.length >= day)
      .map((s) => `${esc(s.label)}: ${fmtMetric(s.values[day - 1], metric, units)}`);
    if (!rows.length) continue;
    const hit = svgEl('rect', {
      x: x(day) - innerW / daysInMonth / 2, y: T,
      width: innerW / daysInMonth, height: innerH,
      class: 'chart-hit',
    });
    hit.dataset.tooltip = `<strong>Day ${day}</strong><span class="tt-grid">` +
      rows.map((r) => `<span class="tt-k">${r.split(': ')[0]}</span><span class="tt-v">${r.split(': ')[1]}</span>`).join('') +
      '</span>';
    svg.appendChild(hit);
  }
  return svg;
}

// ---------- weekly trend bar chart ----------

function weeklyChart({ weeks, metric, units }) {
  const W = 560; const H = 240; const L = 46; const R = 16; const T = 16; const B = 28;
  const innerW = W - L - R; const innerH = H - T - B;
  const yMax = niceMax(Math.max(1e-9, ...weeks.map((w) => w.value)));
  const y = (v) => T + innerH - (v / yMax) * innerH;
  const slot = innerW / weeks.length;
  const barW = Math.max(4, slot - 4);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (const frac of [0, 0.5, 1]) {
    svg.appendChild(svgEl('line', {
      x1: L, x2: W - R, y1: y(yMax * frac), y2: y(yMax * frac),
      class: frac === 0 ? 'chart-baseline' : 'chart-grid',
    }));
    const label = svgEl('text', { x: L - 6, y: y(yMax * frac) + 3.5, class: 'chart-tick', 'text-anchor': 'end' });
    label.textContent = metric === 'time' ? `${Math.round(yMax * frac)}h` : `${Math.round(yMax * frac)}`;
    svg.appendChild(label);
  }

  weeks.forEach((week, i) => {
    const cx = L + slot * i + slot / 2;
    const barH = Math.max(week.value > 0 ? 2 : 0, innerH * (week.value / yMax));
    const bar = svgEl('rect', {
      x: cx - barW / 2, y: T + innerH - barH, width: barW, height: barH || 0.01,
      rx: 3, class: `chart-bar${i === weeks.length - 1 ? ' chart-bar-current' : ''}`,
    });
    const weekLabel = week.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    bar.dataset.tooltip = `<strong>Week of ${esc(weekLabel)}</strong>` +
      `<span class="tt-grid"><span class="tt-k">${metric === 'time' ? 'Time' : 'Distance'}</span>` +
      `<span class="tt-v">${fmtMetric(week.value, metric, units)}</span>` +
      `<span class="tt-k">Activities</span><span class="tt-v">${week.count}</span></span>`;
    svg.appendChild(bar);
    if (i % 4 === 0 || i === weeks.length - 1) {
      const tick = svgEl('text', { x: cx, y: H - 8, class: 'chart-tick', 'text-anchor': 'middle' });
      tick.textContent = week.start.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
      svg.appendChild(tick);
    }
  });

  // direct label on the latest bar only
  const last = weeks.at(-1);
  if (last && last.value > 0) {
    const cx = L + slot * (weeks.length - 1) + slot / 2;
    const label = svgEl('text', { x: cx, y: y(last.value) - 5, class: 'chart-label chart-label-accent', 'text-anchor': 'middle' });
    label.textContent = fmtMetric(last.value, metric, units);
    svg.appendChild(label);
  }
  return svg;
}

// ---------- assembly ----------

// getMonth(year, month) → Promise<activity[]>; returns a detached element.
export async function renderStats({ year, month, units, weekStart, sportFilter, getMonth, onFilterChange }) {
  const back = (n) => {
    const d = new Date(year, month - n, 1);
    return [d.getFullYear(), d.getMonth()];
  };
  const [cur, prev1, prev2, prev3, lastYear] = await Promise.all([
    getMonth(year, month), getMonth(...back(1)), getMonth(...back(2)), getMonth(...back(3)), getMonth(year - 1, month),
  ]);

  const groupsPresent = new Set([...cur, ...prev1, ...prev2, ...prev3, ...lastYear].map((a) => sportGroup(a.type).key));
  if (!groupsPresent.has(sportFilter)) sportFilter = 'all';
  const inFilter = (a) => sportFilter === 'all' || sportGroup(a.type).key === sportFilter;
  const [fCur, fPrev1, fPrev2, fPrev3, fLastYear] = [cur, prev1, prev2, prev3, lastYear].map((list) => list.filter(inFilter));

  const metric = sportFilter !== 'all' && !isDistanceGroup(sportFilter) ? 'time' : 'distance';
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
  const cutoffDay = isCurrentMonth ? now.getDate() : daysInMonth;
  const toCutoff = (list) => list.filter((a) => new Date(a.start).getDate() <= cutoffDay);

  const root = el('section', 'stats-block');

  // header + sport filter
  const head = el('div', 'stats-head');
  head.appendChild(el('h3', 'stats-title', isCurrentMonth ? 'Statistics · month to date' : 'Statistics'));
  const select = el('select', 'stats-filter');
  select.setAttribute('aria-label', 'Filter statistics by sport');
  const optAll = el('option', null, 'All sports');
  optAll.value = 'all';
  select.appendChild(optAll);
  for (const g of groupsInOrder()) {
    if (!groupsPresent.has(g.key)) continue;
    const opt = el('option', null, `${g.icon} ${g.label}`);
    opt.value = g.key;
    select.appendChild(opt);
  }
  select.value = sportFilter;
  select.addEventListener('change', () => onFilterChange(select.value));
  head.appendChild(select);
  root.appendChild(head);

  if (![...fCur, ...fPrev1, ...fLastYear].length) {
    root.appendChild(el('p', 'stats-empty', 'No activities in this period to compare.'));
    return root;
  }

  // delta tiles: honest comparison — same day-of-month cutoff on all months
  const sCur = sumStats(toCutoff(fCur));
  const sPrev = sumStats(toCutoff(fPrev1));
  const sYear = sumStats(toCutoff(fLastYear));
  const prevLabel = monthName(...back(1), false);
  const yearLabel = monthName(year - 1, month, true);
  const tiles = el('div', 'summary stats-tiles');
  const tileDefs = [
    ['Distance', (s) => s.distance, (v) => formatDistance(v, units) ?? '0'],
    ['Time', (s) => s.time, (v) => formatDuration(v) ?? '0'],
    ['Activities', (s) => s.count, (v) => String(v)],
    ['Elevation', (s) => s.elevation, (v) => formatElevation(v, units) ?? '0'],
  ];
  for (const [label, pick, fmt] of tileDefs) {
    const tile = el('div', 'tile');
    tile.appendChild(el('span', 'tile-label', label));
    tile.appendChild(el('span', 'tile-value', fmt(pick(sCur))));
    const sub = el('span', 'tile-sub tile-deltas');
    sub.appendChild(deltaSpan(pick(sCur), pick(sPrev), prevLabel));
    sub.appendChild(deltaSpan(pick(sCur), pick(sYear), yearLabel));
    tile.appendChild(sub);
    tiles.appendChild(tile);
  }
  root.appendChild(tiles);

  // charts
  const charts = el('div', 'charts');

  const cumFig = el('figure', 'chart-card');
  const unitWord = metricLabel(metric, units);
  cumFig.appendChild(el('figcaption', 'chart-caption', `Cumulative ${metric === 'time' ? 'time' : 'distance'} (${unitWord}) by day of month`));
  const prevDays = new Date(back(1)[0], back(1)[1] + 1, 0).getDate();
  const series = [
    { label: monthName(year, month, false), cls: 'series-now', values: cumulativeSeries(fCur, daysInMonth, cutoffDay, metric, units) },
    { label: prevLabel, cls: 'series-prev', values: cumulativeSeries(fPrev1, prevDays, prevDays, metric, units) },
    { label: yearLabel, cls: 'series-year', values: cumulativeSeries(fLastYear, daysInMonth, daysInMonth, metric, units) },
  ].filter((s) => s.values.some((v) => v > 0) || s.cls === 'series-now');
  cumFig.appendChild(cumulativeChart({ series, daysInMonth, metric, units }));
  const legend = el('div', 'chart-legend');
  for (const s of series) {
    const item = el('span', 'legend-item');
    const swatch = el('i', `legend-line ${s.cls}`);
    item.append(swatch, el('span', null, s.label));
    legend.appendChild(item);
  }
  if (!fLastYear.length) legend.appendChild(el('span', 'legend-item legend-note', `no data for ${yearLabel}`));
  cumFig.appendChild(legend);
  charts.appendChild(cumFig);

  const weekFig = el('figure', 'chart-card');
  weekFig.appendChild(el('figcaption', 'chart-caption', `Weekly ${metric === 'time' ? 'time' : 'distance'} (${unitWord}) — last 12 weeks`));
  const anchor = isCurrentMonth ? now : new Date(year, month + 1, 0);
  const anchorWeekStart = new Date(anchor);
  anchorWeekStart.setDate(anchor.getDate() - ((anchor.getDay() - weekStart + 7) % 7));
  anchorWeekStart.setHours(0, 0, 0, 0);
  const pool = [...fCur, ...fPrev1, ...fPrev2, ...fPrev3];
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(anchorWeekStart);
    start.setDate(anchorWeekStart.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const inWeek = pool.filter((a) => a.start >= start.getTime() && a.start < end.getTime());
    weeks.push({ start, value: inWeek.reduce((sum, a) => sum + metricValue(a, metric, units), 0), count: inWeek.length });
  }
  weekFig.appendChild(weeklyChart({ weeks, metric, units }));
  charts.appendChild(weekFig);

  root.appendChild(charts);
  return root;
}
