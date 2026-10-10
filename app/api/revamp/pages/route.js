import { db } from '../../../lib/firebaseAdmin';
import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
import { propertyContainsUrl, normalizeRevampPage } from '../../../lib/revampState';
export async function POST(request) {
  try {
    const body = await request.json(); const uid = await requireUser(request, body.userId);
    if (!Array.isArray(body.pages) || body.pages.length > 200) throw new RequestError('Invalid page list.');
    const ref = db.collection('onboarding').doc(uid);
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!current?.isComplete || (body.runId || null) !== (current.revampRunId || null)) throw new RequestError('Reload your website setup.', 409);
      const property = current.gscProperty || current.websiteUrl;
      const additions = body.pages.map(normalizeRevampPage);
      if (additions.some(page => !propertyContainsUrl(property, page.url))) throw new RequestError('Pages must belong to your website.');
      const pages = new Map((current.revampPages || []).map(normalizeRevampPage).map(p => [p.url, p]));
      for (const page of additions) if (!pages.has(page.url)) pages.set(page.url, { url: page.url, searchDataStatus: 'not_checked', ...(page.finalUrl && propertyContainsUrl(property, page.finalUrl) ? { finalUrl: page.finalUrl } : {}) });
      tx.update(ref, { revampPages: [...pages.values()], revampMonitoringEnabled: true, revampStep: current.revampStep === 'complete' ? 'complete' : 'waiting' });
    });
    return Response.json({ success: true });
  } catch (e) { return errorResponse(e); }
}
