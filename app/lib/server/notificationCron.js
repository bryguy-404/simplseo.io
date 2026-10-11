import { notificationJobsEnabled, notificationEventsEnabled, notificationEmailsEnabled } from './notificationScope';
import { reconcileNotifications } from './notificationEvents';
import { runNotificationDelivery } from './notificationDelivery';

// One absolute clock shared with the existing collector. No third schedule and
// no notification work in manual observation APIs or saved-state reads.
export async function runNotificationAwareCollection(job, collect, now = new Date()) {
  const startedAt = Date.now(), deadline = startedAt + 220000;
  if (!notificationJobsEnabled()) return collect(now, { deadline });
  let result;
  try { result = await collect(now, { deadline: deadline - 30000 }); }
  catch (error) {
    const status = error?.status === 429 ? 'deferred' : 'error';
    result = { checked: 0, counts: { [status]: 1 }, moreRecords: true,
      collectors: { collection: { checked: 0, counts: { [status]: 1 }, moreRecords: true } } };
  }
  const notifications = { reconciliation: null, delivery: null };
  const safely = async action => {
    if (deadline - Date.now() < 1500) return { checked: 0, counts: { deferred: 1 }, moreRecords: true };
    try { return await action(); }
    catch { return { checked: 0, counts: { error: 1 }, moreRecords: true }; }
  };
  if (notificationEventsEnabled()) {
    // Preserve time for delivery even when a source sweep has a large backlog.
    notifications.reconciliation = await safely(() => reconcileNotifications({ now,
      deadline: Math.min(deadline - (notificationEmailsEnabled() ? 15000 : 0), Date.now() + 15000) }));
  }
  if (notificationEmailsEnabled()) notifications.delivery = await safely(() => runNotificationDelivery({
    now, deadline, allowDigests: job === 'website-monitoring', maxAttempts: 20,
  }));
  return { ...result, notifications,
    notificationsSent: notifications.delivery?.accepted || notifications.delivery?.sent || 0 };
}
