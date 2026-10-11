import { createHash, randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { compareObservations, comparisonWindows, cycleTimestamp, latestEligibleCheckpointDay, nextOngoingReviewDay, ongoingCheckpointWindows, pacificDay, PROGRESS_POLICY, shiftDay } from '../progressAssessment';
import { RequestError } from './requestAuth';
import { getGscConnection } from './gscConnection';
import { fetchPageObservation } from './pageObservation';
import { fetchCurrentPageContent } from './scrapeContent';
import { ongoingReviewEnabled } from './ongoingReviewFeature';

const DAY = 86400000;
const COLLECTION = 'pageProgressCycles';
const MAX_CYCLES = 40;
const MAX_CONCURRENCY = 4;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = (value, max = 500) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null;
const errorCode = error => error?.message === 'reconnect_required' ? 'reconnect_required' : 'temporarily_unavailable';
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function ongoingCycleRef(id) {
  if (!validId(id)) throw new RequestError('Choose a saved page review.', 400);
  return db.collection(COLLECTION).doc(id);
}
export function ongoingCycleId(record) {
  return hash([record.userId, record.gscProperty || record.property, record.websiteRunId || null, record.pageUrl, cycleTimestamp(record.implementedAt || record.confirmedAt)]);
}

export async function readOngoingScope(userId, { tx, write = false } = {}) {
  if (typeof userId !== 'string' || !userId || userId.includes('/')) throw new RequestError('Sign in to continue.', 401);
  if (write && !ongoingReviewEnabled(userId)) throw new RequestError('Ongoing page reviews are currently paused. Saved observations remain available.', 409);
  const [userDoc, setupDoc, legacyDoc] = await Promise.all(['users', 'onboarding', 'gscTokens'].map(name => {
    const ref = db.collection(name).doc(userId); return tx ? tx.get(ref) : ref.get();
  }));
  const user = userDoc.data() || {}, setup = setupDoc.data() || {}, legacy = legacyDoc.data() || {};
  const property = setup.gscProperty || user.gscSiteUrl || legacy.siteUrl;
  if (!userDoc.exists || !setupDoc.exists || user.deletionInProgress || setup.deletionInProgress) throw new RequestError('This account is no longer available.', 409);
  if (!property || (user.gscSiteUrl && user.gscSiteUrl !== property)) throw new RequestError('Your website connection changed. Reload before continuing.', 409);
  if (write && (!setup.isComplete || setup.revampArchivePending || setup.revampStatus === 'in-progress' || setup.progressReviewRequired)) {
    throw new RequestError('Review your website setup before continuing.', 409);
  }
  return { userId, property, websiteRunId: setup.revampRunId || null };
}
export function assertOngoingCycleScope(cycle, scope) {
  if (!cycle || cycle.userId !== scope.userId) throw new RequestError('Page review not found.', 404);
  if (cycle.property !== scope.property || (cycle.websiteRunId || null) !== scope.websiteRunId || !propertyContainsUrl(scope.property, cycle.pageUrl)) {
    throw new RequestError('This review belongs to an earlier website setup. Reload your current page.', 409);
  }
}
const inScope = (cycle, scope) => cycle.property === scope.property && (cycle.websiteRunId || null) === scope.websiteRunId;

export function publicOngoingCycle(data, { readOnly = false } = {}) {
  if (!data) return null;
  const { userId, leaseId: _lease, leaseUntil: _until, followUpLease: _followUpLease, ...visible } = data;
  const decision = data.latestDecision;
  const decisionMatchesCheckpoint = decision?.checkpointId === data.latestCheckpointId
    && decision?.checkpointRevision === data.latestCheckpoint?.evidenceRevision;
  return { ...visible, id: data.id, cycleId: data.id,
    ...(decision ? { latestDecision: { ...decision, canAcceptTasks: decision.canAcceptTasks === true && decisionMatchesCheckpoint
      && !readOnly && ongoingReviewEnabled(userId) && data.lifecycle === 'active' } } : {}),
    state: data.lifecycle !== 'active' ? data.lifecycle : data.lastError ? 'error' : data.reviewStatus || 'collecting',
    canRecordInterveningChange: !readOnly && data.lifecycle === 'active' && ongoingReviewEnabled(userId),
    readOnly: readOnly || !ongoingReviewEnabled(userId) };
}
function workspaceCycle(data, options) {
  const cycle = publicOngoingCycle(data, options);
  const observation = value => {
    if (!value) return value;
    const { queries: _queries, ...summary } = value;
    return summary;
  };
  const checkpoint = value => value ? { ...value, baseline: observation(value.baseline), post: observation(value.post) } : value;
  const { tasks: _tasks, observedPage: _page, ...confirmation } = cycle.confirmation || {};
  return { ...cycle, confirmation, originalBaseline: observation(cycle.originalBaseline),
    latestCheckpoint: checkpoint(cycle.latestCheckpoint), originalComparison: checkpoint(cycle.originalComparison),
    latestDecision: cycle.latestDecision ? { ...cycle.latestDecision,
      proposedTasks: (cycle.latestDecision.proposedTasks || []).map(task => ({
        ...(task.id ? { id: task.id } : {}), type: task.type, label: task.label, instruction: task.instruction,
      })) } : null,
  };
}
export async function readOngoingCycle(userId, id) {
  const scope = await readOngoingScope(userId);
  const cycle = (await ongoingCycleRef(id).get()).data();
  if (!cycle || cycle.userId !== userId) throw new RequestError('Page review not found.', 404);
  // Ownership still permits reading preserved history after a website rebuild.
  return publicOngoingCycle(cycle, { readOnly: !inScope(cycle, scope) });
}
export async function readOngoingProgress(userId, { cursor, pageUrl } = {}) {
  if (cursor !== undefined && cursor !== null && !validId(cursor)) throw new RequestError('Choose a valid history page.');
  const scope = await readOngoingScope(userId);
  if (pageUrl !== undefined && (typeof pageUrl !== 'string' || pageUrl.length > 2048 || !propertyContainsUrl(scope.property, pageUrl))) throw new RequestError('Choose a page on your connected website.', 400);
  let activeQuery = db.collection(COLLECTION).where('userId', '==', userId).where('property', '==', scope.property)
    .where('websiteRunId', '==', scope.websiteRunId).where('lifecycle', '==', 'active');
  if (pageUrl) activeQuery = activeQuery.where('pageUrl', '==', pageUrl);
  let query = db.collection(COLLECTION).where('userId', '==', userId).orderBy('__name__').limit(MAX_CYCLES + 1);
  if (cursor) query = query.startAfter(cursor);
  const [snapshot, active] = await Promise.all([query.get(), activeQuery.orderBy('__name__').limit(MAX_CYCLES + 1).get()]);
  const selected = snapshot.docs.slice(0, MAX_CYCLES);
  const records = active.docs.slice(0, MAX_CYCLES).map(document => workspaceCycle(document.data())), history = [];
  for (const document of selected) {
    const cycle = document.data();
    if (cycle.userId !== userId || (pageUrl && cycle.pageUrl !== pageUrl)) continue;
    const current = inScope(cycle, scope), record = workspaceCycle(cycle, { readOnly: !current });
    if (!current || cycle.lifecycle !== 'active') history.push(record);
  }
  const newestFirst = (a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt);
  return { enabled: ongoingReviewEnabled(userId), records: records.sort(newestFirst), history: history.sort(newestFirst),
    activeRecordsLimited: active.size > MAX_CYCLES, nextCursor: snapshot.size > MAX_CYCLES ? selected.at(-1).id : null };
}

export function newOngoingCycle(record, plan, { migrated = false, now = new Date() } = {}) {
  const confirmedAt = cycleTimestamp(record.implementedAt);
  if (!Number.isFinite(Date.parse(confirmedAt))) throw new RequestError('This publication is missing a valid confirmation date.', 409);
  const id = ongoingCycleId(record);
  const tasks = (plan?.tasks || []).filter(task => (record.confirmedTaskIds || []).includes(task.id));
  return { schemaVersion: 1, id, revision: 1, userId: record.userId, property: record.gscProperty,
    websiteRunId: record.websiteRunId || null, pageUrl: record.pageUrl, confirmedAt,
    confirmation: { source: migrated ? 'migrated_owner_reported' : 'owner_reported',
      taskIds: record.confirmedTaskIds || [], taskLabels: record.confirmedTaskLabels || [],
      summary: record.pageChangeSummary || 'Published title and description changes.',
      changeType: record.changeType || 'metadata', sourcePlanId: record.sourcePlanId || null,
      sourcePlanRevision: record.sourcePlanRevision || null, searchFocus: plan?.review?.analysis?.searchFocus || null,
      title: record.title || null, description: record.description || null,
      observedPage: record.confirmedPageObservation || null,
      tasks: tasks.map(task => ({ id: task.id, recommendation: task.recommendation, draft: task.draft || null })),
    },
    lifecycle: 'active', reviewStatus: 'collecting', createdAt: now.toISOString(), migratedAt: migrated ? now.toISOString() : null,
    latestCheckpoint: null, latestCheckpointId: null, latestDecision: null, latestDecisionId: null,
    originalComparison: null, technical: null, lastError: null,
    nextCheckAt: now.toISOString(), nextReviewAt: nextOngoingReviewDay(confirmedAt),
    nextTechnicalAt: `${shiftDay(pacificDay(confirmedAt), 7)}T20:00:00.000Z`,
    lastAttemptAt: null, lastSuccessAt: null, leaseId: null, leaseUntil: null,
  };
}

// Read first; the caller queues all writes only after this returns. This lets the
// publication record, task statuses and both cycle identities commit together.
export async function prepareOngoingConfirmation(tx, record, plan, { previousCycleId, previousCycleRevision, interveningChange = false, now = new Date() } = {}) {
  if (!ongoingReviewEnabled(record.userId)) return null;
  const scope = await readOngoingScope(record.userId, { tx, write: true });
  const cycle = newOngoingCycle(record, plan, { now });
  assertOngoingCycleScope(cycle, scope);
  const ref = ongoingCycleRef(cycle.id), existing = await tx.get(ref);
  if (existing.exists) throw new RequestError('This confirmation already has a saved review. Reload before continuing.', 409);
  let previous = null, previousRef = null;
  if (previousCycleId) {
    previousRef = ongoingCycleRef(previousCycleId);
    previous = (await tx.get(previousRef)).data(); assertOngoingCycleScope(previous, scope);
    if (previous.lifecycle !== 'active' || previous.pageUrl !== record.pageUrl || previous.revision !== previousCycleRevision) {
      throw new RequestError('The active page review changed. Reload before recording another publication.', 409);
    }
    if (interveningChange !== true && previous.reviewChangesAllowed !== true) throw new RequestError('Confirm that you published an additional change before starting another measurement.', 409);
    cycle.previousCycleId = previous.id;
    cycle.confirmation.interveningChange = interveningChange === true;
  }
  return { cycle, commit() {
    if (previous) tx.update(previousRef, { lifecycle: 'superseded', supersededByCycleId: cycle.id,
      supersededAt: record.implementedAt, revision: previous.revision + 1, leaseId: null, leaseUntil: null });
    tx.create(ref, cycle);
  } };
}

// Existing confirmations retain their exact dates. Migration is an explicit
// refresh/collector operation, never a write performed by a GET request.
export async function migrateOngoingRecord(document, { now = new Date(), deadline = Date.now() + 220000 } = {}) {
  if (deadline - Date.now() < 3000) return null;
  const original = document.data();
  if (!original?.userId || !ongoingReviewEnabled(original.userId) || original.preRevampArchived
    || original.status !== 'implemented' || original.source !== 'manual-page-review'
    || original.confirmationMethod !== 'user-confirmed' || !original.gscProperty
    || !Number.isFinite(Date.parse(cycleTimestamp(original.implementedAt)))) return null;
  return db.runTransaction(async tx => {
    const scope = await readOngoingScope(original.userId, { tx, write: true });
    const current = (await tx.get(document.ref)).data();
    if (!current || current.userId !== original.userId || current.pageUrl !== original.pageUrl
      || current.status !== 'implemented' || current.preRevampArchived || cycleTimestamp(current.implementedAt) !== cycleTimestamp(original.implementedAt)) return null;
    let sourcePlan = null;
    if (validId(current.sourcePlanId)) {
      const plan = (await tx.get(db.collection('pageReviewPlans').doc(current.sourcePlanId))).data();
      if (plan && plan.userId === current.userId && plan.pageUrl === current.pageUrl && plan.property === scope.property
        && (plan.websiteRunId || null) === scope.websiteRunId && plan.revision >= current.sourcePlanRevision
        && (current.confirmedTaskIds || []).every(id => plan.tasks?.some(task => task.id === id
          && cycleTimestamp(task.publication?.implementedAt) === cycleTimestamp(current.implementedAt)))) sourcePlan = plan;
    }
    if (deadline - Date.now() < 1000) return null;
    const candidate = newOngoingCycle(current, sourcePlan, { migrated: true, now }); assertOngoingCycleScope(candidate, scope);
    const ref = ongoingCycleRef(candidate.id), existing = await tx.get(ref);
    if (existing.exists) { assertOngoingCycleScope(existing.data(), scope); return existing.data(); }
    // Only genuine server observations become an original comparison; legacy
    // preStats/postStats remain labeled historical data outside this collection.
    const assessment = current.progressAssessment;
    const windows = comparisonWindows(current.implementedAt, now);
    if (assessment?.source === 'google_search_console' && assessment.property === scope.property
      && assessment.pageUrl === current.pageUrl && assessment.implementedAt === cycleTimestamp(current.implementedAt)
      && (assessment.websiteRunId || null) === scope.websiteRunId
      && assessment.baseline?.startDate === windows.baseline.startDate && assessment.baseline?.endDate === windows.baseline.endDate
      && assessment.post?.startDate === windows.post.startDate && assessment.post?.endDate === windows.post.endDate) {
      candidate.originalComparison = { baseline: assessment.baseline, post: assessment.post, windows,
        comparison: compareObservations(assessment.baseline, assessment.post), source: 'google_search_console', migrated: true };
    }
    tx.create(ref, candidate); tx.update(document.ref, { ongoingCycleId: candidate.id }); return candidate;
  });
}

function inspection(payload, at, confirmedAt) {
  const result = payload?.inspectionResult, data = result?.indexStatusResult;
  if (!data || typeof data !== 'object' || !['verdict', 'coverageState', 'indexingState'].some(key => typeof data[key] === 'string')) throw new RequestError('temporarily_unavailable', 503);
  let inspectionUrl = null;
  try { const url = new URL(result.inspectionResultLink); if (url.protocol === 'https:' && url.hostname === 'search.google.com') inspectionUrl = url.href; } catch { /* optional */ }
  return { status: 'available', source: 'google_url_inspection', checkedAt: at,
    verdict: clean(data.verdict), coverageState: clean(data.coverageState), indexingState: clean(data.indexingState),
    pageFetchState: clean(data.pageFetchState), robotsTxtState: clean(data.robotsTxtState),
    googleCanonical: clean(data.googleCanonical, 2048), userCanonical: clean(data.userCanonical, 2048),
    lastCrawlTime: Number.isFinite(Date.parse(data.lastCrawlTime)) ? data.lastCrawlTime : null, inspectionUrl,
    crawlAfterConfirmation: Number.isFinite(Date.parse(data.lastCrawlTime)) ? Date.parse(data.lastCrawlTime) >= Date.parse(confirmedAt) : null,
    limitation: 'Google’s stored indexing view. A later crawl does not prove Google processed each edit.' };
}
function technicalIssues(publicPage, indexing, pageUrl) {
  const issues = [];
  if (publicPage?.status === 'available') {
    if (publicPage.finalUrl !== pageUrl) issues.push({ code: 'redirect', severity: 'attention', message: 'This page redirects. Review the destination before interpreting its traffic.' });
    if (publicPage.noindex === true) issues.push({ code: 'noindex', severity: 'attention', message: 'The live page declares noindex. Review this setting if the page should appear in Google.' });
    if (publicPage.canonicalUrl && publicPage.canonicalUrl !== pageUrl) issues.push({ code: 'canonical', severity: 'attention', message: 'The page names a different canonical URL. Traffic may be attributed elsewhere.' });
  } else if (publicPage?.httpStatus === 404 || publicPage?.httpStatus === 410) issues.push({ code: 'not_found', severity: 'attention', message: 'This page returned a not-found response. Check the live address.' });
  if (indexing?.status === 'available' && ['BLOCKED_BY_META_TAG', 'BLOCKED_BY_HTTP_HEADER'].includes(indexing.indexingState)) issues.push({ code: 'google_noindex', severity: 'attention', message: 'Google’s saved inspection reports an indexing block. Check the live settings and inspection date.' });
  if (indexing?.status === 'available' && indexing.robotsTxtState === 'DISALLOWED') issues.push({ code: 'google_robots', severity: 'attention', message: 'Google’s saved inspection reports blocked crawling. Check robots.txt and the inspection date.' });
  return issues;
}
async function collectTechnical(cycle, connection, { deadline, signal, now }) {
  const at = now.toISOString(), errors = {}, result = { ...(cycle.technical || {}) };
  await Promise.all([
    fetchCurrentPageContent(cycle.pageUrl, { property: cycle.property, deadline, signal }).then(page => {
      result.publicPage = { status: 'available', checkedAt: at, finalUrl: page.finalUrl, httpStatus: page.technical?.httpStatus || 200,
        canonicalUrl: page.technical?.canonicalUrl || null, noindex: page.technical?.noindex === true || page.technical?.noindex?.generic === true || page.technical?.noindex?.googlebot === true,
        robotsMeta: page.technical?.robotsMeta || [], xRobotsTag: page.technical?.xRobotsTag || null,
        title: page.htmlTitle, description: page.seoMetaDescription, h1: page.h1 };
    }).catch(error => {
      if ([404, 410].includes(error?.httpStatus)) result.publicPage = { status: 'not_found', checkedAt: at, httpStatus: error.httpStatus, finalUrl: cycle.pageUrl };
      else errors.publicPage = errorCode(error);
    }),
    connection.inspect(cycle.pageUrl).then(payload => { result.indexing = inspection(payload, at, cycle.confirmedAt); }).catch(error => { errors.indexing = errorCode(error); }),
  ]);
  result.checkedAt = at; result.errors = Object.keys(errors).length ? errors : null;
  result.issues = technicalIssues(result.publicPage, result.indexing, cycle.pageUrl).map(issue => ({ ...issue,
    checkedAt: issue.code.startsWith('google_') ? result.indexing?.checkedAt : result.publicPage?.checkedAt,
    stale: issue.code.startsWith('google_') ? Boolean(errors.indexing) : Boolean(errors.publicPage) }));
  return result;
}

function observationId(window) { return hash(['web', window.startDate, window.endDate]); }
async function queryReport(connection, cycle, window, now) {
  const report = { queriesCheckedAt: now.toISOString() };
  try {
    const payload = await connection.query({ ...window, type: 'web', dataState: 'final', dimensions: ['query'], rowLimit: 100,
      dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'equals', expression: cycle.pageUrl }] }] });
    if (payload.error || (payload.rows !== undefined && !Array.isArray(payload.rows))) throw new Error('Invalid query response');
    const rows = payload.rows || [];
    if (rows.length > 100 || rows.some(row => !Array.isArray(row.keys) || row.keys.length !== 1 || typeof row.keys[0] !== 'string'
      || ![row.clicks, row.impressions, row.ctr, row.position].every(Number.isFinite) || row.clicks < 0 || row.impressions < row.clicks
      || row.ctr < 0 || row.ctr > 1 || (row.impressions > 0 && row.position < 1))) throw new Error('Invalid query response');
    report.queries = rows.map(row => ({ query: row.keys[0].slice(0, 1024), clicks: row.clicks, impressions: row.impressions,
      ctr: row.impressions ? row.clicks / row.impressions : null, position: row.impressions ? row.position : null }));
    report.queriesStatus = rows.length ? 'available' : 'not_reported';
    report.queryCoverage = { limit: 100, truncated: rows.length === 100, partial: true,
      limitation: 'Google omits some searches. Missing query rows are not measured zero traffic.' };
  } catch { report.queries = []; report.queriesStatus = 'unavailable'; }
  return report;
}
async function queryObservation(connection, cycle, window, now) {
  const observation = await fetchPageObservation(connection, cycle.pageUrl, window, now);
  return { ...observation, ...(await queryReport(connection, cycle, window, now)), queryRevision: 1 };
}
function withinGoogleHistory(window, now) {
  const oldest = new Date(`${pacificDay(now)}T12:00:00Z`); oldest.setUTCMonth(oldest.getUTCMonth() - 16);
  return window.startDate >= oldest.toISOString().slice(0, 10);
}

