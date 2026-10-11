import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { seoImplementationId } from '../pageTaskFlow';
import { RequestError } from './requestAuth';
import { ongoingCycleRef, readOngoingScope, assertOngoingCycleScope, publicOngoingCycle } from './ongoingProgress';

const COLLECTION = 'pageReviewPlans';
const MAX_TASKS = 60;
// Leave room for Firestore's field names / encoding below the one-MiB document limit.
const MAX_BYTES = 800000;
const states = new Set(['todo', 'done', 'dismissed', 'needs_review']);
const terminal = status => status === 'done' || status === 'dismissed';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const normalize = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : '';

function validatePageUrl(pageUrl) {
  let url;
  try { url = new URL(pageUrl); } catch { throw new RequestError('Enter a valid page URL.'); }
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || (url.port && !['80', '443'].includes(url.port))) {
    throw new RequestError('Use the full public page URL without a fragment or login details.');
  }
}

async function readScope(transaction, userId, pageUrl, { write = false } = {}) {
  if (typeof userId !== 'string' || !userId || userId.includes('/')) throw new RequestError('Sign in to continue.', 401);
  validatePageUrl(pageUrl);
  const refs = ['onboarding', 'users', 'gscTokens'].map(name => db.collection(name).doc(userId));
  const [setupDoc, userDoc, legacyDoc] = await Promise.all(refs.map(ref => transaction.get(ref)));
  if (!setupDoc.exists || !userDoc.exists || userDoc.data()?.deletionInProgress) throw new RequestError('Your account changed. Reload before reviewing a page.', 409);
  const setup = setupDoc.data(), user = userDoc.data() || {}, legacy = legacyDoc.data() || {};
  if (write && (!setup.isComplete || setup.revampArchivePending || setup.revampStatus === 'in-progress')) {
    throw new RequestError('Your website setup is being updated. Reload it before changing the saved page plan.', 409);
  }
  const property = setup.gscProperty || user.gscSiteUrl || legacy.siteUrl;
  // Read only the stored connection's scope. Loading a saved checklist must not
  // refresh OAuth, fetch Google data, scrape a page, or spend an AI request.
  if (!property || (user.gscSiteUrl && user.gscSiteUrl !== property)) throw new RequestError('Your website connection changed. Reconnect Search Console and try again.', 409);
  const connected = (user.gscSiteUrl === property && (user.gscAccessToken || user.gscRefreshToken)) ||
    (legacy.siteUrl === property && (legacy.accessToken || legacy.refreshToken));
  if (!connected) throw new RequestError('Reconnect Search Console to load this page plan.', 409);
  if (!propertyContainsUrl(property, pageUrl)) throw new RequestError('Page must belong to your connected Search Console property.', 403);
  return { property, pageUrl, websiteRunId: setup.revampRunId || null };
}

function planRef(userId, scope) {
  return db.collection(COLLECTION).doc(hash([userId, scope.property, scope.pageUrl, scope.websiteRunId]));
}
function assertStoredScope(plan, userId, scope) {
  if (plan && (plan.userId !== userId || plan.property !== scope.property || plan.pageUrl !== scope.pageUrl || plan.websiteRunId !== scope.websiteRunId)) {
    throw new RequestError('The saved page plan does not match this website. Reload and try again.', 409);
  }
}
function publicPlan(record) {
  if (!record) return null;
  // The account identity and generation-order marker are server bookkeeping.
  const plan = { ...record };
  delete plan.userId;
  delete plan.generationStartedAt;
  return plan;
}

// Confirmation owns the transaction and has already checked account/setup scope.
// Read this before queuing any writes so plan and publication commit atomically.
export async function pageReviewPlanInTransaction(transaction, userId, scope) {
  const ref = planRef(userId, scope);
  const snapshot = await transaction.get(ref);
  const plan = snapshot.exists ? snapshot.data() : null;
  assertStoredScope(plan, userId, scope);
  return { ref, plan };
}

