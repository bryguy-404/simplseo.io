import { db } from '../firebaseAdmin';
import { PROGRESS_SCHEMA_VERSION, PROGRESS_SOURCE, PROGRESS_POLICY, comparisonWindows, progressIsPaused, assessObservations, pacificDay, progressCycleIsReviewable } from '../progressAssessment';
import { propertyContainsUrl } from '../revampState';
import { getGscConnection } from './gscConnection';
import { fetchPageObservation } from './pageObservation';
import { RequestError } from './requestAuth';

const MAX_CONCURRENCY = 4;
const MAX_RECORDS = 40;
const COOLDOWN_MS = 15 * 60 * 1000;
const cycleDate = value => value?.toDate ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : value || null;
function baseAssessment(data, now) {
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION, source: PROGRESS_SOURCE,
    pageUrl: data.pageUrl || null, implementedAt: cycleDate(data.implementedAt),
    websiteRunId: data.websiteRunId || null,
    windows: comparisonWindows(data.implementedAt, now), attemptedAt: now.toISOString(),
    property: null, baseline: null, post: null, comparison: null,
    automaticOutcome: null,
  };
}
function isSameCycle(assessment, data) {
  return assessment?.schemaVersion === PROGRESS_SCHEMA_VERSION
    && assessment.source === PROGRESS_SOURCE
    && assessment.pageUrl === data.pageUrl
    && (assessment.websiteRunId || null) === (data.websiteRunId || null)
    && assessment.implementedAt === cycleDate(data.implementedAt);
}
function expectedProperty(onboarding, user) {
  return onboarding?.gscProperty || user?.gscSiteUrl || null;
}
function recordInCurrentScope(data, onboarding, property) {
  return !data.preRevampArchived
    && (data.websiteRunId || null) === (onboarding?.revampRunId || null)
    && (!data.gscProperty || data.gscProperty === property) && propertyContainsUrl(property, data.pageUrl);
}
function currentRecord(data, onboarding, property) {
  return data.status === 'implemented' && recordInCurrentScope(data, onboarding, property);
}
function displayRecord(id, data, property) {
  return { id, pageUrl: data.pageUrl, implementedAt: cycleDate(data.implementedAt), websiteRunId: data.websiteRunId || null, property,
    confirmedTaskIds: Array.isArray(data.confirmedTaskIds) ? data.confirmedTaskIds : [],
    confirmedTaskLabels: Array.isArray(data.confirmedTaskLabels) ? data.confirmedTaskLabels : [],
    ...(data.changeType === 'page_content'
      ? { changeType: 'page_content', pageChangeSummary: typeof data.pageChangeSummary === 'string' ? data.pageChangeSummary.slice(0, 600) : '' }
      : { changeType: 'metadata', title: typeof data.title === 'string' ? data.title.slice(0, 500) : '', description: typeof data.description === 'string' ? data.description.slice(0, 1000) : '' }),
  };
}

async function readPreviousComparisons(docs, uid, onboarding, property, now) {
  const scoped = docs.filter(doc => recordInCurrentScope(doc.data(), onboarding, property) && ['implemented', 'reviewed'].includes(doc.data().status)).sort((a, b) => a.id.localeCompare(b.id));
  const histories = await Promise.allSettled(scoped.slice(0, MAX_RECORDS).map(async doc => {
    const snapshot = await doc.ref.collection('cycles').orderBy('reviewedAt', 'desc').limit(5).get();
    const result = snapshot.docs.flatMap(cycleDoc => {
      const archive = cycleDoc.data(), data = archive?.data;
      if (!data || archive.userId !== uid || data.userId !== uid || archive.property !== property || (archive.websiteRunId || null) !== (onboarding?.revampRunId || null)
        || data.pageUrl !== doc.data().pageUrl || !recordInCurrentScope(data, onboarding, property)) return [];
      return [{ ...displayRecord(doc.id, data, property), historyId: cycleDoc.id, reviewedAt: archive.reviewedAt || null,
        assessment: assessmentForDisplay(data, { ...onboarding, progressReviewRequired: false, revampStatus: 'complete' }, property, now), canStartNextCycle: false }];
    });
    const current = doc.data();
    if (current.status === 'reviewed' && !result.some(record => record.implementedAt === cycleDate(current.implementedAt))) {
      result.unshift({ ...displayRecord(doc.id, current, property), historyId: `current-${doc.id}`, reviewedAt: current.reviewedAt || null,
        assessment: assessmentForDisplay(current, { ...onboarding, progressReviewRequired: false, revampStatus: 'complete' }, property, now), canStartNextCycle: false });
    }
    return result.slice(0, 5);
  }));
  return { history: histories.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .sort((a, b) => Date.parse(b.reviewedAt || b.implementedAt) - Date.parse(a.reviewedAt || a.implementedAt)),
  historyUnavailable: histories.some(result => result.status === 'rejected'), historyLimited: scoped.length > MAX_RECORDS };
}
function assessmentForDisplay(data, onboarding, property, now) {
  const base = baseAssessment(data, now);
  if (progressIsPaused(onboarding)) return { ...base, property, state: 'paused', reason: 'account_review_required' };
  if (isSameCycle(data.progressAssessment, data) && data.progressAssessment.property === property) return data.progressAssessment;
  return { ...base, property, state: 'collecting', reason: 'awaiting_verified_observations' };
}

