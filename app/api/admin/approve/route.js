import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { issueInvitation, listAccessRequests, rejectAccessRequest, retryRequestNotice } from '../../../lib/server/earlyAccess';
import { RequestError } from '../../../lib/server/requestAuth';
export const GET = authenticatedRoute(async request => Response.json(await listAccessRequests(new URL(request.url).searchParams.get('cursor')), { headers: { 'Cache-Control': 'private, no-store' } }), { admin: true });
export const POST = authenticatedRoute(async request => {
  const input = await request.json();
  if (input.action === 'reject') return Response.json(await rejectAccessRequest(input.requestId));
  if (input.action === 'retry_notice') return Response.json({ success: true, delivery: await retryRequestNotice(input.requestId) });
  if (!['approve', 'invite', 'replace'].includes(input.action)) throw new RequestError('Choose an invitation action.');
  return Response.json(await issueInvitation(input.userId, { ...input, replace: input.action === 'replace' }));
}, { admin: true });
