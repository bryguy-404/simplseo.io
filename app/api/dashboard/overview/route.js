import { requireUser, errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { readSharedDashboardOverview } from '../../../lib/server/mentorActivitySnapshots';
import { readMentorAccountScope } from '../../../lib/server/mentorAccountScope';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const uid = await requireUser(request, params.get('userId'));
    const scope = await readMentorAccountScope(uid);
    for (const name of ['property', 'siteUrl']) {
      if (params.has(name) && params.get(name) !== scope.property) {
        throw new RequestError('Search Console property does not match your connection.', 403);
      }
    }
    const overview = await readSharedDashboardOverview(uid, { force: params.get('refresh') === 'true', signal: request.signal });
    return Response.json(overview, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
