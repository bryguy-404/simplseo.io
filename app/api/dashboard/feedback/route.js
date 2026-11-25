import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { submitDashboardFeedback, updateFeedbackPrompt } from '../../../lib/server/dashboardFeedback';

export const POST = authenticatedRoute(async request => {
  const input = await request.json();
  const result = input.action === 'submit'
    ? await submitDashboardFeedback(input.userId, input)
    : await updateFeedbackPrompt(input.userId, input);
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
