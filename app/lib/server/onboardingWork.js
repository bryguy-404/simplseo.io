import { createHash, randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { accountWebsiteScope, sameBusinessScope } from './businessProfile';

export const onboardingHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const onboardingSessionRef = uid => db.collection('users').doc(uid).collection('onboardingSessions').doc('current');
export const workSessionIdentity = session => ({ id: session.id || session.createdAt || null, revision: session.revision,
  websiteUrl: session.websiteUrl, originalScope: session.originalScope || null, google: session.google || null, mode: session.mode, state: session.state });

export async function readWorkSession(uid, { expectedRevision, expectedSession, tx, write = true } = {}) {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new RequestError('Sign in to continue.', 401);
  const read = ref => tx ? tx.get(ref) : ref.get();
  const [user, snapshot, setup, legacy] = await Promise.all([read(db.collection('users').doc(uid)), read(onboardingSessionRef(uid)),
    read(db.collection('onboarding').doc(uid)), read(db.collection('gscTokens').doc(uid))]);
  const session = snapshot.data();
  const writable = session?.state === 'draft' || (session?.state === 'complete' && session.mode === 'existing' && setup.data()?.isComplete === true);
  if (!user.exists || user.data()?.deletionInProgress || !session || (write && !writable)) throw new RequestError('Your setup changed. Reload before continuing.', 409);
  if (!sameBusinessScope(session.originalScope, accountWebsiteScope(setup.data() || {}, user.data() || {}, legacy.data() || {}))
    || setup.data()?.revampArchivePending || setup.data()?.revampStatus === 'in-progress') throw new RequestError('Your website connection changed. Reload before continuing setup.', 409);
  if (!Number.isInteger(session.revision) || (expectedRevision !== undefined && session.revision !== expectedRevision)
    || (expectedSession && onboardingHash(workSessionIdentity(session)) !== onboardingHash(workSessionIdentity(expectedSession)))) {
    throw new RequestError('Your setup changed. Reload before continuing.', 409);
  }
  return session;
}

export async function reserveOnboardingWork(uid, session, { kind, requestId, fingerprint, charge = true }) {
  if (!['inventory', 'extraction'].includes(kind) || typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new RequestError('Start a new setup request with a valid request identifier.');
  }
  const ref = onboardingSessionRef(uid), opRef = ref.collection('workRequests').doc(onboardingHash([kind, requestId]));
  const jobRef = ref.collection('workJobs').doc(kind), attempt = randomUUID(), timestamp = Date.now();
  const bucket = Math.floor(timestamp / 86400000);
  const quotaRef = db.collection('requestLimits').doc(onboardingHash(['onboarding', uid, kind, bucket]));
  return db.runTransaction(async tx => {
    await readWorkSession(uid, { expectedSession: session, tx });
    const [prior, job, quota] = await Promise.all([tx.get(opRef), tx.get(jobRef), tx.get(quotaRef)]);
    if (prior.exists) {
      const saved = prior.data();
      if (saved.fingerprint !== fingerprint) throw new RequestError('That request belongs to different setup evidence. Start a new request.', 409);
      if (saved.status === 'complete') return { duplicate: true, result: saved.result, opRef, jobRef };
      throw new RequestError(saved.status === 'running' ? 'This setup request is already running or its outcome is unknown. Reload before retrying.' : 'This request failed. Start a new request to retry.', 409);
    }
    if (Date.parse(job.data()?.leaseUntil) > timestamp) throw new RequestError('This setup check is already running. Try again shortly.', 429);
    const count = quota.data()?.count || 0;
    if (charge && count >= 3) throw new RequestError(`Today’s website setup ${kind === 'inventory' ? 'review' : 'extraction'} allowance is used (3 per day). Saved work remains available.`, 429);
    if (charge) tx.set(quotaRef, { userId: uid, feature: 'onboarding', kind, count: count + 1, expiresAt: new Date((bucket + 2) * 86400000) });
    tx.set(jobRef, { userId: uid, attempt, leaseUntil: new Date(timestamp + 180000).toISOString() });
    tx.set(opRef, { userId: uid, kind, attempt, fingerprint, status: 'running', startedAt: new Date(timestamp).toISOString(), charged: charge });
    return { duplicate: false, attempt, opRef, jobRef };
  });
}

export async function finishOnboardingWork(uid, session, reservation, result, error = false) {
  if (reservation.duplicate) return;
  await db.runTransaction(async tx => {
    await readWorkSession(uid, { expectedSession: session, tx });
    const [job, operation] = await Promise.all([tx.get(reservation.jobRef), tx.get(reservation.opRef)]);
    if (job.data()?.attempt !== reservation.attempt || operation.data()?.attempt !== reservation.attempt) throw new RequestError('This setup check changed. Reload before continuing.', 409);
    tx.update(reservation.opRef, { status: error ? 'failed' : 'complete', result: result || null, completedAt: new Date().toISOString() });
    tx.update(reservation.jobRef, { leaseUntil: null });
  });
}
