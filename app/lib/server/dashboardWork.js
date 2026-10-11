import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { comparisonWindows, cycleTimestamp, nextOngoingReviewDay, PROGRESS_SCHEMA_VERSION, PROGRESS_SOURCE } from '../progressAssessment';
import { readMentorAccountScope, assertMentorAccountScope } from './mentorAccountScope';
import { RequestError } from './requestAuth';

export const DASHBOARD_WORK_BATCH_SIZE = 10;
const SOURCE_NAMES = ['plans', 'cycles', 'legacy', 'newPages'];
const identityFields = ['userId', 'property', 'websiteRunId', 'websiteUrl'];
const text = (value, limit = 320) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, limit) : null;
const date = value => {
  try { const result = cycleTimestamp(value); return typeof result === 'string' && Number.isFinite(Date.parse(result)) ? result : null; }
  catch { return null; }
};
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const errorCodes = value => {
  if (!value) return null;
  if (typeof value === 'string') return value === 'reconnect_required' ? value : 'temporarily_unavailable';
  if (typeof value !== 'object' || Array.isArray(value)) return 'temporarily_unavailable';
  return Object.fromEntries(Object.entries(value).slice(0, 10).map(([key, error]) => [text(key, 40), error === 'reconnect_required' ? error : 'temporarily_unavailable']));
};
const metricFields = ['status', 'startDate', 'endDate', 'fetchedAt', 'observedAt', 'checkedAt', 'clicks', 'impressions', 'position', 'source'];
function observation(value) {
  if (!value || typeof value !== 'object') return null;
  return { status: text(value.status, 40), startDate: date(value.startDate), endDate: date(value.endDate),
    fetchedAt: date(value.fetchedAt), observedAt: date(value.observedAt), checkedAt: date(value.checkedAt),
    clicks: number(value.clicks), impressions: number(value.impressions), position: number(value.position), source: text(value.source, 60) };
}
const checkpointFields = ['id', 'day', 'evidenceRevision', 'state', 'source', 'observedAt', 'collectedAt', 'updatedAt', 'lowVolume', 'limitation', 'windows', ...['baseline', 'post'].flatMap(prefix => metricFields.map(field => `${prefix}.${field}`))];
function checkpoint(value) {
  if (!value || typeof value !== 'object') return null;
  return { id: text(value.id, 100), day: number(value.day), evidenceRevision: number(value.evidenceRevision),
    state: text(value.state, 40), source: text(value.source, 60), observedAt: date(value.observedAt),
    collectedAt: date(value.collectedAt), updatedAt: date(value.updatedAt), lowVolume: value.lowVolume === true,
    limitation: text(value.limitation), baseline: observation(value.baseline), post: observation(value.post),
    windows: value.windows ? { baseline: { startDate: date(value.windows.baseline?.startDate), endDate: date(value.windows.baseline?.endDate) },
      post: { startDate: date(value.windows.post?.startDate), endDate: date(value.windows.post?.endDate) } } : null };
}
const decisionFields = ['id', 'outcome', 'checkpointId', 'checkpointRevision', 'summary', 'nextStep', 'reviewedAt', 'nextReviewAt', 'acceptedAt', 'canAcceptTasks'];
function decision(value) {
  if (!value || typeof value !== 'object') return null;
  return { id: text(value.id, 100), outcome: text(value.outcome, 40), checkpointId: text(value.checkpointId, 100), checkpointRevision: number(value.checkpointRevision),
    summary: text(value.summary), nextStep: text(value.nextStep), reviewedAt: date(value.reviewedAt), nextReviewAt: date(value.nextReviewAt),
    acceptedAt: date(value.acceptedAt), canAcceptTasks: value.canAcceptTasks === true };
}
function technical(value) {
  if (!value || typeof value !== 'object') return null;
  return { checkedAt: date(value.checkedAt), errors: errorCodes(value.errors),
    issues: (Array.isArray(value.issues) ? value.issues : []).slice(0, 10).map(issue => ({ code: text(issue.code, 40), severity: text(issue.severity, 40),
      message: text(issue.message), checkedAt: date(issue.checkedAt), stale: issue.stale === true })) };
}
const cycleFields = [...identityFields, 'pageUrl', 'revision', 'confirmedAt', 'createdAt', 'lifecycle', 'reviewStatus', 'nextReviewAt', 'lastError', 'lastAttemptAt', 'lastSuccessAt',
  'latestCheckpointId', ...checkpointFields.map(field => `latestCheckpoint.${field}`), ...decisionFields.map(field => `latestDecision.${field}`),
  'technical.checkedAt', 'technical.errors', 'technical.issues'];
