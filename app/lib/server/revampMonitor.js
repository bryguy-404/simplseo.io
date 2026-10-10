import { db } from '../firebaseAdmin';
import { getGscConnection } from './gscConnection';
import { RequestError } from './requestAuth';
import { observationWindow, normalizeRevampPage, observePage, propertyContainsUrl } from '../revampState';

export async function monitorRevamp(uid) {
  const ref = db.collection('onboarding').doc(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new RequestError('No website setup found.', 404);
  const data = snapshot.data();
  const runId = data.revampRunId || null;
  const attemptedAt = new Date().toISOString();
  const window = observationWindow(data.revampDate);
  const pages = (data.revampPages || []).map(normalizeRevampPage);
  if (!window || !pages.length) return { pages, connectionStatus: 'not_checked' };
  let connection;
  let connectionError;
  try { connection = await getGscConnection(uid); } catch (error) { connectionError = error; }
  let next = 0;
  const updated = new Array(pages.length);
  await Promise.all(Array.from({ length: Math.min(4, pages.length) }, async () => {
    while (next < pages.length) {
      const i = next++, page = pages[i];
      try {
        if (connectionError) throw connectionError;
        if (!propertyContainsUrl(connection.siteUrl, page.url)) throw new RequestError('Page does not match the connected property.', 400);
        const result = await connection.query({ ...window, dimensions: ['page'], dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: page.url }] }], rowLimit: 1 });
        updated[i] = observePage(page, result.rows || [], window, attemptedAt);
      } catch (error) {
        updated[i] = { ...page, lastAttemptAt: attemptedAt, lastError: error.status ? error.message : 'temporarily_unavailable' };
      }
    }
  }));
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data();
    if ((latest.revampRunId || null) !== runId) throw new RequestError('Website setup changed. Reload before checking again.', 409);
    const byUrl = new Map(updated.map(p => [p.url, p]));
    // Preserve pages added during the request and any more recent observation.
    const merged = (latest.revampPages || []).map(normalizeRevampPage).map(p => p.lastAttemptAt > attemptedAt ? p : byUrl.get(p.url) || p);
    tx.update(ref, { revampPages: merged, revampLastCheckedAt: attemptedAt });
  });
  return { pages: updated, connectionStatus: connectionError?.message || (updated.some(p => p.lastError === 'reconnect_required') ? 'reconnect_required' : updated.some(p => p.lastError) ? 'temporarily_unavailable' : 'usable') };
}