export function publishedPageTaskPlan(plan, { taskIds, revision, publication }) {
  if (!plan) throw new RequestError('Load a saved page plan before confirming its tasks.', 409);
  if (plan.revision !== revision) throw new RequestError('Your task list changed. Reload it and select the changes you published.', 409);
  const selected = taskIds.map(id => plan.tasks.find(task => task.id === id));
  if (selected.some(task => !task || task.recommendation.type === 'check' || ['dismissed', 'needs_review'].includes(task.status)
    || (task.status === 'done' && task.publication))) {
    throw new RequestError('Select current edit tasks from this page. A check, dismissed task or earlier suggestion cannot be confirmed as published.', 409);
  }
  const ids = new Set(taskIds);
  const updated = { ...plan, revision: plan.revision + 1, updatedAt: publication.implementedAt,
    tasks: plan.tasks.map(task => ids.has(task.id) ? {
      ...task, status: 'done', statusUpdatedAt: publication.implementedAt, publication,
      ...(task.publication ? { previousPublications: [...(task.previousPublications || []), task.publication] } : {}),
    } : task),
  };
  withinBounds(updated);
  return { updated, plan: publicPlan(updated), labels: selected.map(task => task.recommendation.label) };
}

export const publicPageReviewPlan = publicPlan;
function withinBounds(plan) {
  if (plan.tasks.length > MAX_TASKS || Buffer.byteLength(JSON.stringify(plan), 'utf8') > MAX_BYTES) {
    throw new RequestError('This page has reached its saved-plan limit. Your previous plan is safe; contact support before creating another review.', 409);
  }
}

// Keep every recommendation and cited fact. The separately loaded activity panel
// owns the large search table; the saved assessment needs only its model sample.
function reviewSnapshot(review) {
  const snapshot = plain(review);
  delete snapshot.plan;
  for (const key of ['current', 'previous']) {
    const period = snapshot.evidence?.[key];
    if (Array.isArray(period?.queries) && period.queries.length > 40) {
      period.queries = period.queries.slice(0, 40);
      period.queryCoverage = { ...period.queryCoverage, savedRows: 40, savedSample: true };
    }
  }
  return snapshot;
}
function taskKey(recommendation, scopeId) {
  // Conservative identity: changing the target, source excerpt or page location
  // creates a separate action. Never fuzzy-merge unrelated suggested changes.
  return hash([scopeId, recommendation.type, recommendation.targetUrl || null,
    normalize(recommendation.location), normalize(recommendation.currentQuote)]);
}
function taskPriority(recommendation) {
  if (recommendation.significance === 'primary') return 'first';
  return ['navigation', 'diagnosis'].includes(recommendation.benefit) && recommendation.basis !== 'observed_issue' ? 'optional' : 'next';
}
function taskSnapshot(review, recommendation, now) {
  const ids = new Set(recommendation.evidenceIds || []);
  const facts = [...new Map([...(review.evidence?.facts || []), ...(review.diagnostics?.facts || [])].map(fact => [fact.id, fact])).values()].filter(fact => ids.has(fact.id));
  const sources = (review.research?.status === 'available' ? review.research.sources || [] : []).filter(source => ids.has(source.id));
  return {
    recommendation: plain(recommendation), facts: plain(facts), sources: plain(sources),
    reviewedAt: review.provenance.generatedAt || now, contentFingerprint: review.provenance.contentFingerprint,
    priority: taskPriority(recommendation), retained: false,
    draft: recommendation.type === 'metadata' ? { title: review.title, description: review.description } : null,
    metadataFields: recommendation.type === 'metadata' ? [...(review.analysis.changedFields || [])].sort() : [],
  };
}
function sameAction(task, recommendation, review) {
  const previous = task.recommendation;
  if (previous.type !== recommendation.type || previous.targetUrl !== recommendation.targetUrl) return false;
  if (recommendation.type === 'metadata') {
    const fields = [...(review.analysis.changedFields || [])].sort();
    if (fields.length && task.metadataFields?.length) return JSON.stringify(fields) === JSON.stringify(task.metadataFields);
  }
  const oldQuote = normalize(previous.currentQuote), newQuote = normalize(recommendation.currentQuote);
  // Exact excerpts identify an action even when the model paraphrases its
  // location label. Two different nonempty excerpts remain separate actions.
  if (oldQuote && newQuote) return oldQuote === newQuote;
  return normalize(previous.location) === normalize(recommendation.location);
}
function reconcileTasks(existing, review, now, scopeId) {
  const pending = new Map(existing.map(task => [task.id, task]));
  const tasks = [];
  for (const recommendation of review.analysis.recommendations) {
    const exactId = taskKey(recommendation, scopeId);
    const candidates = [...pending.values()].filter(task => sameAction(task, recommendation, review));
    // Ambiguous matches are kept separately. Matching is exact and local to the
    // task slot, never a model decision to erase a user's older work.
    const previous = pending.get(exactId) || (candidates.length === 1 ? candidates[0] : null);
    const id = previous?.id || exactId;
    if (tasks.some(task => task.id === id)) continue;
    const next = taskSnapshot(review, recommendation, now);
    // A dismissed/completed action is never resurrected by another AI response.
    // Preserve exactly the version the owner resolved, including its evidence.
    tasks.push(previous && terminal(previous.status) ? previous : {
      id, status: 'todo', createdAt: previous?.createdAt || now,
      ...next,
    });
    pending.delete(id);
  }
  for (const task of pending.values()) {
    const changed = !terminal(task.status) && task.contentFingerprint !== review.provenance.contentFingerprint;
    tasks.push({ ...task,
      status: changed ? 'needs_review' : task.status,
      priority: task.priority === 'first' ? 'next' : task.priority,
      retained: true,
      ...(changed ? { needsReviewReason: 'page_changed' } : {}),
    });
  }
  const order = { first: 0, next: 1, optional: 2 };
  const stateOrder = { todo: 0, needs_review: 1, done: 2, dismissed: 2 };
  // Stable sorting preserves the model's ordering within each priority bucket.
  return tasks.sort((a, b) => stateOrder[a.status] - stateOrder[b.status] || order[a.priority] - order[b.priority]);
}

