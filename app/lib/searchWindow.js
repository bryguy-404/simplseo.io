import { observationWindow } from './revampState';

// Inclusive Pacific dates, excluding the newest three days as an app policy.
export function searchWindow(range = '28', now = new Date()) {
  const days = range === 'all' ? 365 : Number(range);
  if (![7, 28, 30, 90, 180, 365].includes(days)) throw new Error('Choose a supported date range.');
  const { endDate } = observationWindow(null, now);
  const start = new Date(`${endDate}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}
export function keywordRows(rows = []) {
  // Preserve exact queries and Google's average position, not the best position.
  return rows.map(row => ({
    keyword: row.keys[0], ...(row.keys[1] ? { page: row.keys[1] } : {}), clicks: row.clicks,
    impressions: row.impressions, position: row.impressions > 0 ? row.position : null,
    ctrRaw: row.impressions > 0 ? row.clicks / row.impressions * 100 : 0,
    ctr: `${(row.impressions > 0 ? row.clicks / row.impressions * 100 : 0).toFixed(1)}%`,
  }));
}
