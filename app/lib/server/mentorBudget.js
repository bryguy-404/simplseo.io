import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { MENTOR_LIMITS, MENTOR_PRICING, estimatedMentorCost } from '../mentorPolicy';

const hash = value => createHash('sha256').update(value).digest('hex');
const round = value => Math.ceil(Math.max(0, value) * 1e6) / 1e6;
const active = user => user.exists && !user.data()?.deletionInProgress;
export const MENTOR_TURN_RESERVE = estimatedMentorCost({ inputTokens: MENTOR_LIMITS.inputTokens + MENTOR_PRICING.searchInputReserve,
  cacheWriteTokens: MENTOR_LIMITS.inputTokens + MENTOR_PRICING.searchInputReserve, outputTokens: MENTOR_LIMITS.outputTokens, searches: MENTOR_LIMITS.searches });

export async function reserveMentorTurn(uid, turnId, { evaluation = false, now = Date.now() } = {}) {
  if (typeof turnId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(turnId)) throw new RequestError('Choose a valid message request.');
  const month = new Date(now).toISOString().slice(0, 7), monthRef = db.collection('mentorBudgetMonths').doc(month);
  const ref = db.collection('mentorBudgetReservations').doc(hash(`${uid}:${turnId}`));
  const quotaEntries = evaluation ? [] : [{ length: 60000, limit: MENTOR_LIMITS.minute }, { length: 86400000, limit: MENTOR_LIMITS.day }]
    .map(window => ({ ...window, ref: db.collection('mentorRequestLimits').doc(hash(`turn:${uid}:${window.length}:${Math.floor(now / window.length)}`)) }));
  return db.runTransaction(async tx => {
    const [user, deleted, previous, budget, ...quotas] = await Promise.all([
      tx.get(db.collection('users').doc(uid)), tx.get(db.collection('accountDeletionGuards').doc(hash(uid))),
      tx.get(ref), tx.get(monthRef), ...quotaEntries.map(entry => tx.get(entry.ref)),
    ]);
    if (!active(user) || deleted.exists) throw new RequestError('Your account changed. Please sign in again.', 409);
    if (previous.exists) throw new RequestError('This message already has an attempt. Read its saved result or retry with a new request.', 409);
    const data = budget.data() || {}, total = (data.spentUsd || 0) + (data.reservedUsd || 0);
    if (total + MENTOR_TURN_RESERVE > MENTOR_LIMITS.monthlyUsd
      || (evaluation && (data.evaluationSpentUsd || 0) + (data.evaluationReservedUsd || 0) + MENTOR_TURN_RESERVE > MENTOR_LIMITS.evaluationUsd)) {
      throw new RequestError('The mentor pilot has reached its spending allowance. Saved conversations and your other tools remain available.', 429);
    }
    if (quotaEntries.some((entry, index) => (quotas[index].data()?.count || 0) >= entry.limit)) {
      throw new RequestError('Your mentor allowance is used for now (5 messages per minute, 50 per day). Saved conversations remain available.', 429);
    }
    const reservation = { id: ref.id, userId: uid, turnId, month, evaluation, reservedUsd: MENTOR_TURN_RESERVE,
      status: 'reserved', pricingVersion: MENTOR_PRICING.version, createdAt: new Date(now).toISOString() };
    tx.set(ref, reservation);
    tx.set(monthRef, { ...data, reservedUsd: round((data.reservedUsd || 0) + MENTOR_TURN_RESERVE),
      evaluationReservedUsd: round((data.evaluationReservedUsd || 0) + (evaluation ? MENTOR_TURN_RESERVE : 0)), pricingVersion: MENTOR_PRICING.version });
    quotaEntries.forEach((entry, index) => tx.set(entry.ref, { userId: uid, kind: 'mentor_turn',
      count: (quotas[index].data()?.count || 0) + 1, expiresAt: new Date(now + entry.length * 2) }));
    return reservation;
  });
}

export async function reserveMentorResearch(uid, { searches = 2, now = Date.now() } = {}) {
  if (searches !== 2) throw new RequestError('Invalid research allowance.');
  const ref = db.collection('mentorRequestLimits').doc(hash(`research:${uid}:${Math.floor(now / 86400000)}`));
  return db.runTransaction(async tx => {
    const [user, previous] = await Promise.all([tx.get(db.collection('users').doc(uid)), tx.get(ref)]);
    if (!active(user)) throw new RequestError('Your account changed.', 409);
    if ((previous.data()?.count || 0) + searches > MENTOR_LIMITS.dailySearches) return false;
    tx.set(ref, { userId: uid, kind: 'mentor_search', count: (previous.data()?.count || 0) + searches, expiresAt: new Date(now + 172800000) });
    return true;
  });
}

export async function settleMentorTurn(reservation, { costUsd, unknown = false, providerAttempts = 0 } = {}) {
  if (!reservation) return;
  // A timeout may still be billed. Never turn missing provider usage into zero.
  if (unknown || !Number.isFinite(costUsd) || costUsd < 0) return;
  const ref = db.collection('mentorBudgetReservations').doc(reservation.id);
  const monthRef = db.collection('mentorBudgetMonths').doc(reservation.month);
  await db.runTransaction(async tx => {
    const [current, budget, user] = await Promise.all([tx.get(ref), tx.get(monthRef), tx.get(db.collection('users').doc(reservation.userId))]);
    // Deletion removes identifiable reservations; never recreate them. The
    // anonymous global reservation remains conservatively held in that case.
    if (!current.exists || !active(user) || current.data().status !== 'reserved') return;
    const data = budget.data() || {}, amount = round(costUsd), held = current.data().reservedUsd;
    tx.update(ref, { status: 'settled', estimatedCostUsd: amount, providerAttempts, completedAt: new Date().toISOString() });
    tx.set(monthRef, { ...data, spentUsd: round((data.spentUsd || 0) + amount), reservedUsd: round((data.reservedUsd || 0) - held),
      evaluationSpentUsd: round((data.evaluationSpentUsd || 0) + (reservation.evaluation ? amount : 0)),
      evaluationReservedUsd: round((data.evaluationReservedUsd || 0) - (reservation.evaluation ? held : 0)) });
  });
}
