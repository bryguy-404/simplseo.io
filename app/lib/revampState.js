// Pure recovery rules shared by the server and tests. Visibility never gates access.
export const REVAMP_SCHEMA_VERSION = 2;
export function observationWindow(revampDate, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const shift = (date, count) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); };
  const endDate = shift(day, -3);
  const launch = typeof revampDate === 'string' ? revampDate.slice(0, 10) : null;
  const startDate = launch && launch > shift(endDate, -27) ? launch : shift(endDate, -27);
  return startDate > endDate ? null : { startDate, endDate };
}
export function normalizeRevampPage(page) {
  const value = typeof page === 'string' ? { url: page } : page;
  return { ...value, searchDataStatus: value.searchDataStatus || 'not_checked' };
}
export function observePage(page, rows, window, attemptedAt) {
  const impressions = rows.reduce((n, row) => n + (Number(row.impressions) || 0), 0);
  const clicks = rows.reduce((n, row) => n + (Number(row.clicks) || 0), 0);
  return { ...normalizeRevampPage(page), searchDataStatus: impressions > 0 ? 'has_data' : 'no_data', impressions, clicks, observationWindow: window, lastAttemptAt: attemptedAt, lastSuccessAt: attemptedAt, lastError: null };
}
export function completeRevampPatch() {
  return { revampSchemaVersion: REVAMP_SCHEMA_VERSION, revampStatus: 'complete', revampStep: 'complete', postOnboardingStep: 'complete', revampMonitoringEnabled: true, progressReviewRequired: true };
}
export function propertyContainsUrl(property, url) {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
    if (property.startsWith('sc-domain:')) { const host = property.slice(10); return parsed.hostname === host || parsed.hostname.endsWith(`.${host}`); }
    const base = new URL(property);
    return parsed.origin === base.origin && parsed.pathname.startsWith(base.pathname);
  } catch { return false; }
}
