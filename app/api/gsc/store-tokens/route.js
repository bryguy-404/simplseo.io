import { db } from '../../../lib/firebaseAdmin';
import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
export async function POST(request) {
  try {
    const body = await request.json(); const uid = await requireUser(request, body.userId);
    if (!body.accessToken || !body.siteUrl) throw new RequestError('An access token and property are required.');
    const values = { gscAccessToken: body.accessToken, gscSiteUrl: body.siteUrl, gscExpiresAt: Date.now() + 3600000, gscConnectedAt: new Date().toISOString() };
    if (body.refreshToken) values.gscRefreshToken = body.refreshToken;
    await db.collection('users').doc(uid).set(values, { merge: true });
    return Response.json({ success: true });
  } catch (e) { return errorResponse(e); }
}
