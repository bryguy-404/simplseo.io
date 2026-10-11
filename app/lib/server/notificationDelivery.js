import { randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { readNotificationScope, notificationEnabled, notificationEmailsEnabled } from './notificationScope';
import { isNotificationEventEligible } from './notificationEvents';
import { notificationPreferenceRef, notificationRecipient } from './notificationPreferences';
import { notificationHash, notificationDeliveryConfigured, renderNotificationEmail, verifyNotificationWebhook } from './notificationEmail';

export const NOTIFICATION_DELIVERY_LIMITS = Object.freeze({ daily: 50, monthly: 500, attempts: 3, retryHours: 23, perRun: 20, concurrency: 2 });
const DAY = 86400000, RETRY_WINDOW = 23 * 3600000;
const deliveryRef = id => db.collection('notificationDeliveries').doc(id);
const scopeFields = value => ({ userId: value.userId, property: value.property || null, websiteRunId: value.websiteRunId || null, websiteUrl: value.websiteUrl || null });
const sameScope = (a, b) => JSON.stringify(scopeFields(a)) === JSON.stringify(scopeFields(b));
const iso = value => new Date(value).toISOString();
const usableUser = (user, deleted) => user.exists && !user.data()?.deletionInProgress && !deleted.exists;
const activeEmail = (preferences, recipient) => preferences?.emailEnabled === true && recipient.verified && recipient.email
  && preferences.recipient === recipient.email && preferences.suppression?.recipient !== recipient.email;
const ready = () => notificationEmailsEnabled() && notificationDeliveryConfigured();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const safeError = error => error?.status === 429 ? 'allowance' : error?.status === 409 ? 'changed' : 'unavailable';

export function notificationRetryState(delivery, now = Date.now()) {
  if (!delivery.dispatchPending) return 'finished';
  if (delivery.firstAttemptAt && now - Date.parse(delivery.firstAttemptAt) >= RETRY_WINDOW) return 'expired';
  if ((delivery.attemptCount || 0) >= NOTIFICATION_DELIVERY_LIMITS.attempts) return 'exhausted';
  if (Date.parse(delivery.leaseUntil || '') > now || Date.parse(delivery.nextAttemptAt || '') > now) return 'waiting';
  return 'eligible';
}

export async function prepareNotificationDigest(userId, eventIds, { now = Date.now(), deadline = Date.now() + 25000 } = {}) {
  if (!ready() || !notificationEnabled(userId) || !eventIds.length) return null;
  const recipient = await notificationRecipient(userId, { deadline }), scope = await readNotificationScope(userId);
  const id = randomUUID(), ref = deliveryRef(id), preferenceRef = notificationPreferenceRef(userId);
  const selectedIds = [...new Set(eventIds)].slice(0, 50);
  return db.runTransaction(async tx => {
    const currentScope = await readNotificationScope(userId, { tx });
    if (!sameScope(scope, currentScope)) return null;
    const preference = (await tx.get(preferenceRef)).data();
    if (!activeEmail(preference, recipient) || preference.pendingDigestId
      || (preference.nextDigestAt ? now < Date.parse(preference.nextDigestAt) : preference.lastDigestAt && now - Date.parse(preference.lastDigestAt) < DAY)) return null;
    const snapshots = await Promise.all(selectedIds.map(eventId => tx.get(db.collection('notificationEvents').doc(eventId))));
    const events = [];
    for (const snapshot of snapshots) {
      if (Date.now() + 2000 >= deadline) throw new RequestError('Notification work will continue on the next run.', 429);
      const event = snapshot.data();
      if (!event || event.userId !== userId || !sameScope(event, scope) || event.status !== 'active' || event.readAt || event.emailDeliveryId) continue;
      if (await isNotificationEventEligible({ ...event, id: snapshot.id }, { tx, scope, now: new Date(now) })) events.push({ ...event, id: snapshot.id });
    }
    if (!events.length) return null;
    const payload = renderNotificationEmail({ userId, recipient: recipient.email, events, deliveryId: id });
    const record = { id, ...scopeFields(scope), kind: 'digest', recipient: recipient.email, eventIds: events.map(event => event.id), payload,
      payloadHash: notificationHash(JSON.stringify(payload)), idempotencyKey: `simplseo-notification-${id}`,
      status: 'queued', dispatchPending: true, attemptCount: 0, attemptHistory: [], firstAttemptAt: null,
      createdAt: iso(now), updatedAt: iso(now), nextAttemptAt: iso(now), leaseUntil: null };
    tx.create(ref, record);
    tx.update(preferenceRef, { pendingDigestId: id });
    for (const event of events) tx.update(db.collection('notificationEvents').doc(event.id), { emailDeliveryId: id });
    return record;
  });
}

async function stopDelivery(tx, ref, delivery, preferenceRef, preference, status, now, reason) {
  tx.update(ref, { status, dispatchPending: false, updatedAt: iso(now), leaseUntil: null, stoppedReason: reason });
  if (preference?.pendingDigestId === delivery.id) tx.update(preferenceRef, { pendingDigestId: null });
  return { status };
}

async function reserveDeliveryAttempt(id, { now, deadline }) {
  if (deadline - Date.now() <= 1000) return { status: 'deferred' };
  const ref = deliveryRef(id), saved = await ref.get();
  if (!saved.exists) return { status: 'missing' };
  const original = saved.data();
  let recipient;
  try { recipient = await notificationRecipient(original.userId, { deadline }); }
  catch { return { status: 'unavailable' }; }
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists) return { status: 'missing' };
    const delivery = current.data(), userId = delivery.userId, preferenceRef = notificationPreferenceRef(userId);
    const [user, deleted, preferenceSnapshot] = await Promise.all([tx.get(db.collection('users').doc(userId)),
      tx.get(db.collection('accountDeletionGuards').doc(notificationHash(userId))), tx.get(preferenceRef)]);
    if (!usableUser(user, deleted)) return { status: 'deleted' };
    const preference = preferenceSnapshot.data();
    const retryState = notificationRetryState(delivery, now);
    if (retryState === 'finished' || retryState === 'waiting') return { status: retryState };
    if (retryState === 'expired' || retryState === 'exhausted') return stopDelivery(tx, ref, delivery, preferenceRef, preference, 'delivery_unknown', now, retryState);
    if (!ready() || !notificationEnabled(userId)) return { status: 'disabled' };
    let scope;
    try { scope = await readNotificationScope(userId, { tx }); }
    catch (error) {
      if (error.status === 409) return stopDelivery(tx, ref, delivery, preferenceRef, preference, 'cancelled', now, 'scope_changed');
      return { status: 'unavailable' };
    }
    const allowedRecipient = recipient.verified && recipient.email === delivery.recipient && preference?.suppression?.recipient !== recipient.email;
    if (!sameScope(scope, delivery) || !allowedRecipient || (delivery.kind !== 'test' && !activeEmail(preference, recipient))) {
      return stopDelivery(tx, ref, delivery, preferenceRef, preference, 'cancelled', now, 'consent_or_recipient_changed');
    }
    // The payload is immutable. If any included notice is now read or resolved,
    // cancel rather than silently modifying a request behind an idempotency key.
    const events = await Promise.all(delivery.eventIds.map(eventId => tx.get(db.collection('notificationEvents').doc(eventId))));
    for (const snapshot of events) {
      if (Date.now() + 2500 >= deadline) return { status: 'deferred' };
      const event = snapshot.data();
      if (!event || event.userId !== userId || event.status !== 'active' || event.readAt || event.emailDeliveryId !== id
        || !await isNotificationEventEligible({ ...event, id: snapshot.id }, { tx, scope, now: new Date(now) })) {
        return stopDelivery(tx, ref, delivery, preferenceRef, preference, 'cancelled', now, 'source_no_longer_eligible');
      }
    }
    const date = iso(now).slice(0, 10), month = date.slice(0, 7);
    const dayRef = db.collection('notificationBudgets').doc(`day-${date}`), monthRef = db.collection('notificationBudgets').doc(`month-${month}`);
    const paceRef = db.collection('notificationJobs').doc('resend-pacing');
    const [day, monthly, pacing] = await Promise.all([tx.get(dayRef), tx.get(monthRef), tx.get(paceRef)]);
    if ((day.data()?.attempts || 0) >= NOTIFICATION_DELIVERY_LIMITS.daily || (monthly.data()?.attempts || 0) >= NOTIFICATION_DELIVERY_LIMITS.monthly) return { status: 'allowance' };
    const dispatchAt = Math.max(now, Number(pacing.data()?.nextRequestAt) || 0);
    if (dispatchAt + 6000 > deadline) return { status: 'deferred' };
    const token = randomUUID(), firstAttemptAt = delivery.firstAttemptAt || iso(now), attemptCount = (delivery.attemptCount || 0) + 1;
    if (dispatchAt - Date.parse(firstAttemptAt) >= RETRY_WINDOW) return stopDelivery(tx, ref, delivery, preferenceRef, preference, 'delivery_unknown', now, 'expired');
    const reservationCount = (delivery.reservationCount || 0) + 1;
    const attemptHistory = [...(delivery.attemptHistory || []).slice(-49), { number: attemptCount, reservation: reservationCount, reservedAt: iso(now), dispatchAt: iso(dispatchAt), outcome: 'unknown' }];
    const next = { ...delivery, firstAttemptAt, attemptCount, reservationCount, attemptHistory, status: 'retry_pending', dispatchPending: true,
      nextAttemptAt: iso(now + 60000), leaseToken: token, leaseUntil: iso(Math.min(deadline + 5000, now + 65000)), updatedAt: iso(now) };
    tx.update(ref, next);
    tx.set(dayRef, { attempts: (day.data()?.attempts || 0) + 1, period: date });
    tx.set(monthRef, { attempts: (monthly.data()?.attempts || 0) + 1, period: month });
    tx.set(paceRef, { nextRequestAt: dispatchAt + 1000 });
    if (delivery.kind === 'digest' && !delivery.firstAttemptAt) tx.update(preferenceRef, { nextDigestAt: iso(dispatchAt + DAY + 65000) });
    return { status: 'reserved', delivery: next, token, dispatchAt, previousFirstAttemptAt: delivery.firstAttemptAt || null };
  });
}

