// Parser for Strava bulk-export activities.csv — runs entirely in the browser.

// RFC-4180-ish CSV state machine (handles quoted fields, escaped quotes,
// and newlines inside quotes, which Strava descriptions contain).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Strava export dates look like "Jul 20, 2018, 5:04:47 PM" and are in UTC.
// Parse as UTC so local calendar-day placement comes out right for the viewer.
export function parseExportDate(str) {
  const m = /^(\w{3}) (\d{1,2}), (\d{4})(?:,)? (\d{1,2}):(\d{2}):(\d{2})(?: (AM|PM))?$/.exec(String(str).trim());
  if (!m) {
    const fallback = new Date(str);
    return Number.isNaN(fallback.getTime()) ? null : fallback.getTime();
  }
  let hours = Number(m[4]);
  if (m[7] === 'PM' && hours !== 12) hours += 12;
  if (m[7] === 'AM' && hours === 12) hours = 0;
  return Date.UTC(Number(m[3]), MONTHS[m[1]] ?? 0, Number(m[2]), hours, Number(m[5]), Number(m[6]));
}

function toNumber(value) {
  if (value == null || value === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// The export header repeats some column names ("Elapsed Time", "Distance"):
// the first "Distance" is km for display, a later one is raw meters. We index
// every occurrence and prefer the raw column when present.
export function parseActivitiesCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('That file has no data rows.');
  const header = rows[0].map((h) => h.trim());
  const indicesOf = (name) => header.reduce((acc, h, i) => (h === name ? [...acc, i] : acc), []);

  const idIdx = indicesOf('Activity ID')[0];
  const dateIdx = indicesOf('Activity Date')[0];
  const nameIdx = indicesOf('Activity Name')[0];
  const typeIdx = indicesOf('Activity Type')[0];
  const distIdxs = indicesOf('Distance');
  const elapsedIdxs = indicesOf('Elapsed Time');
  const movingIdx = indicesOf('Moving Time')[0];
  const elevIdx = indicesOf('Elevation Gain')[0];

  if (dateIdx == null || typeIdx == null) {
    throw new Error('This doesn’t look like a Strava activities.csv (missing "Activity Date" / "Activity Type" columns).');
  }

  const activities = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < 2) continue;
    const start = parseExportDate(row[dateIdx]);
    if (start == null) continue;

    // Prefer the raw meters column (2nd "Distance"); fall back to km * 1000.
    let distance = 0;
    if (distIdxs.length > 1 && row[distIdxs[1]] !== '') distance = toNumber(row[distIdxs[1]]);
    else if (distIdxs.length > 0) distance = toNumber(row[distIdxs[0]]) * 1000;

    activities.push({
      id: idIdx != null ? row[idIdx] : null,
      name: nameIdx != null ? row[nameIdx] : '',
      type: row[typeIdx] || 'Workout',
      start,
      distance,
      movingTime: movingIdx != null ? toNumber(row[movingIdx]) : 0,
      elapsedTime: elapsedIdxs.length ? toNumber(row[elapsedIdxs[0]]) : 0,
      elevation: elevIdx != null ? toNumber(row[elevIdx]) : 0,
    });
  }
  if (activities.length === 0) throw new Error('No activities could be parsed from that file.');
  activities.sort((a, b) => a.start - b.start);
  return activities;
}
