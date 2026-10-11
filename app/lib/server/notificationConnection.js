import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { notificationEnabled, notificationEventsEnabled, readNotificationScope, assertNotificationScope } from './notificationScope';
import { reconcileNotificationSource } from './notificationEvents';

export const notificationConnectionVersion = (user = {}, legacy = {}) => user.gscConnectionVersion
  || createHash('sha256').update(user.gscRefreshToken || legacy.refreshToken || '').digest('hex');

// Only confirmed authorization observations call this helper. Temporary failures
// never become reconnection events, and telemetry cannot fail a Google request.
export async function recordNotificationConnection(userId, status, expected, { now = new Date() } = {}) {
  if (!notificationEnabled(userId) || !notificationEventsEnabled() || !['available', 'reconnect_required'].includes(status)) return;
  try {
    const scope = await readNotificationScope(userId);
    if (scope.property !== expected.property || (scope.websiteRunId || null) !== (expected.websiteRunId || null)) return;
    const ref = db.collection('notificationConnectionObservations').doc(userId);
    const changed = await db.runTransaction(async tx => {
      assertNotificationScope(scope, await readNotificationScope(userId, { tx }));
      const [user, tokens, setup, old] = await Promise.all([
        ...['users', 'gscTokens', 'onboarding'].map(name => tx.get(db.collection(name).doc(userId))), tx.get(ref),
      ]);
      if (!setup.data()?.isComplete || notificationConnectionVersion(user.data(), tokens.data()) !== expected.connectionVersion) return false;
      const previous = old.data(), checkedAt = now.toISOString();
      const sameConnection = previous?.connectionVersion === expected.connectionVersion
        && previous.property === scope.property && previous.websiteRunId === scope.websiteRunId;
      // Concurrent Google requests may persist in a different order from their
      // observations. An older failure must not erase a newer verified success
      // (or vice versa). Keep the watermark even when the status is unchanged.
      if (sameConnection && Date.parse(previous.checkedAt) > now.getTime()) return false;
      if (sameConnection && previous.status === status) {
        if (Date.parse(previous.checkedAt) < now.getTime()) tx.update(ref, { checkedAt });
        return false;
      }
      tx.set(ref, { ...scope, status, connectionVersion: expected.connectionVersion, checkedAt });
      return true;
    });
    if (changed) await reconcileNotificationSource('notificationConnectionObservations', userId, { now });
  } catch { /* Saved source reconciliation also recovers after a notification outage. */ }
}
