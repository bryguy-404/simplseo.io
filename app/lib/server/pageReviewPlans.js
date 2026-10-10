import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { RequestError } from './requestAuth';

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
  if (!setupDoc.exists) throw new RequestError('Complete your website setup before reviewing a page.', 409);
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
function taskKey(recommendation) {
  // Conservative identity: changing the target, source excerpt or page location
  // creates a separate action. Never fuzzy-merge unrelated suggested changes.
  return hash([recommendation.type, recommendation.targetUrl || null,
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
function reconcileTasks(existing, review, now) {
  const pending = new Map(existing.map(task => [task.id, task]));
  const tasks = [];
  for (const recommendation of review.analysis.recommendations) {
    const exactId = taskKey(recommendation);
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
    if (existing && generationStartedAt < existing.generationStartedAt) {
      throw new RequestError('A newer review is already saved. Reload to see your current plan.', 409);
    }
    const now = new Date().toISOString();
    const plan = {
      id: ref.id, userId, ...scope, revision: (existing?.revision || 0) + 1,
      createdAt: existing?.createdAt || now, updatedAt: now, generationStartedAt,
      review: savedReview, tasks: reconcileTasks(existing?.tasks || [], savedReview, now),
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
