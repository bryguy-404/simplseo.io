import { db } from '../firebaseAdmin';
import { getGscConnection } from './gscConnection';
import { RequestError } from './requestAuth';
import { observationWindow, normalizeRevampPage, observePage, propertyContainsUrl } from '../revampState';

export async function monitorRevamp(uid, { maxPages = Infinity, deadline = Infinity, scheduled = false } = {}) {
  const ref = db.collection('onboarding').doc(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new RequestError('No website setup found.', 404);
  const data = snapshot.data();
  const runId = data.revampRunId || null;
  const attemptedAt = new Date().toISOString();
  const window = observationWindow(data.revampDate);
  const pages = (data.revampPages || []).map(normalizeRevampPage);
  if (!window || !pages.length || (scheduled && data.revampMonitoringEnabled !== true)) return { pages, connectionStatus: 'not_checked', checked: 0, morePages: false };
  const ordered = [...pages].sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  const afterCursor = scheduled ? ordered.filter(page => !data.revampMonitorCursor || page.url > data.revampMonitorCursor) : ordered;
  const selected = scheduled ? (afterCursor.length ? afterCursor : ordered).slice(0, maxPages) : pages;
  if (Date.now() >= deadline) return { pages, connectionStatus: 'deferred', checked: 0, morePages: true };
  let connection;
  let connectionError;
  try { connection = await getGscConnection(uid, { deadline }); } catch (error) { connectionError = error; }
  let next = 0;
  const updated = new Array(selected.length);
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (next < selected.length && Date.now() < deadline) {
      const i = next++, page = selected[i];
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
  const completed = updated.filter(Boolean);
  if (!completed.length) return { pages, connectionStatus: 'deferred', checked: 0, morePages: true };
  const morePages = completed.length < pages.length;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data();
    if (!latest || (latest.revampRunId || null) !== runId || latest.gscProperty !== data.gscProperty
      || (scheduled && latest.revampMonitoringEnabled !== true)) throw new RequestError('Website setup changed. Reload before checking again.', 409);
    const byUrl = new Map(completed.map(p => [p.url, p]));
    // Preserve pages added during the request and any more recent observation.
    const merged = (latest.revampPages || []).map(normalizeRevampPage).map(p => p.lastAttemptAt > attemptedAt ? p : byUrl.get(p.url) || p);
    tx.update(ref, { revampPages: merged, revampLastCheckedAt: latest.revampLastCheckedAt > attemptedAt ? latest.revampLastCheckedAt : attemptedAt,
      ...(scheduled && (!latest.revampLastCheckedAt || latest.revampLastCheckedAt <= attemptedAt)
        ? { revampMonitorCursor: completed.at(-1).url } : {}),
    });
  });
  const byUrl = new Map(completed.map(page => [page.url, page]));
  return { pages: pages.map(page => byUrl.get(page.url) || page), checked: completed.length, morePages,
    connectionStatus: connectionError ? (connectionError.message === 'reconnect_required' ? 'reconnect_required' : 'temporarily_unavailable')
      : completed.some(p => p.lastError === 'reconnect_required') ? 'reconnect_required' : completed.some(p => p.lastError) ? 'temporarily_unavailable' : 'usable' };
}
