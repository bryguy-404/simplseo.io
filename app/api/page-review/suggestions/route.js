import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { generatePageReviewSuggestions } from '../../../lib/server/manualPageReview';

export const maxDuration = 180;

export const POST = authenticatedRoute(async request => {
  const { userId, pageUrl, focusKeywords, goal } = await request.json();
  return Response.json(await generatePageReviewSuggestions(userId, pageUrl, focusKeywords, { signal: request.signal, goal }),
    { headers: { 'Cache-Control': 'private, no-store' } });
}, { quota: 'ai' });
