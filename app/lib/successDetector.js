// Internal module, deliberately not a Next server action. Legacy statistics are
// retained as history but cannot be promoted into evidence for other customers.
import { db } from './firebaseAdmin';
import { progressIsPaused } from './progressAssessment';

export async function detectAndSaveSuccessfulStrategies(userId) {
  const onboarding = (await db.collection('onboarding').doc(userId).get()).data();
  return {
    success: true, saved: 0, strategiesSaved: 0, strategyIds: [], paused: true,
    reason: progressIsPaused(onboarding) ? 'account_review_required' : 'automatic_promotion_disabled',
  };
}
