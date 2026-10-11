import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { selectStagedGsc } from '../../../lib/server/stagedGsc';
export async function POST(request) {
  try {
    const body = await request.json(), uid = await requireUser(request, body.userId);
    return Response.json(await selectStagedGsc(uid, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
