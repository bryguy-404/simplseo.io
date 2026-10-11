import { readDashboardWork } from '../../../lib/server/dashboardWork';
import { requireUser, errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { visualDashboardEnabled } from '../../../lib/server/visualDashboardFeature';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const userId = await requireUser(request, params.get('userId'));
    const allowed = new Set(['userId', 'cursor']);
    if ([...params.keys()].some(key => !allowed.has(key))) throw new RequestError('Use the saved dashboard work for your current website.');
    const result = await readDashboardWork(userId, { cursor: params.get('cursor') || undefined });
    return Response.json({ ...result, enabled: visualDashboardEnabled(userId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
