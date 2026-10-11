import { errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { handleNotificationWebhook } from '../../../lib/server/notificationDelivery';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    if (Number(request.headers.get('content-length')) > 200000) throw new RequestError('Invalid webhook.', 400);
    return Response.json(await handleNotificationWebhook(await request.text(), request.headers));
  } catch (error) { return errorResponse(error); }
}
