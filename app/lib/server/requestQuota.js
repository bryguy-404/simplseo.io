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

// Page reviews include reasoning and optionally web search. Reserve their
// smaller allowances atomically, before provider calls. A failed call still
// consumes an attempt; retries are always an explicit user action.
export async function consumePageReviewQuota(userId, includeResearch) {
  const windows = [
    { name: 'page-review-minute', duration: 60000, limit: 5 },
    { name: 'page-review-day', duration: 86400000, limit: 20 },
    ...(includeResearch ? [{ name: 'page-review-research', duration: 86400000, limit: 5 }] : []),
  ];
  const entries = windows.map(({ name, duration, limit }) => {
    const bucket = Math.floor(Date.now() / duration);
    const key = createHash('sha256').update(`${name}:${userId}:${bucket}`).digest('hex');
    return { ref: db.collection('requestLimits').doc(key), limit, expiresAt: new Date((bucket + 2) * duration) };
  });
  await db.runTransaction(async tx => {
    const previous = await Promise.all(entries.map(entry => tx.get(entry.ref)));
    if (entries.some((entry, index) => (previous[index].data()?.count || 0) >= entry.limit)) {
      throw new RequestError('Your page review limit has been reached. Try later, or turn off web research if its daily allowance is used.', 429);
    }
    entries.forEach((entry, index) => tx.set(entry.ref, { userId, count: (previous[index].data()?.count || 0) + 1, expiresAt: entry.expiresAt }));
  });
}
