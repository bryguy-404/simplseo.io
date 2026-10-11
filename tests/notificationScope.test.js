import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => ({ ...(await import('./fakeFirestore')).fakeFirestore() }));
import { records, reset } from '../app/lib/firebaseAdmin';
import { createHash } from 'node:crypto';
import { readNotificationScope, assertNotificationScope, notificationEnabled, notificationJobsEnabled } from '../app/lib/server/notificationScope';
beforeEach(() => {
  reset(); vi.stubEnv('NOTIFICATIONS_ENABLED', 'true'); vi.stubEnv('NOTIFICATION_PILOT_UIDS', 'alice');
  vi.stubEnv('NOTIFICATION_EVENTS_ENABLED', 'false'); vi.stubEnv('NOTIFICATION_EMAILS_ENABLED', 'false');
  records.set('users/alice', { websiteUrl: 'https://example.test/', gscSiteUrl: 'sc-domain:example.test' });
});
it('reads saved scope without a provider, including pending Google setup', async () => {
  expect(await readNotificationScope('alice')).toEqual({ userId: 'alice', websiteUrl: 'https://example.test/', property: 'sc-domain:example.test', websiteRunId: null });
  records.set('users/alice', {});
  expect(await readNotificationScope('alice')).toMatchObject({ property: null, websiteUrl: null });
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects missing accounts, deletion guards, deletion in progress and identity changes', async () => {
  await expect(readNotificationScope('bob')).rejects.toMatchObject({ status: 409 });
  const scope = await readNotificationScope('alice');
  expect(() => assertNotificationScope(scope, { ...scope, websiteRunId: 'rebuilt' })).toThrow();
  expect(() => assertNotificationScope(scope, { ...scope, userId: 'bob' })).toThrow();
  records.set('accountDeletionGuards/' + createHash('sha256').update('alice').digest('hex'), { blocked: true });
  await expect(readNotificationScope('alice')).rejects.toMatchObject({ status: 409 });
});
it('has separate enrollment, creation and delivery switches, defaulting to off', () => {
  expect(notificationEnabled('alice')).toBe(true); expect(notificationEnabled('bob')).toBe(false);
  expect(notificationJobsEnabled()).toBe(false);
  vi.stubEnv('NOTIFICATION_EVENTS_ENABLED', 'true'); expect(notificationJobsEnabled()).toBe(true);
  vi.stubEnv('NOTIFICATIONS_ENABLED', 'false'); expect(notificationEnabled('alice')).toBe(false); expect(notificationJobsEnabled()).toBe(false);
});