export async function readProgress(uid, now = new Date()) {
  const [account, user, snapshot] = await Promise.all([
    db.collection('onboarding').doc(uid).get(), db.collection('users').doc(uid).get(),
    db.collection('implementedSeoTips').where('userId', '==', uid).get(),
  ]);
  const onboarding = account.data();
  const property = expectedProperty(onboarding, user.data());
  const previousComparisons = await readPreviousComparisons(snapshot.docs, uid, onboarding, property, now);
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION, source: PROGRESS_SOURCE, property,
    paused: progressIsPaused(onboarding), pauseReason: progressIsPaused(onboarding) ? 'account_review_required' : null,
    policy: PROGRESS_POLICY, notificationsEnabled: false, automaticOutcomesEnabled: false,
    websiteRunId: onboarding?.revampRunId || null,
    ...previousComparisons,
    records: snapshot.docs.filter(doc => currentRecord(doc.data(), onboarding, property)).map(doc => {
      const data = doc.data();
      return { ...displayRecord(doc.id, data, property),
        canStartNextCycle: onboarding?.isComplete === true && !progressIsPaused(onboarding) && !onboarding?.revampArchivePending && progressCycleIsReviewable(data, property, onboarding?.revampRunId, now),
        assessment: assessmentForDisplay(data, onboarding, property, now) };
    }),
  };
}

async function persistAssessment(doc, original, assessment, onboardingAtStart) {
  return db.runTransaction(async tx => {
    const [current, account, user] = await Promise.all([
      tx.get(doc.ref), tx.get(db.collection('onboarding').doc(original.userId)), tx.get(db.collection('users').doc(original.userId)),
    ]);
    const data = current.data();
    const onboarding = account.data();
    if (!data || data.preRevampArchived || data.status !== 'implemented' || data.userId !== original.userId
      || data.pageUrl !== original.pageUrl || cycleDate(data.implementedAt) !== cycleDate(original.implementedAt)) return false;
    if (!currentRecord(data, onboarding, expectedProperty(onboarding, user.data()))) return false;
    // A rebuild, new implementation, or connection change wins over an in-flight check.
    if (onboarding?.revampRunId !== onboardingAtStart?.revampRunId || progressIsPaused(onboarding) !== progressIsPaused(onboardingAtStart)) return false;
    if (assessment.property && expectedProperty(onboarding, user.data()) !== assessment.property) return false;
    if (Date.parse(data.progressAssessment?.attemptedAt) > Date.parse(assessment.attemptedAt)) return false;
    tx.update(doc.ref, { progressAssessment: assessment });
    return true;
  });
}

export async function collectProgressRecord(doc, { now = new Date(), connectionCache = new Map() } = {}) {
  const original = doc.data();
  if (original.preRevampArchived || original.status !== 'implemented' || !original.userId) return 'skipped';
  const [account, user] = await Promise.all([db.collection('onboarding').doc(original.userId).get(), db.collection('users').doc(original.userId).get()]);
  const onboarding = account.data();
  let assessment = { ...baseAssessment(original, now), property: expectedProperty(onboarding, user.data()) };
  if (!currentRecord(original, onboarding, assessment.property)) return 'skipped';
  const previous = original.progressAssessment;
  if (isSameCycle(previous, original) && previous.property === assessment.property) {
    // Keep the last successful dated evidence even if the account is paused or
    // its original baseline later ages out of Google's available history.
    assessment.baseline = previous.baseline || null;
    assessment.post = previous.post || null;
  }
  if (progressIsPaused(onboarding)) {
    assessment = { ...assessment, state: 'paused', reason: 'account_review_required' };
  } else if (!assessment.windows || !original.pageUrl) {
    assessment = { ...assessment, state: 'insufficient_data', reason: 'implementation_date_or_page_missing' };
  } else if (!assessment.windows.ready) {
    assessment = { ...assessment, state: 'collecting', reason: 'waiting_for_complete_post_window' };
  } else {
    try {
      if (!connectionCache.has(original.userId)) connectionCache.set(original.userId, getGscConnection(original.userId));
      const connection = await connectionCache.get(original.userId);
      if (connection.siteUrl !== assessment.property) throw new RequestError('reconnect_required', 409);
      // Search Analytics retains a limited history. Do not interpret expired data
      // as a genuine zero baseline. A conservative 16-month boundary is explicit.
      const oldest = new Date(`${pacificDay(now)}T12:00:00Z`);
      oldest.setUTCMonth(oldest.getUTCMonth() - 16);
      if (assessment.windows.baseline.startDate < oldest.toISOString().slice(0, 10)) {
        assessment = { ...assessment, state: 'insufficient_data', reason: 'baseline_outside_available_history' };
      } else {
        const baseline = await fetchPageObservation(connection, original.pageUrl, assessment.windows.baseline, now);
        const post = await fetchPageObservation(connection, original.pageUrl, assessment.windows.post, now);
        assessment = { ...assessment, baseline, post, ...assessObservations(baseline, post) };
      }
    } catch (error) {
      // Keep successful observations as dated historical evidence on errors,
      // but clear comparison and expose error state; no zero or stale verdict.
      const preserve = isSameCycle(previous, original) && previous.property === assessment.property;
      assessment = { ...assessment, baseline: preserve ? previous.baseline : null, post: preserve ? previous.post : null,
        comparison: null, state: 'error', reason: error.message === 'reconnect_required' ? 'reconnect_required' : 'search_data_unavailable' };
    }
  }
  const saved = await persistAssessment(doc, original, assessment, onboarding);
  return saved ? assessment.state : 'superseded';
}

