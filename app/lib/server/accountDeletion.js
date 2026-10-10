import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';

// Every per-account collection currently written by the application, including
// parents that may not exist even though their subcollections do.
export const ACCOUNT_ROOT_COLLECTIONS = [
  'gscTokens', 'focusKeywords', 'siteCrawls', 'contentKeywordEdits',
  'pageContentCache', 'intentMismatches', 'seoMetaTitles', 'seoMetaDescriptions',
  'skippedKeywords', 'createdContentOpportunities', 'deletedUsers', 'progressJobs',
];
export const ACCOUNT_OWNED_COLLECTIONS = [
  'implementedSeoTips', 'contentAuditResults', 'aiSuggestions',
  'internalLinkSuggestions', 'intentMismatches', 'pageContentCache',
  'seoMetaTitles', 'seoMetaDescriptions', 'genericKeywordsCache',
  'conversations', 'contactMessages', 'requestLimits', 'pageReviewPlans',
];
const PREFIXED_COLLECTIONS = [
  'implementedSeoTips', 'contentAuditResults', 'aiSuggestions',
  'internalLinkSuggestions', 'intentMismatches', 'pageContentCache',
];
const HASHED_COLLECTIONS = ['trainingEvents', 'playbookStrategies', 'conversationSummaries'];
export const accountHash = uid => createHash('sha256').update(uid).digest('hex');

async function deleteMatching(db, query) {
  let roots = 0;
  // Delete in bounded groups. recursiveDelete handles nested documents and
  // Firestore's batch limits; removing the first group advances the next query.
  for (;;) {
    const snapshot = await query.limit(200).get();
    if (snapshot.empty) return roots;
    for (const document of snapshot.docs) {
      await db.recursiveDelete(document.ref);
      roots += 1;
    }
  }
}

export async function deleteAccountFirestore(db, uid, verifiedEmail) {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new Error('Invalid account identity');
  let deletedRoots = 0;
  const remove = async ref => { await db.recursiveDelete(ref); deletedRoots += 1; };
  for (const name of ACCOUNT_OWNED_COLLECTIONS) {
    deletedRoots += await deleteMatching(db, db.collection(name).where('userId', '==', uid));
  }
  // Some old records have no userId. Only the explicit UID + underscore namespace
  // is attributable; URL-only legacy meta caches must never be guessed by domain.
  for (const name of PREFIXED_COLLECTIONS) {
    const prefix = `${uid}_`;
    const query = db.collection(name).orderBy(FieldPath.documentId()).startAt(prefix).endBefore(`${prefix}\uf8ff`);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      const claimedOwner = document.data().userId;
      if (claimedOwner && claimedOwner !== uid) continue;
      await remove(document.ref);
    }
  }
  for (const name of ACCOUNT_ROOT_COLLECTIONS) await remove(db.collection(name).doc(uid));
  await remove(db.collection('progressJobs').doc(`user-${uid}`));
  for (const name of HASHED_COLLECTIONS) await remove(db.collection(name).doc(accountHash(uid)));
  deletedRoots += await deleteMatching(db, db.collection('gscOAuthStates').where('uid', '==', uid));

  // Email is obtained from Firebase Auth, never from the deletion request body.
  if (verifiedEmail) {
    const email = verifiedEmail.trim().toLowerCase();
    if (email && !email.includes('/')) {
      await remove(db.collection('approvedUsers').doc(email));
      for (const name of ['accessRequests', 'invitationCodes']) {
        deletedRoots += await deleteMatching(db, db.collection(name).where('email', '==', email));
      }
    }
  }
  // Delete these last: a failure above leaves authentication/context available
  // for an idempotent retry instead of reporting an incomplete deletion as success.
  await remove(db.collection('users').doc(uid));
  await remove(db.collection('onboarding').doc(uid));
  return { deletedRoots };
}

export async function deleteAccountBigQuery(client, uid, config) {
  const { projectId, dataset, table } = config;
  if (![projectId, dataset, table].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value))) {
    throw new Error('Invalid account data export configuration');
  }
  await client.query({
    query: `DELETE FROM \`${projectId}.${dataset}.${table}\` WHERE hashed_user_id = @hashedUserId`,
    params: { hashedUserId: accountHash(uid) },
  });
}
