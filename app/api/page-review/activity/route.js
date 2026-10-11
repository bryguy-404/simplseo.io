import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { readPageReviewActivity } from '../../../lib/server/pageReviewActivity';

export const maxDuration = 60;
export const POST = authenticatedRoute(async request => {
  const { userId, pageUrl } = await request.json();
  return Response.json(await readPageReviewActivity(userId, pageUrl, { signal: request.signal }), { headers: { 'Cache-Control': 'private, no-store' } });
});
