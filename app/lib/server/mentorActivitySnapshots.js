import { randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { searchWindow } from '../searchWindow';
import { buildDashboardOverview, dashboardQueryPlans } from '../dashboardOverview';
import { getGscConnection } from './gscConnection';
import { collectPageReviewEvidence } from './pageReviewEvidence';
import { mentorPageInScope } from './mentorContext';
import { assertMentorAccountScope, mentorHash, readMentorAccountScope } from './mentorAccountScope';
import { RequestError } from './requestAuth';

const CACHE_MS = 6 * 3600000;
const COOLDOWN_MS = 15 * 60000;
const refFor = (scope, pageUrl, window) => db.collection('mentorActivitySnapshots').doc(mentorHash([scope.key, pageUrl || 'overview', window]));
const latestRefFor = (scope, pageUrl) => db.collection('mentorActivitySnapshots').doc(`latest-${mentorHash([scope.key, pageUrl || 'overview'])}`);
const visible = data => data ? { value: data.value || null, lastAttemptAt: data.lastAttemptAt || null,
  lastSuccessAt: data.lastSuccessAt || null, lastError: data.lastError || null, errorStatus: data.errorStatus || null } : null;

export async function readSavedMentorActivity(uid, scope, { pageUrl = null, now = new Date() } = {}) {
  await assertMentorAccountScope(uid, scope);
  if (pageUrl && !mentorPageInScope(scope, pageUrl)) throw new RequestError('Choose a page on your connected website.', 403);
  const snapshot = await refFor(scope, pageUrl, searchWindow('28', now)).get();
  let snapshotId = snapshot.id;
  let saved = snapshot.data();
  if (!saved?.value) {
    const latest = (await latestRefFor(scope, pageUrl).get()).data();
    if (latest?.userId === uid && latest.scopeKey === scope.key && /^[a-f0-9]{64}$/.test(latest.snapshotId || '')) {
      const previous = (await db.collection('mentorActivitySnapshots').doc(latest.snapshotId).get()).data();
      if (previous?.userId === uid && previous.scopeKey === scope.key) {
        snapshotId = latest.snapshotId;
        saved = { ...previous, ...(saved || {}), value: previous.value, lastSuccessAt: previous.lastSuccessAt };
      }
    }
  }
  if (saved && (saved.userId !== uid || saved.scopeKey !== scope.key)) throw new RequestError('Saved activity is unavailable.', 409);
  await assertMentorAccountScope(uid, scope);
  return saved ? { ...visible(saved), snapshotId } : null;
}

// Dashboard and page activity use this same cache as explicit mentor checks.
// Failed refreshes keep the prior complete value; partial new observations are
// exposed separately rather than silently mixing dates from different checks.
export async function refreshSavedMentorActivity(uid, scope, { pageUrl = null, force = false, includeHistory = false,
  now = new Date(), deadline = Date.now() + 60000, signal } = {}) {
  if (!scope.property || (pageUrl && !mentorPageInScope(scope, pageUrl))) throw new RequestError('Choose a page on your connected website.', 403);
  deadline = Math.min(deadline, Date.now() + 60000);
  if (deadline - Date.now() < 1000) throw new RequestError('This check ran out of time. Try again.', 503);
  const ref = refFor(scope, pageUrl, searchWindow('28', now));
  const latestRef = latestRefFor(scope, pageUrl);
  const operationId = randomUUID();
  const reservation = await db.runTransaction(async tx => {
    await assertMentorAccountScope(uid, scope, tx);
    let saved = (await tx.get(ref)).data();
    const latest = (await tx.get(latestRef)).data();
    if (!saved?.value && latest?.userId === uid && latest.scopeKey === scope.key && /^[a-f0-9]{64}$/.test(latest.snapshotId || '')) {
      const previous = (await tx.get(db.collection('mentorActivitySnapshots').doc(latest.snapshotId))).data();
      if (previous?.userId === uid && previous.scopeKey === scope.key) saved = { ...previous, ...(saved || {}), value: previous.value,
        lastSuccessAt: previous.lastSuccessAt };
    }
    if (saved && (saved.userId !== uid || saved.scopeKey !== scope.key)) throw new RequestError('Saved activity is unavailable.', 409);
    const age = now.getTime() - Date.parse(saved?.lastSuccessAt || '');
    const historyReady = !includeHistory || !pageUrl || (saved?.value?.history?.length || 0) >= 6;
    const sameWindow = JSON.stringify(saved?.value?.window) === JSON.stringify(searchWindow('28', now));
    if (saved?.value && sameWindow && age < (force ? COOLDOWN_MS : CACHE_MS) && historyReady) return { saved, cached: true };
    if (Date.parse(saved?.leaseUntil || '') > now.getTime()) return { saved, pending: true };
    tx.set(ref, { ...(saved || {}), userId: uid, scopeKey: scope.key, property: scope.property,
      websiteUrl: scope.websiteUrl, websiteRunId: scope.websiteRunId, pageUrl,
      leaseId: operationId, leaseUntil: new Date(deadline).toISOString(), lastAttemptAt: now.toISOString() });
    return { saved };
  });
  if (reservation.cached || reservation.pending) return { ...visible(reservation.saved), cached: true, pending: Boolean(reservation.pending) };
  let value = null, failed = null, errorStatus = null;
  try {
    if (pageUrl) value = await collectPageReviewEvidence(uid, { property: scope.property, pageUrl, now, deadline, signal, includeHistory });
    else {
      const connection = await getGscConnection(uid, { deadline, signal });
      if (connection.siteUrl !== scope.property) throw new RequestError('Your Google connection changed.', 409);
      const window = searchWindow('28', now);
      const [totalsResult, dailyResult, pagesResult] = await Promise.all(dashboardQueryPlans(window).map(body => connection.query(body)));
      value = buildDashboardOverview({ property: scope.property, window, fetchedAt: now.toISOString(), totalsResult, dailyResult, pagesResult });
    }
    if (pageUrl && value.status !== 'available') failed = 'Some search activity could not be checked. Previous saved activity is still available.';
  } catch (error) {
    errorStatus = [403, 409].includes(error.status) ? 409 : [502, 503].includes(error.status) ? error.status : 503;
    failed = error.message === 'reconnect_required' ? 'reconnect_required' : 'Search activity could not be checked. Try again.';
  }
  return db.runTransaction(async tx => {
    await assertMentorAccountScope(uid, scope, tx);
    const saved = (await tx.get(ref)).data();
    if (saved?.leaseId !== operationId) throw new RequestError('Another activity check replaced this one. Reload to see the saved result.', 409);
    const successful = !failed;
    const next = { ...saved, leaseId: null, leaseUntil: null, lastError: failed, errorStatus,
      ...(successful ? { value, lastSuccessAt: now.toISOString(), partialObservation: null }
        : value ? { partialObservation: value, ...(!saved.value ? { value } : {}) } : {}) };
    tx.set(ref, next);
    if (successful) tx.set(latestRef, { userId: uid, scopeKey: scope.key, property: scope.property,
      websiteUrl: scope.websiteUrl, websiteRunId: scope.websiteRunId, pageUrl, snapshotId: ref.id, lastSuccessAt: now.toISOString() });
    return { ...visible(next), cached: false, pending: false, ...(failed && value ? { partialObservation: value } : {}) };
  });
}

export async function readSharedDashboardOverview(uid, options = {}) {
  const scope = await readMentorAccountScope(uid);
  const result = await refreshSavedMentorActivity(uid, scope, options);
  if (!result.value) throw new RequestError(result.pending ? 'Search activity is already loading. Try again shortly.' : result.lastError || 'Reconnect Google to read search activity.', result.errorStatus || 503);
  return { ...result.value, observation: { lastAttemptAt: result.lastAttemptAt, lastSuccessAt: result.lastSuccessAt,
    lastError: result.lastError, cached: result.cached, pending: result.pending } };
}
