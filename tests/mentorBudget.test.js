import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const fake = (await import('./fakeFirestore')).fakeFirestore(), transaction = fake.db.runTransaction;
  let pending = Promise.resolve();
  fake.db.runTransaction = callback => { const next = pending.then(() => transaction(callback)); pending = next.catch(() => {}); return next; };
  return fake;
});
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { reserveMentorTurn, reserveMentorResearch, settleMentorTurn, MENTOR_TURN_RESERVE } from '../app/lib/server/mentorBudget';
const now = Date.parse('2026-10-11T10:00:00Z');
beforeEach(async () => { reset(); await db.collection('users').doc('alice').set({}); });
describe('mentor atomic cost and attempt accounting', () => {
  it('reserves before provider work, releases known excess and settles idempotently', async () => {
    const hold = await reserveMentorTurn('alice', 'turn1', { now });
    expect(records.get('mentorBudgetMonths/2026-10').reservedUsd).toBe(MENTOR_TURN_RESERVE);
    await settleMentorTurn(hold, { costUsd: 0.01, providerAttempts: 2 });
    await settleMentorTurn(hold, { costUsd: 1 });
    expect(records.get('mentorBudgetMonths/2026-10')).toMatchObject({ spentUsd: 0.01, reservedUsd: 0 });
  });
  it('rejects a duplicate reservation instead of charging or generating again', async () => {
    await reserveMentorTurn('alice', 'turn1', { now });
    await expect(reserveMentorTurn('alice', 'turn1', { now })).rejects.toMatchObject({ status: 409 });
  });
  it('keeps ambiguous provider spend reserved', async () => {
    const hold = await reserveMentorTurn('alice', 'turn1', { now });
    await settleMentorTurn(hold, { costUsd: 0, unknown: true });
    expect(records.get(`mentorBudgetReservations/${hold.id}`).status).toBe('reserved');
  });
  it('enforces the minute allowance across both interfaces', async () => {
    for (let i = 0; i < 5; i++) await reserveMentorTurn('alice', `turn${i}`, { now });
    await expect(reserveMentorTurn('alice', 'turn6', { now })).rejects.toMatchObject({ status: 429 });
  });
  it('enforces the pilot budget even when daily quota is available', async () => {
    await db.collection('mentorBudgetMonths').doc('2026-10').set({ spentUsd: 24.99 });
    await expect(reserveMentorTurn('alice', 'turn1', { now })).rejects.toMatchObject({ status: 429 });
  });
  it('counts evaluation costs within both the global and evaluation ceilings', async () => {
    const hold = await reserveMentorTurn('alice', 'eval1', { now, evaluation: true });
    await settleMentorTurn(hold, { costUsd: 0.2 });
    expect(records.get('mentorBudgetMonths/2026-10')).toMatchObject({ spentUsd: 0.2, evaluationSpentUsd: 0.2 });
    await db.collection('mentorBudgetMonths').doc('2026-10').set({ evaluationSpentUsd: 9.99 });
    await expect(reserveMentorTurn('alice', 'eval2', { now, evaluation: true })).rejects.toMatchObject({ status: 429 });
  });
  it('reserves two searches atomically, up to ten daily', async () => {
    for (let i = 0; i < 5; i++) expect(await reserveMentorResearch('alice', { now })).toBe(true);
    expect(await reserveMentorResearch('alice', { now })).toBe(false);
  });
  it('enforces quota and global budget during competing reservations', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => reserveMentorTurn('alice', `parallel-${index}`, { now })));
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(5);
    expect(attempts.find(item => item.status === 'rejected').reason.status).toBe(429);
    reset(); await db.collection('users').doc('alice').set({}); await db.collection('users').doc('bob').set({});
    await db.collection('mentorBudgetMonths').doc('2026-10').set({ spentUsd: 25 - MENTOR_TURN_RESERVE - .001 });
    const budgetRace = await Promise.allSettled(['alice', 'bob'].map(uid => reserveMentorTurn(uid, 'competing-budget', { now })));
    expect(budgetRace.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(budgetRace.find(item => item.status === 'rejected').reason.status).toBe(429);
  });
  it('settles concurrent known costs without losing another reservation', async () => {
    const holds = await Promise.all([reserveMentorTurn('alice', 'one', { now }), reserveMentorTurn('alice', 'two', { now })]);
    await Promise.all(holds.map(hold => settleMentorTurn(hold, { costUsd: .01, providerAttempts: 1 })));
    expect(records.get('mentorBudgetMonths/2026-10')).toMatchObject({ spentUsd: .02, reservedUsd: 0 });
  });
  it('never recreates identifiable reservations after account deletion', async () => {
    const hold = await reserveMentorTurn('alice', 'turn1', { now });
    await db.collection('users').doc('alice').delete(); await db.collection('mentorBudgetReservations').doc(hold.id).delete();
    await settleMentorTurn(hold, { costUsd: 0.1 });
    expect(records.has(`mentorBudgetReservations/${hold.id}`)).toBe(false);
    await expect(reserveMentorTurn('alice', 'turn2', { now })).rejects.toMatchObject({ status: 409 });
  });
});
