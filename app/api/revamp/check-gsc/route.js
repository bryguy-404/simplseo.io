import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { monitorRevamp } from '../../../lib/server/revampMonitor';
export async function POST(request) {
  try { const body = await request.json(); const uid = await requireUser(request, body.userId); return Response.json({ success: true, ...await monitorRevamp(uid) }); }
  catch (error) { return errorResponse(error); }
}