async function claimProviderLane(deadline, sleepImpl) {
  const ref = db.collection('notificationJobs').doc('resend-send-lane'), token = randomUUID();
  while (Date.now() + 4000 < deadline) {
    const result = await db.runTransaction(async tx => {
      const value = (await tx.get(ref)).data() || {}, now = Date.now();
      const availableAt = Math.max(Date.parse(value.leaseUntil || '') || 0, Number(value.nextRequestAt) || 0);
      if (availableAt > now) return { wait: Math.min(1000, availableAt - now) };
      tx.set(ref, { leaseToken: token, leaseUntil: iso(deadline + 1000), nextRequestAt: now + 1000 });
      return { token };
    });
    if (result.token) return { ref, token };
    await sleepImpl(result.wait);
  }
  return null;
}
async function releaseProviderLane(lane) {
  if (!lane) return;
  await db.runTransaction(async tx => {
    const value = (await tx.get(lane.ref)).data();
    // Final recipient/source checks can take longer than the original pacing
    // slot. Keep a full second after this lane finishes so a following request
    // cannot bunch up immediately behind a slow pre-dispatch check.
    if (value?.leaseToken === lane.token) tx.update(lane.ref, { leaseToken: null, leaseUntil: null,
      nextRequestAt: Math.max(Number(value.nextRequestAt) || 0, Date.now() + 1000) });
  });
}

