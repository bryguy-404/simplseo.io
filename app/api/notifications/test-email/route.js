import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { sendNotificationTest } from '../../../lib/server/notificationDelivery';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request) {
  try { const userId = await requireUser(request); return Response.json(await sendNotificationTest(userId, await request.json())); }
  catch (error) { return errorResponse(error); }
}
