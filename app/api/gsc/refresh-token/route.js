import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { getGscConnection } from '../../../lib/server/gscConnection';

// Compatibility for existing browser Search Console views. Refresh credentials
// are chosen and retained on the server, never accepted from request input.
export async function POST(request) {
  try {
    const body = await request.json();
    const uid = await requireUser(request, body.userId);
    const connection = await getGscConnection(uid);
    return Response.json(await connection.browserCredentials(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
