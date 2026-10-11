import { randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { mentorPageInScope } from './mentorContext';
import { assertMentorAccountScope, mentorHash } from './mentorAccountScope';
import { refreshSavedMentorActivity } from './mentorActivitySnapshots';
import { fetchCurrentPageContent } from './scrapeContent';
import { getGscConnection } from './gscConnection';
import { readOngoingCycle, refreshOngoingProgress } from './ongoingProgress';
import { RequestError } from './requestAuth';

const COOLDOWN = 15 * 60000;
const publicCheck = saved => ({ kind: saved.kind, pageUrl: saved.pageUrl, result: saved.result || null,
  lastAttemptAt: saved.lastAttemptAt || null, lastSuccessAt: saved.lastSuccessAt || null, lastError: saved.lastError || null });

export async function runMentorCheck(uid, scope, { kind, pageUrl, cycleId }, { now = new Date(),
  deadline = Date.now() + 60000, signal, requestId } = {}) {
  if (kind === 'page') kind = 'technical';
  if (!['activity', 'technical', 'progress'].includes(kind) || !mentorPageInScope(scope, pageUrl) || new URL(pageUrl).hash) {
    throw new RequestError('Choose one page and a supported check.', 400);
  }
  await assertMentorAccountScope(uid, scope);
  if (kind === 'progress') {
    const cycle = await readOngoingCycle(uid, cycleId);
    if (cycle.readOnly || cycle.pageUrl !== pageUrl || cycle.property !== scope.property || (cycle.websiteRunId || null) !== scope.websiteRunId) {
      throw new RequestError('Choose the active review for this page.', 409);
    }
  }
  deadline = Math.min(deadline, Date.now() + 60000);
  if (deadline - Date.now() < 1000 || signal?.aborted) throw new RequestError('This check was interrupted. Try again.', 503);
  const ref = db.collection('mentorCheckOperations').doc(mentorHash([scope.key, kind, kind === 'progress' ? cycleId : pageUrl]));
  const quota = db.collection('requestLimits').doc(`mentor-check-${mentorHash([uid, now.toISOString().slice(0, 10)])}`);
  const leaseId = randomUUID();
  const reservation = await db.runTransaction(async tx => {
    await assertMentorAccountScope(uid, scope, tx);
    const [record, usage] = await Promise.all([tx.get(ref), tx.get(quota)]), saved = record.data();
    if (saved && (saved.userId !== uid || saved.scopeKey !== scope.key)) throw new RequestError('This check is unavailable.', 409);
    if (Date.parse(saved?.leaseUntil || '') > now.getTime()) return { cached: true, pending: true, saved };
    if (saved && now.getTime() - Date.parse(saved.lastAttemptAt) < COOLDOWN) return { cached: true, saved };
    if ((usage.data()?.count || 0) >= 20) throw new RequestError('You have used today’s 20 mentor checks. Saved observations remain available.', 429);
    tx.set(quota, { userId: uid, count: (usage.data()?.count || 0) + 1, day: now.toISOString().slice(0, 10), kind: 'mentor_check' });
    tx.set(ref, { ...(saved || {}), userId: uid, property: scope.property, websiteUrl: scope.websiteUrl,
      websiteRunId: scope.websiteRunId, scopeKey: scope.key, kind, pageUrl, cycleId: cycleId || null,
      requestId: typeof requestId === 'string' ? requestId.slice(0, 100) : null,
      leaseId, leaseUntil: new Date(deadline).toISOString(), lastAttemptAt: now.toISOString() });
    return { saved };
  });
  if (reservation.cached) return { ...publicCheck(reservation.saved), cached: true, pending: Boolean(reservation.pending) };
  let result = null, error = null;
  try {
    if (kind === 'activity') {
      result = await refreshSavedMentorActivity(uid, scope, { pageUrl, force: true, now, deadline, signal });
      error = result.lastError || (result.pending ? 'An activity check is already running. Try again shortly.' : null);
    } else if (kind === 'progress') {
      result = await refreshOngoingProgress(uid, { cycleId, now, deadline, signal });
      error = result.state === 'error' ? 'Some progress checks were unavailable. Previous observations are retained.' : null;
    } else {
      const observations = await Promise.allSettled([
        fetchCurrentPageContent(pageUrl, { property: scope.property, allowedHostname: new URL(pageUrl).hostname, deadline, signal }),
        getGscConnection(uid, { deadline, signal }).then(connection => {
          if (connection.siteUrl !== scope.property) throw new RequestError('Google connection changed.', 409);
          return connection.inspect(pageUrl);
        }),
      ]);
      const [html, google] = observations;
      result = { pageUrl, checkedAt: now.toISOString(),
        website: html.status === 'fulfilled' ? { status: 'available', fetchedAt: html.value.fetchedAt,
          finalUrl: html.value.finalUrl, technical: html.value.technical, htmlTitle: html.value.htmlTitle,
          h1: html.value.h1, metaDescription: html.value.seoMetaDescription, limitations: html.value.structuralLimitations }
          : { status: 'unavailable', httpStatus: html.reason?.httpStatus || null,
            message: html.reason?.httpStatus ? `The page returned HTTP ${html.reason.httpStatus}.` : 'The live page check could not finish.' },
        indexing: google.status === 'fulfilled' ? { status: 'available', observedAt: now.toISOString(),
          indexStatusResult: google.value.inspectionResult?.indexStatusResult || null,
          inspectionResultLink: google.value.inspectionResult?.inspectionResultLink || null,
          meaning: 'Google’s stored indexing observation, not a live indexing test or indexing request.' }
          : { status: 'unavailable', observedAt: now.toISOString(), message: 'Google’s stored indexing status could not be read.' } };
      if (html.status === 'rejected' || google.status === 'rejected') error = 'Some checks could not finish. Previous successful observations remain dated below.';
    }
  } catch { error = 'This check could not finish. Previous observations are unchanged; try again.'; }
  return db.runTransaction(async tx => {
    await assertMentorAccountScope(uid, scope, tx);
    const saved = (await tx.get(ref)).data();
    if (saved?.leaseId !== leaseId) throw new RequestError('Another check replaced this request. Reload the saved result.', 409);
    const next = { ...saved, leaseId: null, leaseUntil: null, lastError: error,
      ...(!error ? { result, lastSuccessAt: now.toISOString(), failedObservation: null }
        : { failedObservation: result, ...(!saved.result ? { result } : {}) }) };
    tx.set(ref, next);
    return { ...publicCheck(next), cached: false, pending: false, ...(error ? { failedObservation: result } : {}) };
  });
}
