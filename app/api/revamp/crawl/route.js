import { db } from '../../../lib/firebaseAdmin';
import { requireUser, errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { POST as crawlSite } from '../../crawl-site/route';
export async function POST(request) {
  try {
    const body = await request.json(); const uid = await requireUser(request, body.userId);
    const data = (await db.collection('onboarding').doc(uid).get()).data();
    if (!data?.websiteUrl) throw new RequestError('No website configured.', 404);
    // Stage suggestions without clearing existing pages or user preferences.
    const result = await crawlSite(new Request(new URL('/api/crawl-site', request.url), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: request.headers.get('authorization') }, body: JSON.stringify({ userId: uid, websiteUrl: data.websiteUrl, mode: 'initial' }) }));
    if (!result.ok) return result;
    const crawl = await result.json();
    return Response.json({ success: true, pages: (crawl.pages || []).map(p => ({ url: p.pageUrl || p.url, searchDataStatus: 'not_checked' })), errors: crawl.errors });
  } catch (e) { return errorResponse(e); }
}
