import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { markNotificationRead } from '../../../lib/server/notificationEvents';
export const POST = authenticatedRoute(async request => { const input = await request.json(); return Response.json(await markNotificationRead(input.userId, input.id), { headers: { 'Cache-Control': 'private, no-store' } }); });
