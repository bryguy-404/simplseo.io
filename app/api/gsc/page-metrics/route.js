import { requireUser, errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { getGscConnection } from '../../../lib/server/gscConnection';
import { recentObservationWindow } from '../../../lib/progressAssessment';
import { fetchPageObservation } from '../../../lib/server/pageObservation';

export async function POST(request) {
  try {
    const uid = await requireUser(request);
    const body = await request.json();
    if (body.userId && body.userId !== uid) throw new RequestError('Forbidden', 403);
    const connection = await getGscConnection(uid);
    if (body.siteUrl && body.siteUrl !== connection.siteUrl) throw new RequestError('Search Console property does not match your connection.', 403);
    // Supplied OAuth tokens/date ranges cannot change the source of this response.
    const observation = await fetchPageObservation(connection, body.pageUrl, recentObservationWindow());
    return Response.json(observation);
  } catch (error) { return errorResponse(error); }
}
