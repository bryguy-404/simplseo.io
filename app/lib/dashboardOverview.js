import { propertyContainsUrl } from './revampState';

export const DASHBOARD_PAGE_LIMIT = 100;
export const DASHBOARD_DAY_LIMIT = 28;

// This helper is deliberately independent of authentication, credentials and storage.
class DashboardDataError extends Error {
  constructor() {
    super('Invalid Search Console response. Please try again.');
    this.status = 502;
  }
}
const invalid = () => { throw new DashboardDataError(); };
const isDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const readRows = (result, limit) => {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.error
    || (result.rows !== undefined && !Array.isArray(result.rows))) invalid();
  const rows = result.rows || [];
  if (rows.length > limit) invalid();
  return rows;
};
const readMetrics = row => {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || ![row.clicks, row.impressions, row.ctr, row.position].every(Number.isFinite)
    || row.clicks < 0 || row.impressions < 0 || row.clicks > row.impressions
    || row.ctr < 0 || row.ctr > 1 || row.position < 0
    || (row.impressions > 0 && row.position < 1)) invalid();
  return {
    clicks: row.clicks, impressions: row.impressions,
    ctr: row.impressions > 0 ? row.ctr : null,
    position: row.impressions > 0 ? row.position : null,
  };
};
const oneKey = row => {
  if (!row || !Array.isArray(row.keys) || row.keys.length !== 1 || typeof row.keys[0] !== 'string') invalid();
  return row.keys[0];
};

export function dashboardQueryPlans(window) {
  const common = { ...window, type: 'web', dataState: 'final', aggregationType: 'auto' };
  return [
    { ...common, rowLimit: 1 },
    { ...common, dimensions: ['date'], rowLimit: DASHBOARD_DAY_LIMIT },
    { ...common, dimensions: ['page'], rowLimit: DASHBOARD_PAGE_LIMIT },
  ];
}

export function buildDashboardOverview({ property, window, fetchedAt, totalsResult, dailyResult, pagesResult }) {
  if (typeof property !== 'string' || !property || !window
    || !isDay(window.startDate) || !isDay(window.endDate) || window.startDate > window.endDate
    || typeof fetchedAt !== 'string' || !Number.isFinite(Date.parse(fetchedAt))) invalid();
  const totalsRows = readRows(totalsResult, 1);
  if (totalsRows[0]?.keys !== undefined && (!Array.isArray(totalsRows[0].keys) || totalsRows[0].keys.length)) invalid();
  const totals = totalsRows.length ? readMetrics(totalsRows[0]) : { clicks: 0, impressions: 0, ctr: null, position: null };

  const seenDays = new Set();
  const daily = readRows(dailyResult, DASHBOARD_DAY_LIMIT).map(row => {
    const date = oneKey(row);
    if (!isDay(date) || date < window.startDate || date > window.endDate || seenDays.has(date)) invalid();
    seenDays.add(date);
    // Keep Google's calendar date exactly; parsing it as local time shifts it.
    return { date, ...readMetrics(row) };
  }).sort((a, b) => a.date.localeCompare(b.date));

  const seenPages = new Set();
  const pages = readRows(pagesResult, DASHBOARD_PAGE_LIMIT).map(row => {
    const pageUrl = oneKey(row);
    if (pageUrl.length > 2048 || !propertyContainsUrl(property, pageUrl) || seenPages.has(pageUrl)) invalid();
    seenPages.add(pageUrl);
    return { pageUrl, ...readMetrics(row) };
  });

  return {
    schemaVersion: 1, source: 'google_search_console', property,
    window: { startDate: window.startDate, endDate: window.endDate }, fetchedAt,
    dataState: 'final', searchType: 'web', totals, daily, pages,
    coverage: {
      pages: { limit: DASHBOARD_PAGE_LIMIT, returned: pages.length, complete: false },
      daily: { omitsDaysWithoutData: true },
      isIndexingReport: false,
    },
  };
}
