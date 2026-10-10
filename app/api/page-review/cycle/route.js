import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { reviewPageCycle } from '../../../lib/server/pageReviewCycle';

export const POST = authenticatedRoute(async request => {
  const input = await request.json();
  return Response.json(await reviewPageCycle(input.userId, input), { headers: { 'Cache-Control': 'private, no-store' } });
});