async function collectCycle(userId, id, { now = new Date(), deadline = Date.now() + 210000, signal, technicalOnly = false, scheduled = false, expectedRevision } = {}) {
  const ref = ongoingCycleRef(id), attempt = randomUUID(), at = now.toISOString();
  const cycle = await db.runTransaction(async tx => {
    const scope = await readOngoingScope(userId, { tx, write: true });
    const current = (await tx.get(ref)).data(); assertOngoingCycleScope(current, scope);
    if (current.lifecycle !== 'active') throw new RequestError('This review is preserved as history.', 409);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new RequestError('This page review changed. Reload before checking it.', 409);
    const cacheAt = technicalOnly ? current.technical?.checkedAt : current.lastAttemptAt;
    const cooldown = technicalOnly ? 6 * 3600000 : scheduled ? DAY : 15 * 60000;
    if (Date.parse(current.leaseUntil) > now.getTime() || Date.parse(current.followUpLease?.expiresAt) > now.getTime() || Date.parse(cacheAt) + cooldown > now.getTime()
      || (scheduled && Date.parse(current.nextCheckAt) > now.getTime())) return null;
    if (deadline - Date.now() < 5000 || signal?.aborted) return null;
    tx.update(ref, { leaseId: attempt, leaseUntil: new Date(now.getTime() + 240000).toISOString(), lastAttemptAt: at });
    return current;
  });
  if (!cycle) return { state: 'skipped', cycle: await readOngoingCycle(userId, id) };
  const patch = {}, errors = {}, observations = new Map(), checkpointWrites = [];
  const latestDay = latestEligibleCheckpointDay(cycle.confirmedAt, now);
  const originalWindows = comparisonWindows(cycle.confirmedAt, now);
  const oldCheckpoints = await ref.collection('checkpoints').orderBy('day', 'desc').limit(60).get();
  const checkpointsByDay = new Map(oldCheckpoints.docs.map(doc => [doc.data().day, doc.data()]));
  const existingDays = new Set(oldCheckpoints.docs.map(doc => doc.data().day));
  const checkpointDays = [];
  const retryQueries = point => point && [point.baseline, point.post].some(period => period?.queriesStatus === 'unavailable');
  if (!technicalOnly && latestDay > 0 && (!existingDays.has(latestDay) || retryQueries(checkpointsByDay.get(latestDay)))) checkpointDays.push(latestDay);
  // One old missing block per run prevents a long absence from becoming an
  // unbounded provider backlog. Always retain the original first comparison.
  if (!technicalOnly && latestDay > 28) {
    for (let day = cycle.backfillNextDay || 28; day < latestDay; day += 28) if (!existingDays.has(day)) { checkpointDays.push(day); break; }
  }
  let connection;
  try {
    connection = await getGscConnection(userId, { deadline, signal });
    if (connection.siteUrl !== cycle.property) throw new RequestError('reconnect_required', 409);
    const observe = async window => {
      const key = observationId(window);
      if (observations.has(key)) return observations.get(key);
      const previous = (await ref.collection('observations').doc(key).get()).data();
      if (previous?.source === 'google_search_console' && previous.pageUrl === cycle.pageUrl && previous.property === cycle.property
        && previous.startDate === window.startDate && previous.endDate === window.endDate) {
        // Never refetch or rewrite successful page totals. A missing query report
        // may recover separately, with a new dated query revision.
        let value = previous;
        if (previous.queriesStatus === 'unavailable' && withinGoogleHistory(window, now) && deadline - Date.now() >= 3000) {
          const report = await queryReport(connection, cycle, window, now);
          patch.lastQueryAttemptAt = at;
          if (report.queriesStatus !== previous.queriesStatus || JSON.stringify(report.queries) !== JSON.stringify(previous.queries)) {
            value = { ...previous, ...report, queryRevision: (previous.queryRevision || 1) + 1 };
          } else if (report.queriesStatus === 'unavailable') errors.queries = 'temporarily_unavailable';
        }
        observations.set(key, value); return value;
      }
      if (!withinGoogleHistory(window, now)) return { status: 'unavailable', reason: 'outside_google_history', ...window, fetchedAt: at };
      if (deadline - Date.now() < 3000 || signal?.aborted) throw new RequestError('temporarily_unavailable', 503);
      const value = await queryObservation(connection, cycle, window, now); observations.set(key, value); return value;
    };
    if (!technicalOnly && originalWindows.baseline.endDate <= originalWindows.completeThrough) {
      try { patch.originalBaseline = cycle.originalBaseline || cycle.originalComparison?.baseline || await observe(originalWindows.baseline); }
      catch (error) { errors.baseline = errorCode(error); }
    }
    for (const day of checkpointDays) {
      if (deadline - Date.now() < 5000) { errors.checkpoint = 'deferred'; break; }
      const windows = ongoingCheckpointWindows(cycle.confirmedAt, day, now);
      try {
        const baseline = await observe(windows.baseline), post = await observe(windows.post);
        const previousPoint = checkpointsByDay.get(day);
        if (previousPoint && (previousPoint.baseline?.queryRevision || 1) === (baseline.queryRevision || 1)
          && (previousPoint.post?.queryRevision || 1) === (post.queryRevision || 1)) continue;
        const available = baseline.status !== 'unavailable' && post.status !== 'unavailable';
        const lowVolume = !available || baseline.impressions < PROGRESS_POLICY.minImpressionsPerWindow
          || post.impressions < PROGRESS_POLICY.minImpressionsPerWindow || baseline.clicks + post.clicks < PROGRESS_POLICY.minCombinedClicks;
        const point = { id: `day-${day}`, day, evidenceRevision: (checkpointsByDay.get(day)?.evidenceRevision || 0) + 1, source: 'google_search_console', observedAt: at, windows,
          baseline, post, comparison: available ? compareObservations(baseline, post) : null, lowVolume,
          state: available ? 'available' : 'incomplete',
          limitation: 'Observed changes do not prove that the edits caused them. Query coverage and external factors can differ.' };
        checkpointWrites.push(point);
        if (!(patch.latestCheckpoint || cycle.latestCheckpoint) || day >= (patch.latestCheckpoint || cycle.latestCheckpoint).day) patch.latestCheckpoint = point;
        if (day === 28) patch.originalComparison = { baseline, post, windows, comparison: point.comparison, source: point.source, observedAt: at };
      } catch (error) { errors[`checkpoint${day}`] = errorCode(error); }
    }
    if (technicalOnly || Date.parse(cycle.nextTechnicalAt) <= now.getTime()) {
      if (deadline - Date.now() >= 5000) {
        patch.technical = await collectTechnical(cycle, connection, { deadline, signal, now });
        if (patch.technical.errors) errors.technical = 'temporarily_unavailable';
        patch.nextTechnicalAt = new Date(now.getTime() + (patch.technical.errors ? DAY : 7 * DAY)).toISOString();
      } else errors.technical = 'deferred';
    }
  } catch (error) { errors.connection = errorCode(error); }
  const errorsPresent = Object.keys(errors).length > 0;
  const updated = await db.runTransaction(async tx => {
    const scope = await readOngoingScope(userId, { tx, write: true });
    const current = (await tx.get(ref)).data(); assertOngoingCycleScope(current, scope);
    if (current.lifecycle !== 'active' || current.leaseId !== attempt) return current;
    const observationRefs = [...observations.keys()].map(key => ref.collection('observations').doc(key));
    const checkpointRefs = checkpointWrites.map(point => ref.collection('checkpoints').doc(point.id));
    const existing = await Promise.all([...observationRefs, ...checkpointRefs].map(item => tx.get(item)));
    const latestCheckpoint = patch.latestCheckpoint && (!current.latestCheckpoint || patch.latestCheckpoint.day >= current.latestCheckpoint.day)
      ? patch.latestCheckpoint : current.latestCheckpoint;
    const hasNewCheckpoint = latestCheckpoint?.id && (latestCheckpoint.id !== current.latestCheckpoint?.id || latestCheckpoint.evidenceRevision !== current.latestCheckpoint?.evidenceRevision);
    const attention = (patch.technical || current.technical)?.issues?.some(issue => !issue.stale);
    const age = now.getTime() - Date.parse(current.confirmedAt);
    let backfillNextDay = current.backfillNextDay || 28;
    while (backfillNextDay <= latestDay && (existingDays.has(backfillNextDay) || checkpointWrites.some(point => point.day === backfillNextDay))) backfillNextDay += 28;
    const stillMissing = backfillNextDay <= latestDay;
    const interval = errorsPresent || stillMissing || age < 90 * DAY ? DAY : 7 * DAY;
    const next = { ...current, ...patch, latestCheckpoint: latestCheckpoint || null,
      latestCheckpointId: latestCheckpoint?.id || null,
      originalComparison: current.originalComparison || patch.originalComparison || null,
      originalBaseline: current.originalBaseline || patch.originalBaseline || null,
      backfillNextDay,
      nextCheckAt: new Date(now.getTime() + interval).toISOString(),
      nextReviewAt: nextOngoingReviewDay(current.confirmedAt, latestCheckpoint?.day || 0),
      reviewStatus: attention ? 'needs_attention' : hasNewCheckpoint ? 'review_due' : current.reviewStatus,
      lastError: errorsPresent ? { checkedAt: at, ...errors } : null,
      lastSuccessAt: errorsPresent ? current.lastSuccessAt : at, lastAttemptAt: at,
      leaseId: null, leaseUntil: null, revision: current.revision + 1 };
    for (let index = 0; index < observationRefs.length; index++) {
      const value = [...observations.values()][index], previous = existing[index].data();
      if (!previous) tx.create(observationRefs[index], value);
      else if (value.queryRevision > (previous.queryRevision || 1)) {
        tx.set(observationRefs[index].collection('queryHistory').doc(String(value.queryRevision)), {
          queries: value.queries, queriesStatus: value.queriesStatus, queriesCheckedAt: value.queriesCheckedAt, queryRevision: value.queryRevision,
        });
        tx.update(observationRefs[index], value);
      }
    }
    for (let index = 0; index < checkpointRefs.length; index++) {
      const previous = existing[observationRefs.length + index].data();
      if (!previous) tx.create(checkpointRefs[index], checkpointWrites[index]);
      else if (checkpointWrites[index].evidenceRevision > previous.evidenceRevision) {
        tx.set(checkpointRefs[index].collection('versions').doc(String(previous.evidenceRevision)), previous);
        tx.update(checkpointRefs[index], checkpointWrites[index]);
      }
    }
    tx.update(ref, next); return next;
  });
  return { state: updated.lifecycle !== 'active' ? 'superseded' : errorsPresent ? 'error' : updated.latestCheckpoint ? 'ready' : 'collecting', cycle: publicOngoingCycle(updated) };
}

