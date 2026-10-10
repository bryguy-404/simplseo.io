import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
import { getGscConnection } from '../../../lib/server/gscConnection';

async function listProperties(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 8192) throw new RequestError('Connect Google to select a property.');
  let response;
  try { response = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new RequestError('Google is temporarily unavailable. Try again.', 503); }
  if (response.status === 401 || response.status === 403) throw new RequestError('Reconnect Google to select a property.', 409);
  if (!response.ok) throw new RequestError('Google is temporarily unavailable. Try again.', 503);
  const data = await response.json();
  return Response.json({ success: true, properties: (data.siteEntry || []).filter(site => ['siteOwner', 'siteFullUser'].includes(site.permissionLevel)).map(({ siteUrl, permissionLevel }) => ({ siteUrl, permissionLevel })) }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(request) {
  try {
    const uid = await requireUser(request, new URL(request.url).searchParams.get('userId'));
    const connection = await getGscConnection(uid);
    return await listProperties((await connection.browserCredentials()).access_token);
  } catch (e) { return errorResponse(e); }
}
export async function POST(request) {
  try {
    const body = await request.json();
    await requireUser(request, body.userId);
    // New OAuth connections have no property yet. Tokens belong in the request
    // body, never query strings, browser history or request URLs.
    return await listProperties(body.accessToken);
  } catch (e) { return errorResponse(e); }
}