export function dashboardCycleSummary(id, value) {
  return { kind: 'cycle', id, pageUrl: value.pageUrl, revision: number(value.revision), confirmedAt: date(value.confirmedAt),
    createdAt: date(value.createdAt), lifecycle: value.lifecycle, reviewStatus: text(value.reviewStatus, 40),
    state: value.lastError ? 'error' : value.reviewStatus || 'collecting', nextReviewAt: date(value.nextReviewAt),
    lastError: errorCodes(value.lastError), lastAttemptAt: date(value.lastAttemptAt), lastSuccessAt: date(value.lastSuccessAt),
    latestCheckpointId: text(value.latestCheckpointId, 100), latestCheckpoint: checkpoint(value.latestCheckpoint),
    latestDecision: decision(value.latestDecision), technical: technical(value.technical) };
}
function planSummary(id, value) {
  const tasks = (Array.isArray(value.tasks) ? value.tasks : []).slice(0, 60);
  const taskCounts = { todo: 0, needs_review: 0, done: 0, dismissed: 0, published: 0 };
  for (const task of tasks) {
    if (Object.hasOwn(taskCounts, task.status) && task.status !== 'published') taskCounts[task.status]++;
    if (task.status === 'done' && task.publication && task.recommendation?.type !== 'check') taskCounts.published++;
  }
  const pending = tasks.find(task => ['todo', 'needs_review'].includes(task.status));
  return { kind: 'plan', id, pageUrl: value.pageUrl, revision: number(value.revision), createdAt: date(value.createdAt), updatedAt: date(value.updatedAt),
    taskCounts, nextTask: pending ? { id: text(pending.id, 100), label: text(pending.recommendation?.label),
      type: text(pending.recommendation?.type, 40), status: pending.status, priority: text(pending.priority, 20) } : null };
}
function legacySummary(id, value, scope, now) {
  const implementedAt = date(value.implementedAt), saved = value.progressAssessment;
  const matching = saved?.schemaVersion === PROGRESS_SCHEMA_VERSION && saved.source === PROGRESS_SOURCE
    && saved.pageUrl === value.pageUrl && saved.property === scope.property && (saved.websiteRunId || null) === scope.websiteRunId
    && saved.implementedAt === implementedAt;
  const assessment = matching ? { state: text(saved.state, 40), reason: text(saved.reason, 100), attemptedAt: date(saved.attemptedAt),
    baseline: observation(saved.baseline), post: observation(saved.post), windows: saved.windows ? {
      baseline: { startDate: date(saved.windows.baseline?.startDate), endDate: date(saved.windows.baseline?.endDate) },
      post: { startDate: date(saved.windows.post?.startDate), endDate: date(saved.windows.post?.endDate) }, ready: saved.windows.ready === true,
    } : null } : { state: 'collecting', reason: 'awaiting_verified_observations', baseline: null, post: null, windows: comparisonWindows(implementedAt, now) };
  return { kind: 'legacy', id, pageUrl: value.pageUrl, implementedAt, confirmedAt: implementedAt,
    nextReviewAt: implementedAt ? nextOngoingReviewDay(implementedAt) : null, assessment, activeCycle: null, activeCycleLookupFailed: false };
}
function indexing(value) {
  if (!value || typeof value !== 'object') return null;
  return { status: text(value.status, 40), fetchedAt: date(value.fetchedAt), checkedAt: date(value.checkedAt),
    verdict: text(value.verdict, 40), coverageState: text(value.coverageState, 160), indexingState: text(value.indexingState, 80),
    lastCrawlTime: date(value.lastCrawlTime) };
}
function publicationSummary(id, value) {
  return { id, planId: value.planId, pageUrl: value.pageUrl, verifiedAt: date(value.verifiedAt), ownerDeclaredAt: date(value.ownerDeclaredAt),
    indexing: indexing(value.indexing), activity: value.activity ? { rolling: observation(value.activity.rolling), sinceVerified: observation(value.activity.sinceVerified) } : null,
    preexistingActivity: observation(value.preexistingActivity), lastError: errorCodes(value.lastError), lastAttemptAt: date(value.lastAttemptAt),
    lastSuccessAt: date(value.lastSuccessAt), nextCheckAt: date(value.nextCheckAt), trackingEnabled: value.trackingEnabled === true,
    publicPage: value.publicPage ? { status: text(value.publicPage.status, 40), verifiedAt: date(value.publicPage.verifiedAt),
      warnings: (Array.isArray(value.publicPage.warnings) ? value.publicPage.warnings : []).slice(0, 5).map(warning => text(warning)) } : null };
}
const publicationFields = [...identityFields, 'planId', 'pageUrl', 'verifiedAt', 'ownerDeclaredAt', 'trackingEnabled', 'nextCheckAt', 'lastError', 'lastAttemptAt', 'lastSuccessAt',
  'publicPage.status', 'publicPage.verifiedAt', 'publicPage.warnings',
  ...['status', 'fetchedAt', 'checkedAt', 'verdict', 'coverageState', 'indexingState', 'lastCrawlTime'].map(field => `indexing.${field}`),
  ...['activity.rolling', 'activity.sinceVerified', 'preexistingActivity'].flatMap(prefix => metricFields.map(field => `${prefix}.${field}`))];
