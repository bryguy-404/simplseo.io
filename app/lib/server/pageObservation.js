import { propertyContainsUrl } from '../revampState';
import { PROGRESS_SCHEMA_VERSION, PROGRESS_SOURCE } from '../progressAssessment';
import { RequestError } from './requestAuth';

export async function fetchPageObservation(connection, pageUrl, window, now = new Date()) {
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || !propertyContainsUrl(connection.siteUrl, pageUrl)) {
    throw new RequestError('Page must belong to your connected Search Console property.', 400);
  }
  const result = await connection.query({
    ...window, type: 'web', dataState: 'final', aggregationType: 'auto',
    // One exact page across all queries. No top-page search or fuzzy URL matching.
    dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] }],
    rowLimit: 1,
  });
  if (result.error || (result.rows !== undefined && !Array.isArray(result.rows))) throw new RequestError('Invalid Search Console response.', 502);
  const rows = result.rows || [];
  if (rows.length > 1) throw new RequestError('Invalid Search Console response.', 502);
  const row = rows[0];
  if (row && (![row.clicks, row.impressions, row.ctr, row.position].every(Number.isFinite)
    || row.clicks < 0 || row.impressions < 0 || row.clicks > row.impressions || row.ctr < 0 || row.ctr > 1
    || (row.impressions > 0 && row.position < 1))) throw new RequestError('Invalid Search Console response.', 502);
  const impressions = row?.impressions || 0;
  const clicks = row?.clicks || 0;
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION, source: PROGRESS_SOURCE, property: connection.siteUrl,
    pageUrl, ...window, fetchedAt: now.toISOString(), dataState: 'final', searchType: 'web',
    status: impressions > 0 ? 'has_data' : 'no_data', noData: impressions === 0,
    impressions, clicks, ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? row.position : null,
  };
}
