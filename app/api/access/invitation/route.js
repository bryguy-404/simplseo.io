import { publicRoute } from '../../../lib/server/publicRequest';
import { requireIdentity, RequestError } from '../../../lib/server/requestAuth';
import { inspectInvitation, acceptInvitation } from '../../../lib/server/earlyAccess';
export const POST = publicRoute(async request => {
  const { action, token } = await request.json();
  if (action === 'inspect') return Response.json(await inspectInvitation(token), { headers: { 'Cache-Control': 'no-store' } });
  if (action !== 'accept') throw new RequestError('Choose an invitation action.');
  const uid = await requireIdentity(request);
  return Response.json(await acceptInvitation(uid, token));
}, { limit: 30, windowMs: 60000 });
