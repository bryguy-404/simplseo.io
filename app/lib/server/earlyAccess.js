import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { auth, db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { escapeHtml } from './publicRequest';
import { notificationOrigin } from './notificationEmail';

const DAY = 86400000;
const hash = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function accessEmail(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value.length > 254 || !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) throw new RequestError('Enter a valid email address.');
  return value;
}
const textField = (value, max) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) throw new RequestError('Please shorten the details and try again.');
  return value.trim();
};
function secret() {
  const value = process.env.INVITATION_SIGNING_SECRET || process.env.NOTIFICATION_UNSUBSCRIBE_SECRET;
  if (!value || value.length < 32) throw new RequestError('Invitation email setup is not ready yet.', 503);
  return value;
}
function configuration() {
  const origin = notificationOrigin();
  if (!origin || !process.env.RESEND_API_KEY || !process.env.RESEND_NOTIFICATION_FROM || !process.env.RESEND_NOTIFICATION_REPLY_TO
    || process.env.NOTIFICATION_TRACKING_DISABLED !== 'true' || process.env.EARLY_ACCESS_EMAILS_ENABLED === 'false') {
    throw new RequestError('Invitation email is temporarily unavailable. Saved requests are still available.', 503);
  }
  return { origin, from: process.env.RESEND_NOTIFICATION_FROM, reply_to: process.env.RESEND_NOTIFICATION_REPLY_TO };
}
export function invitationToken(id) {
  return `${id}.${createHmac('sha256', secret()).update(`simplseo-early-access-v1:${id}`).digest('base64url')}`;
}
function invitationId(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{48}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new RequestError('This invitation link is invalid. Ask for a new invitation.', 400);
  const id = token.split('.')[0];
  if (!timingSafeEqual(Buffer.from(token), Buffer.from(invitationToken(id)))) throw new RequestError('This invitation link is invalid. Ask for a new invitation.', 400);
  return id;
}
export function renderAccessMail({ kind, email, name, company, reason, invitationId: id, expiresAt }) {
  const { origin, ...sender } = configuration();
  const invited = kind === 'invitation';
  // Fragments do not reach web-server access logs or Referer headers. Only the
  // authenticated acceptance POST can consume a link; email scanners cannot.
  const href = invited ? `${origin}/accept-invite#token=${invitationToken(id)}` : `${origin}/admin/access-requests`;
  const heading = invited ? 'You’re invited to SimplSEO' : 'A new early-access request';
  const paragraphs = invited ? [
    `Hi${name ? ` ${name}` : ''}, you’re invited to try SimplSEO’s private early access.`,
    'Accept your invitation and choose the Google account you want to use for SimplSEO. There is no code to enter.',
    'You can connect a different Google account for Search Console during setup. If you have not set it up yet, we’ll guide you.',
    `This one-use invitation expires on ${expiresAt.slice(0, 10)}. Keep this link private: it joins the first verified account that accepts it.`,
    'Already joined? Use the regular Sign in button with your SimplSEO account.',
  ] : [`Email: ${email}`, `Name: ${name || 'Not provided'}`, `Business: ${company || 'Not provided'}`, `Message: ${reason || 'Not provided'}`];
  const action = invited ? 'Accept invitation' : 'Review access requests';
  return { ...sender, to: [invited ? email : accessEmail(process.env.EARLY_ACCESS_ADMIN_EMAIL || 'simplseoai@gmail.com')],
    subject: invited ? 'Your invitation to SimplSEO' : 'SimplSEO: new early-access request',
    text: [heading, '', ...paragraphs, '', `${action}: ${href}`, '', `Sign in: ${origin}/auth`].join('\n\n'),
    html: `<!doctype html><html><body style="margin:0;background:#f4f7f5;color:#1a2922;font-family:Arial,sans-serif"><main style="max-width:560px;margin:24px auto;padding:28px;background:white;border-radius:16px"><p style="color:#087d44;font-weight:bold">SimplSEO · EARLY ACCESS</p><h1 style="font-size:25px">${heading}</h1>${paragraphs.map(p => `<p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(p)}</p>`).join('')}<p><a style="display:inline-block;padding:12px 18px;background:#087d44;color:white;text-decoration:none;border-radius:8px" href="${escapeHtml(href)}">${action}</a></p><p><a href="${origin}/auth">Sign in to your existing account</a></p></main></body></html>`,
    tags: [{ name: 'feature', value: 'early_access' }] };
}