export async function readPageReviewPlan(userId, pageUrl) {
  return db.runTransaction(async transaction => {
    const scope = await readScope(transaction, userId, pageUrl);
    const snapshot = await transaction.get(planRef(userId, scope));
    const plan = snapshot.exists ? snapshot.data() : null;
    assertStoredScope(plan, userId, scope);
    return publicPlan(plan);
  });
}

async function assertNoActivePublication(transaction, userId, scope) {
  const snapshot = await transaction.get(db.collection('implementedSeoTips').doc(seoImplementationId(userId, scope.pageUrl)));
  const record = snapshot.data();
  if (record && (record.userId !== userId || record.pageUrl !== scope.pageUrl)) {
    throw new RequestError('This page record conflicts with another record. Please contact support before continuing.', 409);
  }
  if (record && !record.preRevampArchived && record.status === 'implemented') {
    throw new RequestError('This page already has a confirmed change being tracked. Review its progress before checking for new suggestions.', 409);
  }
}

// A check for updates is read-only, but must honor the same setup/publication
// boundaries as generation. Read the latest checklist in this transaction so a
// concurrent owner checkbox edit is returned intact rather than overwritten.
export async function readPageReviewPlanForUpdate(userId, provenance, { expectedReview } = {}) {
  return db.runTransaction(async transaction => {
    const scope = await readScope(transaction, userId, provenance.pageUrl, { write: true });
    if (scope.property !== provenance.property || scope.websiteRunId !== provenance.websiteRunId) {
      throw new RequestError('Your website setup changed while checking this page. Reload and try again.', 409);
    }
    const { plan } = await pageReviewPlanInTransaction(transaction, userId, scope);
    await assertNoActivePublication(transaction, userId, scope);
    if (expectedReview !== undefined && hash(plan?.review || null) !== hash(expectedReview)) {
      throw new RequestError('A different review was saved while checking this page. Reload to see your current plan.', 409);
    }
    return publicPlan(plan);
  });
}

// Called only by the authenticated generation service after strict validation.
// startedAt is set on the server before analysis, never accepted from the client.
export async function savePageReviewPlan(userId, review, { startedAt = review?.provenance?.generatedAt } = {}) {
  const provenance = review?.provenance;
  const generationStartedAt = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  if (!provenance || !Array.isArray(review.analysis?.recommendations) || !provenance.contentFingerprint || !Number.isFinite(generationStartedAt) || generationStartedAt > Date.now() + 5000) {
    throw new RequestError('The review could not be saved. Your previous plan is safe.', 502);
  }
  const savedReview = reviewSnapshot(review);
  return db.runTransaction(async transaction => {
    const scope = await readScope(transaction, userId, provenance.pageUrl, { write: true });
    if (scope.property !== provenance.property || scope.websiteRunId !== provenance.websiteRunId) {
      throw new RequestError('Your website setup changed while this page was being reviewed. Reload and try again.', 409);
    }
    const ref = planRef(userId, scope);
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() : null;
    assertStoredScope(existing, userId, scope);
    await assertNoActivePublication(transaction, userId, scope);
    if (existing && generationStartedAt < existing.generationStartedAt) {
      throw new RequestError('A newer review is already saved. Reload to see your current plan.', 409);
    }
    const now = new Date().toISOString();
    const plan = {
      id: ref.id, userId, ...scope, revision: (existing?.revision || 0) + 1,
      createdAt: existing?.createdAt || now, updatedAt: now, generationStartedAt,
      review: savedReview, tasks: reconcileTasks(existing?.tasks || [], savedReview, now, ref.id),
    };
    withinBounds(plan);
    transaction.set(ref, plan);
    return publicPlan(plan);
  });
}

