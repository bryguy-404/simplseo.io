import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => ({ ...(await import('./fakeFirestore')).fakeFirestore() }));
vi.mock('../app/lib/server/notificationEvents', () => ({ reconcileNotificationSource: vi.fn() }));
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { notificationConnectionVersion, recordNotificationConnection } from '../app/lib/server/notificationConnection';
import { reconcileNotificationSource } from '../app/lib/server/notificationEvents';
const property = 'https://example.test/';
beforeEach(() => {
  reset(); vi.clearAllMocks(); vi.stubEnv('NOTIFICATIONS_ENABLED', 'true'); vi.stubEnv('NOTIFICATION_PILOT_UIDS', 'alice');
  vi.stubEnv('NOTIFICATION_EVENTS_ENABLED', 'true');
  records.set('users/alice', { gscSiteUrl: property, gscAccessToken: 'access', gscRefreshToken: 'refresh', gscConnectionVersion: 'one', gscExpiresAt: Date.now() + 3600000 });
  records.set('onboarding/alice', { gscProperty: property, websiteUrl: property, isComplete: true });
});
it('persists an authorization incident once, and a later successful query resolves it', async () => {
  fetch.mockResolvedValueOnce(new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 })).mockResolvedValueOnce(new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 }))
    .mockResolvedValueOnce(new Response('{}'));
  const connection = await getGscConnection('alice');
  await expect(connection.query({})).rejects.toThrow('reconnect_required');
  expect(records.get('notificationConnectionObservations/alice')).toMatchObject({ status: 'reconnect_required', connectionVersion: 'one', property });
  await expect(connection.query({})).rejects.toThrow('reconnect_required');
  expect(reconcileNotificationSource).toHaveBeenCalledTimes(1);
  await connection.query({});
  expect(records.get('notificationConnectionObservations/alice').status).toBe('available');
  expect(reconcileNotificationSource).toHaveBeenCalledTimes(2);
});
it('does not convert temporary errors or unfinished setup into reconnect incidents', async () => {
  fetch.mockResolvedValue(new Response('{}', { status: 500 }));
  await expect((await getGscConnection('alice')).query({})).rejects.toThrow('temporarily_unavailable');
  expect(records.has('notificationConnectionObservations/alice')).toBe(false);
  records.get('onboarding/alice').isComplete = false;
  fetch.mockResolvedValue(new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 }));
  await expect((await getGscConnection('alice')).query({})).rejects.toThrow('reconnect_required');
  expect(records.has('notificationConnectionObservations/alice')).toBe(false);
});
it.each(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'])('Google403 %s does not mean lost authorization', async reason => {
  fetch.mockResolvedValue(new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status: 403 }));
  await expect((await getGscConnection('alice')).query({})).rejects.toThrow('temporarily_unavailable');
  expect(records.has('notificationConnectionObservations/alice')).toBe(false);
});
it('ignores stale connection versions, rebuilds and deleted accounts before saving', async () => {
  const expected = { property, websiteRunId: null, connectionVersion: 'old' };
  await recordNotificationConnection('alice', 'reconnect_required', expected);
  expect(records.has('notificationConnectionObservations/alice')).toBe(false);
  expected.connectionVersion = 'one'; records.get('onboarding/alice').revampRunId = 'new';
  await recordNotificationConnection('alice', 'reconnect_required', expected);
  expect(records.has('notificationConnectionObservations/alice')).toBe(false);
  records.delete('users/alice');
  await recordNotificationConnection('alice', 'reconnect_required', expected);
  expect(records.has('notificationConnectionObservations/alice')).toBe(false);
});
it('notification persistence failure cannot turn a successful Google request into a failure', async () => {
  fetch.mockResolvedValue(new Response('{"rows":[]}'));
  vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('notification store unavailable'));
  await expect((await getGscConnection('alice')).query({})).resolves.toEqual({ rows: [] });
});
it('uses the same legacy credential version as staged reconnection without storing tokens', () => {
  expect(notificationConnectionVersion({}, { refreshToken: 'private' })).toMatch(/^[a-f0-9]{64}$/);
  expect(notificationConnectionVersion({ gscConnectionVersion: 'saved' })).toBe('saved');
});

it('does not let an older in-flight authorization result overwrite a newer observation', async () => {
  const expected = { property, websiteRunId: null, connectionVersion: 'one' };
  const early = new Date('2026-10-11T10:00:00.000Z'), later = new Date('2026-10-11T10:02:00.000Z');
  await recordNotificationConnection('alice', 'available', expected, { now: later });
  await recordNotificationConnection('alice', 'reconnect_required', expected, { now: early });
  expect(records.get('notificationConnectionObservations/alice')).toMatchObject({ status: 'available', checkedAt: later.toISOString() });
  expect(reconcileNotificationSource).toHaveBeenCalledTimes(1);
  await recordNotificationConnection('alice', 'reconnect_required', expected, { now: new Date('2026-10-11T10:03:00.000Z') });
  await recordNotificationConnection('alice', 'available', expected, { now: later });
  expect(records.get('notificationConnectionObservations/alice')).toMatchObject({ status: 'reconnect_required', checkedAt: '2026-10-11T10:03:00.000Z' });
  expect(reconcileNotificationSource).toHaveBeenCalledTimes(2);
});
it('advances the same-status watermark without creating another notification incident', async () => {
  const expected = { property, websiteRunId: null, connectionVersion: 'one' };
  await recordNotificationConnection('alice', 'available', expected, { now: new Date('2026-10-11T10:00:00.000Z') });
  await recordNotificationConnection('alice', 'available', expected, { now: new Date('2026-10-11T10:02:00.000Z') });
  await recordNotificationConnection('alice', 'reconnect_required', expected, { now: new Date('2026-10-11T10:01:00.000Z') });
  expect(records.get('notificationConnectionObservations/alice')).toMatchObject({ status: 'available', checkedAt: '2026-10-11T10:02:00.000Z' });
  expect(reconcileNotificationSource).toHaveBeenCalledTimes(1);
});
