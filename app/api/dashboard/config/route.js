import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { visualDashboardEnabled } from '../../../lib/server/visualDashboardFeature';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const uid = await requireUser(request, new URL(request.url).searchParams.get('userId'));
    return Response.json({ enabled: visualDashboardEnabled(uid) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
