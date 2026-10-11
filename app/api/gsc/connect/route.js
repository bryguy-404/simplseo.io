import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { beginGscConnection } from '../../../lib/server/stagedGsc';
export async function GET(request) {
  try {
    const url = new URL(request.url), uid = await requireUser(request, url.searchParams.get('userId'));
    const revision = url.searchParams.get('sessionRevision');
    const result = await beginGscConnection(uid, { origin: url.origin,
      property: url.searchParams.get('property') || undefined,
      sessionRevision: revision === null ? undefined : Number(revision) });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
