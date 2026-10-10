import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
import { getGscConnection } from '../../../lib/server/gscConnection';
import { searchWindow, keywordRows } from '../../../lib/searchWindow';

export async function POST(request) {
  try {
    const body = await request.json();
    const uid = await requireUser(request, body.userId);
    let window;
    try { window = searchWindow(body.dateRange); } catch (e) { throw new RequestError(e.message); }
    const connection = await getGscConnection(uid);
    const result = await connection.query({ ...window, dimensions: ['query', 'page'], dataState: 'final', type: 'web', rowLimit: 1000 });
    return Response.json({ success: true, keywords: keywordRows(result.rows), source: 'google_search_console', property: connection.siteUrl,
      ...window, fetchedAt: new Date().toISOString(), coverage: 'reported_queries', mayBeIncomplete: true });
  } catch (e) { return errorResponse(e); }
}