export async function updatePageReviewTask(userId, pageUrl, taskId, status, revision) {
  if (typeof taskId !== 'string' || !/^[a-f0-9]{64}$/.test(taskId) || !states.has(status) || !Number.isSafeInteger(revision) || revision < 1) {
    throw new RequestError('Choose a valid saved task and reload its current plan.');
  }
  return db.runTransaction(async transaction => {
    const scope = await readScope(transaction, userId, pageUrl, { write: true });
    const ref = planRef(userId, scope);
    const snapshot = await transaction.get(ref);
    const plan = snapshot.exists ? snapshot.data() : null;
    assertStoredScope(plan, userId, scope);
    if (!plan) throw new RequestError('This page plan is no longer available. Analyze the page again.', 404);
    if (plan.revision !== revision) throw new RequestError('This plan changed in another tab. Reload it before updating this task.', 409);
    const task = plan.tasks.find(item => item.id === taskId);
    if (!task) throw new RequestError('This task is not part of the selected page plan.', 404);
    if (task.status === status) return publicPlan(plan);
    const now = new Date().toISOString();
    const updated = { ...plan, revision: plan.revision + 1, updatedAt: now,
      tasks: plan.tasks.map(item => item.id === taskId ? { ...item, status, statusUpdatedAt: now } : item),
    };
    // This is a personal checklist only. It deliberately writes no SEO change,
    // publication timestamp, progress comparison, or Google observation.
    transaction.set(ref, updated);
    return publicPlan(updated);
  });
}

// Follow-up analysis is saved separately. Accepting it changes the checklist,
// never the publication date or the measurement lifecycle.
export function prepareFollowUpPlan(existing, review, { cycleId, decisionId, now = new Date().toISOString() }) {
  if (!existing || !review?.provenance?.contentFingerprint || !Array.isArray(review.analysis?.recommendations)) {
    throw new RequestError('Reload the saved page plan before accepting these tasks.', 409);
  }
  const savedReview = reviewSnapshot(review);
  const reconciled = reconcileTasks(existing.tasks || [], savedReview, now, existing.id);
  // Resolved actions are safely retained in the immutable preceding-plan
  // snapshot, rather than growing the active document for every future cycle.
  const tasks = reconciled.filter(task => !terminal(task.status)).map(task => {
    const previous = existing.tasks.find(item => item.id === task.id);
    if (!previous || terminal(previous.status)) return task;
    // Preserve user-controlled fields and wording on unfinished work. The new
    // review is available separately; it must not silently overwrite the draft.
    const changed = previous.contentFingerprint !== review.provenance.contentFingerprint;
    return { ...previous, retained: true, ...(changed ? { status: 'needs_review', needsReviewReason: 'page_changed' } : {}),
      priority: task.priority };
  });
  const plan = { ...existing, revision: existing.revision + 1, updatedAt: now, generationStartedAt: Date.parse(now),
    review: savedReview, tasks, followUp: { cycleId, decisionId }, archivedTasksAvailable: true };
  withinBounds(plan);
  return plan;
}

