import { db } from '../../../lib/firebaseAdmin';
import { requireIdentity, errorResponse } from '../../../lib/server/requestAuth';
import { readEarlyAccess } from '../../../lib/server/earlyAccessPolicy';
export async function GET(request) {
  try {
    const uid = await requireIdentity(request);
    const access = await readEarlyAccess(uid);
    const setup = access.approved ? (await db.collection('onboarding').doc(uid).get()).data() : null;
    return Response.json({ ...access, nextPath: access.approved ? setup?.isComplete ? '/dashboard' : '/onboarding' : '/request-access' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
