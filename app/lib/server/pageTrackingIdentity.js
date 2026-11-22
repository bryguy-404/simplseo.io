import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { pageMonitoringEnabled } from './pageMonitoringFeature';

// The shared per-page document serializes enrollment and publication, including
// racing requests from two tabs. Existing active cycles are discovered lazily.
export async function readPageTrackingIdentity(tx, scope, pageUrl) {
  const id = createHash('sha256').update(JSON.stringify([scope.userId, scope.property, scope.websiteRunId || null, pageUrl])).digest('hex');
  const ref = db.collection('pageTrackingStates').doc(id);
  const snapshot = await tx.get(ref), state = snapshot.data();
  if (state && (state.userId !== scope.userId || state.property !== scope.property
    || (state.websiteRunId || null) !== (scope.websiteRunId || null) || state.pageUrl !== pageUrl)) {
    throw new RequestError('The saved tracking identity does not match this page.', 409);
  }
  const active = await tx.get(db.collection('pageProgressCycles').where('userId', '==', scope.userId)
    .where('property', '==', scope.property).where('websiteRunId', '==', scope.websiteRunId || null)
    .where('pageUrl', '==', pageUrl).where('lifecycle', '==', 'active').limit(2));
  if (active.size > 1) throw new RequestError('This page has conflicting active tracking records. Review its saved history before continuing.', 409);
  return { ref, state, active: active.docs[0]?.data() || null,
    value: { userId: scope.userId, property: scope.property, websiteRunId: scope.websiteRunId || null, pageUrl } };
}

export async function assertMonitoringReview(tx, userId, pageUrl, guard) {
  if (!guard) return;
  const snapshot = await tx.get(db.collection('pageProgressCycles').doc(guard.cycleId));
  const cycle = snapshot.data();
  if (!pageMonitoringEnabled(userId) || !cycle || cycle.userId !== userId || cycle.pageUrl !== pageUrl
    || cycle.mode !== 'monitoring' || cycle.lifecycle !== 'active' || cycle.followUpLease?.id !== guard.leaseId
    || Date.parse(cycle.followUpLease.expiresAt) <= Date.now()) {
    throw new RequestError('Monitoring changed during this review. Reload to see the saved page.', 409);
  }
}