export async function refreshOngoingProgress(userId, { cycleId, expectedRevision, now = new Date(), deadline = Date.now() + 220000, signal, technicalOnly = false } = {}) {
  await readOngoingScope(userId, { write: true });
  if (cycleId) return collectCycle(userId, cycleId, { now, deadline, signal, technicalOnly, expectedRevision });
  const records = await db.collection('implementedSeoTips').where('userId', '==', userId).limit(MAX_CYCLES).get();
  for (const document of records.docs.slice(0, MAX_CYCLES)) {
    if (Date.now() >= deadline) break;
    try { await migrateOngoingRecord(document, { now, deadline }); } catch { /* One stale legacy scope cannot prevent current cycles collecting. */ }
  }
  const workspace = await readOngoingProgress(userId);
  let next = 0, checked = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, workspace.records.length) }, async () => {
    while (next < workspace.records.length && deadline - Date.now() >= 5000) {
      const item = workspace.records[next++];
      try { await collectCycle(userId, item.id, { now, deadline, signal, technicalOnly }); } catch { /* Each cycle retains its own dated evidence. */ }
      checked++;
    }
  }));
  return { ...(await readOngoingProgress(userId)), checked, moreRecords: checked < workspace.records.length || Boolean(workspace.nextCursor) };
}

export async function acknowledgeOngoingCycle(userId, { cycleId, revision, action }, now = new Date()) {
  if (!['keep_monitoring', 'review_changes'].includes(action) || !Number.isSafeInteger(revision)) throw new RequestError('Choose how to continue this page review.');
  const ref = ongoingCycleRef(cycleId);
  const cycle = await db.runTransaction(async tx => {
    const scope = await readOngoingScope(userId, { tx, write: true });
    const current = (await tx.get(ref)).data(); assertOngoingCycleScope(current, scope);
    if (current.lifecycle !== 'active' || current.revision !== revision) throw new RequestError('This page review changed. Reload before continuing.', 409);
    if (!current.latestCheckpoint && action === 'review_changes') throw new RequestError('Check the completed reporting period before reviewing another change. You can inspect a technical problem anytime.', 409);
    const next = { ...current, revision: current.revision + 1, reviewStatus: 'reviewed',
      reviewChangesAllowed: action === 'review_changes', lastAcknowledgedCheckpointId: current.latestCheckpointId,
      acknowledgedAt: now.toISOString(), nextReviewAt: nextOngoingReviewDay(current.confirmedAt, current.latestCheckpoint?.day || 0) };
    tx.update(ref, next); return next;
  });
  return { success: true, cycle: publicOngoingCycle(cycle) };
}

