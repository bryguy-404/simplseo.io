import { createHash, randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { seoImplementationId } from '../pageTaskFlow';
import { pacificDay, PROGRESS_POLICY, shiftDay } from '../progressAssessment';
import { isMonitoringCycle, nextCycleReviewDay } from '../pageMonitoring';
import { RequestError } from './requestAuth';
import { pageMonitoringEnabled } from './pageMonitoringFeature';
import { readPageTrackingIdentity, assertMonitoringReview } from './pageTrackingIdentity';
import { assertOngoingCycleScope, migrateOngoingRecord, ongoingCycleRef, publicOngoingCycle, readOngoingCycle, readOngoingScope, refreshOngoingProgress } from './ongoingProgress';
import { generatePageReviewSuggestions } from './manualPageReview';
import { readPageReviewPlan } from './pageReviewPlans';
import { consumeAiQuota } from './requestQuota';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const changed = () => new RequestError('This page’s monitoring changed. Reload before continuing.', 409);

export function newMonitoringCycle(scope, pageUrl, now = new Date()) {
  const startedAt = now.toISOString();
  const cycle = { schemaVersion: 1, mode: 'monitoring', id: hash([scope.userId, scope.property, scope.websiteRunId, pageUrl, randomUUID()]),
    ...scope, pageUrl, startedAt, observationAnchorDay: shiftDay(pacificDay(now), -PROGRESS_POLICY.reportingDelayDays),
    revision: 1, lifecycle: 'active', reviewStatus: 'collecting', createdAt: startedAt,
    initialReviewStatus: 'pending', initialReviewError: null, latestCheckpoint: null, latestCheckpointId: null,
    latestDecision: null, latestDecisionId: null, originalComparison: null, technical: null, lastError: null,
    nextCheckAt: startedAt, nextTechnicalAt: startedAt, lastAttemptAt: null, lastSuccessAt: null, leaseId: null, leaseUntil: null };
  return { ...cycle, nextReviewAt: nextCycleReviewDay(cycle) };
}

function validateUrl(pageUrl) {
  let parsed;
  try { parsed = new URL(pageUrl); } catch { throw new RequestError('Choose a valid page on your website.'); }
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username || parsed.password || parsed.hash || (parsed.port && !['80', '443'].includes(parsed.port))) throw new RequestError('Use the full page address without login details or a fragment.');
}

export async function enrollPageMonitoring(userId, pageUrl, { now = new Date() } = {}) {
  if (!pageMonitoringEnabled(userId)) throw new RequestError('Page monitoring is currently paused. Saved work remains available.', 409);
  validateUrl(pageUrl);
  const scope = await readOngoingScope(userId, { write: true });
  if (!propertyContainsUrl(scope.property, pageUrl)) throw new RequestError('Choose a page on your connected website.', 403);
  // Preserve an existing genuine publication rather than enrolling over it.
  const legacy = await db.collection('implementedSeoTips').doc(seoImplementationId(userId, pageUrl)).get();
  if (legacy.exists && (legacy.data().userId !== userId || legacy.data().pageUrl !== pageUrl)) throw new RequestError('This page record conflicts with another record. Please contact support before continuing.', 409);
  if (legacy.exists && legacy.data().userId === userId && legacy.data().pageUrl === pageUrl) await migrateOngoingRecord(legacy, { now });
  return db.runTransaction(async tx => {
    const currentScope = await readOngoingScope(userId, { tx, write: true });
    if (currentScope.property !== scope.property || currentScope.websiteRunId !== scope.websiteRunId || !pageMonitoringEnabled(userId)) throw changed();
    const tracking = await readPageTrackingIdentity(tx, scope, pageUrl);
    if (tracking.active) return { cycle: publicOngoingCycle(tracking.active), alreadyStarted: true };
    const cycle = newMonitoringCycle(scope, pageUrl, now);
    tx.create(ongoingCycleRef(cycle.id), cycle);
    tx.set(tracking.ref, { ...tracking.value, activeCycleId: cycle.id });
    return { cycle: publicOngoingCycle(cycle), alreadyStarted: false };
  });
}

export async function stopPageMonitoring(userId, { cycleId, expectedRevision }, now = new Date()) {
  if (!pageMonitoringEnabled(userId) || !Number.isSafeInteger(expectedRevision)) throw changed();
  const ref = ongoingCycleRef(cycleId);
  const cycle = await db.runTransaction(async tx => {
    const scope = await readOngoingScope(userId, { tx, write: true });
    const current = (await tx.get(ref)).data(); assertOngoingCycleScope(current, scope);
    if (current.lifecycle === 'stopped') return current;
    if (current.lifecycle !== 'active' || current.revision !== expectedRevision) throw changed();
    const tracking = await readPageTrackingIdentity(tx, scope, current.pageUrl);
    if (tracking.active?.id !== cycleId) throw changed();
    const next = { ...current, lifecycle: 'stopped', stoppedAt: now.toISOString(), revision: current.revision + 1,
      leaseId: null, leaseUntil: null, followUpLease: null };
    tx.update(ref, next); tx.set(tracking.ref, { ...tracking.value, activeCycleId: null, lastCycleId: cycleId });
    return next;
  });
  return { success: true, cycle: publicOngoingCycle(cycle) };
}