export async function requestEarlyAccess(input) {
  const email = accessEmail(input.email), name = textField(input.name, 120), company = textField(input.company, 200), reason = textField(input.reason, 2000);
  const id = hash(email), ref = db.collection('accessRequests').doc(id);
  const now = Date.now(), mailId = `request-${id}-${randomBytes(8).toString('hex')}`;
  const created = await db.runTransaction(async tx => {
    const current = await tx.get(ref), saved = current.data();
    const invite = saved?.invitationId ? await tx.get(db.collection('earlyAccessInvitations').doc(saved.invitationId)) : null;
    const oldEnough = now - Date.parse(saved?.requestedAt || '') >= DAY;
    const canReopen = saved && oldEnough && (saved.status === 'rejected' || (saved.status === 'invited' && (!invite?.exists || invite.data().status === 'revoked' || Date.parse(invite.data().expiresAt) <= now)));
    if (saved && !canReopen) return false; // Uniform response avoids revealing membership.
    if (invite?.exists && invite.data().status === 'pending') tx.update(invite.ref, { status: 'revoked', revokedAt: now });
    tx.set(ref, { email, name, company, reason, status: 'pending', requestedAt: new Date(now).toISOString(), source: 'request', adminMailId: mailId });
    return true;
  });
  if (created) {
    try {
      const payload = renderAccessMail({ kind: 'request', email, name, company, reason });
      await db.collection('earlyAccessMail').doc(mailId).set({ requestId: id, email, kind: 'request', payload, status: 'pending', attempts: 0, createdAt: now });
      await sendAccessMail(mailId);
    } catch { /* The saved admin queue is authoritative even if email is unavailable. */ }
  }
  return { success: true, message: 'Your request is saved. If approved, we’ll email you an invitation link.' };
}

export async function issueInvitation(adminUid, { requestId, email, name, replace = false }) {
  configuration(); secret();
  if (requestId != null && !validId(requestId)) throw new RequestError('Choose a saved access request.');
  const direct = !requestId;
  if (direct) { email = accessEmail(email); name = textField(name, 120); requestId = hash(email); }
  const ref = db.collection('accessRequests').doc(requestId);
  const freshId = randomBytes(24).toString('hex');
  const now = Date.now(), expiresAt = new Date(now + 14 * DAY).toISOString();
  const result = await db.runTransaction(async tx => {
    const doc = await tx.get(ref), saved = doc.data();
    if (!direct && !saved) throw new RequestError('This access request is no longer available.', 404);
    const previous = saved?.invitationId ? await tx.get(db.collection('earlyAccessInvitations').doc(saved.invitationId)) : null;
    if (saved?.status === 'joined' || previous?.data()?.status === 'accepted') throw new RequestError('This invitation has already been accepted. They can sign in normally.', 409);
    if (previous?.exists && !replace) return { id: previous.id, requestId, existing: true };
    if (replace && previous?.data()?.createdAt > now - 60000) throw new RequestError('Wait a minute before replacing this invitation.', 429);
    const recipient = accessEmail(saved?.email || email);
    const invitation = { email: recipient, name: saved?.name || name || '', requestId, status: 'pending', createdAt: now,
      expiresAt, approvedBy: adminUid, userId: null };
    const payload = renderAccessMail({ ...invitation, kind: 'invitation', invitationId: freshId });
    if (previous?.exists) tx.update(previous.ref, { status: 'revoked', revokedAt: now });
    tx.create(db.collection('earlyAccessInvitations').doc(freshId), invitation);
    tx.create(db.collection('earlyAccessMail').doc(freshId), { requestId, email: recipient, invitationId: freshId, kind: 'invitation', payload,
      status: 'pending', attempts: 0, createdAt: now });
    tx.set(ref, { ...(saved || { email: recipient, name: name || '', source: 'direct', requestedAt: new Date(now).toISOString() }),
      status: 'invited', invitationId: freshId, approvedBy: adminUid, approvedAt: new Date(now).toISOString() });
    return { id: freshId, requestId };
  });
  const delivery = await sendAccessMail(result.id);
  return { success: true, requestId, delivery, message: delivery === 'accepted' ? 'Invitation sent. Access begins when they accept it.' : 'Invitation saved. Check its email status below.' };
}

