import { auth, db } from '../firebaseAdmin';
import { createHash } from 'node:crypto';

export const earlyAccessEnabled = () => process.env.EARLY_ACCESS_ENABLED === 'true' || process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST === 'true';
export const isAccessAdmin = account => account.customClaims?.admin === true || (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).includes(account.uid);

// Existing Firebase identities are grandfathered using a fixed rollout boundary,
// never a client-writable onboarding flag or browser-supplied email.
export async function readEarlyAccess(uid, account) {
  account ||= await auth.getUser(uid);
  if (account.disabled) return { approved: false, reason: 'disabled', isAdmin: false };
  const [grant, guard] = await Promise.all([
    db.collection('earlyAccessGrants').doc(uid).get(),
    db.collection('accountDeletionGuards').doc(createHash('sha256').update(uid).digest('hex')).get(),
  ]);
  if (guard.data()?.blocked || grant.data()?.revokedAt) return { approved: false, reason: 'unavailable', isAdmin: false };
  const isAdmin = isAccessAdmin(account);
  if (isAdmin || !earlyAccessEnabled()) return { approved: true, isAdmin };
  if (grant.data()?.userId === uid) return { approved: true, isAdmin };
  const cutoff = Date.parse(process.env.EARLY_ACCESS_EXISTING_BEFORE || '');
  const created = Date.parse(account.metadata?.creationTime || '');
  if (Number.isFinite(cutoff) && Number.isFinite(created) && created < cutoff) return { approved: true, isAdmin };
  if (!account.emailVerified || !account.email) return { approved: false, reason: 'verify_email', isAdmin };
  const email = account.email.trim().toLowerCase();
  const legacy = !email.includes('/') && await db.collection('approvedUsers').doc(email).get();
  return { approved: Boolean(legacy?.exists), reason: legacy?.exists ? null : 'invitation_required', isAdmin };
}
