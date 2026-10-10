import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { readPageReviewPlan, updatePageReviewTask } from '../../../lib/server/pageReviewPlans';

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
  const plan = await readPageReviewPlan(params.get('userId'), params.get('pageUrl'));
  return Response.json({ plan }, { headers });
});
export const POST = privateRoute(async request => {
  const { userId, pageUrl, taskId, status, revision } = await request.json();
  const plan = await updatePageReviewTask(userId, pageUrl, taskId, status, revision);
  return Response.json({ plan }, { headers });
});