async function recheckBeforeSend(delivery, { recordDispatch = false, deadline = Date.now() + 25000 } = {}) {
  if (!ready() || !notificationEnabled(delivery.userId)) return false;
  const recipient = await notificationRecipient(delivery.userId, { deadline });
  return db.runTransaction(async tx => {
    let scope;
    try { scope = await readNotificationScope(delivery.userId, { tx }); } catch (error) { if (error.status === 409) return false; throw error; }
    if (!sameScope(scope, delivery)) return false;
    const preference = (await tx.get(notificationPreferenceRef(delivery.userId))).data();
    if (!recipient.verified || recipient.email !== delivery.recipient || preference?.suppression?.recipient === recipient.email
      || (delivery.kind !== 'test' && !activeEmail(preference, recipient))) return false;
    const documents = await Promise.all(delivery.eventIds.map(id => tx.get(db.collection('notificationEvents').doc(id))));
    for (const snapshot of documents) {
      const event = snapshot.data();
      if (!event || event.status !== 'active' || event.readAt || event.userId !== delivery.userId
        || !await isNotificationEventEligible({ ...event, id: snapshot.id }, { tx, scope, now: new Date() })) return false;
    }
    if (recordDispatch && delivery.kind === 'digest') {
      tx.update(notificationPreferenceRef(delivery.userId), { lastDigestAt: iso(Date.now()), nextDigestAt: iso(Date.now() + DAY + 15000) });
    }
    return true;
  });
}

