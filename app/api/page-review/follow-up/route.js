import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { readFollowUpReview, runFollowUpReview } from '../../../lib/server/followUpReview';

export const maxDuration = 180;
const headers = { 'Cache-Control': 'private, no-store' };
const privateRoute = handler => {
  const authenticated = authenticatedRoute(handler);
  return async request => {
    const response = await authenticated(request);
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
  };
};
export const GET = privateRoute(async request => {
  const params = new URL(request.url).searchParams;
  return Response.json(await readFollowUpReview(params.get('userId'), params.get('cycleId')), { headers });
});
export const POST = privateRoute(async request => {
  const { userId, ...input } = await request.json();
  return Response.json(await runFollowUpReview(userId, input, { signal: request.signal }), { headers });
});
