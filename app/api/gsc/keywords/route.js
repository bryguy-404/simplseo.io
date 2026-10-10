import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { getGscConnection } from '../../../lib/server/gscConnection';
import { observationWindow } from '../../../lib/revampState';
export async function POST(request) {
  try {
    const body = await request.json(); const uid = await requireUser(request, body.userId);
    const connection = await getGscConnection(uid);
    const result = await connection.query({ ...observationWindow(null), dimensions: ['query', 'page'], rowLimit: 1000 });
    return Response.json({ success: true, keywords: (result.rows || []).map(row => ({ keyword: row.keys[0], page: row.keys[1], clicks: row.clicks, impressions: row.impressions, position: Math.round(row.position), ctr: `${(row.ctr * 100).toFixed(1)}%` })) });
  } catch (e) { return errorResponse(e); }
}
