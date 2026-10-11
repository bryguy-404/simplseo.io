import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/server/notificationEvents', () => ({ reconcileNotifications: vi.fn() }));
vi.mock('../app/lib/server/notificationDelivery', () => ({ runNotificationDelivery: vi.fn() }));
vi.mock('../app/lib/server/notificationScope', () => ({ notificationJobsEnabled: vi.fn(), notificationEventsEnabled: vi.fn(), notificationEmailsEnabled: vi.fn() }));
import { reconcileNotifications } from '../app/lib/server/notificationEvents';
import { runNotificationDelivery } from '../app/lib/server/notificationDelivery';
import { notificationJobsEnabled, notificationEventsEnabled, notificationEmailsEnabled } from '../app/lib/server/notificationScope';
import { runNotificationAwareCollection } from '../app/lib/server/notificationCron';
const now = new Date('2026-10-12T02:00:00Z');
beforeEach(() => {
  vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(1000);
  notificationJobsEnabled.mockReturnValue(true); notificationEventsEnabled.mockReturnValue(true); notificationEmailsEnabled.mockReturnValue(true);
  reconcileNotifications.mockResolvedValue({ checked: 2, counts: {}, moreRecords: false });
  runNotificationDelivery.mockResolvedValue({ checked: 1, attempts: 1, accepted: 1, counts: {}, moreRecords: false });
});
it('reserves the final30seconds and keeps02h retries distinct from03h digests', async () => {
  const collect = vi.fn().mockResolvedValue({ checked: 3, counts: { ready: 3 } });
  const result = await runNotificationAwareCollection('progress', collect, now);
  expect(collect).toHaveBeenCalledWith(now, { deadline: 191000 });
  expect(runNotificationDelivery).toHaveBeenLastCalledWith({ now, deadline: 221000, allowDigests: false, maxAttempts: 20 });
  expect(result).toMatchObject({ checked: 3, counts: { ready: 3 }, notificationsSent: 1 });
  await runNotificationAwareCollection('website-monitoring', collect, now);
  expect(runNotificationDelivery.mock.lastCall[0].allowDigests).toBe(true);
});
it('does no notification work and grants full collection time when rolled back', async () => {
  notificationJobsEnabled.mockReturnValue(false);
  const collect = vi.fn().mockResolvedValue({ checked: 0 });
  await runNotificationAwareCollection('progress', collect, now);
  expect(collect).toHaveBeenCalledWith(now, { deadline: 221000 });
  expect(reconcileNotifications).not.toHaveBeenCalled(); expect(runNotificationDelivery).not.toHaveBeenCalled();
});
it('keeps collection success independent from mail failure', async () => {
  runNotificationDelivery.mockRejectedValue(new Error('private provider details'));
  const result = await runNotificationAwareCollection('progress', async () => ({ checked: 2, counts: { ready: 2 } }), now);
  expect(result).toMatchObject({ checked: 2, counts: { ready: 2 }, notifications: { delivery: { counts: { error: 1 }, moreRecords: true } } });
  expect(JSON.stringify(result)).not.toContain('private');
});
it('still reconciles saved work if collection fails, retaining its independent failure', async () => {
  const result = await runNotificationAwareCollection('progress', async () => { throw new Error('offline'); }, now);
  expect(result.counts).toEqual({ error: 1 }); expect(reconcileNotifications).toHaveBeenCalledOnce();
});
it('defers notifications after the absolute deadline rather than starting provider work', async () => {
  const result = await runNotificationAwareCollection('progress', async () => {
    Date.now.mockReturnValue(221000); return { checked: 2, counts: { ready: 2 } };
  }, now);
  expect(result.notifications.delivery.counts.deferred).toBe(1);
  expect(runNotificationDelivery).not.toHaveBeenCalled(); expect(reconcileNotifications).not.toHaveBeenCalled();
});
