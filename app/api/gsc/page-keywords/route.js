import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
import { getGscConnection } from '../../../lib/server/gscConnection';
import { propertyContainsUrl } from '../../../lib/revampState';
import { searchWindow, keywordRows } from '../../../lib/searchWindow';

export async function POST(request) {
  try {
    const body = await request.json();
    const uid = await requireUser(request, body.userId);
    let window;
    try { window = searchWindow(body.dateRange); } catch (e) { throw new RequestError(e.message); }
    const connection = await getGscConnection(uid);
    if (!propertyContainsUrl(connection.siteUrl, body.pageUrl)) throw new RequestError('Choose a page in your connected Search Console property.');
    const result = await connection.query({ ...window, dimensions: ['query'], dataState: 'final', type: 'web', rowLimit: 1000,
      dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: body.pageUrl }] }] });
    const rows = keywordRows(result.rows);
    return Response.json({ success: true, source: 'google_search_console', property: connection.siteUrl, pageUrl: body.pageUrl,
      ...window, fetchedAt: new Date().toISOString(), coverage: 'reported_queries', mayBeIncomplete: true,
      keywords: { topPerformers: rows.filter(row => row.impressions >= 5 || row.clicks > 0),
        otherKeywords: rows.filter(row => row.impressions < 5 && row.clicks === 0),
        totals: { impressions: rows.reduce((sum, row) => sum + row.impressions, 0), clicks: rows.reduce((sum, row) => sum + row.clicks, 0), totalKeywords: rows.length } } });
  } catch (e) { return errorResponse(e); }
}
