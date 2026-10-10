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
