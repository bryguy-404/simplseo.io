import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { startPageMonitoring, stopPageMonitoring } from '../../../lib/server/pageMonitoring';
import { RequestError } from '../../../lib/server/requestAuth';

export const maxDuration = 240;
export const POST = authenticatedRoute(async request => {
  const { userId, action, ...input } = await request.json();
  if (!['start', 'stop'].includes(action)) throw new RequestError('Choose whether to start or stop monitoring.');
  const result = action === 'start' ? await startPageMonitoring(userId, input, { signal: request.signal })
    : await stopPageMonitoring(userId, input);
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
