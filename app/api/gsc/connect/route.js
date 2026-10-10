import { randomBytes } from 'node:crypto';
import { db } from '../../../lib/firebaseAdmin';
import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { GOOGLE_CLIENT_ID } from '../../../lib/server/gscConnection';
export async function GET(request) {
  try {
    const uid = await requireUser(request);
    const state = randomBytes(32).toString('hex');
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${new URL(request.url).origin}/gsc-callback`;
    await db.collection('gscOAuthStates').doc(state).set({ uid, expiresAt: Date.now() + 600000, redirectUri });
    const query = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/webmasters.readonly', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
    return Response.json({ state, url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` });
  } catch (e) { return errorResponse(e); }
}
