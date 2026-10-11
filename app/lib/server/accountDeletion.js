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
  'conversations', 'contactMessages', 'requestLimits', 'pageReviewPlans', 'aiUsageEvents',
  'pageProgressCycles',
  'newPageWorkspaces', 'newPageInventories', 'newPageAssessments', 'newPagePlans', 'newPagePublications', 'newPageJobs',
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
  // Participate in every new publication/review write transaction. A failed
  // deletion can be retried; it must not allow fresh work to appear mid-sweep.
  await db.runTransaction(async tx => {
    const ref = db.collection('users').doc(uid);
    const user = await tx.get(ref);
    if (user.exists) tx.update(ref, { deletionInProgress: true });
  });
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
  // Clear this account's cursor after removing onboarding. A finishing sweep
  // transaction checks that document, so it cannot restore the deleted UID.
  const sweep = db.collection('progressJobs').doc('daily-website-monitoring');
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(sweep);
    if (snapshot.data()?.cursor === uid) tx.update(sweep, { cursor: null });
  });
  // A review already in flight may have started its accounting after the first
  // sweep. New accounting transactions now see the missing account roots.
  deletedRoots += await deleteMatching(db, db.collection('aiUsageEvents').where('userId', '==', uid));
  // In-flight new-page work saves only while account roots still exist. Sweep
  // anything committed between the first collection pass and root removal.
  for (const name of ACCOUNT_OWNED_COLLECTIONS.filter(name => name.startsWith('newPage') || ['pageProgressCycles', 'pageReviewPlans', 'implementedSeoTips', 'requestLimits'].includes(name))) {
    deletedRoots += await deleteMatching(db, db.collection(name).where('userId', '==', uid));
  }
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
