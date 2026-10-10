import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { propertyContainsUrl } from '../revampState';

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '956212275866-7dtgdq7b38b156riehghuvh8b8469ktg.apps.googleusercontent.com';
const reconnect = () => new RequestError('reconnect_required', 409);
export async function getGscConnection(uid) {
  const [user, legacy, onboarding] = await Promise.all(['users', 'gscTokens', 'onboarding'].map(c => db.collection(c).doc(uid).get()));
  const u = user.data() || {}, l = legacy.data() || {}, o = onboarding.data() || {};
  const expected = o.gscProperty || u.gscSiteUrl || l.siteUrl;
  const primary = { accessToken: u.gscAccessToken, refreshToken: u.gscRefreshToken, siteUrl: u.gscSiteUrl, expiresAt: u.gscExpiresAt || (Date.parse(u.gscConnectedAt) + 3600000) };
  if (primary.siteUrl && primary.siteUrl !== expected) throw reconnect();
  let connection;
  if (primary.siteUrl && primary.refreshToken) connection = primary;
  else if (l.siteUrl === expected && l.refreshToken) connection = { ...l, ...(primary.accessToken ? { accessToken: primary.accessToken, expiresAt: primary.expiresAt } : {}) };
  else if (primary.siteUrl && primary.accessToken) connection = primary;
  else if (l.siteUrl === expected && l.accessToken) connection = l;
  else throw reconnect();
  let refreshing;
  const refresh = async () => {
    if (!connection.refreshToken) throw reconnect();
    if (refreshing) return refreshing;
    refreshing = (async () => {
      let res;
      try {
        res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || '', refresh_token: connection.refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15000) });
      } catch { throw new RequestError('temporarily_unavailable', 503); }
      const payload = await res.json();
      if (!res.ok) { if (payload.error === 'invalid_grant') throw reconnect(); throw new RequestError('temporarily_unavailable', 503); }
      if (!payload.access_token) throw new RequestError('temporarily_unavailable', 503);
      connection = { ...connection, accessToken: payload.access_token, refreshToken: payload.refresh_token || connection.refreshToken, expiresAt: Date.now() + (payload.expires_in || 3600) * 1000 };
      await db.collection('users').doc(uid).set({ gscAccessToken: connection.accessToken, gscRefreshToken: connection.refreshToken, gscSiteUrl: connection.siteUrl, gscExpiresAt: connection.expiresAt, gscConnectedAt: new Date().toISOString() }, { merge: true });
    })();
    try { await refreshing; } finally { refreshing = null; }
  };
  if (!connection.accessToken || !connection.expiresAt || connection.expiresAt < Date.now() + 300000) await refresh();
  const requestGoogle = async (endpoint, body) => {
    const send = () => fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${connection.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    let response;
    try { response = await send(); if (response.status === 401) { await refresh(); response = await send(); } }
    catch (e) { if (e instanceof RequestError) throw e; throw new RequestError('temporarily_unavailable', 503); }
    if (response.status === 401 || response.status === 403) throw reconnect();
    if (!response.ok) throw new RequestError('temporarily_unavailable', 503);
    try { return await response.json(); } catch { throw new RequestError('temporarily_unavailable', 503); }
  };
  return {
    siteUrl: connection.siteUrl,
    async browserCredentials() {
      return { access_token: connection.accessToken, expires_in: Math.max(0, Math.floor((connection.expiresAt - Date.now()) / 1000)), siteUrl: connection.siteUrl };
    },
    async query(body) {
      return requestGoogle(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(connection.siteUrl)}/searchAnalytics/query`, body);
    },
    async inspect(pageUrl) {
      if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || !propertyContainsUrl(connection.siteUrl, pageUrl)) throw new RequestError('Page must belong to your connected Search Console property.', 403);
      const url = new URL(pageUrl);
      if (url.username || url.password || url.hash || (url.port && !['80', '443'].includes(url.port))) throw new RequestError('Enter a valid public page URL.');
      // URL Inspection supports the existing webmasters.readonly scope. This
      // reads Google's stored index view; it cannot request indexing/live tests.
      return requestGoogle('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        inspectionUrl: pageUrl, siteUrl: connection.siteUrl, languageCode: 'en-US',
      });
    },
  };
}
