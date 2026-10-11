import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';

// Shared across server instances and all AI routes. Separate minute/day limits
// bound bursts and total request volume; this is not a billing entitlement.
export async function consumeAiQuota(userId) {
  const windows = [{ duration: 60000, limit: 30 }, { duration: 86400000, limit: 200 }];
  const entries = windows.map(({ duration, limit }) => {
    const bucket = Math.floor(Date.now() / duration);
    const key = createHash('sha256').update(`ai:${userId}:${duration}:${bucket}`).digest('hex');
    return { ref: db.collection('requestLimits').doc(key), limit, expiresAt: new Date((bucket + 2) * duration) };
  });
  await db.runTransaction(async tx => {
    const previous = await Promise.all(entries.map(({ ref }) => tx.get(ref)));
    for (let i = 0; i < entries.length; i++) {
      const count = previous[i].data()?.count || 0;
      if (count >= entries[i].limit) throw new RequestError('Your AI request limit has been reached. Please try again later.', 429);
    }
    entries.forEach((entry, i) => tx.set(entry.ref, { userId, count: (previous[i].data()?.count || 0) + 1, expiresAt: entry.expiresAt }));
  });
}

// New or meaningfully changed page reviews include reasoning and a bounded web
// search. Unchanged update checks skip this allowance entirely. Reserve it
// atomically before provider calls; a failed call still consumes an attempt.
export async function consumePageReviewQuota(userId) {
  const windows = [
    { name: 'page-review-minute', duration: 60000, limit: 5 },
    { name: 'page-review-day', duration: 86400000, limit: 20 },
  ];
  const entries = windows.map(({ name, duration, limit }) => {
    const bucket = Math.floor(Date.now() / duration);
    const key = createHash('sha256').update(`${name}:${userId}:${bucket}`).digest('hex');
    return { ref: db.collection('requestLimits').doc(key), limit, expiresAt: new Date((bucket + 2) * duration) };
  });
  await db.runTransaction(async tx => {
    const previous = await Promise.all(entries.map(entry => tx.get(entry.ref)));
    if (entries.some((entry, index) => (previous[index].data()?.count || 0) >= entry.limit)) {
      throw new RequestError('Your page review limit has been reached (5 per minute, 20 per day). Please try again later. You can still view your page and search activity.', 429);
    }
    entries.forEach((entry, index) => tx.set(entry.ref, { userId, count: (previous[index].data()?.count || 0) + 1, expiresAt: entry.expiresAt }));
  });
}

export async function consumeNewPageQuota(userId, kind) {
  const limits = { assessment: 3, draft: 5, nearby: 2 };
  const limit = limits[kind];
  if (!limit) throw new RequestError('Unknown planning operation.');
  const bucket = Math.floor(Date.now() / 86400000);
  const key = createHash('sha256').update(`new-page:${kind}:${userId}:${bucket}`).digest('hex');
  const ref = db.collection('requestLimits').doc(key);
  await db.runTransaction(async tx => {
    const [previous, user, setup] = await Promise.all([tx.get(ref), tx.get(db.collection('users').doc(userId)), tx.get(db.collection('onboarding').doc(userId))]);
    if (!user.exists || !setup.exists) throw new RequestError('Your account changed. Reload to continue.', 409);
    const count = previous.data()?.count || 0;
    if (count >= limit) throw new RequestError(`Today’s new-page ${kind} allowance is used (${limit} per day). Saved work remains available. Try again tomorrow.`, 429);
    tx.set(ref, { userId, feature: 'new_page_planning', kind, count: count + 1, expiresAt: new Date((bucket + 2) * 86400000) });
  });
}