export async function attemptNotificationDelivery(id, { now = Date.now(), deadline = Date.now() + 25000, fetchImpl = fetch, sleepImpl = sleep } = {}) {
  const reservation = await reserveDeliveryAttempt(id, { now, deadline });
  if (reservation.status !== 'reserved') return reservation;
  const { delivery, token, dispatchAt, previousFirstAttemptAt } = reservation;
  if (dispatchAt > Date.now()) await sleepImpl(dispatchAt - Date.now());
  let outcome = 'unknown', providerId = null, retryAfterMs = 60000, lane = null, fetchStarted = false;
  try {
    if (deadline - Date.now() < 3000) outcome = 'deferred';
    else if (!await recheckBeforeSend(delivery, { deadline })) outcome = 'cancelled';
    else {
      lane = await claimProviderLane(deadline, sleepImpl);
      if (!lane) throw new Error('Delivery deadline reached');
      if (!await recheckBeforeSend(delivery, { recordDispatch: true, deadline })) { outcome = 'cancelled'; throw new Error('Notification changed before dispatch'); }
      if (Date.now() - Date.parse(delivery.firstAttemptAt) >= RETRY_WINDOW) throw new Error('Idempotency retention window closed');
      if (Date.now() + 2000 >= deadline) throw new Error('Delivery deadline reached');
      fetchStarted = true;
      const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
          'User-Agent': 'SimplSEO-Notifications/1.0', 'Idempotency-Key': delivery.idempotencyKey },
        body: JSON.stringify(delivery.payload), signal: AbortSignal.timeout(Math.max(1, Math.min(12000, deadline - Date.now() - 1500))) });
      const data = await response.json().catch(() => null);
      if (response.ok && typeof data?.id === 'string') { outcome = 'accepted'; providerId = data.id; }
      else if (response.status === 429) {
        outcome = 'rate_limited';
        const retry = response.headers.get('retry-after');
        retryAfterMs = Math.max(60000, Math.min(DAY, /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry || '') - Date.now() || 60000));
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409) outcome = 'failed';
    }
  } catch { if (outcome !== 'cancelled') outcome = fetchStarted ? 'unknown' : 'deferred'; }
  finally { await releaseProviderLane(lane); }
  const finishedAt = Date.now();
  await db.runTransaction(async tx => {
    const ref = deliveryRef(id), preferenceRef = notificationPreferenceRef(delivery.userId);
    const [current, user, deleted, preferenceSnapshot] = await Promise.all([tx.get(ref), tx.get(db.collection('users').doc(delivery.userId)),
      tx.get(db.collection('accountDeletionGuards').doc(notificationHash(delivery.userId))), tx.get(preferenceRef)]);
    if (!current.exists || !usableUser(user, deleted) || current.data().leaseToken !== token) return;
    const previous = current.data(), preference = preferenceSnapshot.data();
    const history = [...previous.attemptHistory];
    history[history.length - 1] = { ...history.at(-1), outcome, completedAt: iso(finishedAt) };
    // A reserved slot is conservatively counted in global cost ceilings, but a
    // proven never-dispatched request does not consume a provider attempt or
    // start its 23-hour retry clock. After a process crash, absence of this local
    // proof remains unknown and retains the original conservative reservation.
    const neverDispatched = !fetchStarted && outcome === 'deferred';
    const attemptCount = neverDispatched ? Math.max(0, previous.attemptCount - 1) : previous.attemptCount;
    const firstAttemptAt = neverDispatched ? previousFirstAttemptAt : previous.firstAttemptAt;
    const retryWindowOpen = !firstAttemptAt || finishedAt + retryAfterMs - Date.parse(firstAttemptAt) < RETRY_WINDOW;
    const retry = (neverDispatched || ['unknown', 'rate_limited'].includes(outcome)) && attemptCount < 3 && retryWindowOpen;
    const proposedStatus = (outcome === 'unknown' || neverDispatched) && !retry ? 'delivery_unknown' : outcome === 'rate_limited' && !retry ? 'failed'
      : retry ? firstAttemptAt ? 'retry_pending' : 'queued' : outcome;
    // A signed webhook can arrive before the HTTP response. Never downgrade it.
    const webhookFinished = ['accepted', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed'].includes(previous.status);
    const status = webhookFinished ? previous.status : proposedStatus;
    tx.update(ref, { status, dispatchPending: !webhookFinished && retry, attemptCount, firstAttemptAt, attemptHistory: history, providerId: previous.providerId || providerId,
      updatedAt: iso(finishedAt), nextAttemptAt: iso(finishedAt + retryAfterMs), leaseUntil: null, leaseToken: null });
    if ((!retry || webhookFinished) && preference?.pendingDigestId === id) tx.update(preferenceRef, { pendingDigestId: null, ...(outcome === 'accepted' ? { nextDigestAt: iso(finishedAt + DAY) } : {}) });
  });
  return { status: outcome, deliveryId: id, attempted: fetchStarted, reserved: true };
}