const definitions = {
  plans: { collection: 'pageReviewPlans', fields: [...identityFields, 'pageUrl', 'revision', 'updatedAt', 'createdAt', 'tasks'] },
  cycles: { collection: 'pageProgressCycles', fields: cycleFields },
  legacy: { collection: 'implementedSeoTips', fields: ['userId', 'pageUrl', 'gscProperty', 'websiteRunId', 'preRevampArchived', 'status', 'implementedAt',
    'progressAssessment.schemaVersion', 'progressAssessment.source', 'progressAssessment.pageUrl', 'progressAssessment.property', 'progressAssessment.websiteRunId',
    'progressAssessment.implementedAt', 'progressAssessment.state', 'progressAssessment.reason', 'progressAssessment.attemptedAt', 'progressAssessment.windows',
    ...['baseline', 'post'].flatMap(prefix => metricFields.map(field => `progressAssessment.${prefix}.${field}`))] },
  newPages: { collection: 'newPagePlans', fields: [...identityFields, 'revision', 'status', 'updatedAt', 'createdAt', 'context.area', 'idea.topic', 'draft.h1', 'publicationId'] },
};
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/') && !/[\u0000-\u001f]/.test(value);
function decodeCursor(cursor, scope) {
  if (!cursor) return {};
  try {
    if (typeof cursor !== 'string' || cursor.length > 12000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.version !== 1 || parsed.scope !== scope.key || !parsed.after || typeof parsed.after !== 'object' || Array.isArray(parsed.after)
      || Object.keys(parsed.after).some(key => !SOURCE_NAMES.includes(key))
      || Object.values(parsed.after).some(value => value !== null && !validId(value))) throw Error();
    return parsed.after;
  } catch { throw new RequestError('Your saved-work list changed. Reload the dashboard to continue.', 400); }
}
const encodeCursor = (scope, after) => Buffer.from(JSON.stringify({ version: 1, scope: scope.key, after })).toString('base64url');
function inScope(value, scope, { website = false, legacy = false } = {}) {
  return value?.userId === scope.userId && (legacy ? !value.gscProperty || value.gscProperty === scope.property : value.property === scope.property)
    && (value.websiteRunId || null) === scope.websiteRunId && (!website || value.websiteUrl === scope.websiteUrl)
    && (!value.websiteUrl || value.websiteUrl === scope.websiteUrl);
}
const pageInScope = (value, scope) => typeof value.pageUrl === 'string' && value.pageUrl.length <= 2048 && propertyContainsUrl(scope.property, value.pageUrl);
function scopedQuery(name, scope) {
  let query = db.collection(definitions[name].collection).where('userId', '==', scope.userId);
  if (name !== 'legacy') query = query.where('property', '==', scope.property).where('websiteRunId', '==', scope.websiteRunId);
  if (name === 'cycles') query = query.where('lifecycle', '==', 'active');
  if (name === 'newPages') query = query.where('websiteUrl', '==', scope.websiteUrl);
  return query;
}
async function sourceBatch(name, scope, after) {
  if (after === null || !scope.property) return { docs: [], scanned: 0, hasMore: false, cursor: null, error: null };
  try {
    let query = scopedQuery(name, scope).orderBy('__name__').select(...definitions[name].fields).limit(DASHBOARD_WORK_BATCH_SIZE + 1);
    if (after) query = query.startAfter(after);
    const snapshot = await query.get(), docs = snapshot.docs.slice(0, DASHBOARD_WORK_BATCH_SIZE);
    const hasMore = snapshot.size > DASHBOARD_WORK_BATCH_SIZE;
    return { docs, scanned: docs.length, hasMore, cursor: hasMore ? docs.at(-1).id : null, error: null };
  } catch { return { docs: [], scanned: 0, hasMore: true, cursor: after, error: 'Saved work could not be loaded. Please try again.' }; }
}

