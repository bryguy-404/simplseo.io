import { createHash, randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { comparisonWindows, ongoingCheckpointWindows, cycleTimestamp } from '../progressAssessment';
import { propertyContainsUrl } from '../revampState';
import { RequestError } from './requestAuth';
import { assertNotificationScope, notificationEnabled, notificationEventsEnabled, readNotificationScope } from './notificationScope';

const DAY = 86400000;
const SOURCES = ['pageProgressCycles', 'newPagePublications', 'implementedSeoTips', 'notificationConnectionObservations'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const date = value => { const result = cycleTimestamp(value); return Number.isFinite(Date.parse(result)) ? result : null; };
const read = (ref, tx) => tx ? tx.get(ref) : ref.get();
const get = async (collection, id, tx) => (await read(db.collection(collection).doc(id), tx)).data();
const scopeKey = scope => [scope.userId, scope.property, scope.websiteRunId || null, scope.websiteUrl || null];
const sameScope = (data, scope) => data?.userId === scope.userId && (data.property || data.gscProperty) === scope.property
  && (data.websiteRunId || null) === (scope.websiteRunId || null) && (!data.websiteUrl || data.websiteUrl === scope.websiteUrl)
  && (!data.pageUrl || propertyContainsUrl(scope.property, data.pageUrl));
const namedPage = url => { try { const path = new URL(url).pathname; return path === '/' ? 'Homepage' : decodeURIComponent(path).split('/').filter(Boolean).join(' / ').slice(0, 120); } catch { return 'Your page'; } };
const observationAvailable = value => ['available', 'has_data', 'no_data'].includes(value?.status)
  && Number.isFinite(value.clicks) && Number.isFinite(value.impressions) && value.clicks >= 0 && value.impressions >= value.clicks;
const matchingPeriods = (point, windows) => windows?.ready === true && ['baseline', 'post'].every(key => observationAvailable(point?.[key])
  && point[key].startDate === windows[key].startDate && point[key].endDate === windows[key].endDate);
const reviewed = (cycle, id) => cycle.lastAcknowledgedCheckpointId === id || cycle.latestDecision?.checkpointId === id;
const fresh = (value, now) => date(value) && Date.parse(value) <= now.getTime() && now.getTime() - Date.parse(value) <= 8 * DAY;
const hasReconnect = source => source?.status === 'reconnect_required' || source?.lastError && Object.values(source.lastError).includes('reconnect_required')
  || source?.progressAssessment?.reason === 'reconnect_required';
const connectionVersionOf = (user = {}, legacy = {}) => user.gscConnectionVersion || createHash('sha256').update(user.gscRefreshToken || legacy.refreshToken || '').digest('hex');
const sourceCheckedAt = source => date(source?.checkedAt || source?.lastError?.checkedAt || source?.progressAssessment?.attemptedAt || source?.lastAttemptAt);
const cycleIdForLegacy = source => hash([source.userId, source.gscProperty || source.property, source.websiteRunId || null, source.pageUrl, cycleTimestamp(source.implementedAt || source.confirmedAt)]);

async function hasModernCycle(source, scope, tx) {
  if (await get('pageProgressCycles', cycleIdForLegacy(source), tx)) return true;
  const query = db.collection('pageProgressCycles').where('userId', '==', scope.userId).where('property', '==', scope.property)
    .where('websiteRunId', '==', scope.websiteRunId || null).where('pageUrl', '==', source.pageUrl).where('lifecycle', '==', 'active').limit(1);
  return !(await read(query, tx)).empty;
}

const ISSUE_CODES = ['redirect', 'noindex', 'canonical', 'not_found', 'google_noindex', 'google_robots'];
function notificationTechnicalIssues(collection, source) {
  if (collection === 'pageProgressCycles') return source.technical?.issues || [];
  if (collection !== 'newPagePublications' || source.trackingEnabled !== true) return [];
  const issues = [], page = source.publicPage, indexing = source.indexing;
  if (page?.status === 'available') {
    if (/\b(noindex|none)\b/i.test(page.robots || '')) issues.push({ code: 'noindex', checkedAt: page.verifiedAt,
      message: 'The published page declares noindex. Review this setting if it should appear in Google.' });
    if (page.canonical && page.canonical !== source.pageUrl) issues.push({ code: 'canonical', checkedAt: page.verifiedAt,
      message: 'The published page names a different canonical URL. Search activity may be attributed elsewhere.' });
  }
  if (indexing?.status === 'available') {
    if (['BLOCKED_BY_META_TAG', 'BLOCKED_BY_HTTP_HEADER'].includes(indexing.indexingState)) issues.push({ code: 'google_noindex', checkedAt: indexing.fetchedAt,
      stale: Boolean(source.lastError?.indexing), message: 'Google’s saved inspection reports an indexing block. Review the live settings and the inspection date.' });
    if (indexing.robotsTxtState === 'DISALLOWED') issues.push({ code: 'google_robots', checkedAt: indexing.fetchedAt,
      stale: Boolean(source.lastError?.indexing), message: 'Google’s saved inspection reports blocked crawling. Review robots.txt and the inspection date.' });
  }
  return issues;
}
function technicalRecoveryObservedAt(collection, source, code) {
  const google = code.startsWith('google_');
  if (collection === 'pageProgressCycles') {
    if (source.technical?.errors?.[google ? 'indexing' : 'publicPage']) return null;
    const observed = google ? source.technical?.indexing : source.technical?.publicPage;
    return (google ? observed?.status === 'available' : ['available', 'not_found'].includes(observed?.status)) ? observed.checkedAt : null;
  }
  if (collection === 'newPagePublications') {
    if (google && source.lastError?.indexing) return null;
    return google ? (source.indexing?.status === 'available' ? source.indexing.fetchedAt : null) : (source.publicPage?.status === 'available' ? source.publicPage.verifiedAt : null);
  }
  return null;
}

/** Complete, dated totals are enough. Traffic thresholds never gate a notice. */
export function notificationCheckpointAvailable(cycle, now = new Date()) {
  const point = cycle?.latestCheckpoint;
  return cycle?.lifecycle === 'active' && point?.source === 'google_search_console' && point.state === 'available'
    && point.id === `day-${point.day}` && date(point.observedAt) && point.observedAt <= now.toISOString()
    && matchingPeriods(point, ongoingCheckpointWindows(cycle.confirmedAt, point.day, now));
}
export function notificationPublicationMilestone(publication, now = new Date()) {
  if (publication?.trackingEnabled !== true || !date(publication.verifiedAt) || !date(publication.ownerDeclaredAt)
    || publication.publicPage?.status !== 'available') return null;
  const days = Math.floor((now.getTime() - Date.parse(publication.verifiedAt)) / DAY);
  return days >= 84 ? 84 : days >= 28 ? 28 : null;
}
function eventBase(scope, source, collection, id, now) {
  return { schemaVersion: 1, userId: scope.userId, property: scope.property, websiteRunId: scope.websiteRunId || null,
    websiteUrl: scope.websiteUrl || null, pageUrl: source.pageUrl || null, pageName: namedPage(source.pageUrl),
    source: { collection, id }, destination: { kind: 'existing_page', pageUrl: source.pageUrl, ...(collection === 'pageProgressCycles' ? { cycleId: id } : {}) },
    status: 'active', readAt: null, emailDeliveryId: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}
export function notificationCandidates(scope, collection, id, source, now = new Date()) {
  if (!sameScope(source, scope) || source.preRevampArchived) return [];
  const base = eventBase(scope, source, collection, id, now), candidates = [];
  if (collection === 'pageProgressCycles' && notificationCheckpointAvailable(source, now) && !reviewed(source, source.latestCheckpoint.id)) {
    const point = source.latestCheckpoint;
    candidates.push({ ...base, id: hash([...scopeKey(scope), 'results', id, point.id]), type: 'results_ready',
      title: 'Your page results are ready', message: 'Both reporting periods are available. Review what changed and choose your next step.',
      occurredAt: point.observedAt, observedAt: point.observedAt,
      source: { ...base.source, checkpointId: point.id }, evidence: { baseline: { startDate: point.baseline.startDate, endDate: point.baseline.endDate }, post: { startDate: point.post.startDate, endDate: point.post.endDate }, revision: point.evidenceRevision || 1 } });
  }
  if (collection === 'implementedSeoTips' && source.status === 'implemented') {
    const point = source.progressAssessment, windows = comparisonWindows(source.implementedAt, now);
    if (point?.source === 'google_search_console' && point.property === scope.property && point.pageUrl === source.pageUrl
      && point.implementedAt === cycleTimestamp(source.implementedAt) && (point.websiteRunId || null) === scope.websiteRunId
      && ['ready', 'insufficient_data'].includes(point.state) && matchingPeriods(point, windows) && date(point.attemptedAt)) {
      candidates.push({ ...base, id: hash([...scopeKey(scope), 'legacy-results', id, cycleTimestamp(source.implementedAt)]), type: 'results_ready',
        title: 'Your page results are ready', message: 'Both reporting periods are available. Review what changed and choose your next step.',
        occurredAt: point.attemptedAt, observedAt: point.attemptedAt, source: { ...base.source, confirmedAt: cycleTimestamp(source.implementedAt) },
        evidence: { baseline: windows.baseline, post: windows.post } });
    }
  }
  if (collection === 'newPagePublications') {
    const milestone = notificationPublicationMilestone(source, now);
    if (milestone) candidates.push({ ...base, id: hash([...scopeKey(scope), 'publication', id, milestone]), type: 'new_page_check_in',
      title: 'Time to check your published page', message: `Your ${milestone}-day check-in is due. See the available indexing and search activity; results may still be limited.`,
      occurredAt: new Date(Date.parse(source.verifiedAt) + milestone * DAY).toISOString(), observedAt: source.verifiedAt,
      source: { ...base.source, milestone }, destination: { kind: 'new_page', pageUrl: source.pageUrl, planId: source.planId },
      evidence: { verifiedAt: source.verifiedAt, milestone } });
  }
  if ((collection === 'pageProgressCycles' && source.lifecycle === 'active') || (collection === 'newPagePublications' && source.trackingEnabled === true)) {
    for (const issue of notificationTechnicalIssues(collection, source)) {
      if (!ISSUE_CODES.includes(issue.code) || issue.stale || !fresh(issue.checkedAt, now)) continue;
      candidates.push({ ...base, episodeKey: hash([...scopeKey(scope), source.pageUrl, issue.code]), type: 'page_needs_attention',
        title: 'Your page needs a check', message: String(issue.message).slice(0, 500), occurredAt: issue.checkedAt, observedAt: issue.checkedAt,
        source: { ...base.source, issueCode: issue.code }, evidence: { checkedAt: issue.checkedAt },
        ...(collection === 'newPagePublications' ? { destination: { kind: 'new_page', pageUrl: source.pageUrl, planId: source.planId } } : {}) });
    }
  }
  return candidates;
}

async function eligibility(event, { tx, scope, now = new Date() } = {}) {
  if (!event || !validId(event.id) || !notificationEnabled(event.userId)) return { eligible: false, reason: 'disabled' };
  scope ||= await readNotificationScope(event.userId, { tx });
  if (!sameScope(event, scope)) return { eligible: false, reason: 'superseded' };
  if (event.type === 'reconnect_google') {
    const episode = await get('notificationIssueEpisodes', event.episodeKey, tx), user = await get('users', event.userId, tx);
    const [connection, tokens] = await Promise.all([get('notificationConnectionObservations', event.userId, tx), get('gscTokens', event.userId, tx)]);
    const currentVersion = connectionVersionOf(user, tokens);
    const knownHealthy = sameScope(connection, scope) && connection.connectionVersion === currentVersion && connection.status === 'available' && connection.checkedAt >= event.observedAt;
    return { eligible: !knownHealthy && episode?.active === true && episode.currentEventId === event.id && currentVersion === event.evidence?.connectionVersion,
      reason: 'resolved' };
  }
  if (!SOURCES.includes(event.source?.collection) || !validId(event.source?.id)) return { eligible: false, reason: 'superseded' };
  const source = await get(event.source.collection, event.source.id, tx);
  if (!sameScope(source, scope) || source.preRevampArchived || (source.lifecycle && source.lifecycle !== 'active')) return { eligible: false, reason: 'superseded' };
  if (event.type === 'results_ready' && event.source.collection === 'pageProgressCycles') {
    if (source.latestCheckpoint?.id !== event.source.checkpointId) return { eligible: false, reason: 'superseded' };
    return { eligible: notificationCheckpointAvailable(source, now) && !reviewed(source, event.source.checkpointId), reason: reviewed(source, event.source.checkpointId) ? 'resolved' : 'unavailable' };
  }
  if (event.type === 'results_ready' && event.source.collection === 'implementedSeoTips') {
    if (await hasModernCycle(source, scope, tx)) return { eligible: false, reason: 'superseded' };
    return { eligible: notificationCandidates(scope, event.source.collection, event.source.id, source, now).some(candidate => candidate.id === event.id), reason: source.status !== 'implemented' ? 'resolved' : 'unavailable' };
  }
  if (event.type === 'new_page_check_in') {
    const plan = validId(source.planId) ? await get('newPagePlans', source.planId, tx) : null;
    return { eligible: notificationPublicationMilestone(source, now) === event.source.milestone && sameScope(plan, scope)
      && plan.status === 'published' && plan.publicationId === event.source.id, reason: 'superseded' };
  }
  if (event.type === 'page_needs_attention') {
    if (event.source.collection === 'newPagePublications') {
      const plan = validId(source.planId) ? await get('newPagePlans', source.planId, tx) : null;
      if (!sameScope(plan, scope) || plan.status !== 'published' || plan.publicationId !== event.source.id) return { eligible: false, reason: 'superseded' };
    }
    const issue = notificationTechnicalIssues(event.source.collection, source).find(value => value.code === event.source.issueCode);
    const recoveryAt = technicalRecoveryObservedAt(event.source.collection, source, event.source.issueCode);
    return { eligible: Boolean(issue && !issue.stale && fresh(issue.checkedAt, now)),
      reason: !issue && fresh(recoveryAt, now) ? 'resolved' : 'unavailable' };
  }
  return { eligible: false, reason: 'superseded' };
}
export async function isNotificationEventEligible(event, options = {}) {
  try { return event?.status === 'active' && (await eligibility(event, options)).eligible; }
  catch (error) { if ([404, 409].includes(error?.status)) return false; throw error; }
}

async function persistCandidate(candidate, scope, now) {
  return db.runTransaction(async tx => {
    assertNotificationScope(scope, await readNotificationScope(scope.userId, { tx }));
    let episode, episodeRef;
    if (candidate.episodeKey) {
      episodeRef = db.collection('notificationIssueEpisodes').doc(candidate.episodeKey);
      episode = (await tx.get(episodeRef)).data();
      if (episode && !episode.active && episode.resolvedAt >= candidate.observedAt) return null;
      const number = episode?.active ? episode.episode : (episode?.episode || 0) + 1;
      candidate = { ...candidate, id: hash([candidate.episodeKey, number]), episode: number };
    }
    const ref = db.collection('notificationEvents').doc(candidate.id), current = (await tx.get(ref)).data();
    if (candidate.type === 'reconnect_google') {
      const [user, tokens, observation, source] = await Promise.all([get('users', scope.userId, tx), get('gscTokens', scope.userId, tx),
        get('notificationConnectionObservations', scope.userId, tx), get(candidate.source.collection, candidate.source.id, tx)]);
      const version = connectionVersionOf(user, tokens);
      if (version !== candidate.evidence.connectionVersion || !sameScope(source, scope) || !hasReconnect(source)
        || (candidate.source.collection === 'notificationConnectionObservations' && source.connectionVersion !== version)
        || (sameScope(observation, scope) && observation.connectionVersion === version && observation.status === 'available' && observation.checkedAt >= candidate.observedAt)) return null;
    } else if (!(await eligibility(candidate, { tx, scope, now })).eligible) return null;
    // Preserve read state, delivery identity and first occurrence on corrections.
    const next = { ...candidate, ...(current ? { createdAt: current.createdAt, occurredAt: current.occurredAt,
      readAt: current.readAt || null, emailDeliveryId: current.emailDeliveryId || null, status: current.status,
      observedAt: current.observedAt > candidate.observedAt ? current.observedAt : candidate.observedAt } : {}) };
    if (episodeRef) tx.set(episodeRef, { ...scope, id: candidate.episodeKey, userId: scope.userId, active: true, episode: candidate.episode,
      currentEventId: candidate.id, source: candidate.source, type: candidate.type, updatedAt: now.toISOString(),
      ...(candidate.type === 'reconnect_google' ? { lastFailureAt: episode?.lastFailureAt > candidate.observedAt ? episode.lastFailureAt : candidate.observedAt, connectionVersion: candidate.evidence.connectionVersion } : {}) });
    tx.set(ref, next); return { event: next, created: !current };
  });
}

async function resolveTechnicalRecovery(scope, collection, id, code, now) {
  const episodeRef = db.collection('notificationIssueEpisodes').doc(hash([...scopeKey(scope), (await get(collection, id))?.pageUrl, code]));
  await db.runTransaction(async tx => {
    assertNotificationScope(scope, await readNotificationScope(scope.userId, { tx }));
    const source = await get(collection, id, tx), episode = (await tx.get(episodeRef)).data();
    if (!episode?.active || !sameScope(source, scope) || (source.lifecycle && source.lifecycle !== 'active')) return;
    const eventRef = db.collection('notificationEvents').doc(episode.currentEventId), event = (await tx.get(eventRef)).data();
    const recoveryAt = technicalRecoveryObservedAt(collection, source, code);
    if (event && fresh(recoveryAt, now) && recoveryAt >= event.observedAt
      && !notificationTechnicalIssues(collection, source).some(issue => issue.code === code)) {
      tx.update(episodeRef, { active: false, resolvedAt: recoveryAt });
      tx.update(eventRef, { status: 'resolved', updatedAt: now.toISOString() });
    }
  });
}

/** Best-effort caller hook, only AFTER an observation was committed. Never sends. */
export async function reconcileNotificationSource(collection, id, { now = new Date() } = {}) {
  if (!notificationEventsEnabled() || !SOURCES.includes(collection) || !validId(id)) return { created: 0 };
  const source = await get(collection, id);
  if (!source?.userId || !notificationEnabled(source.userId)) return { created: 0 };
  const scope = await readNotificationScope(source.userId);
  if (!sameScope(source, scope)) return { created: 0 };
  if ((collection === 'pageProgressCycles' && source.technical) || collection === 'newPagePublications') {
    // Resolve a verified recovery immediately. A later recurrence is a new
    // episode even when it occurs before the next scheduled reconciliation.
    for (const code of ISSUE_CODES) {
      const episode = await get('notificationIssueEpisodes', hash([...scopeKey(scope), source.pageUrl, code]));
      if (episode?.active && episode.currentEventId) {
        await resolveTechnicalRecovery(scope, collection, id, code, now);
        await reconcileSavedEvent(episode.currentEventId, now);
      }
    }
  }
  const candidates = notificationCandidates(scope, collection, id, source, now);
  if (collection === 'implementedSeoTips' && await hasModernCycle(source, scope)) candidates.length = 0;
  // Connection failures are account incidents, independent of page count.
  const [user, tokens] = await Promise.all([get('users', scope.userId), get('gscTokens', scope.userId)]), connectionVersion = connectionVersionOf(user, tokens);
  const episodeKey = hash([...scopeKey(scope), 'connection', connectionVersion]);
  const checkedAt = sourceCheckedAt(source);
  const latestConnection = await get('notificationConnectionObservations', scope.userId);
  const laterHealthy = sameScope(latestConnection, scope) && latestConnection.connectionVersion === connectionVersion && latestConnection.status === 'available' && latestConnection.checkedAt >= checkedAt;
  if (!laterHealthy && hasReconnect(source) && checkedAt && (collection !== 'notificationConnectionObservations' || source.connectionVersion === connectionVersion)
    && (!date(user?.gscConnectedAt) || checkedAt >= user.gscConnectedAt)) {
    candidates.push({ ...eventBase(scope, source, collection, id, now), pageUrl: null, pageName: 'Google connection',
      type: 'reconnect_google', episodeKey, title: 'Reconnect Google', message: 'Google needs your permission again before SimplSEO can update your search data.',
      occurredAt: checkedAt, observedAt: checkedAt, destination: { kind: 'connection' }, evidence: { connectionVersion } });
  } else if (checkedAt && collection === 'notificationConnectionObservations' && source.status === 'available' && source.connectionVersion === connectionVersion) {
    await db.runTransaction(async tx => {
      assertNotificationScope(scope, await readNotificationScope(scope.userId, { tx }));
      const ref = db.collection('notificationIssueEpisodes').doc(episodeKey), episode = (await tx.get(ref)).data();
      if (episode?.active && episode.lastFailureAt <= checkedAt) tx.update(ref, { active: false, resolvedAt: checkedAt });
    });
  }
  let created = 0;
  for (const candidate of candidates) { if ((await persistCandidate(candidate, scope, now))?.created) created++; }
  return { created };
}

async function reconcileSavedEvent(id, now) {
  const event = await get('notificationEvents', id);
  if (!event || event.status !== 'active' || !notificationEnabled(event.userId)) return;
  let scope;
  try { scope = await readNotificationScope(event.userId); } catch { return; }
  await db.runTransaction(async tx => {
    assertNotificationScope(scope, await readNotificationScope(event.userId, { tx }));
    const ref = db.collection('notificationEvents').doc(id), current = (await tx.get(ref)).data();
    if (!current || current.status !== 'active') return;
    const result = await eligibility(current, { scope, tx, now });
    const episodeRef = current.episodeKey ? db.collection('notificationIssueEpisodes').doc(current.episodeKey) : null;
    const episode = episodeRef ? (await tx.get(episodeRef)).data() : null;
    if (!result.eligible && ['resolved', 'superseded'].includes(result.reason)) {
      tx.update(ref, { status: result.reason, updatedAt: now.toISOString() });
      if (episode?.currentEventId === id) tx.update(episodeRef, { active: false, resolvedAt: now.toISOString() });
    }
  });
}

/** Each source has an independent durable cursor. Repeated bounded runs cover
 * every record, rather than borrowing the dashboard's featured-work subset. */
export async function reconcileNotifications({ now = new Date(), deadline = Date.now() + 25000, batchSize = 20 } = {}) {
  if (!notificationEventsEnabled()) return { checked: 0, created: 0, failures: 0, moreRecords: false };
  const job = db.collection('notificationJobs').doc('event-reconciliation'), leaseId = randomUUID();
  const saved = await db.runTransaction(async tx => { const data = (await tx.get(job)).data() || {};
    if (Date.parse(data.leaseUntil) > now.getTime()) return null;
    tx.set(job, { ...data, leaseId, leaseUntil: new Date(Math.max(Date.now(), now.getTime()) + 60000).toISOString() }); return data; });
  if (!saved) return { checked: 0, created: 0, failures: 0, moreRecords: true, skipped: true };
  const stats = { checked: 0, created: 0, failures: 0, moreRecords: false }, cursors = { ...(saved.cursors || {}) };
  const allSources = [...SOURCES, 'notificationEvents'], start = (saved.sourceOffset || 0) % allSources.length;
  for (const collection of [...allSources.slice(start), ...allSources.slice(0, start)]) {
    if (deadline - Date.now() < 1500) { stats.moreRecords = true; break; }
    try {
      let query = db.collection(collection).orderBy('__name__').limit(Math.min(40, Math.max(1, batchSize)) + 1);
      if (cursors[collection]) query = query.startAfter(cursors[collection]);
      const snapshot = await query.get(), docs = snapshot.docs.slice(0, batchSize);
      let completed = 0;
      for (const doc of docs) {
        if (deadline - Date.now() < 1000) { stats.moreRecords = true; break; }
        try { if (collection === 'notificationEvents') await reconcileSavedEvent(doc.id, now);
          else stats.created += (await reconcileNotificationSource(collection, doc.id, { now })).created;
        } catch { stats.failures++; }
        stats.checked++; completed++; cursors[collection] = doc.id;
      }
      if (completed === docs.length && snapshot.size <= batchSize) cursors[collection] = null;
      else stats.moreRecords = true;
    } catch { stats.failures++; stats.moreRecords = true; }
  }
  await db.runTransaction(async tx => { const data = (await tx.get(job)).data();
    if (data?.leaseId === leaseId) tx.update(job, { cursors, leaseId: null, leaseUntil: null, lastRunAt: now.toISOString(), sourceOffset: (start + 1) % allSources.length, ...stats }); });
  return { ...stats, counts: { ready: stats.created, error: stats.failures, deferred: stats.moreRecords ? 1 : 0 } };
}

function publicEvent(event, current = true) {
  const { id, type, title, message, pageName, pageUrl, occurredAt, observedAt, createdAt, readAt, status, evidence } = event;
  return { id, type, title, message, pageName, pageUrl, occurredAt, observedAt, createdAt, readAt, status, evidence,
    active: status === 'active' && current, href: `/notifications/${id}` };
}
function cursorDecode(value, scope) {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (value.length > 1200 || parsed.scope !== hash(scopeKey(scope)) || !validId(parsed.id) || !date(parsed.createdAt)) throw Error(); return parsed;
  } catch { throw new RequestError('Reload updates before continuing.', 400); }
}
export async function listNotifications(userId, { cursor, limit = 20, now = new Date() } = {}) {
  const scope = await readNotificationScope(userId);
  if (!notificationEnabled(userId)) return { enabled: false, items: [], nextCursor: null, unreadCount: 0 };
  const count = Math.min(50, Math.max(1, Number.isSafeInteger(Number(limit)) ? Number(limit) : 20)), after = cursorDecode(cursor, scope);
  let query = db.collection('notificationEvents').where('userId', '==', userId).orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(count + 1);
  if (after) query = query.startAfter(after.createdAt, after.id);
  const [snapshot, unread] = await Promise.all([query.get(), db.collection('notificationEvents').where('userId', '==', userId).where('status', '==', 'active').where('readAt', '==', null).limit(101).get()]);
  const docs = snapshot.docs.slice(0, count), items = await Promise.all(docs.map(async doc => {
    const event = { ...doc.data(), id: doc.id }; return publicEvent(event, await isNotificationEventEligible(event, { scope, now })); }));
  const unreadEligible = await Promise.all(unread.docs.map(doc => isNotificationEventEligible({ ...doc.data(), id: doc.id }, { scope, now })));
  assertNotificationScope(scope, await readNotificationScope(userId));
  const last = docs.at(-1);
  return { enabled: true, items, unreadCount: unreadEligible.filter(Boolean).length, unreadCountLimited: unread.size > 100,
    nextCursor: snapshot.size > count && last ? Buffer.from(JSON.stringify({ scope: hash(scopeKey(scope)), createdAt: last.data().createdAt, id: last.id })).toString('base64url') : null };
}
export async function readNotification(userId, id, { now = new Date() } = {}) {
  if (!validId(id)) throw new RequestError('Update not found.', 404);
  const scope = await readNotificationScope(userId), event = await get('notificationEvents', id);
  if (!notificationEnabled(userId) || !event || event.userId !== userId) throw new RequestError('Update not found.', 404);
  const current = sameScope(event, scope), eligible = current && await isNotificationEventEligible(event, { scope, now });
  const target = event.destination;
  const source = SOURCES.includes(event.source?.collection) && validId(event.source?.id)
    ? await get(event.source.collection, event.source.id) : null;
  const navigable = current && event.status !== 'superseded' && sameScope(source, scope) && !source.preRevampArchived;
  let href = null;
  if (navigable && target?.kind === 'connection' && eligible) href = '/settings?tab=integrations';
  if (navigable && target?.kind === 'existing_page' && source.pageUrl === target.pageUrl && propertyContainsUrl(scope.property, target.pageUrl)) {
    const modernReplacement = event.source.collection === 'implementedSeoTips' && await hasModernCycle(source, scope);
    if (!modernReplacement && (!source.lifecycle || source.lifecycle === 'active')
      && (!target.cycleId || (event.source.collection === 'pageProgressCycles' && target.cycleId === event.source.id))
      && (!event.source.checkpointId || source.latestCheckpoint?.id === event.source.checkpointId)
      && (!event.source.confirmedAt || cycleTimestamp(source.implementedAt) === event.source.confirmedAt)) href = `/low-ctr?page=${encodeURIComponent(target.pageUrl)}${target.cycleId ? `&cycleId=${encodeURIComponent(target.cycleId)}` : ''}`;
  }
  if (navigable && target?.kind === 'new_page' && event.source.collection === 'newPagePublications'
    && source.pageUrl === target.pageUrl && source.planId === target.planId && validId(target.planId)) {
    const plan = await get('newPagePlans', target.planId);
    if (sameScope(plan, scope) && plan.status === 'published' && plan.publicationId === event.source.id
      && (!event.source.milestone || notificationPublicationMilestone(source, now) === event.source.milestone)) href = `/generic-keywords?planId=${encodeURIComponent(target.planId)}`;
  }
  assertNotificationScope(scope, await readNotificationScope(userId));
  return { event: publicEvent({ ...event, id }, eligible), destination: { href, historical: !current || !href,
    ...(!current || !href ? { message: 'This dated update belongs to earlier or unavailable work. Your current work has not changed.' } : {}) } };
}
export async function markNotificationRead(userId, id, { now = new Date() } = {}) {
  if (!validId(id)) throw new RequestError('Update not found.', 404);
  const scope = await readNotificationScope(userId);
  return db.runTransaction(async tx => {
    assertNotificationScope(scope, await readNotificationScope(userId, { tx }));
    const ref = db.collection('notificationEvents').doc(id), event = (await tx.get(ref)).data();
    if (!notificationEnabled(userId) || !event || event.userId !== userId) throw new RequestError('Update not found.', 404);
    const next = { ...event, readAt: event.readAt || now.toISOString() };
    tx.update(ref, { readAt: next.readAt }); return { event: publicEvent({ ...next, id }, sameScope(event, scope)) };
  });
}