export async function sendNotificationTest(userId, { idempotencyKey } = {}, now = Date.now()) {
  if (!ready() || !notificationEnabled(userId)) throw new RequestError('Test email will be available after the sending domain and notification credentials are configured.', 409);
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey)) throw new RequestError('Please try the test email again.');
  const deadline = Date.now() + 25000;
  const recipient = await notificationRecipient(userId, { deadline });
  if (!recipient.verified || !recipient.email) throw new RequestError('Verify your sign-in email before sending a test.', 409);
  const scope = await readNotificationScope(userId), id = notificationHash(`test:${userId}:${idempotencyKey}`), ref = deliveryRef(id);
  const limitRef = db.collection('notificationTestLimits').doc(notificationHash(userId));
  const previous = await db.runTransaction(async tx => {
    const currentScope = await readNotificationScope(userId, { tx });
    if (!sameScope(scope, currentScope)) throw new RequestError('Your website changed. Reload before sending a test.', 409);
    const [saved, quota, preferences] = await Promise.all([tx.get(ref), tx.get(limitRef), tx.get(notificationPreferenceRef(userId))]);
    if (saved.exists) return saved.data();
    if (preferences.data()?.suppression?.recipient === recipient.email) throw new RequestError('Email to this address is paused after a bounce or spam complaint.', 409);
    const limits = quota.data() || {};
    if ((limits.day === iso(now).slice(0, 10) && (limits.count || 0) >= 3) || (limits.lastAt && now - Date.parse(limits.lastAt) < 60000)) throw new RequestError('You can send one test per minute, up to three per day.', 429);
    const payload = renderNotificationEmail({ userId, recipient: recipient.email, events: [], deliveryId: id, test: true });
    const record = { id, ...scopeFields(scope), kind: 'test', recipient: recipient.email, eventIds: [], payload, payloadHash: notificationHash(JSON.stringify(payload)),
      idempotencyKey: `simplseo-notification-${id}`, status: 'queued', dispatchPending: true, attemptCount: 0, attemptHistory: [],
      firstAttemptAt: null, createdAt: iso(now), updatedAt: iso(now), nextAttemptAt: iso(now), leaseUntil: null };
    tx.create(ref, record);
    tx.set(limitRef, { userId, day: iso(now).slice(0, 10), count: (limits.day === iso(now).slice(0, 10) ? limits.count || 0 : 0) + 1, lastAt: iso(now) });
    return record;
  });
  const result = previous.attemptCount ? { status: previous.status, deliveryId: id } : await attemptNotificationDelivery(id, { now, deadline });
  return { ...result, message: result.status === 'accepted' ? 'Your labeled test email was accepted for delivery.' : 'The test request is saved. Its delivery status will update when confirmed.' };
}

