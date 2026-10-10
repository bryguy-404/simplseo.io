import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { generatePageReviewSuggestions } from '../../../lib/server/manualPageReview';

export const POST = authenticatedRoute(async request => {
  const { userId, pageUrl, focusKeywords } = await request.json();
  return Response.json(await generatePageReviewSuggestions(userId, pageUrl, focusKeywords));
}, { quota: 'ai' });
