import { errorResponse } from '../../../lib/server/requestAuth';
import { inspectNotificationUnsubscribe, unsubscribeNotifications } from '../../../lib/server/notificationPreferences';
export const runtime = 'nodejs';
export async function GET(request) {
  try { return Response.json(await inspectNotificationUnsubscribe(new URL(request.url).searchParams.get('token')), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    let token = new URL(request.url).searchParams.get('token');
    if (!token && request.headers.get('content-type')?.includes('application/json')) token = (await request.json()).token;
    return Response.json(await unsubscribeNotifications(token), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) { return errorResponse(error); }
}
