import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { ensureCurrentHistory } from '../../../lib/server/revampHistory';
export async function POST(request) {
  try { const uid = await requireUser(request); await ensureCurrentHistory(uid); return Response.json({ success: true }); }
  catch (e) { return errorResponse(e); }
}