async function collectBatch(docs, now, startedAt) {
  let next = 0;
  const results = [];
  const connectionCache = new Map();
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, docs.length) }, async () => {
    while (next < docs.length && Date.now() - startedAt < 90000) {
      const index = next++;
      try { results[index] = await collectProgressRecord(docs[index], { now, connectionCache }); }
      catch { results[index] = 'error'; }
    }
  }));
  return { results, processed: next };
}

async function acquireJob(id, now, cooldown) {
  const ref = db.collection('progressJobs').doc(id);
  const attempt = `${now.toISOString()}-${Math.random().toString(36).slice(2)}`;
  const previous = await db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data() || {};
    if (Date.parse(prior.leaseUntil) > now.getTime() || Date.parse(prior.lastStartedAt) + cooldown > now.getTime()) throw new RequestError('Please wait before checking progress again.', 429);
    tx.set(ref, { attempt, lastStartedAt: now.toISOString(), leaseUntil: new Date(now.getTime() + 240000).toISOString() }, { merge: true });
    return prior;
  });
  return { ref, attempt, previous };
}
async function finishJob(job, patch) {
  await db.runTransaction(async tx => {
    const current = (await tx.get(job.ref)).data();
    if (current?.attempt === job.attempt) tx.set(job.ref, { ...patch, leaseUntil: null }, { merge: true });
  });
}

export async function refreshUserProgress(uid, now = new Date()) {
  const account = (await db.collection('onboarding').doc(uid).get()).data();
  if (progressIsPaused(account)) return { ...(await readProgress(uid, now)), checked: 0 };
  const startedAt = Date.now();
  const job = await acquireJob(`user-${uid}`, now, COOLDOWN_MS);
  try {
    const snapshot = await db.collection('implementedSeoTips').where('userId', '==', uid).get();
    const user = (await db.collection('users').doc(uid).get()).data();
    const active = snapshot.docs.filter(doc => currentRecord(doc.data(), account, expectedProperty(account, user))).sort((a, b) => a.id.localeCompare(b.id));
    const afterCursor = active.filter(doc => !job.previous.cursor || doc.id > job.previous.cursor);
    const docs = (afterCursor.length ? afterCursor : active).slice(0, MAX_RECORDS);
    const batch = await collectBatch(docs, now, startedAt);
    const last = docs[batch.processed - 1]?.id;
    await finishJob(job, { cursor: last || null, lastFinishedAt: new Date().toISOString() });
    return { ...(await readProgress(uid, now)), checked: batch.processed, moreRecords: batch.processed < active.length };
  } catch (error) { await finishJob(job, { lastErrorAt: new Date().toISOString() }); throw error; }
}

export async function runProgressCollection(now = new Date()) {
  const startedAt = Date.now();
  const job = await acquireJob('daily-progress', now, 60000);
  try {
    let query = db.collection('implementedSeoTips').orderBy('__name__').limit(MAX_RECORDS);
    if (job.previous.cursor) query = query.startAfter(job.previous.cursor);
    let snapshot = await query.get();
    if (snapshot.empty && job.previous.cursor) snapshot = await db.collection('implementedSeoTips').orderBy('__name__').limit(MAX_RECORDS).get();
    const batch = await collectBatch(snapshot.docs, now, startedAt);
    const counts = batch.results.reduce((all, state) => ({ ...all, [state]: (all[state] || 0) + 1 }), {});
    await finishJob(job, { cursor: snapshot.docs[batch.processed - 1]?.id || null, lastFinishedAt: new Date().toISOString(), counts });
    return { checked: batch.processed, counts, moreRecords: batch.processed < snapshot.size || snapshot.size === MAX_RECORDS,
      notificationsSent: 0, strategiesSaved: 0, automaticOutcomesEnabled: false };
  } catch (error) { await finishJob(job, { lastErrorAt: new Date().toISOString() }); throw error; }
}