async function queueDigests({ deadline, now }) {
  const ref = db.collection('notificationJobs').doc('email-queue-cursor'), cursor = (await ref.get()).data()?.cursor;
  let query = db.collection('notificationEvents').where('status', '==', 'active').where('readAt', '==', null).where('emailDeliveryId', '==', null)
    .orderBy('createdAt').orderBy(FieldPath.documentId()).limit(101);
  if (cursor) query = query.startAfter(cursor.createdAt, cursor.id);
  const snapshot = await query.get(), documents = snapshot.docs.slice(0, 100), grouped = new Map();
  for (const document of documents) {
    const event = document.data();
    if (!grouped.has(event.userId)) grouped.set(event.userId, []);
    grouped.get(event.userId).push(document.id);
  }
  let prepared = 0, visited = 0, errors = 0, deferred = 0;
  const handled = new Set();
  // Advance by the last visited source row, even if a slow account exhausts the
  // batch. Grouping may collect later rows for that account but never skips an
  // intervening account when the next invocation resumes.
  for (const document of documents) {
    const userId = document.data().userId;
    if (!handled.has(userId)) {
      if (Date.now() + 6500 >= deadline) break;
      try { if (await prepareNotificationDigest(userId, grouped.get(userId), { now, deadline })) prepared += 1; }
      catch (error) { if (error.status === 429) { deferred += 1; break; } errors += 1; }
      handled.add(userId);
    }
    visited += 1;
  }
  const remaining = visited < documents.length || snapshot.docs.length > 100;
  if (visited || snapshot.empty) {
    const last = documents[visited - 1];
    await ref.set({ cursor: remaining && last ? { id: last.id, createdAt: last.data().createdAt } : null, checkedAt: iso(now) });
  }
  return { prepared, moreRecords: remaining, errors, deferred };
}

export async function runNotificationDelivery({ now = new Date(), deadline = Date.now() + 30000, allowDigests = false, maxAttempts = 20 } = {}) {
  if (!ready()) return { status: 'disabled', attempted: 0, attempts: 0, accepted: 0, checked: 0, prepared: 0, moreRecords: false };
  const start = Number(now), ref = db.collection('notificationJobs').doc('email-delivery'), token = randomUUID();
  const leased = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (Date.parse(current?.leaseUntil || '') > Date.now()) return false;
    tx.set(ref, { ...current, leaseToken: token, leaseUntil: iso(deadline + 5000), startedAt: iso(start) }); return true;
  });
  if (!leased) return { status: 'leased', attempted: 0, attempts: 0, accepted: 0, checked: 0, prepared: 0, moreRecords: true };
  const counts = {}, cap = Math.min(20, Math.max(0, maxAttempts));
  let attempted = 0, prepared = 0, moreRecords = false, failure = null;
  const process = async () => {
    const snapshot = await db.collection('notificationDeliveries').where('dispatchPending', '==', true).orderBy('nextAttemptAt').limit(cap + 1).get();
    const candidates = snapshot.docs.filter(document => Date.parse(document.data().nextAttemptAt) <= Date.now()).slice(0, cap - attempted);
    moreRecords ||= snapshot.docs.length > cap;
    let index = 0;
    const worker = async () => {
      while (index < candidates.length && attempted < cap) {
        if (Date.now() + 6500 >= deadline) { moreRecords = true; break; }
        const candidate = candidates[index++];
        try {
          const result = await attemptNotificationDelivery(candidate.id, { now: Date.now(), deadline });
          if (result.attempted) attempted += 1;
          counts[result.status] = (counts[result.status] || 0) + 1;
          if (['deferred', 'allowance', 'waiting', 'unknown', 'rate_limited', 'unavailable'].includes(result.status)) moreRecords = true;
        } catch (error) { const kind = safeError(error); counts[kind] = (counts[kind] || 0) + 1; moreRecords = true; }
      }
    };
    await Promise.all([worker(), worker()]);
  };
  try {
    await process();
    if (allowDigests && attempted < cap && Date.now() + 6500 < deadline) {
      const result = await queueDigests({ deadline, now: Date.now() }); prepared = result.prepared; moreRecords ||= result.moreRecords; counts.queue_error = result.errors || 0; counts.deferred = (counts.deferred || 0) + (result.deferred || 0);
      if (prepared) await process();
    }
  } catch { failure = 'Notification delivery could not finish. Saved observations are unaffected.'; moreRecords = true; }
  const result = { status: failure ? 'error' : 'completed', attempted, attempts: attempted, accepted: counts.accepted || 0, checked: Object.values(counts).reduce((sum, count) => sum + count, 0), prepared, counts: { ...counts, error: (counts.unavailable || 0) + (counts.unknown || 0) + (counts.queue_error || 0) + (failure ? 1 : 0), deferred: counts.deferred || 0 }, moreRecords, ...(failure ? { error: failure } : {}) };
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.leaseToken === token) tx.update(ref, { leaseToken: null, leaseUntil: null, completedAt: iso(Date.now()), lastRun: result });
  });
  return result;
}