export async function retryRequestNotice(requestId) {
  if (!validId(requestId)) throw new RequestError('Choose a saved request.');
  const request = (await db.collection('accessRequests').doc(requestId).get()).data();
  if (!request || request.status !== 'pending') throw new RequestError('This request no longer needs review.', 409);
  const id = request.adminMailId || `request-${requestId}`, ref = db.collection('earlyAccessMail').doc(id);
  // Recover a request saved while email was disabled, without claiming it sent.
  const payload = renderAccessMail({ ...request, kind: 'request' });
  await db.runTransaction(async tx => {
    const current = await tx.get(ref), source = await tx.get(db.collection('accessRequests').doc(requestId));
    if (!source.exists || source.data().status !== 'pending') throw new RequestError('This request changed.', 409);
    if (!current.exists) tx.create(ref, { requestId, email: request.email, kind: 'request', payload, status: 'pending', attempts: 0, createdAt: Date.now() });
  });
  return sendAccessMail(id);
}

export async function rejectAccessRequest(id) {
  if (!validId(id)) throw new RequestError('Choose a saved access request.');
  await db.runTransaction(async tx => {
    const ref = db.collection('accessRequests').doc(id), saved = (await tx.get(ref)).data();
    if (!saved) throw new RequestError('Request not found.', 404);
    const invitation = saved.invitationId ? await tx.get(db.collection('earlyAccessInvitations').doc(saved.invitationId)) : null;
    if (saved.status === 'joined' || saved.status === 'approved' || invitation?.data()?.status === 'accepted') throw new RequestError('This account already has access. Its saved work has not changed.', 409);
    if (invitation?.exists) tx.update(invitation.ref, { status: 'revoked', revokedAt: Date.now() });
    tx.update(ref, { status: 'rejected', rejectedAt: new Date().toISOString() });
  });
  return { success: true };
}

export async function sendAccessMail(id) {
  configuration();
  const ref = db.collection('earlyAccessMail').doc(id), now = Date.now();
  // Share the actual dispatch lane with progress emails, not just a per-feature
  // quota. A slow notification request must not overlap an invitation send.
  const paceRef = db.collection('notificationJobs').doc('resend-send-lane');
  const leaseToken = randomBytes(16).toString('hex');
  const selected = await db.runTransaction(async tx => {
    const doc = await tx.get(ref), mail = doc.data();
    if (!mail) throw new RequestError('This saved email is unavailable.', 404);
    if (mail.status === 'accepted') return { status: 'accepted' };
    const request = (await tx.get(db.collection('accessRequests').doc(mail.requestId))).data();
    const invite = mail.invitationId ? (await tx.get(db.collection('earlyAccessInvitations').doc(mail.invitationId))).data() : null;
    if (!request || (mail.kind === 'request' && request.status !== 'pending') || (mail.kind === 'invitation' && (!invite || invite.status !== 'pending' || Date.parse(invite.expiresAt) <= now || request.invitationId !== mail.invitationId))) return { status: 'cancelled' };
    if (mail.leaseUntil > now) return { status: 'sending' };
    if ((mail.attempts || 0) >= 3 || (mail.firstAttemptAt && now - mail.firstAttemptAt >= 23 * 3600000)) {
      tx.update(ref, { status: 'unknown', leaseUntil: null }); return { status: 'unknown' };
    }
    const dayRef = db.collection('earlyAccessLimits').doc(`day-${new Date(now).toISOString().slice(0, 10)}`);
    const monthRef = db.collection('earlyAccessLimits').doc(`month-${new Date(now).toISOString().slice(0, 7)}`);
    const [day, month, pace] = await Promise.all([tx.get(dayRef), tx.get(monthRef), tx.get(paceRef)]);
    if ((day.data()?.attempts || 0) >= 50 || (month.data()?.attempts || 0) >= 500) throw new RequestError('The invitation email limit has been reached. Try again later.', 429);
    if (Math.max(Date.parse(pace.data()?.leaseUntil || '') || 0, Number(pace.data()?.nextRequestAt) || 0) > now) throw new RequestError('Please wait a moment before sending another invitation.', 429);
    tx.set(dayRef, { attempts: (day.data()?.attempts || 0) + 1 });
    tx.set(monthRef, { attempts: (month.data()?.attempts || 0) + 1 });
    tx.set(paceRef, { leaseToken, leaseUntil: new Date(now + 60000).toISOString(), nextRequestAt: now + 1000 });
    tx.update(ref, { status: 'sending', firstAttemptAt: mail.firstAttemptAt || now, lastAttemptAt: now, attempts: (mail.attempts || 0) + 1, leaseUntil: now + 60000 });
    return { mail };
  });
  if (!selected.mail) return selected.status;
  let status = 'unknown', providerId = null;
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `early-access-${id}` },
      body: JSON.stringify(selected.mail.payload), signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (response.ok && typeof body.id === 'string') { status = 'accepted'; providerId = body.id; }
    else if (response.status >= 400 && response.status < 500 && response.status !== 408) status = 'failed';
  } catch { /* Unknown outcomes retain the identical key/payload and retry window. */ }
  await db.runTransaction(async tx => {
    const [doc, lane] = await Promise.all([tx.get(ref), tx.get(paceRef)]);
    if (doc.exists) tx.update(ref, { status, providerId, leaseUntil: null }); // Never recreate deleted records.
    if (lane.data()?.leaseToken === leaseToken) tx.update(paceRef, { leaseToken: null, leaseUntil: null, nextRequestAt: Date.now() + 1000 });
  });
  return status;
}