export async function activateFollowUpPlan(userId, { cycleId, decisionId, expectedRevision, expectedPlanRevision }) {
  if (typeof decisionId !== 'string' || !/^[a-f0-9]{64}$/.test(decisionId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new RequestError('Choose the current saved review before accepting tasks.');
  }
  return db.runTransaction(async tx => {
    const scope = await readOngoingScope(userId, { tx, write: true });
    const ref = ongoingCycleRef(cycleId), cycle = (await tx.get(ref)).data();
    assertOngoingCycleScope(cycle, scope);
    const decisionRef = ref.collection('decisions').doc(decisionId);
    const decision = (await tx.get(decisionRef)).data();
    const saved = await pageReviewPlanInTransaction(tx, userId, { ...scope, pageUrl: cycle.pageUrl });
    if (!decision || decision.cycleId !== cycleId || cycle.latestDecisionId !== decisionId || cycle.lifecycle !== 'active') {
      throw new RequestError('This review changed. Reload the current result before accepting tasks.', 409);
    }
    if (decision.acceptedAt && saved.plan?.followUp?.decisionId === decisionId) {
      return { cycle: publicOngoingCycle(cycle), decision: cycle.latestDecision, plan: publicPlan(saved.plan), alreadyAccepted: true };
    }
    if (!cycle.latestCheckpointId || decision.checkpointId !== cycle.latestCheckpointId
      || (decision.checkpointRevision ?? decision.review?.evidence?.evidenceRevision) !== cycle.latestCheckpoint?.evidenceRevision) {
      throw new RequestError('Newer search evidence is available. Review your results again before accepting these tasks.', 409);
    }
    if (cycle.revision !== expectedRevision || !saved.plan || saved.plan.revision !== decision.sourcePlanRevision
      || (expectedPlanRevision !== undefined && saved.plan.revision !== expectedPlanRevision)) {
      throw new RequestError('Your page or task list changed. Reload before accepting these suggestions.', 409);
    }
    const provenance = decision.review?.provenance;
    if (decision.outcome !== 'improve_page' || !provenance || provenance.property !== scope.property
      || (provenance.websiteRunId || null) !== scope.websiteRunId || provenance.pageUrl !== cycle.pageUrl
      || !decision.review.analysis?.recommendations?.some(item => item.type !== 'check')) {
      throw new RequestError('This review has no new edit tasks to activate.', 409);
    }
    const now = new Date().toISOString();
    const plan = prepareFollowUpPlan(saved.plan, decision.review, { cycleId, decisionId, now });
    if (!plan.tasks.some(task => !saved.plan.tasks.some(previous => previous.id === task.id))) {
      throw new RequestError('These actions are already in your saved work. Keep your existing tasks and review the evidence before making another edit.', 409);
    }
    const snapshotRef = saved.ref.collection('history').doc(`revision-${saved.plan.revision}`);
    const existingSnapshot = await tx.get(snapshotRef);
    if (existingSnapshot.exists) throw new RequestError('This plan revision was already preserved. Reload before continuing.', 409);
    const accepted = Object.fromEntries(['id', 'cycleId', 'pageUrl', 'outcome', 'summary', 'whatChanged', 'meaning',
      'nextStep', 'reviewedAt', 'evidenceIds', 'proposedTasks', 'sourcePlanRevision', 'checkpointId', 'checkpointRevision'].filter(key => decision[key] !== undefined)
      .map(key => [key, decision[key]]));
    accepted.acceptedAt = now;
    accepted.canAcceptTasks = false;
    const updatedCycle = { ...cycle, revision: cycle.revision + 1, latestDecision: accepted, reviewChangesAllowed: true };
    tx.create(snapshotRef, { ...saved.plan, archivedAt: now, archiveReason: 'accepted_follow_up', cycleId, decisionId });
    tx.set(saved.ref, plan);
    tx.update(decisionRef, { acceptedAt: now });
    tx.update(ref, { revision: updatedCycle.revision, latestDecision: accepted, reviewChangesAllowed: true });
    return { cycle: publicOngoingCycle(updatedCycle), decision: accepted, plan: publicPlan(plan) };
  });
}

export async function readPageReviewPlanHistory(userId, pageUrl, beforeRevision) {
  if (beforeRevision !== undefined && (!Number.isSafeInteger(beforeRevision) || beforeRevision < 1)) throw new RequestError('Choose a valid saved plan revision.');
  const scope = await db.runTransaction(tx => readScope(tx, userId, pageUrl));
  let query = planRef(userId, scope).collection('history').orderBy('revision', 'desc');
  if (beforeRevision !== undefined) query = query.startAfter(beforeRevision);
  const snapshot = await query.limit(6).get();
  const history = snapshot.docs.slice(0, 5).map(document => {
    const value = document.data(); assertStoredScope(value, userId, scope); return publicPlan(value);
  });
  return { history, nextCursor: snapshot.size > 5 ? history.at(-1).revision : null };
}
