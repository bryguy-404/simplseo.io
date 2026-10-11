import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
import { listCurrentGscProperties, listStagedGscProperties } from '../../../lib/server/stagedGsc';
export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams, uid = await requireUser(request, params.get('userId'));
    if (params.has('accessToken') || params.has('refreshToken')) throw new RequestError('Reconnect Google using your signed-in account.');
    const result = params.has('pendingId') ? await listStagedGscProperties(uid, params.get('pendingId')) : await listCurrentGscProperties(uid);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request) {
  try {
    const body = await request.json(), uid = await requireUser(request, body.userId);
    if (body.accessToken || body.refreshToken) throw new RequestError('Reconnect Google using your signed-in account.');
    const result = body.pendingId ? await listStagedGscProperties(uid, body.pendingId) : await listCurrentGscProperties(uid);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
