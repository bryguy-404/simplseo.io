import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { confirmPageReview } from '../../../lib/server/confirmPageReview';

export const POST = authenticatedRoute(async request => {
  const input = await request.json();
  return Response.json(await confirmPageReview(input.userId, input), { headers: { 'Cache-Control': 'private, no-store' } });
});
