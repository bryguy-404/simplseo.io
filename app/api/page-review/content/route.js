import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { readCurrentPageForReview } from '../../../lib/server/manualPageReview';

export const POST = authenticatedRoute(async request => {
  const { userId, pageUrl } = await request.json();
  const review = await readCurrentPageForReview(userId, pageUrl);
  return Response.json({ success: true, data: review.currentPage, provenance: review.provenance });
});
