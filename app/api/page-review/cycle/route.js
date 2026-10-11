import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { reviewPageCycle } from '../../../lib/server/pageReviewCycle';
import { acknowledgeOngoingCycle } from '../../../lib/server/ongoingProgress';

export const POST = authenticatedRoute(async request => {
  const input = await request.json();
  return Response.json(await (input.cycleId ? acknowledgeOngoingCycle(input.userId, input) : reviewPageCycle(input.userId, input)), { headers: { 'Cache-Control': 'private, no-store' } });
});
