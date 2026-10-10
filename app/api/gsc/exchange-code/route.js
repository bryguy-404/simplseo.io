import { db } from '../../../lib/firebaseAdmin';
import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
import { GOOGLE_CLIENT_ID } from '../../../lib/server/gscConnection';
export async function POST(request) {
  try {
    const body = await request.json();
    const uid = await requireUser(request, body.userId);
    if (body.accessToken && body.property) {
      const existing = (await db.collection('users').doc(uid).get()).data() || {};
      if (existing.gscSiteUrl && body.property !== existing.gscSiteUrl && !body.refreshToken) throw new RequestError('Reconnect Google with full consent before changing properties.', 409);
      const values = { gscAccessToken: body.accessToken, gscSiteUrl: body.property, gscConnectedAt: new Date().toISOString() };
      if (body.refreshToken) values.gscRefreshToken = body.refreshToken;
      await db.collection('users').doc(uid).set(values, { merge: true });
      return Response.json({ success: true });
    }
    if (!body.code || !/^[a-f0-9]{64}$/.test(body.state || '')) throw new RequestError('Restart the Google connection.');
    const stateRef = db.collection('gscOAuthStates').doc(body.state);
    const state = await db.runTransaction(async tx => {
      const value = (await tx.get(stateRef)).data();
      if (!value || value.uid !== uid || value.expiresAt < Date.now()) throw new RequestError('Google connection expired. Try again.', 403);
      tx.delete(stateRef); return value;
    });
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || '', code: body.code, grant_type: 'authorization_code', redirect_uri: state.redirectUri }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new RequestError('Google connection could not be completed. Your previous connection is preserved.', 502);
    const tokens = await response.json();
    if (!tokens.access_token) throw new RequestError('Google did not return a connection.', 502);
    const existing = (await db.collection('users').doc(uid).get()).data() || {};
    const values = { gscAccessToken: tokens.access_token, gscExpiresAt: Date.now() + (tokens.expires_in || 3600) * 1000, gscConnectedAt: new Date().toISOString() };
    if (tokens.refresh_token) values.gscRefreshToken = tokens.refresh_token;
    if (body.property) {
      if (existing.gscSiteUrl && body.property !== existing.gscSiteUrl && !tokens.refresh_token) throw new RequestError('Select the existing property or reconnect with full consent.', 409);
      values.gscSiteUrl = body.property;
    }
    await db.collection('users').doc(uid).set(values, { merge: true });
    return Response.json({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expires_in });
  } catch (e) { return errorResponse(e); }
}
