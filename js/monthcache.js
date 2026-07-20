// Shared per-month activity cache on localStorage: past months are stable and
// cached indefinitely; the current month refreshes after a short TTL or on
// demand (force). Used by both live API sources (Strava, intervals.icu).

const CURRENT_MONTH_TTL_MS = 15 * 60 * 1000;

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota — cache is optional */ }
}

// fetchRange(afterEpochS, beforeEpochS) → Promise<activity[]>
export function makeMonthCache(prefix, fetchRange) {
  return async function activitiesForMonth(year, month, { force = false } = {}) {
    const key = `${prefix}${year}-${String(month + 1).padStart(2, '0')}`;
    const now = Date.now();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 1);
    const isPast = monthEnd.getTime() < now;

    const cached = readJson(key);
    if (cached && !force && (isPast || now - cached.fetchedAt < CURRENT_MONTH_TTL_MS)) {
      return cached.activities;
    }
    if (monthStart.getTime() > now) return []; // future month — nothing to fetch

    // Pad a day each side so timezone offsets can't drop edge activities;
    // rendering filters by calendar day anyway.
    const after = Math.floor(monthStart.getTime() / 1000) - 86400;
    const before = Math.floor(monthEnd.getTime() / 1000) + 86400;
    const activities = await fetchRange(after, before);
    writeJson(key, { fetchedAt: now, activities });
    return activities;
  };
}