export async function runOngoingProgressCollection({ now = new Date(), deadline = Date.now() + 220000, maxRecords = MAX_CYCLES } = {}) {
  const limit = Math.min(MAX_CYCLES, Math.max(1, maxRecords));
  const allowed = (process.env.ONGOING_PAGE_REVIEW_PILOT_UIDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (process.env.ONGOING_PAGE_REVIEWS_ENABLED !== 'true' || !allowed.length) return { checked: 0, counts: {}, moreRecords: false, notificationsSent: 0, automaticOutcomesEnabled: false };
  const base = () => db.collection(COLLECTION).where('lifecycle', '==', 'active').where('nextCheckAt', '<=', now.toISOString());
  // Filter pilot membership in the due query: paused accounts cannot occupy the
  // front of the queue forever, and disabling the feature performs no writes.
  const queries = allowed.includes('*') ? [base()] : Array.from({ length: Math.ceil(allowed.length / 30) }, (_, index) => base().where('userId', 'in', allowed.slice(index * 30, index * 30 + 30)));
  const snapshots = [];
  for (const query of queries) {
    if (deadline - Date.now() < 3000) break;
    snapshots.push(await query.orderBy('nextCheckAt').limit(limit + 1).get());
  }
  const due = snapshots.flatMap(snapshot => snapshot.docs).sort((a, b) => a.data().nextCheckAt.localeCompare(b.data().nextCheckAt) || a.id.localeCompare(b.id));
  const documents = due.slice(0, limit);
  let next = 0, checked = 0;
  const counts = {};
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, documents.length) }, async () => {
    while (next < documents.length && deadline - Date.now() >= 5000) {
      const document = documents[next++], cycle = document.data();
      if (!ongoingReviewEnabled(cycle.userId)) { counts.skipped = (counts.skipped || 0) + 1; checked++; continue; }
      try {
        const result = await collectCycle(cycle.userId, document.id, { now, deadline, scheduled: true });
        counts[result.state] = (counts[result.state] || 0) + 1;
      } catch {
        counts.error = (counts.error || 0) + 1;
        // A changed scope or deleting account must not monopolize the due queue.
        await db.runTransaction(async tx => {
          const current = await tx.get(document.ref);
          if (current.exists && current.data().lifecycle === 'active' && current.data().confirmedAt === cycle.confirmedAt) {
            const [user, setup] = await Promise.all([tx.get(db.collection('users').doc(cycle.userId)), tx.get(db.collection('onboarding').doc(cycle.userId))]);
            if (!user.exists || user.data().deletionInProgress) return;
            const changedScope = !setup.exists || (setup.data().revampRunId || null) !== cycle.websiteRunId
              || (setup.data().gscProperty || user.data().gscSiteUrl) !== cycle.property;
            tx.update(document.ref, { ...(changedScope ? { lifecycle: 'paused', pausedReason: 'website_setup_changed', revision: current.data().revision + 1 } : {}),
              nextCheckAt: new Date(now.getTime() + DAY).toISOString(), leaseId: null, leaseUntil: null });
          }
        });
      }
      checked++;
    }
  }));
  return { checked, counts, moreRecords: snapshots.length < queries.length || due.length > checked, notificationsSent: 0, automaticOutcomesEnabled: false };
}
