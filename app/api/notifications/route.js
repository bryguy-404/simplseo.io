import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { listNotifications } from '../../lib/server/notificationEvents';
export const GET = authenticatedRoute(async request => {
  const params = new URL(request.url).searchParams;
  return Response.json(await listNotifications(params.get('userId'), { cursor: params.get('cursor'), limit: params.get('limit') || 20 }), { headers: { 'Cache-Control': 'private, no-store' } });
});
