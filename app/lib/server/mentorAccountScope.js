import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { accountWebsiteScope, businessProfileRef } from './businessProfile';
import { RequestError } from './requestAuth';

export const mentorHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = scope => [scope.userId, scope.property || null, scope.websiteUrl || null, scope.websiteRunId || null];

// Credentials are never returned and this reader never refreshes OAuth.
export async function readMentorAccountScope(uid, { tx } = {}) {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new RequestError('Sign in to continue.', 401);
  const read = ref => tx ? tx.get(ref) : ref.get();
  const [userDoc, setupDoc, legacyDoc, guard] = await Promise.all([
    ...['users', 'onboarding', 'gscTokens'].map(name => read(db.collection(name).doc(uid))),
    read(db.collection('accountDeletionGuards').doc(createHash('sha256').update(uid).digest('hex'))),
  ]);
  if (!userDoc.exists || userDoc.data()?.deletionInProgress || setupDoc.data()?.deletionInProgress || guard.data()?.blocked) {
    throw new RequestError('Your account is no longer available. Sign in again to continue.', 409);
  }
  const scope = { userId: uid, ...accountWebsiteScope(setupDoc.data(), userDoc.data(), legacyDoc.data()) };
  const profile = (await read(businessProfileRef(uid, scope))).data();
  return { ...scope, profileRevision: profile?.revision || 0, key: mentorHash(identity(scope)) };
}

export async function assertMentorAccountScope(uid, expected, tx) {
  const current = await readMentorAccountScope(uid, { tx });
  if (!expected || JSON.stringify(identity(current)) !== JSON.stringify(identity(expected))
    || current.profileRevision !== expected.profileRevision) {
    throw new RequestError('Your website or business details changed. Reload before continuing.', 409);
  }
  return current;
}
