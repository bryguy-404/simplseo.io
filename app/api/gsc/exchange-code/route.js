import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
import { exchangeStagedGsc } from '../../../lib/server/stagedGsc';
export async function POST(request) {
  try {
    const body = await request.json(), uid = await requireUser(request, body.userId);
    if (body.accessToken || body.refreshToken || body.property) throw new RequestError('Use the secure Google connection and property selection flow.');
    return Response.json(await exchangeStagedGsc(uid, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