export async function inspectInvitation(token) {
  const id = invitationId(token), record = (await db.collection('earlyAccessInvitations').doc(id).get()).data();
  if (!record || record.status === 'revoked') throw new RequestError('This invitation is no longer available. Ask for a new invitation.', 410);
  if (record.status === 'accepted') return { status: 'accepted' };
  if (!Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) throw new RequestError('This invitation has expired. Ask for a new invitation.', 410);
  return { status: 'pending', expiresAt: record.expiresAt };
}
export async function acceptInvitation(uid, token) {
  const id = invitationId(token), account = await auth.getUser(uid);
  if (account.disabled || !account.emailVerified || !account.email) throw new RequestError('Sign in with a verified Google account before accepting your invitation.', 403);
  await db.runTransaction(async tx => {
    const ref = db.collection('earlyAccessInvitations').doc(id);
    const [snapshot, guard, user, grant] = await Promise.all([tx.get(ref), tx.get(db.collection('accountDeletionGuards').doc(hash(uid))),
      tx.get(db.collection('users').doc(uid)), tx.get(db.collection('earlyAccessGrants').doc(uid))]);
    if (guard.data()?.blocked || user.data()?.deletionInProgress || grant.data()?.revokedAt) throw new RequestError('This account is unavailable.', 403);
    const record = snapshot.data();
    if (record?.status === 'accepted' && record.userId === uid) return; // Idempotent even after expiry.
    if (!record || record.status !== 'pending' || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) throw new RequestError('This invitation has expired or was already accepted. Use Sign in if you have already joined.', 410);
    const requestRef = db.collection('accessRequests').doc(record.requestId), request = await tx.get(requestRef);
    if (!request.exists || request.data().invitationId !== id || request.data().status !== 'invited') throw new RequestError('This invitation is no longer available.', 410);
    const acceptedAt = new Date().toISOString();
    tx.update(ref, { status: 'accepted', userId: uid, acceptedAt });
    tx.set(db.collection('earlyAccessGrants').doc(uid), { userId: uid, invitationId: id, acceptedAt, source: 'invitation' });
    // Never change existing website identity, plans or completion state.
    tx.set(db.collection('users').doc(uid), { earlyAccessSetupVersion: 2 }, { merge: true });
    tx.update(requestRef, { status: 'joined', userId: uid, acceptedAt });
    tx.update(db.collection('earlyAccessMail').doc(id), { userId: uid });
  });
  return { success: true };
}

export async function listAccessRequests(cursor) {
  if (cursor && !validId(cursor)) throw new RequestError('Invalid next page.');
  let query = db.collection('accessRequests').orderBy('__name__').limit(51);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get(), docs = snapshot.docs.slice(0, 50);
  const requests = await Promise.all(docs.map(async doc => {
    const r = doc.data();
    const mail = r.invitationId ? (await db.collection('earlyAccessMail').doc(r.invitationId).get()).data() : null;
    const notice = !r.invitationId ? (await db.collection('earlyAccessMail').doc(r.adminMailId || `request-${doc.id}`).get()).data() : null;
    return { id: doc.id, email: r.email, name: r.name || '', company: r.company || '', reason: r.reason || '', status: r.status,
      requestedAt: r.requestedAt, acceptedAt: r.acceptedAt || null, delivery: mail?.status || null, adminNotice: notice?.status || null,
      expiresAt: r.invitationId ? (await db.collection('earlyAccessInvitations').doc(r.invitationId).get()).data()?.expiresAt || null : null };
  }));
  return { requests, cursor: snapshot.docs.length > 50 ? docs.at(-1).id : null };
}