const webhookStatus = { 'email.sent': 'accepted', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'suppressed' };
export function nextNotificationProviderStatus(previous, next) {
  if (previous === 'complained' || next === 'complained') return 'complained';
  if (previous === 'bounced' || next === 'bounced') return 'bounced';
  if (previous === 'suppressed' || next === 'suppressed') return 'suppressed';
  if (previous === 'delivered' || next === 'delivered') return 'delivered';
  if (previous === 'failed' || next === 'failed') return 'failed';
  if (previous === 'delivery_delayed' || next === 'delivery_delayed') return 'delivery_delayed';
  return next;
}
export async function handleNotificationWebhook(raw, headers, { now = Date.now() } = {}) {
  const { id: webhookId, event } = verifyNotificationWebhook(raw, headers, { now });
  const status = webhookStatus[event.type];
  if (!status) return { received: true };
  const tags = event.data?.tags;
  const taggedId = Array.isArray(tags) ? tags.find(tag => tag.name === 'delivery_id')?.value : tags?.delivery_id;
  let id = typeof taggedId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(taggedId) ? taggedId : null;
  if (!id && typeof event.data?.email_id === 'string') {
    const matches = await db.collection('notificationDeliveries').where('providerId', '==', event.data.email_id).limit(1).get(); id = matches.docs[0]?.id;
  }
  if (!id) return { received: true };
  const ref = deliveryRef(id), receipt = ref.collection('webhooks').doc(notificationHash(webhookId));
  await db.runTransaction(async tx => {
    const [saved, seen] = await Promise.all([tx.get(ref), tx.get(receipt)]);
    if (!saved.exists || seen.exists) return;
    const delivery = saved.data(), preferenceRef = notificationPreferenceRef(delivery.userId);
    const [user, deleted, preferences] = await Promise.all([tx.get(db.collection('users').doc(delivery.userId)),
      tx.get(db.collection('accountDeletionGuards').doc(notificationHash(delivery.userId))), tx.get(preferenceRef)]);
    if (!usableUser(user, deleted) || (delivery.providerId && delivery.providerId !== event.data?.email_id)) return;
    const preference = preferences.data();
    const nextStatus = nextNotificationProviderStatus(delivery.status, status);
    tx.create(receipt, { type: event.type, receivedAt: iso(now), providerCreatedAt: event.created_at || null });
    tx.update(ref, { status: nextStatus, dispatchPending: false, providerId: delivery.providerId || event.data?.email_id || null,
      providerObservedAt: event.created_at || iso(now), webhookReceivedAt: iso(now), updatedAt: iso(now) });
    if (!preference && ['bounced', 'complained', 'suppressed'].includes(nextStatus)) {
      tx.set(preferenceRef, { userId: delivery.userId, revision: 1, emailEnabled: false, recipient: delivery.recipient, chosenAt: null,
        suppression: { recipient: delivery.recipient, reason: nextStatus, observedAt: iso(now) } });
    }
    if (preference) {
      const updates = preference.pendingDigestId === id ? { pendingDigestId: null } : {};
      if (['bounced', 'complained', 'suppressed'].includes(nextStatus) && preference.recipient === delivery.recipient) {
        Object.assign(updates, { suppression: { recipient: delivery.recipient, reason: nextStatus, observedAt: iso(now) },
          emailEnabled: false, revision: (preference.revision || 0) + 1 });
      }
      if (Object.keys(updates).length) tx.update(preferenceRef, updates);
    }
  });
  return { received: true };
}
