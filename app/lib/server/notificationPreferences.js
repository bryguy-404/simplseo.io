import { auth, db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { readNotificationScope, notificationEnabled, notificationEmailsEnabled } from './notificationScope';
import { notificationHash, normalizeNotificationEmail, notificationDeliveryConfigured, verifyUnsubscribeToken } from './notificationEmail';

export const notificationPreferenceRef = userId => db.collection('notificationPreferences').doc(userId);
export async function notificationRecipient(userId, { deadline = Date.now() + 7000, timeoutMs = 5000 } = {}) {
  // Firebase Admin's internal Auth client can retry a 25-second request several
  // times. Bound our wait independently; a late read-only result is discarded
  // and cannot resume the caller's delivery or persistence path.
  const remaining = Math.floor(Math.min(timeoutMs, deadline - Date.now() - 1000));
  if (remaining <= 0) throw new RequestError('Email verification could not finish in time. Please try again.', 503);
  let timer;
  let account;
  try {
    account = await Promise.race([auth.getUser(userId), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new RequestError('Email verification is temporarily unavailable. Please try again.', 503)), remaining);
    })]);
  } finally { clearTimeout(timer); }
  return { email: normalizeNotificationEmail(account.email) || null, verified: account.emailVerified === true && !account.disabled };
}
export function notificationPreferenceView(record = {}, recipient, userId) {
  const changed = Boolean(record.recipient && record.recipient !== recipient.email);
  const suppressed = record.suppression?.recipient === recipient.email;
  const emailState = !recipient.verified ? 'verify_email' : changed ? 'confirm_new_email' : suppressed ? 'suppressed' : record.emailEnabled ? 'enabled' : 'off';
  return { enabled: notificationEnabled(userId), revision: record.revision || 0, chosenAt: record.chosenAt || null,
    emailEnabled: Boolean(record.emailEnabled && recipient.verified && !changed && !suppressed),
    recipient: recipient.email, recipientVerified: recipient.verified, emailState,
    sendingEnabled: notificationEmailsEnabled() && notificationDeliveryConfigured(),
    suppression: suppressed ? { reason: record.suppression.reason, observedAt: record.suppression.observedAt } : null };
}
export async function readNotificationPreferences(userId) {
  const [recipient, snapshot] = await Promise.all([notificationRecipient(userId), notificationPreferenceRef(userId).get()]);
  await readNotificationScope(userId);
  return notificationPreferenceView(snapshot.data(), recipient, userId);
}
export async function updateNotificationPreferences(userId, { expectedRevision, emailEnabled, idempotencyKey } = {}, now = new Date()) {
  if (typeof emailEnabled !== 'boolean' || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw new RequestError('Reload your notification settings before saving.');
  if (idempotencyKey && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey))) throw new RequestError('Invalid settings request.');
  const recipient = await notificationRecipient(userId);
  if (emailEnabled && (!recipient.verified || !recipient.email)) throw new RequestError('Verify your sign-in email before enabling updates.', 409);
  const ref = notificationPreferenceRef(userId);
  const saved = await db.runTransaction(async tx => {
    await readNotificationScope(userId, { tx });
    const snapshot = await tx.get(ref), previous = snapshot.data() || {};
    if (idempotencyKey && previous.lastRequestId === idempotencyKey) return previous;
    if ((previous.revision || 0) !== expectedRevision) throw new RequestError('Your notification settings changed. Reload them and try again.', 409);
    if (emailEnabled && previous.suppression?.recipient === recipient.email) throw new RequestError('Email delivery to this address is paused after a bounce or spam complaint. Your inbox is still available.', 409);
    const record = { ...previous, userId, emailEnabled, recipient: recipient.email, recipientVerifiedAt: recipient.verified ? now.toISOString() : null,
      chosenAt: now.toISOString(), updatedAt: now.toISOString(), revision: expectedRevision + 1, lastRequestId: idempotencyKey || null };
    tx.set(ref, record);
    return record;
  });
  return notificationPreferenceView(saved, recipient, userId);
}
export async function inspectNotificationUnsubscribe(token) {
  const data = verifyUnsubscribeToken(token), saved = await notificationPreferenceRef(data.uid).get();
  const record = saved.data();
  // Deliberately do not reveal a recipient, account ID, or account existence.
  return { valid: true, emailEnabled: Boolean(record?.emailEnabled && notificationHash(record.recipient || '') === data.recipient) };
}
export async function unsubscribeNotifications(token, now = new Date()) {
  const data = verifyUnsubscribeToken(token), ref = notificationPreferenceRef(data.uid);
  await db.runTransaction(async tx => {
    const [saved, user, deleted] = await Promise.all([tx.get(ref), tx.get(db.collection('users').doc(data.uid)),
      tx.get(db.collection('accountDeletionGuards').doc(notificationHash(data.uid)))]);
    if (!saved.exists || !user.exists || user.data()?.deletionInProgress || deleted.exists) return;
    const previous = saved.data();
    if (!previous.emailEnabled || notificationHash(previous.recipient || '') !== data.recipient) return;
    tx.update(ref, { emailEnabled: false, chosenAt: now.toISOString(), updatedAt: now.toISOString(), unsubscribedAt: now.toISOString(), revision: (previous.revision || 0) + 1 });
  });
  return { unsubscribed: true };
}
