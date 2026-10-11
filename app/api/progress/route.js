import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { readProgress, refreshUserProgress } from '../../lib/server/progressMonitor';
import { readOngoingCycle, readOngoingProgress, refreshOngoingProgress } from '../../lib/server/ongoingProgress';

export const maxDuration = 240;
const headers = { 'Cache-Control': 'private, no-store' };
export const GET = authenticatedRoute(async request => {
  const params = new URL(request.url).searchParams, uid = params.get('userId');
  if (params.has('cycleId')) return Response.json({ cycle: await readOngoingCycle(uid, params.get('cycleId')) }, { headers });
  const pageUrl = params.has('pageUrl') ? params.get('pageUrl') : undefined;
  if (params.has('cursor')) return Response.json({ ongoing: await readOngoingProgress(uid, { cursor: params.get('cursor'), pageUrl }) }, { headers });
  return Response.json(await readProgress(uid, new Date(), { pageUrl }), { headers });
});
export const POST = authenticatedRoute(async request => {
  const input = await request.json();
  return Response.json(input.cycleId
    ? await refreshOngoingProgress(input.userId, { cycleId: input.cycleId, expectedRevision: input.revision, technicalOnly: input.technicalOnly === true, signal: request.signal })
    : await refreshUserProgress(input.userId), { headers });
});
