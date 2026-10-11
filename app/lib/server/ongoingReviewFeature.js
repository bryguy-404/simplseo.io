// Server-only rollout. The browser receives only the resolved boolean, never
// the account allowlist. '*' is an explicit later rollout to all accounts.
export function ongoingReviewEnabled(uid) {
  if (process.env.ONGOING_PAGE_REVIEWS_ENABLED !== 'true' || typeof uid !== 'string' || !uid) return false;
  const allowed = (process.env.ONGOING_PAGE_REVIEW_PILOT_UIDS || '').split(',').map(value => value.trim()).filter(Boolean);
  return allowed.includes('*') || allowed.includes(uid);
}