/** Saved-only dashboard read. All provider work and lifecycle mutations remain
 * in their existing explicit operations. Source failures never erase another
 * source's successful results, and a scope change rejects the complete read. */
export async function readDashboardWork(userId, { cursor, now = new Date() } = {}) {
  const scope = await readMentorAccountScope(userId), after = decodeCursor(cursor, scope);
  const batches = await Promise.all(SOURCE_NAMES.map(name => sourceBatch(name, scope, after[name])));
  const sources = {}, items = [];
  const nextAfter = {};
  for (let index = 0; index < SOURCE_NAMES.length; index++) {
    const name = SOURCE_NAMES[index], batch = batches[index];
    sources[name] = { scanned: batch.scanned, hasMore: batch.hasMore, error: batch.error, readFailed: Boolean(batch.error), returned: 0 };
    if (batch.cursor !== undefined) nextAfter[name] = batch.cursor;
    for (const document of batch.docs) {
      const value = document.data();
      if (!inScope(value, scope, { legacy: name === 'legacy', website: name === 'newPages' })) continue;
      if (name !== 'newPages' && !pageInScope(value, scope)) continue;
      if (name === 'plans') items.push(planSummary(document.id, value));
      if (name === 'cycles' && value.lifecycle === 'active') {
        items.push(dashboardCycleSummary(document.id, value));
      }
      if (name === 'legacy' && value.status === 'implemented' && !value.preRevampArchived) items.push(legacySummary(document.id, value, scope, now));
      if (name === 'newPages' && ['draft', 'published'].includes(value.status)) {
        items.push({ kind: 'new_page', id: document.id, revision: number(value.revision), status: value.status,
          topic: text(value.idea?.topic), area: value.context?.area ? { name: text(value.context.area.name, 100), region: text(value.context.area.region, 100), country: text(value.context.area.country, 100) } : null,
          hasDraft: Boolean(value.draft), createdAt: date(value.createdAt), updatedAt: date(value.updatedAt),
          publication: null, publicationError: null, publicationId: validId(value.publicationId) ? value.publicationId : null });
      }
    }
  }
  // A modern cycle may be outside this request's page of cycles. Resolve each
  // legacy candidate before the client can incorrectly promote its old status.
  await Promise.all(items.filter(item => item.kind === 'legacy').map(async item => {
    try {
      const snapshot = await scopedQuery('cycles', scope).where('pageUrl', '==', item.pageUrl).orderBy('__name__').select(...cycleFields).limit(2).get();
      const current = snapshot.docs.filter(doc => inScope(doc.data(), scope) && pageInScope(doc.data(), scope) && doc.data().pageUrl === item.pageUrl && doc.data().lifecycle === 'active');
      if (current.length > 1) throw Error('ambiguous_active_cycle');
      item.activeCycle = current.length === 1 ? dashboardCycleSummary(current[0].id, current[0].data()) : null;
    } catch {
      item.activeCycleLookupFailed = true;
      sources.legacy.error = 'Some saved progress could not be checked. Open the page to see its current review.';
    }
  }));
  await Promise.all(items.filter(item => item.kind === 'new_page' && item.publicationId).map(async item => {
    try {
      const ref = db.collection('newPagePublications').doc(item.publicationId);
      const [saved] = await db.getAll(ref, { fieldMask: publicationFields });
      const value = saved.data();
      if (!inScope(value, scope, { website: true }) || value.planId !== item.id || !pageInScope(value, scope)) throw Error('publication_unavailable');
      item.publication = publicationSummary(item.publicationId, value);
    } catch {
      item.publicationError = 'Saved publication observations could not be loaded.';
      sources.newPages.error = 'Some saved publication observations could not be loaded.';
    }
  }));
  const sourceForKind = { plan: 'plans', cycle: 'cycles', legacy: 'legacy', new_page: 'newPages' };
  for (const item of items) sources[sourceForKind[item.kind]].returned++;
  await assertMentorAccountScope(userId, scope);
  const hasMore = Object.values(sources).some(source => source.hasMore);
  return { schemaVersion: 1, scope: { key: scope.key, property: scope.property, websiteUrl: scope.websiteUrl, websiteRunId: scope.websiteRunId },
    items, sources, nextCursor: hasMore ? encodeCursor(scope, nextAfter) : null,
    coverage: { partial: hasMore || Object.values(sources).some(source => source.error), hasMore, batchSize: DASHBOARD_WORK_BATCH_SIZE,
      countsAreComplete: !hasMore && !cursor && !Object.values(sources).some(source => source.error) },
    readAt: now.toISOString() };
}
