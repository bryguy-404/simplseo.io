import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { readNotification } from '../../../lib/server/notificationEvents';
export const GET = authenticatedRoute(async (request, context) => Response.json(await readNotification(new URL(request.url).searchParams.get('userId'), (await context.params).id), { headers: { 'Cache-Control': 'private, no-store' } }));
