import { authenticatedRoute } from '../../../../lib/server/authenticatedRoute';
import { markNotificationRead } from '../../../../lib/server/notificationEvents';
export const POST = authenticatedRoute(async (request, context) => Response.json(await markNotificationRead((await request.json()).userId, (await context.params).id), { headers: { 'Cache-Control': 'private, no-store' } }));
