const DAY_MS = 86400000;

function calendarTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** Four equal reporting weeks. Unreturned days remain unknown, never zero. */
export function dashboardActivityWeeks(window, daily = []) {
  const start = calendarTime(window?.startDate);
  const end = calendarTime(window?.endDate);
  if (start === null || end === null || end - start !== 27 * DAY_MS) return [];
  const rows = new Map();
  const duplicates = new Set();
  for (const row of Array.isArray(daily) ? daily : []) {
    const time = calendarTime(row?.date);
    if (time === null || time < start || time > end
      || !Number.isFinite(row.clicks) || row.clicks < 0
      || !Number.isFinite(row.impressions) || row.impressions < row.clicks) continue;
    if (rows.has(row.date)) duplicates.add(row.date);
    rows.set(row.date, row);
  }
  // Ambiguous duplicate observations should not inflate a bar.
  for (const date of duplicates) rows.delete(date);
  return Array.from({ length: 4 }, (_, index) => {
    const days = Array.from({ length: 7 }, (_, offset) => new Date(start + (index * 7 + offset) * DAY_MS).toISOString().slice(0, 10));
    const reported = days.map(date => rows.get(date)).filter(Boolean);
    return {
      index: index + 1, startDate: days[0], endDate: days[6],
      reportedDays: reported.length, missingDays: 7 - reported.length,
      complete: reported.length === 7,
      clicks: reported.length ? reported.reduce((sum, row) => sum + row.clicks, 0) : null,
      impressions: reported.length ? reported.reduce((sum, row) => sum + row.impressions, 0) : null,
    };
  });
}

export function dashboardActivityState(overview) {
  const { clicks, impressions } = overview?.totals || {};
  if (overview?.source !== 'google_search_console' || !Number.isFinite(clicks) || clicks < 0
    || !Number.isFinite(impressions) || impressions < clicks) return 'unavailable';
  if (clicks > 0) return 'clicks';
  return impressions > 0 ? 'appearances' : 'zero';
}

export function activityDayLabel(value, options = {}) {
  const time = calendarTime(value);
  return time === null ? 'Date unavailable' : new Date(time).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...options });
}
