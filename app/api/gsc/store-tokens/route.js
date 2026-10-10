import { db } from '../../../lib/firebaseAdmin';
import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
export async function POST(request) {
  try {
    const body = await request.json(); const uid = await requireUser(request, body.userId);
    if (!body.accessToken || !body.siteUrl) throw new RequestError('An access token and property are required.');
    const existing = (await db.collection('users').doc(uid).get()).data() || {};
    if (existing.gscSiteUrl && body.siteUrl !== existing.gscSiteUrl && !body.refreshToken) throw new RequestError('Reconnect Google with full consent before changing properties.', 409);
    const values = { gscAccessToken: body.accessToken, gscSiteUrl: body.siteUrl, gscExpiresAt: Date.now() + 3600000, gscConnectedAt: new Date().toISOString() };
    if (body.refreshToken) values.gscRefreshToken = body.refreshToken;
    await db.collection('users').doc(uid).set(values, { merge: true });
    return Response.json({ success: true });
  } catch (e) { return errorResponse(e); }
}
export async function DELETE(request) {
  try {
    const uid = await requireUser(request);
    await db.collection('users').doc(uid).set({ gscAccessToken: null, gscRefreshToken: null, gscSiteUrl: null, gscExpiresAt: null, gscConnectedAt: null, gscLastSync: null }, { merge: true });
    await db.collection('gscTokens').doc(uid).delete();
    return Response.json({ success: true });
  } catch (e) { return errorResponse(e); }
}
