import { requireUser, errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { getGscConnection } from '../../../lib/server/gscConnection';
import { searchWindow } from '../../../lib/searchWindow';
import { buildDashboardOverview, dashboardQueryPlans } from '../../../lib/dashboardOverview';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const uid = await requireUser(request, params.get('userId'));
    const connection = await getGscConnection(uid);
    for (const name of ['property', 'siteUrl']) {
      if (params.has(name) && params.get(name) !== connection.siteUrl) {
        throw new RequestError('Search Console property does not match your connection.', 403);
      }
    }
    // One date window shared by all three bounded queries. Client tokens/ranges
    // cannot replace the signed-in account's stored connection or this policy.
    const window = searchWindow('28');
    const results = await Promise.allSettled(dashboardQueryPlans(window).map(body => connection.query(body)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [totalsResult, dailyResult, pagesResult] = results.map(result => result.value);
    const overview = buildDashboardOverview({
      property: connection.siteUrl, window, fetchedAt: new Date().toISOString(),
      totalsResult, dailyResult, pagesResult,
    });
    return Response.json(overview, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
