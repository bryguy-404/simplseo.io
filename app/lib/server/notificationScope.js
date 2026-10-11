import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { accountWebsiteScope } from './businessProfile';
import { RequestError } from './requestAuth';

// Independent server controls: rollback never deletes preferences or history.
export function notificationEnabled(userId) {
  if (process.env.NOTIFICATIONS_ENABLED !== 'true' || typeof userId !== 'string' || !userId) return false;
  const allowed = (process.env.NOTIFICATION_PILOT_UIDS || '').split(',').map(value => value.trim()).filter(Boolean);
  return allowed.includes('*') || allowed.includes(userId);
}
export const notificationEventsEnabled = () => process.env.NOTIFICATION_EVENTS_ENABLED === 'true';
export const notificationEmailsEnabled = () => process.env.NOTIFICATION_EMAILS_ENABLED === 'true';
export const notificationJobsEnabled = () => process.env.NOTIFICATIONS_ENABLED === 'true'
  && (notificationEventsEnabled() || notificationEmailsEnabled());
const identity = scope => [scope?.userId, scope?.property || null, scope?.websiteUrl || null, scope?.websiteRunId || null];

// Saved state only, including while Google setup is pending. Never refresh OAuth.
export async function readNotificationScope(userId, { tx } = {}) {
  if (typeof userId !== 'string' || !userId || userId.includes('/')) throw new RequestError('Sign in to continue.', 401);
  const read = ref => tx ? tx.get(ref) : ref.get();
  const [user, setup, tokens, guard] = await Promise.all([
    ...['users', 'onboarding', 'gscTokens'].map(name => read(db.collection(name).doc(userId))),
    read(db.collection('accountDeletionGuards').doc(createHash('sha256').update(userId).digest('hex'))),
  ]);
  if (!user.exists || user.data()?.deletionInProgress || setup.data()?.deletionInProgress || guard.data()?.blocked) {
    throw new RequestError('This account is no longer available.', 409);
  }
  return { userId, ...accountWebsiteScope(setup.data(), user.data(), tokens.data()) };
}

export function assertNotificationScope(expected, actual) {
  if (!expected || !actual || JSON.stringify(identity(expected)) !== JSON.stringify(identity(actual))) {
    throw new RequestError('Your website setup changed. Reload before continuing.', 409);
  }
  return actual;
}
