import { detectAndSaveSuccessfulStrategies } from '../../../lib/successDetector';
import { requireUser, requireCron, errorResponse, RequestError } from '../../../lib/server/requestAuth';

export async function POST(request) {
  try {
    const uid = await requireUser(request);
    const body = await request.json();
    if (body.userId && body.userId !== uid) throw new RequestError('Forbidden', 403);
    return Response.json(await detectAndSaveSuccessfulStrategies(uid));
  } catch (error) { return errorResponse(error); }
}
export async function GET(request) {
  try {
    requireCron(request);
    return Response.json({ success: true, paused: true, reason: 'automatic_promotion_disabled', strategiesSaved: 0 });
  } catch (error) { return errorResponse(error); }
}
