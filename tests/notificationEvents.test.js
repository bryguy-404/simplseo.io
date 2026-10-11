import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  const fake = fakeFirestore(), base = fake.db.collection;
  const val = (path, data, field) => field === '__name__' ? path.split('/').at(-1) : field.split('.').reduce((v, key) => v?.[key], data);
  const query = (path, filters = [], orders = [], maximum = Infinity, after = null) => ({ ...base(path),
    where: (field, operator, value) => query(path, [...filters, [field, operator, value]], orders, maximum, after),
    orderBy: (field, direction = 'asc') => query(path, filters, [...orders, [field, direction]], maximum, after),
    limit: count => query(path, filters, orders, count, after),
    startAfter: (...values) => query(path, filters, orders, maximum, values),
    get: async () => {
      const compare = (a, b) => { for (let i = 0; i < orders.length; i++) { const direction = orders[i][1] === 'desc' ? -1 : 1;
        if (a[i] !== b[i]) return String(a[i]).localeCompare(String(b[i])) * direction; } return 0; };
      const entries = [...fake.records].filter(([key, data]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1
        && filters.every(([field, op, expected]) => op === '==' && val(key, data, field) === expected))
        .sort((a, b) => compare(orders.map(([field]) => val(a[0], a[1], field)), orders.map(([field]) => val(b[0], b[1], field))))
        .filter(([key, data]) => !after || compare(orders.map(([field]) => val(key, data, field)), after) > 0).slice(0, maximum);
      const docs = await Promise.all(entries.map(([key]) => base(path).doc(key.split('/').at(-1)).get()));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  fake.db.collection = path => query(path);
  const transaction = fake.db.runTransaction; let pending = Promise.resolve();
  fake.db.runTransaction = fn => { const next = pending.then(() => transaction(fn)); pending = next.catch(() => {}); return next; };
  return { ...fake, auth: { verifyIdToken: vi.fn(async token => ({ uid: token })) } };
});
vi.mock('../app/lib/server/notificationScope', async () => {
  const { db } = await import('../app/lib/firebaseAdmin');
  const { RequestError } = await import('../app/lib/server/requestAuth');
  return {
    notificationEnabled: uid => ['alice', 'bob'].includes(uid), notificationEventsEnabled: () => true,
    readNotificationScope: async (userId, { tx } = {}) => {
      const ref = db.collection('users').doc(userId), snap = await (tx ? tx.get(ref) : ref.get());
      if (!snap.exists || snap.data().deletionInProgress) throw new RequestError('Account unavailable', 409);
      return { userId, property: snap.data().property, websiteRunId: snap.data().websiteRunId, websiteUrl: snap.data().property };
    },
    assertNotificationScope: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new RequestError('Changed', 409); },
  };
});

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { ongoingCheckpointWindows } from '../app/lib/progressAssessment';
import { isNotificationEventEligible, listNotifications, markNotificationRead, notificationCandidates, notificationCheckpointAvailable, notificationPublicationMilestone, readNotification, reconcileNotifications, reconcileNotificationSource } from '../app/lib/server/notificationEvents';
import { GET as listRoute } from '../app/api/notifications/route';
import { POST as readRoute } from '../app/api/notifications/read/route';

const now = new Date('2026-10-11T16:00:00.000Z'), property = 'https://example.com/';
const scope = { userId: 'alice', property, websiteRunId: 'v1', websiteUrl: property };
const confirmedAt = '2026-08-01T12:00:00.000Z';
const checkpoint = (day = 56, patch = {}) => {
  const windows = ongoingCheckpointWindows(confirmedAt, day, now);
  return { id: `day-${day}`, day, source: 'google_search_console', state: 'available', observedAt: now.toISOString(), evidenceRevision: 1, windows,
    baseline: { ...windows.baseline, status: 'has_data', clicks: 0, impressions: 100 }, post: { ...windows.post, status: 'no_data', clicks: 0, impressions: 0 }, ...patch };
};
const cycle = (patch = {}) => ({ ...scope, id: 'cycle-one', pageUrl: `${property}service`, lifecycle: 'active', confirmedAt,
  latestCheckpoint: checkpoint(), latestCheckpointId: 'day-56', ...patch });
const seedCycle = async (patch = {}, id = 'cycle-one') => { const value = cycle({ ...patch, id }); await db.collection('pageProgressCycles').doc(id).set(value); return value; };
const publication = patch => ({ ...scope, id: 'publication-one', pageUrl: `${property}new-page`, planId: 'plan-one', trackingEnabled: true,
  ownerDeclaredAt: '2026-07-01T12:00:00Z', verifiedAt: '2026-07-01T12:00:00Z', publicPage: { status: 'available' }, ...patch });
const events = () => [...records].filter(([key]) => /^notificationEvents\/[^/]+$/.test(key)).map(([, value]) => value);

beforeEach(async () => { reset(); vi.useFakeTimers(); vi.setSystemTime(now);
  await db.collection('users').doc('alice').set({ property, websiteRunId: 'v1', gscConnectionVersion: 'connection-one' });
  await db.collection('users').doc('bob').set({ property: 'https://other.com/', websiteRunId: 'v1' });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('notification evidence policy', () => {
  it.each([{ clicks: 20, impressions: 200 }, { clicks: 0, impressions: 0 }, { clicks: 0, impressions: 500 }, { clicks: 1, impressions: 5 }])('notifies complete comparisons regardless of volume or direction: %o', metrics => {
    const point = checkpoint(); point.post = { ...point.post, ...metrics };
    expect(notificationCheckpointAvailable(cycle({ latestCheckpoint: point }), now)).toBe(true);
  });
  it('rejects a review_due label, absent totals, incomplete state and prematurely dated periods', () => {
    expect(notificationCheckpointAvailable(cycle({ latestCheckpoint: null, reviewStatus: 'review_due' }), now)).toBe(false);
    const point = checkpoint(); delete point.baseline.clicks;
    expect(notificationCheckpointAvailable(cycle({ latestCheckpoint: point }), now)).toBe(false);
    expect(notificationCheckpointAvailable(cycle({ latestCheckpoint: checkpoint(56, { state: 'incomplete' }) }), now)).toBe(false);
    expect(notificationCheckpointAvailable(cycle({ latestCheckpoint: checkpoint(84) }), now)).toBe(false);
  });
  it('honors Pacific day boundaries and reporting buffer', () => {
    const confirmation = '2026-02-08T22:00:00Z', availableAt = new Date('2026-03-11T07:00:00Z');
    const windows = ongoingCheckpointWindows(confirmation, 28, availableAt);
    const point = { ...checkpoint(28), observedAt: '2026-03-10T00:00:00Z', baseline: { ...checkpoint(28).baseline, ...windows.baseline }, post: { ...checkpoint(28).post, ...windows.post } };
    const source = cycle({ confirmedAt: confirmation, latestCheckpoint: point });
    expect(notificationCheckpointAvailable(source, new Date('2026-03-11T06:59:59Z'))).toBe(false);
    expect(notificationCheckpointAvailable(source, availableAt)).toBe(true);
  });
  it('suppresses a reviewed checkpoint even when its evidence revision later changes', () => {
    expect(notificationCandidates(scope, 'pageProgressCycles', 'cycle-one', cycle({ latestDecision: { checkpointId: 'day-56', checkpointRevision: 1 }, latestCheckpoint: checkpoint(56, { evidenceRevision: 2 }) }), now)).toEqual([]);
    expect(notificationCandidates(scope, 'pageProgressCycles', 'cycle-one', cycle({ lastAcknowledgedCheckpointId: 'day-56' }), now)).toEqual([]);
  });
  it('uses only the latest due publication milestone without inventing activity or indexing', () => {
    expect(notificationPublicationMilestone(publication(), now)).toBe(84);
    expect(notificationPublicationMilestone(publication({ verifiedAt: '2026-10-01T00:00:00Z' }), now)).toBeNull();
    expect(notificationPublicationMilestone(publication({ ownerDeclaredAt: null }), now)).toBeNull();
    const [candidate] = notificationCandidates(scope, 'newPagePublications', 'publication-one', publication(), now);
    expect(candidate.source.milestone).toBe(84); expect(candidate.message).toContain('results may still be limited');
    expect(candidate).not.toHaveProperty('clicks'); expect(candidate.message).not.toContain('indexed');
  });
  it('does not treat stale or failed technical checks as findings', () => {
    const issue = { code: 'noindex', message: 'A live noindex is present.', checkedAt: now.toISOString() };
    const findings = patch => notificationCandidates(scope, 'pageProgressCycles', 'cycle-one', cycle({ latestCheckpoint: null, technical: { issues: [{ ...issue, ...patch }] } }), now);
    expect(findings({})).toHaveLength(1); expect(findings({ stale: true })).toEqual([]);
    expect(findings({ checkedAt: '2026-09-01T00:00:00Z' })).toEqual([]);
    expect(findings({ code: 'temporarily_unavailable' })).toEqual([]);
  });
});

describe('saved notification lifecycle', () => {
  it('deduplicates repeated collection and preserves delivery claims/read state on corrections', async () => {
    await seedCycle(); await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now });
    const first = events()[0]; await markNotificationRead('alice', first.id);
    await db.collection('notificationEvents').doc(first.id).update({ emailDeliveryId: 'frozen-delivery' });
    await seedCycle({ latestCheckpoint: checkpoint(56, { evidenceRevision: 2, observedAt: '2026-10-11T15:00:00Z' }) });
    await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now });
    expect(events()).toHaveLength(1); expect(events()[0]).toMatchObject({ readAt: now.toISOString(), emailDeliveryId: 'frozen-delivery', evidence: { revision: 2 }, occurredAt: first.occurredAt });
  });
  it('suppresses pending notices immediately when reviewed, without resetting dates or tasks', async () => {
    await seedCycle(); await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now });
    const event = events()[0]; await db.collection('pageProgressCycles').doc('cycle-one').update({ lastAcknowledgedCheckpointId: 'day-56' });
    expect(await isNotificationEventEligible(event, { now })).toBe(false);
    expect((await listNotifications('alice', { now })).unreadCount).toBe(0);
    await reconcileNotifications({ now }); expect(events()[0].status).toBe('resolved');
    expect(records.get('pageProgressCycles/cycle-one').confirmedAt).toBe(confirmedAt);
  });
  it('reconciles true issue episodes without timestamp-only duplicates or reopening stale failures', async () => {
    const issue = { code: 'noindex', message: 'The page declares noindex.', checkedAt: now.toISOString() };
    await seedCycle({ latestCheckpoint: null, technical: { issues: [issue], publicPage: { checkedAt: now.toISOString() } } });
    await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now });
    await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now }); expect(events()).toHaveLength(1);
    await seedCycle({ latestCheckpoint: null, technical: { issues: [], publicPage: { status: 'available', checkedAt: now.toISOString() } } });
    await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now }); expect(events()[0].status).toBe('resolved');
    const later = new Date(now.getTime() + 60000);
    await seedCycle({ latestCheckpoint: null, technical: { issues: [{ ...issue, checkedAt: later.toISOString() }], publicPage: { checkedAt: later.toISOString() } } });
    await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now: later }); expect(events()).toHaveLength(2);
    expect(events().map(event => event.episode)).toEqual([1, 2]);
  });
  it('creates one reconnect incident across many pages and suppresses stale failures after a saved success', async () => {
    await seedCycle({ latestCheckpoint: null, lastError: { checkedAt: now.toISOString(), connection: 'reconnect_required' } });
    await seedCycle({ latestCheckpoint: null, pageUrl: `${property}other`, lastError: { checkedAt: now.toISOString(), connection: 'reconnect_required' } }, 'cycle-two');
    await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now }); await reconcileNotificationSource('pageProgressCycles', 'cycle-two', { now });
    expect(events()).toHaveLength(1); expect(events()[0].type).toBe('reconnect_google');
    await db.collection('notificationConnectionObservations').doc('alice').set({ ...scope, checkedAt: now.toISOString(), status: 'available', connectionVersion: 'connection-one' });
    expect(await isNotificationEventEligible(events()[0], { now })).toBe(false);
    await reconcileNotifications({ now }); expect(events()).toHaveLength(1); expect(events()[0].status).toBe('resolved');
  });
  it('ignores temporary failures and recognizes a reconnect incident without any active work', async () => {
    await db.collection('notificationConnectionObservations').doc('alice').set({ ...scope, checkedAt: now.toISOString(), status: 'temporarily_unavailable', connectionVersion: 'connection-one' });
    await reconcileNotificationSource('notificationConnectionObservations', 'alice', { now }); expect(events()).toHaveLength(0);
    await db.collection('notificationConnectionObservations').doc('alice').update({ status: 'reconnect_required' });
    await reconcileNotificationSource('notificationConnectionObservations', 'alice', { now }); expect(events()).toHaveLength(1);
  });
  it('handles new-page milestones only with the matching published plan', async () => {
    await db.collection('newPagePublications').doc('publication-one').set(publication());
    await reconcileNotificationSource('newPagePublications', 'publication-one', { now }); expect(events()).toHaveLength(0);
    await db.collection('newPagePlans').doc('plan-one').set({ ...scope, status: 'published', publicationId: 'publication-one' });
    await reconcileNotificationSource('newPagePublications', 'publication-one', { now }); expect(events()).toHaveLength(1);
    expect((await readNotification('alice', events()[0].id)).destination.href).toBe('/generic-keywords?planId=plan-one');
  });
  it('keeps old-version history but never routes it into unrelated current work', async () => {
    await seedCycle(); await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now });
    await db.collection('users').doc('alice').update({ websiteRunId: 'v2' });
    const result = await readNotification('alice', events()[0].id);
    expect(result.destination).toMatchObject({ href: null, historical: true }); expect(result.event.active).toBe(false);
    expect((await listNotifications('alice', { now })).unreadCount).toBe(0);
  });
  it('forbids cross-account reads and mark-read, and refuses deleted accounts', async () => {
    await seedCycle(); await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now }); const event = events()[0];
    await expect(readNotification('bob', event.id)).rejects.toMatchObject({ status: 404 });
    await expect(markNotificationRead('bob', event.id)).rejects.toMatchObject({ status: 404 });
    await db.collection('users').doc('alice').delete(); await expect(readNotification('alice', event.id)).rejects.toMatchObject({ status: 409 });
  });
  it('GET reads perform no writes or provider work and reading never completes a task', async () => {
    await seedCycle(); await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now });
    const snapshot = structuredClone([...records]), fetch = vi.spyOn(globalThis, 'fetch');
    await listNotifications('alice', { now }); await readNotification('alice', events()[0].id);
    expect([...records]).toEqual(snapshot); expect(fetch).not.toHaveBeenCalled();
    await markNotificationRead('alice', events()[0].id); expect(records.get('pageProgressCycles/cycle-one')).toEqual(cycle());
  });
  it('covers every source through independent resumable cursors beyond one batch', async () => {
    for (let index = 0; index < 7; index++) await seedCycle({ pageUrl: `${property}service-${index}` }, `cycle-${index}`);
    const first = await reconcileNotifications({ now, batchSize: 2 }); expect(first.moreRecords).toBe(true);
    for (let index = 0; index < 4; index++) await reconcileNotifications({ now, batchSize: 2 });
    expect(events().filter(event => event.type === 'results_ready')).toHaveLength(7);
    expect(records.get('notificationJobs/event-reconciliation').cursors).toBeTruthy();
  });
  it('paginates the inbox consistently and rejects a forged scope cursor', async () => {
    for (let index = 0; index < 3; index++) { await seedCycle({}, `cycle-${index}`); await reconcileNotificationSource('pageProgressCycles', `cycle-${index}`, { now }); }
    const first = await listNotifications('alice', { now, limit: 2 }), second = await listNotifications('alice', { now, limit: 2, cursor: first.nextCursor });
    expect(first.items).toHaveLength(2); expect(second.items).toHaveLength(1); expect(new Set([...first.items, ...second.items].map(event => event.id)).size).toBe(3);
    await expect(listNotifications('bob', { cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
  });
  it('notifies a verified publication noindex or canonical finding without requiring a mature check-in', async () => {
    await db.collection('newPagePlans').doc('plan-one').set({ ...scope, status: 'published', publicationId: 'publication-one' });
    await db.collection('newPagePublications').doc('publication-one').set(publication({ verifiedAt: now.toISOString(), publicPage: {
      status: 'available', verifiedAt: now.toISOString(), robots: 'noindex,follow', canonical: `${property}different` } }));
    await reconcileNotificationSource('newPagePublications', 'publication-one', { now });
    expect(events().map(event => event.source.issueCode).sort()).toEqual(['canonical', 'noindex']);
    expect(events().every(event => event.destination.kind === 'new_page')).toBe(true);
  });
  it('does not freshen old publication warnings or interpret a failed Google check as a technical issue', async () => {
    await db.collection('newPagePlans').doc('plan-one').set({ ...scope, status: 'published', publicationId: 'publication-one' });
    await db.collection('newPagePublications').doc('publication-one').set(publication({
      publicPage: { status: 'available', verifiedAt: '2026-07-01T12:00:00Z', robots: 'noindex', warnings: ['Noindex exists'] },
      indexing: { status: 'available', fetchedAt: now.toISOString(), indexingState: 'BLOCKED_BY_META_TAG' }, lastError: { indexing: 'temporarily_unavailable' },
    }));
    await reconcileNotificationSource('newPagePublications', 'publication-one', { now });
    expect(events().filter(event => event.type === 'page_needs_attention')).toEqual([]);
    expect(events().filter(event => event.type === 'new_page_check_in')).toHaveLength(1);
  });
  it('a newer healthy cycle check resolves an older publication issue without stale reopening', async () => {
    await db.collection('newPagePlans').doc('plan-one').set({ ...scope, status: 'published', publicationId: 'publication-one' });
    await db.collection('newPagePublications').doc('publication-one').set(publication({ verifiedAt: now.toISOString(), publicPage: {
      status: 'available', verifiedAt: now.toISOString(), robots: 'noindex' } }));
    await reconcileNotificationSource('newPagePublications', 'publication-one', { now });
    const later = new Date(now.getTime() + 60000);
    await seedCycle({ pageUrl: `${property}new-page`, latestCheckpoint: null, technical: { issues: [], publicPage: { status: 'available', checkedAt: later.toISOString() } } });
    await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now: later });
    expect(events()[0].status).toBe('resolved');
    await reconcileNotificationSource('newPagePublications', 'publication-one', { now: later });
    expect(events()).toHaveLength(1); expect(events()[0].status).toBe('resolved');
  });
  it('creates a fresh stored Google indexing-block notice separately from publication status', async () => {
    await db.collection('newPagePlans').doc('plan-one').set({ ...scope, status: 'published', publicationId: 'publication-one' });
    await db.collection('newPagePublications').doc('publication-one').set(publication({
      indexing: { status: 'available', fetchedAt: now.toISOString(), robotsTxtState: 'DISALLOWED' },
    }));
    await reconcileNotificationSource('newPagePublications', 'publication-one', { now });
    const issue = events().find(event => event.type === 'page_needs_attention');
    expect(issue.source.issueCode).toBe('google_robots'); expect(issue.message).toContain('saved inspection');
  });
  it('never routes an older checkpoint notice into the newer comparison', async () => {
    await seedCycle({ latestCheckpoint: checkpoint(28), latestCheckpointId: 'day-28' });
    await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now }); const event = events()[0];
    await seedCycle();
    expect((await readNotification('alice', event.id)).destination).toMatchObject({ href: null, historical: true });
  });
  it('ignores an old connection attempt after a newer validated connection', async () => {
    await db.collection('notificationConnectionObservations').doc('alice').set({ ...scope, checkedAt: now.toISOString(), status: 'reconnect_required', connectionVersion: 'older-connection' });
    await reconcileNotificationSource('notificationConnectionObservations', 'alice', { now }); expect(events()).toHaveLength(0);
  });
  it('does not create legacy notices when a different current recurring cycle owns the page', async () => {
    const point = checkpoint(28), legacy = { ...scope, gscProperty: property, pageUrl: `${property}service`, status: 'implemented', implementedAt: confirmedAt,
      progressAssessment: { source: 'google_search_console', property, websiteRunId: 'v1', pageUrl: `${property}service`, implementedAt: confirmedAt,
        state: 'ready', attemptedAt: now.toISOString(), baseline: point.baseline, post: point.post } };
    await seedCycle({ confirmedAt: '2026-09-01T12:00:00Z', latestCheckpoint: null });
    await db.collection('implementedSeoTips').doc('legacy-one').set(legacy);
    await reconcileNotificationSource('implementedSeoTips', 'legacy-one', { now }); expect(events()).toHaveLength(0);
  });
  it('shows a legacy notice as history once a recurring cycle takes ownership of the page', async () => {
    const point = checkpoint(28), legacy = { ...scope, gscProperty: property, pageUrl: `${property}service`, status: 'implemented', implementedAt: confirmedAt,
      progressAssessment: { source: 'google_search_console', property, websiteRunId: 'v1', pageUrl: `${property}service`, implementedAt: confirmedAt,
        state: 'ready', attemptedAt: now.toISOString(), baseline: point.baseline, post: point.post } };
    await db.collection('implementedSeoTips').doc('legacy-one').set(legacy);
    await reconcileNotificationSource('implementedSeoTips', 'legacy-one', { now }); const event = events()[0];
    expect((await readNotification('alice', event.id)).destination.href).toContain('/low-ctr?');
    await seedCycle({ confirmedAt: '2026-09-01T12:00:00Z', latestCheckpoint: null });
    expect((await readNotification('alice', event.id)).destination).toMatchObject({ href: null, historical: true });
  });
  it('rejects destinations whose source scope changed and explicitly superseded events', async () => {
    await seedCycle(); await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now }); const event = events()[0];
    await db.collection('pageProgressCycles').doc('cycle-one').update({ userId: 'bob' });
    expect((await readNotification('alice', event.id)).destination).toMatchObject({ href: null, historical: true });
    await seedCycle(); await db.collection('notificationEvents').doc(event.id).update({ status: 'superseded' });
    expect((await readNotification('alice', event.id)).destination).toMatchObject({ href: null, historical: true });
  });
  it('keeps a reviewed current checkpoint navigable to its saved guidance', async () => {
    await seedCycle(); await reconcileNotificationSource('pageProgressCycles', 'cycle-one', { now }); const event = events()[0];
    await db.collection('pageProgressCycles').doc('cycle-one').update({ latestDecision: { checkpointId: 'day-56', checkpointRevision: 1 } });
    await reconcileNotifications({ now });
    const result = await readNotification('alice', event.id);
    expect(result.event.status).toBe('resolved'); expect(result.destination.historical).toBe(false);
    expect(result.destination.href).toContain('cycleId=cycle-one');
  });
  it('does not route a publication notice after its source is replaced or its plan points elsewhere', async () => {
    await db.collection('newPagePlans').doc('plan-one').set({ ...scope, status: 'published', publicationId: 'publication-one' });
    await db.collection('newPagePublications').doc('publication-one').set(publication());
    await reconcileNotificationSource('newPagePublications', 'publication-one', { now }); const event = events()[0];
    await db.collection('newPagePublications').doc('publication-one').update({ websiteRunId: 'old-version' });
    expect((await readNotification('alice', event.id)).destination).toMatchObject({ href: null, historical: true });
    await db.collection('newPagePublications').doc('publication-one').set(publication());
    await db.collection('newPagePlans').doc('plan-one').update({ publicationId: 'replacement' });
    expect((await readNotification('alice', event.id)).destination).toMatchObject({ href: null, historical: true });
  });
  it('authenticates route calls and never trusts a supplied identity', async () => {
    const anonymous = await listRoute(new Request('https://app.test/api/notifications')); expect(anonymous.status).toBe(401);
    const forged = await readRoute(new Request('https://app.test/api/notifications/read', { method: 'POST', headers: { Authorization: 'Bearer alice' }, body: JSON.stringify({ userId: 'bob', id: 'anything' }) })); expect(forged.status).toBe(403);
  });
});
