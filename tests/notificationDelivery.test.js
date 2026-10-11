import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const fake = (await import('./fakeFirestore')).fakeFirestore(), original = fake.db.runTransaction, base = fake.db.collection;
  const fieldValue = (path, data, field) => typeof field !== 'string' || field === '__name__' ? path.split('/').at(-1) : data[field];
  const query = (path, filters = [], orders = [], maximum = Infinity, cursor = null) => ({ ...base(path),
    where: (field, operator, value) => query(path, [...filters, [field, operator, value]], orders, maximum, cursor),
    orderBy: (field, direction = 'asc') => query(path, filters, [...orders, [field, direction]], maximum, cursor),
    limit: count => query(path, filters, orders, count, cursor),
    startAfter: (...values) => query(path, filters, orders, maximum, values),
    get: async () => {
      const values = ([key, data]) => orders.map(([field]) => fieldValue(key, data, field));
      const compare = (a, b) => { for (let i = 0; i < orders.length; i++) {
        const delta = String(a[i]).localeCompare(String(b[i])) * (orders[i][1] === 'desc' ? -1 : 1); if (delta) return delta;
      } return 0; };
      const entries = [...fake.records].filter(([key, data]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1
        && filters.every(([field, op, expected]) => op === '==' && fieldValue(key, data, field) === expected))
        .sort((a, b) => compare(values(a), values(b))).filter(entry => !cursor || compare(values(entry), cursor) > 0).slice(0, maximum);
      const docs = await Promise.all(entries.map(([key]) => base(path).doc(key.split('/').at(-1)).get()));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  fake.db.collection = path => query(path);
  let pending = Promise.resolve();
  fake.db.runTransaction = callback => { const task = pending.then(() => original(callback)); pending = task.catch(() => {}); return task; };
  return { ...fake, auth: { verifyIdToken: vi.fn(async uid => ({ uid })), getUser: vi.fn(async uid => ({ uid, email: `${uid}@example.com`, emailVerified: true })) } };
});
vi.mock('../app/lib/server/notificationEvents', () => ({ isNotificationEventEligible: vi.fn(async event => event.eligible !== false) }));
import { db, records, reset, auth } from '../app/lib/firebaseAdmin';
import { notificationRecipient, readNotificationPreferences, updateNotificationPreferences, inspectNotificationUnsubscribe, unsubscribeNotifications } from '../app/lib/server/notificationPreferences';
import { notificationHash, unsubscribeToken, verifyUnsubscribeToken, renderNotificationEmail, verifyNotificationWebhook } from '../app/lib/server/notificationEmail';
import { prepareNotificationDigest, attemptNotificationDelivery, notificationRetryState, nextNotificationProviderStatus, handleNotificationWebhook, runNotificationDelivery, sendNotificationTest } from '../app/lib/server/notificationDelivery';
import { GET as preferenceGet, PATCH as preferencePatch } from '../app/api/notifications/preferences/route';
import { GET as unsubscribeGet, POST as unsubscribePost } from '../app/api/notifications/unsubscribe/route';
import { POST as webhookPost } from '../app/api/notifications/webhook/route';
import { POST as testPost } from '../app/api/notifications/test-email/route';
const now = Date.parse('2026-10-11T10:00:00Z');
const scope = { userId: 'alice', property: 'https://example.com/', websiteUrl: 'https://example.com/', websiteRunId: null };
const secret = 'whsec_' + Buffer.from('webhook-secret-for-isolated-tests').toString('base64');
async function enabled() {
  return updateNotificationPreferences('alice', { expectedRevision: 0, emailEnabled: true, idempotencyKey: 'opt-in' }, new Date(now));
}
async function event(id = 'one', extra = {}) {
  await db.collection('notificationEvents').doc(id).set({ id, ...scope, status: 'active', readAt: null, emailDeliveryId: null,
    title: 'Results ready', pageName: 'Homepage', message: 'Two saved reporting periods are available.', occurredAt: '2026-10-10T00:00:00Z',
    createdAt: new Date(now).toISOString(), ...extra });
}
async function queued(id = 'one') { await event(id); return prepareNotificationDigest('alice', [id], { now }); }
function signed(event, id = 'msg-one', timestamp = now / 1000) {
  const raw = JSON.stringify(event), signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return { raw, headers: new Headers({ 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${signature}` }) };
}
beforeEach(async () => {
  reset(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  Object.assign(process.env, { NOTIFICATIONS_ENABLED: 'true', NOTIFICATION_PILOT_UIDS: 'alice,bob', NOTIFICATION_EMAILS_ENABLED: 'true',
    RESEND_API_KEY: 'isolated-key', RESEND_NOTIFICATION_FROM: 'SimplSEO <updates@example.com>', RESEND_NOTIFICATION_REPLY_TO: 'help@example.com',
    RESEND_WEBHOOK_SECRET: secret, NOTIFICATION_UNSUBSCRIBE_SECRET: 'isolated-unsubscribe-secret-is-at-least-32-characters',
    NOTIFICATION_PUBLIC_ORIGIN: 'https://app.example.com', NOTIFICATION_TRACKING_DISABLED: 'true' });
  auth.getUser.mockImplementation(async uid => ({ uid, email: `${uid}@example.com`, emailVerified: true }));
  await db.collection('users').doc('alice').set({ websiteUrl: scope.websiteUrl, gscSiteUrl: scope.property });
  await db.collection('onboarding').doc('alice').set({ websiteUrl: scope.websiteUrl, gscProperty: scope.property });
});
afterEach(() => { vi.useRealTimers(); });

describe('notification preferences and safe mail content', () => {
  it('defaults off and saved reads perform no provider request or writes', async () => {
    const count = records.size;
    expect(await readNotificationPreferences('alice')).toMatchObject({ emailEnabled: false, revision: 0, chosenAt: null, recipient: 'alice@example.com' });
    expect(records.size).toBe(count); expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds Firebase Auth reads and discards a late verification response', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    let resolveAuth;
    auth.getUser.mockImplementation(() => new Promise(resolve => { resolveAuth = resolve; }));
    const result = notificationRecipient('alice', { deadline: now + 2000 });
    const assertion = expect(result).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(1000); await assertion;
    resolveAuth({ email: 'alice@example.com', emailVerified: true }); await Promise.resolve();
    expect([...records.keys()].some(key => key.startsWith('notificationDeliveries/'))).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it('requires a verified recipient and optimistic revision', async () => {
    await enabled();
    await expect(updateNotificationPreferences('alice', { expectedRevision: 0, emailEnabled: false })).rejects.toMatchObject({ status: 409 });
    auth.getUser.mockResolvedValue({ email: 'alice@example.com', emailVerified: false });
    await expect(updateNotificationPreferences('alice', { expectedRevision: 1, emailEnabled: true })).rejects.toMatchObject({ status: 409 });
  });
  it('preserves declined choice and makes duplicate saves idempotent', async () => {
    await updateNotificationPreferences('alice', { expectedRevision: 0, emailEnabled: false, idempotencyKey: 'decline' });
    const result = await updateNotificationPreferences('alice', { expectedRevision: 0, emailEnabled: false, idempotencyKey: 'decline' });
    expect(result).toMatchObject({ revision: 1, emailEnabled: false }); expect(result.chosenAt).toBeTruthy();
  });
  it('pauses a changed email until its owner explicitly confirms it', async () => {
    await enabled(); auth.getUser.mockResolvedValue({ email: 'new@example.com', emailVerified: true });
    expect(await readNotificationPreferences('alice')).toMatchObject({ emailState: 'confirm_new_email', emailEnabled: false });
    expect(await updateNotificationPreferences('alice', { expectedRevision: 1, emailEnabled: true })).toMatchObject({ emailEnabled: true, recipient: 'new@example.com' });
  });
  it('unsubscribe GET is scanner safe and tokens can only turn email off', async () => {
    await enabled(); const token = unsubscribeToken('alice', 'alice@example.com');
    expect(await inspectNotificationUnsubscribe(token)).toEqual({ valid: true, emailEnabled: true });
    expect(records.get('notificationPreferences/alice').emailEnabled).toBe(true);
    await unsubscribeNotifications(token); await unsubscribeNotifications(token);
    expect(records.get('notificationPreferences/alice')).toMatchObject({ emailEnabled: false, revision: 2 });
    expect(() => verifyUnsubscribeToken(token + 'x')).toThrow();
    await updateNotificationPreferences('alice', { expectedRevision: 2, emailEnabled: true });
    auth.getUser.mockResolvedValue({ email: 'new@example.com', emailVerified: true });
    await updateNotificationPreferences('alice', { expectedRevision: 3, emailEnabled: true });
    await unsubscribeNotifications(token);
    expect(records.get('notificationPreferences/alice').emailEnabled).toBe(true);
  });
  it('escapes content, features five updates and never embeds private tables', () => {
    const payload = renderNotificationEmail({ userId: 'alice', recipient: 'alice@example.com', deliveryId: 'abc', events: Array.from({ length: 6 }, (_, i) => ({ id: `id-${i}`, title: '<script>x</script>', message: 'A & B', queries: ['secret'], occurredAt: '2026-10-01' })) });
    expect(payload.html).not.toContain('<script>'); expect(payload.html).toContain('&lt;script&gt;'); expect(payload.text).not.toContain('secret');
    expect(payload.html).not.toContain('/notifications/id-5'); expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(payload.tags).toContainEqual({ name: 'delivery_id', value: 'abc' });
  });
  it('does not recreate preferences after account deletion', async () => {
    await enabled(); const token = unsubscribeToken('alice', 'alice@example.com');
    await db.collection('users').doc('alice').delete(); await db.collection('notificationPreferences').doc('alice').delete();
    await unsubscribeNotifications(token); expect(records.has('notificationPreferences/alice')).toBe(false);
    await expect(updateNotificationPreferences('alice', { expectedRevision: 0, emailEnabled: true })).rejects.toMatchObject({ status: 409 });
  });
});

describe('notification queue, frozen attempts and quotas', () => {
  it('claims one immutable payload under simultaneous digest preparation', async () => {
    await enabled(); await event();
    const results = await Promise.all([prepareNotificationDigest('alice', ['one'], { now }), prepareNotificationDigest('alice', ['one'], { now })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const delivery = results.find(Boolean);
    expect(records.get('notificationEvents/one').emailDeliveryId).toBe(delivery.id);
    expect(delivery.payload.to).toEqual(['alice@example.com']);
  });
  it('ignores read, resolved and source-ineligible events', async () => {
    await enabled(); await event('read', { readAt: new Date(now).toISOString() }); await event('resolved', { status: 'resolved' }); await event('unsupported', { eligible: false });
    expect(await prepareNotificationDigest('alice', ['read', 'resolved', 'unsupported'], { now })).toBeNull();
  });
  it('reserves attempts before sending and never calls the provider twice for an accepted delivery', async () => {
    await enabled(); const delivery = await queued(), fetchImpl = vi.fn(async () => {
      expect(records.get('notificationBudgets/day-2026-10-11').attempts).toBe(1);
      expect(records.get(`notificationDeliveries/${delivery.id}`).firstAttemptAt).toBeTruthy();
      return Response.json({ id: 'resend-one' });
    });
    expect(await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl })).toMatchObject({ status: 'accepted' });
    await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(records.get('notificationPreferences/alice').lastDigestAt).toBe(new Date(now).toISOString());
  });
  it('retries the exact payload and key only within the provider retention window', async () => {
    await enabled(); const delivery = await queued();
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(Response.json({ id: 'recovered' }));
    await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl });
    vi.setSystemTime(now + 61000);
    await attemptNotificationDelivery(delivery.id, { now: now + 61000, deadline: now + 86000, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].body).toBe(fetchImpl.mock.calls[1][1].body);
    expect(fetchImpl.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetchImpl.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it('retains a claimed queue when the deadline expires after reservation but before dispatch', async () => {
    await enabled(); const delivery = await queued();
    let reads = 0; auth.getUser.mockImplementation(async () => {
      if (++reads === 2) vi.setSystemTime(now + 24000);
      return { email: 'alice@example.com', emailVerified: true };
    });
    const fetchImpl = vi.fn(async () => Response.json({ id: 'sent-after-deferral' }));
    expect(await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl })).toMatchObject({ status: 'deferred', attempted: false });
    expect(records.get(`notificationDeliveries/${delivery.id}`)).toMatchObject({ status: 'queued', dispatchPending: true, attemptCount: 0, firstAttemptAt: null });
    expect(records.get('notificationEvents/one').emailDeliveryId).toBe(delivery.id); expect(fetchImpl).not.toHaveBeenCalled();
    auth.getUser.mockResolvedValue({ email: 'alice@example.com', emailVerified: true }); vi.setSystemTime(now + 86400000);
    expect(await attemptNotificationDelivery(delivery.id, { now: Date.now(), deadline: Date.now() + 25000, fetchImpl })).toMatchObject({ status: 'accepted', attempted: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('defers temporary lookup failures beforedispatch without using provider attempts', async () => {
    await enabled(); const delivery = await queued();
    let reads = 0; auth.getUser.mockImplementation(async () => {
      if (++reads === 2) throw Error('temporary Auth outage');
      return { email: 'alice@example.com', emailVerified: true };
    });
    const fetchImpl = vi.fn();
    expect(await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl })).toMatchObject({ status: 'deferred', attempted: false });
    expect(records.get(`notificationDeliveries/${delivery.id}`)).toMatchObject({ dispatchPending: true, attemptCount: 0, firstAttemptAt: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('keeps a prior unknown provider attempt and its original retention deadline during an unsent retry', async () => {
    await enabled(); const delivery = await queued(); const fetchImpl = vi.fn(async () => { throw Error('provider outcome unknown'); });
    await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl });
    vi.setSystemTime(now + 61000); let reads = 0;
    auth.getUser.mockImplementation(async () => { if (++reads === 2) throw Error('Auth outage'); return { email: 'alice@example.com', emailVerified: true }; });
    await attemptNotificationDelivery(delivery.id, { now: Date.now(), deadline: Date.now() + 25000, fetchImpl });
    expect(records.get(`notificationDeliveries/${delivery.id}`)).toMatchObject({ status: 'retry_pending', attemptCount: 1, firstAttemptAt: new Date(now).toISOString() });
    vi.setSystemTime(now + 23 * 3600000); auth.getUser.mockResolvedValue({ email: 'alice@example.com', emailVerified: true });
    expect(await attemptNotificationDelivery(delivery.id, { now: Date.now(), deadline: Date.now() + 25000, fetchImpl })).toMatchObject({ status: 'delivery_unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('ends a stalled recipient check before the invocation deadline without a late send', async () => {
    await enabled(); const delivery = await queued();
    vi.useFakeTimers(); vi.setSystemTime(now);
    let resolveAuth;
    auth.getUser.mockImplementation(() => new Promise(resolve => { resolveAuth = resolve; }));
    const fetchImpl = vi.fn();
    const result = attemptNotificationDelivery(delivery.id, { now, deadline: now + 3000, fetchImpl });
    await vi.advanceTimersByTimeAsync(2001);
    expect(await result).toMatchObject({ status: 'unavailable' });
    resolveAuth({ email: 'alice@example.com', emailVerified: true }); await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled(); expect(records.get(`notificationDeliveries/${delivery.id}`).attemptCount).toBe(0);
  });
  it('never retries unknown delivery after23hours or puts its events in another digest', async () => {
    await enabled(); const delivery = await queued(), fetchImpl = vi.fn(async () => { throw Error('lost'); });
    await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl });
    vi.setSystemTime(now + 23 * 3600000);
    expect(await attemptNotificationDelivery(delivery.id, { now: Date.now(), deadline: Date.now() + 25000, fetchImpl })).toMatchObject({ status: 'delivery_unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 25 * 3600000);
    expect(await prepareNotificationDigest('alice', ['one'], { now: Date.now() })).toBeNull();
  });
  it('limits attempts to three and respects missing deadlines', async () => {
    await enabled(); const delivery = await queued(), fetchImpl = vi.fn(async () => { throw Error('lost'); });
    expect(await attemptNotificationDelivery(delivery.id, { now, deadline: now + 1000, fetchImpl })).toMatchObject({ status: 'deferred' });
    for (let i = 0; i < 4; i++) { vi.setSystemTime(now + i * 61000); await attemptNotificationDelivery(delivery.id, { now: Date.now(), deadline: Date.now() + 25000, fetchImpl }); }
    expect(fetchImpl).toHaveBeenCalledTimes(3); expect(records.get(`notificationDeliveries/${delivery.id}`).status).toBe('delivery_unknown');
  });
  it('prevents read, unsubscribe, email change and deleted-account dispatch', async () => {
    await enabled(); const delivery = await queued();
    await db.collection('notificationEvents').doc('one').update({ readAt: new Date(now).toISOString() });
    const fetchImpl = vi.fn(); expect(await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl })).toMatchObject({ status: 'cancelled' });
    expect(fetchImpl).not.toHaveBeenCalled();
    const second = await queued('two'); await unsubscribeNotifications(unsubscribeToken('alice', 'alice@example.com'));
    expect(await attemptNotificationDelivery(second.id, { now, deadline: now + 25000, fetchImpl })).toMatchObject({ status: 'cancelled' });
    await updateNotificationPreferences('alice', { expectedRevision: 2, emailEnabled: true });
    const third = await queued('three'); auth.getUser.mockResolvedValue({ email: 'other@example.com', emailVerified: true });
    expect(await attemptNotificationDelivery(third.id, { now, deadline: now + 25000, fetchImpl })).toMatchObject({ status: 'cancelled' });
    auth.getUser.mockResolvedValue({ email: 'alice@example.com', emailVerified: true });
    const fourth = await queued('four'); await db.collection('users').doc('alice').delete();
    expect(await attemptNotificationDelivery(fourth.id, { now, deadline: now + 25000, fetchImpl })).toMatchObject({ status: 'deleted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('enforces global daily/monthly caps atomically', async () => {
    await enabled(); const delivery = await queued(); await db.collection('notificationBudgets').doc('day-2026-10-11').set({ attempts: 50 });
    expect(await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000 })).toMatchObject({ status: 'allowance' });
    await db.collection('notificationBudgets').doc('day-2026-10-11').set({ attempts: 0 }); await db.collection('notificationBudgets').doc('month-2026-10').set({ attempts: 500 });
    expect(await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000 })).toMatchObject({ status: 'allowance' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the rolling24hour guard after provider acceptance', async () => {
    await enabled(); const delivery = await queued(); await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl: async () => Response.json({ id: 'sent' }) });
    await event('new'); expect(await prepareNotificationDigest('alice', ['new'], { now: now + DAY - 1 })).toBeNull();
    expect(await prepareNotificationDigest('alice', ['new'], { now: now + DAY })).toBeTruthy();
  });
  it('preserves provider acceptance arriving before a lost HTTP response', async () => {
    await enabled(); const delivery = await queued();
    const fetchImpl = async () => {
      const request = signed({ type: 'email.sent', data: { email_id: 'accepted-in-webhook', tags: { delivery_id: delivery.id } } });
      await handleNotificationWebhook(request.raw, request.headers, { now });
      throw Error('response lost');
    };
    await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl });
    expect(records.get(`notificationDeliveries/${delivery.id}`)).toMatchObject({ status: 'accepted', dispatchPending: false });
  });
  it('does not recreate delivery state when deletion occurs during the provider request', async () => {
    await enabled(); const delivery = await queued();
    await attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl: async () => {
      await db.collection('users').doc('alice').delete(); await db.collection('notificationDeliveries').doc(delivery.id).delete();
      return Response.json({ id: 'already-submitted' });
    } });
    expect(records.has(`notificationDeliveries/${delivery.id}`)).toBe(false);
  });
  it('caps simultaneous accounts before either can exceed the daily global ceiling', async () => {
    await enabled(); const alice = await queued();
    await db.collection('users').doc('bob').set({ websiteUrl: scope.websiteUrl, gscSiteUrl: scope.property });
    await db.collection('onboarding').doc('bob').set({ websiteUrl: scope.websiteUrl, gscProperty: scope.property });
    await updateNotificationPreferences('bob', { expectedRevision: 0, emailEnabled: true });
    await event('bob-event', { userId: 'bob' }); const bob = await prepareNotificationDigest('bob', ['bob-event'], { now });
    await db.collection('notificationBudgets').doc('day-2026-10-11').set({ attempts: 49 });
    const fetchImpl = vi.fn(async () => Response.json({ id: 'one-last-send' }));
    const result = await Promise.all([alice, bob].map(delivery => attemptNotificationDelivery(delivery.id, { now, deadline: now + 25000, fetchImpl })));
    expect(result.map(item => item.status).sort()).toEqual(['accepted', 'allowance']); expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(records.get('notificationBudgets/day-2026-10-11').attempts).toBe(50);
  });
  it('keeps actual sends a second apart after a slow final recipient check', async () => {
    await enabled(); const alice = await queued();
    await db.collection('users').doc('bob').set({ websiteUrl: scope.websiteUrl, gscSiteUrl: scope.property });
    await db.collection('onboarding').doc('bob').set({ websiteUrl: scope.websiteUrl, gscProperty: scope.property });
    await updateNotificationPreferences('bob', { expectedRevision: 0, emailEnabled: true });
    await event('bob-event', { userId: 'bob' }); const bob = await prepareNotificationDigest('bob', ['bob-event'], { now });
    let reads = 0;
    auth.getUser.mockImplementation(async uid => {
      if (++reads === 3) vi.setSystemTime(now + 5000);
      return { email: `${uid}@example.com`, emailVerified: true };
    });
    const sentAt = [], fetchImpl = vi.fn(async () => { sentAt.push(Date.now()); return Response.json({ id: `sent-${sentAt.length}` }); });
    const sleepImpl = async ms => vi.setSystemTime(Date.now() + ms);
    await attemptNotificationDelivery(alice.id, { now, deadline: now + 25000, fetchImpl, sleepImpl });
    await attemptNotificationDelivery(bob.id, { now: Date.now(), deadline: now + 25000, fetchImpl, sleepImpl });
    expect(sentAt).toHaveLength(2); expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(1000);
  });
  it('test emails are explicit, labeled, limited and independent from progress events', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: `test-${Date.now()}` })));
    const first = await sendNotificationTest('alice', { idempotencyKey: 'test-one' }, now);
    await sendNotificationTest('alice', { idempotencyKey: 'test-one' }, now);
    expect(fetch).toHaveBeenCalledTimes(1); expect(first.status).toBe('accepted');
    const saved = records.get(`notificationDeliveries/${first.deliveryId}`);
    expect(saved.payload.subject).toBe('SimplSEO notification test'); expect(saved.eventIds).toEqual([]);
    await expect(sendNotificationTest('alice', { idempotencyKey: 'test-two' }, now + 1000)).rejects.toMatchObject({ status: 429 });
    for (let i = 1; i <= 2; i++) { vi.setSystemTime(now + i * 61000); await sendNotificationTest('alice', { idempotencyKey: `test-${i}` }, Date.now()); }
    vi.setSystemTime(now + 4 * 61000);
    await expect(sendNotificationTest('alice', { idempotencyKey: 'fourth' }, Date.now())).rejects.toMatchObject({ status: 429 });
    expect([...records.keys()].filter(key => key.startsWith('notificationEvents/'))).toHaveLength(0);
  });
  it('paginates source events independently of featured dashboard work', async () => {
    for (let i = 0; i < 102; i++) await event(`event-${String(i).padStart(3, '0')}`);
    const first = await runNotificationDelivery({ now: new Date(now), deadline: now + 30000, allowDigests: true, maxAttempts: 1 });
    expect(first.moreRecords).toBe(true); expect(records.get('notificationJobs/email-queue-cursor').cursor.id).toBe('event-099');
    const second = await runNotificationDelivery({ now: new Date(now), deadline: now + 30000, allowDigests: true, maxAttempts: 1 });
    expect(second.moreRecords).toBe(false); expect(records.get('notificationJobs/email-queue-cursor').cursor).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('saves partial cursor progress without skipping an intervening account', async () => {
    await event('row-001'); await event('row-002', { userId: 'bob' }); await event('row-003');
    auth.getUser.mockImplementation(async uid => { vi.setSystemTime(now + 24000); return { email: `${uid}@example.com`, emailVerified: true }; });
    const result = await runNotificationDelivery({ now: new Date(now), deadline: now + 30000, allowDigests: true, maxAttempts: 1 });
    expect(result.moreRecords).toBe(true); expect(records.get('notificationJobs/email-queue-cursor').cursor.id).toBe('row-001');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports a failed account preparation without invalidating other saved evidence', async () => {
    await event('unavailable'); await db.collection('users').doc('alice').delete();
    const result = await runNotificationDelivery({ now: new Date(now), deadline: now + 30000, allowDigests: true, maxAttempts: 1 });
    expect(result.counts.error).toBe(1); expect(result.counts.queue_error).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('rolls back sending independently without any provider work', async () => {
    process.env.NOTIFICATION_EMAILS_ENABLED = 'false';
    expect(await runNotificationDelivery()).toMatchObject({ status: 'disabled', attempts: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
const DAY = 86400000;

describe('signed webhook reconciliation', () => {
  it('checks exact raw body, timestamp and signature', () => {
    const request = signed({ type: 'email.sent', data: {} });
    expect(verifyNotificationWebhook(request.raw, request.headers, { now }).id).toBe('msg-one');
    expect(() => verifyNotificationWebhook(request.raw + ' ', request.headers, { now })).toThrow();
    expect(() => verifyNotificationWebhook(request.raw, request.headers, { now: now + 301000 })).toThrow();
  });
  it('uses opaque delivery tags after a lost response and ignores repeated/out-of-order webhooks', async () => {
    await enabled(); const delivery = await queued();
    const payload = { type: 'email.delivered', created_at: new Date(now).toISOString(), data: { email_id: 'known-by-webhook', tags: { delivery_id: delivery.id } } };
    let request = signed(payload);
    await handleNotificationWebhook(request.raw, request.headers, { now }); await handleNotificationWebhook(request.raw, request.headers, { now });
    request = signed({ ...payload, type: 'email.sent' }, 'msg-two'); await handleNotificationWebhook(request.raw, request.headers, { now });
    expect(records.get(`notificationDeliveries/${delivery.id}`)).toMatchObject({ status: 'delivered', providerId: 'known-by-webhook', dispatchPending: false });
    expect([...records.keys()].filter(key => key.includes('/webhooks/'))).toHaveLength(2);
  });
  it('a permanent bounce suppresses future email and a late webhook cannot recreate a deleted account', async () => {
    await enabled(); const delivery = await queued();
    const request = signed({ type: 'email.bounced', data: { email_id: 'bounce', tags: [{ name: 'delivery_id', value: delivery.id }] } });
    await handleNotificationWebhook(request.raw, request.headers, { now });
    expect(await readNotificationPreferences('alice')).toMatchObject({ emailEnabled: false, emailState: 'suppressed' });
    await expect(updateNotificationPreferences('alice', { expectedRevision: 2, emailEnabled: true })).rejects.toMatchObject({ status: 409 });
    await db.collection('users').doc('alice').delete(); await db.collection('notificationPreferences').doc('alice').delete();
    const late = signed({ type: 'email.complained', data: { email_id: 'bounce', tags: { delivery_id: delivery.id } } }, 'late');
    await handleNotificationWebhook(late.raw, late.headers, { now }); expect(records.has('notificationPreferences/alice')).toBe(false);
  });
  it('never downgrades terminal provider evidence', () => {
    expect(nextNotificationProviderStatus('complained', 'delivered')).toBe('complained');
    expect(nextNotificationProviderStatus('delivered', 'accepted')).toBe('delivered');
    expect(notificationRetryState({ dispatchPending: true, firstAttemptAt: new Date(now - 23 * 3600000).toISOString() }, now)).toBe('expired');
  });
});

describe('notification delivery HTTP protections', () => {
  it('requires authentication and ignores forged recipient/account fields', async () => {
    expect((await preferenceGet(new Request('https://app.test/api/notifications/preferences'))).status).toBe(401);
    const request = new Request('https://app.test/api/notifications/preferences', { method: 'PATCH', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'bob', recipient: 'attacker@example.com', emailEnabled: true, expectedRevision: 0 }) });
    const response = await preferencePatch(request); expect(response.status).toBe(200);
    expect(records.get('notificationPreferences/alice').recipient).toBe('alice@example.com'); expect(records.has('notificationPreferences/bob')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps unsubscribe GET read-only and supports one-click POST without login', async () => {
    await enabled(); const token = unsubscribeToken('alice', 'alice@example.com'), url = `https://app.test/api/notifications/unsubscribe?token=${token}`;
    expect((await unsubscribeGet(new Request(url))).status).toBe(200); expect(records.get('notificationPreferences/alice').emailEnabled).toBe(true);
    expect((await unsubscribePost(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }))).status).toBe(200);
    expect(records.get('notificationPreferences/alice').emailEnabled).toBe(false);
  });
  it('rejects invalid raw webhook signatures and never sends a test while setup is off', async () => {
    expect((await webhookPost(new Request('https://app.test/api/notifications/webhook', { method: 'POST', body: '{}' }))).status).toBe(400);
    process.env.NOTIFICATION_EMAILS_ENABLED = 'false';
    const response = await testPost(new Request('https://app.test/api/notifications/test-email', { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'no-setup' }) }));
    expect(response.status).toBe(409); expect(fetch).not.toHaveBeenCalled();
    expect([...records.keys()].some(key => key.startsWith('notificationDeliveries/'))).toBe(false);
  });
});