function initialDecision(cycle, review, plan) {
  const analysis = review.analysis;
  const outcome = ({ keep_current: 'keep_monitoring', collect_data: 'gather_evidence', review_page: 'investigate_visibility',
    investigate_visibility: 'investigate_visibility', improve_content: 'improve_page', revise_metadata: 'improve_page' })[analysis?.action];
  if (!outcome || !plan || plan.pageUrl !== cycle.pageUrl) throw new RequestError('The initial recommendation could not be verified.', 502);
  return { id: hash([cycle.id, plan.id, plan.revision, review.provenance.generatedAt]), cycleId: cycle.id, pageUrl: cycle.pageUrl,
    outcome, summary: analysis.summary, whatChanged: 'Monitoring started with a review of this page and its available search history.',
    meaning: analysis.reason, nextStep: analysis.nextStep, evidenceIds: analysis.evidenceIds,
    reviewedAt: review.provenance.generatedAt, sourcePlanRevision: plan.revision, proposedTasks: [],
    // Initial recommendations are already saved as the page plan; accepting them again would duplicate tasks.
    canAcceptTasks: false, acceptedAt: null, initialReview: true,
    checkpointId: cycle.latestCheckpointId || null, checkpointRevision: cycle.latestCheckpoint?.evidenceRevision ?? null };
}

export async function startPageMonitoring(userId, { pageUrl, goal, focusKeywords }, { signal, now = new Date(), deadline = Date.now() + 230000 } = {}) {
  if (goal !== undefined && (typeof goal !== 'string' || goal.length > 180 || /[\r\n\u0000-\u001f]/.test(goal))) throw new RequestError('Use a short, single-line goal for this page.');
  const enrolled = await enrollPageMonitoring(userId, pageUrl, { now });
  if (!isMonitoringCycle(enrolled.cycle) || enrolled.cycle.initialReviewStatus === 'complete') return { success: true, ...enrolled };
  let cycle = enrolled.cycle;
  try { cycle = (await refreshOngoingProgress(userId, { cycleId: cycle.id, now, signal, deadline: Math.min(deadline, Date.now() + 50000) })).cycle; }
  catch { /* Enrollment is durable even when a first collection is unavailable. */ }
  const ref = ongoingCycleRef(cycle.id), leaseId = randomUUID();
  const leased = await db.runTransaction(async tx => {
    const scope = await readOngoingScope(userId, { tx, write: true });
    const current = (await tx.get(ref)).data(); assertOngoingCycleScope(current, scope);
    if (current.lifecycle !== 'active' || !pageMonitoringEnabled(userId)) throw changed();
    if (current.initialReviewStatus === 'complete' || Date.parse(current.followUpLease?.expiresAt) > Date.now()
      || Date.parse(current.leaseUntil) > Date.now()) return null;
    tx.update(ref, { initialReviewStatus: 'checking', initialReviewError: null,
      followUpLease: { id: leaseId, expiresAt: new Date(deadline + 5000).toISOString() } });
    return current;
  });
  if (!leased) return { success: true, ...enrolled, cycle: await readOngoingCycle(userId, cycle.id) };
  const guard = { cycleId: cycle.id, leaseId };
  let review;
  try {
    await consumeAiQuota(userId);
    const saved = await readPageReviewPlan(userId, pageUrl);
    review = await generatePageReviewSuggestions(userId, pageUrl, focusKeywords ?? saved?.review?.updateBaseline?.focusKeywords, {
      signal, goal: goal ?? saved?.review?.ownerGoal ?? '', deadline, monitoringReview: guard,
    });
    if (review.updateCheck?.status === 'incomplete') throw new RequestError('Some evidence could not be checked. Your earlier recommendations remain saved.', 503);
    const updated = await db.runTransaction(async tx => {
      const scope = await readOngoingScope(userId, { tx, write: true });
      const current = (await tx.get(ref)).data(); assertOngoingCycleScope(current, scope);
      await assertMonitoringReview(tx, userId, pageUrl, guard);
      const plan = (await tx.get(db.collection('pageReviewPlans').doc(review.plan.id))).data();
      if (plan?.revision !== review.plan.revision) throw changed();
      const decision = initialDecision(current, review, review.plan);
      const next = { ...current, revision: current.revision + 1, initialReviewStatus: 'complete', initialReviewError: null,
        followUpLease: null, latestDecisionId: decision.id, latestDecision: decision,
        reviewStatus: current.technical?.issues?.some(issue => !issue.stale) ? 'needs_attention' : 'reviewed' };
      tx.create(ref.collection('decisions').doc(decision.id), { ...decision, userId, property: scope.property,
        websiteRunId: scope.websiteRunId, review: review.plan.review });
      tx.update(ref, next); return next;
    });
    return { success: true, ...enrolled, cycle: publicOngoingCycle(updated), review, plan: review.plan };
  } catch (error) {
    const message = error instanceof RequestError ? error.message : 'The initial review could not finish. Please retry it.';
    const updated = await db.runTransaction(async tx => {
      const scope = await readOngoingScope(userId, { tx });
      const current = (await tx.get(ref)).data(); assertOngoingCycleScope(current, scope);
      if (current.lifecycle !== 'active' || current.followUpLease?.id !== leaseId) return current;
      const next = { ...current, revision: current.revision + 1, followUpLease: null,
        initialReviewStatus: 'failed', initialReviewError: message };
      tx.update(ref, next); return next;
    });
    return { success: true, ...enrolled, cycle: publicOngoingCycle(updated), reviewError: message };
  }
}
