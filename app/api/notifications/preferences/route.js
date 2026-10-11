import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { readNotificationPreferences, updateNotificationPreferences } from '../../../lib/server/notificationPreferences';
export const runtime = 'nodejs';
export async function GET(request) {
  try { return Response.json(await readNotificationPreferences(await requireUser(request)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request) {
  try { const userId = await requireUser(request); return Response.json(await updateNotificationPreferences(userId, await request.json())); }
  catch (error) { return errorResponse(error); }
}
