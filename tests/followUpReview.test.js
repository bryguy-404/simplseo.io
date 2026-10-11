import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureData from './fixtures/follow-up-reviews.cjs';

const control = vi.hoisted(() => ({ plan: null, context: null, payload: null, create: vi.fn(), readPage: vi.fn(), diagnostics: vi.fn(), refresh: vi.fn(), usage: vi.fn(), accept: vi.fn() }));
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { verifyIdToken: vi.fn(async token => {
    if (!['alice', 'bob'].includes(token)) throw new Error('invalid'); return { uid: token };
  }) } };
});
vi.mock('openai', () => ({ default: class { responses = { create: (...args) => control.create(...args) }; } }));
vi.mock('../app/lib/server/manualPageReview', () => ({ readCurrentPageForReview: (...args) => control.readPage(...args) }));
vi.mock('../app/lib/server/pageReviewDiagnostics', () => ({ collectPageReviewDiagnostics: (...args) => control.diagnostics(...args) }));
vi.mock('../app/lib/server/pageReviewPlans', () => ({ readPageReviewPlan: vi.fn(async () => structuredClone(control.plan)), activateFollowUpPlan: (...args) => control.accept(...args) }));
vi.mock('../app/lib/server/aiUsage', () => ({ recordPageReviewResponse: (...args) => control.usage(...args) }));
vi.mock('../app/lib/server/ongoingProgress', async importOriginal => ({ ...await importOriginal(), refreshOngoingProgress: (...args) => control.refresh(...args) }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { runFollowUpReview, readFollowUpReview } from '../app/lib/server/followUpReview';
import { readOngoingCycle } from '../app/lib/server/ongoingProgress';
import { GET, POST } from '../app/api/page-review/follow-up/route';
import { accountWebsiteScope, businessProfileRef } from '../app/lib/server/businessProfile';

const id = 'a'.repeat(64), planId = 'b'.repeat(64);
const ref = () => db.collection('pageProgressCycles').doc(id);
const decisionPaths = () => [...records.keys()].filter(key => key.startsWith(`pageProgressCycles/${id}/decisions/`));
const action = (revision = 1) => ({ action: 'review', cycleId: id, expectedRevision: revision });
const request = (body, uid = 'alice') => new Request(`https://app.test/api/page-review/follow-up?cycleId=${id}`, {
  method: body ? 'POST' : 'GET', headers: { ...(uid ? { Authorization: `Bearer ${uid}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const response = payload => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] });

beforeEach(async () => {
  reset(); vi.clearAllMocks();
  process.env.ONGOING_PAGE_REVIEWS_ENABLED = 'true'; process.env.ONGOING_PAGE_REVIEW_PILOT_UIDS = 'alice'; process.env.OPENAI_API_KEY = 'synthetic-not-a-key';
  control.context = fixtureData.context('roofing'); control.payload = fixtureData.keepDecision(control.context);
  control.plan = { id: planId, revision: 3, tasks: control.context.priorTasks,
    review: { research: { ...control.context.research, checkedAt: new Date().toISOString() } } };
  for (const uid of ['alice', 'bob']) {
    await db.collection('users').doc(uid).set({ gscSiteUrl: control.context.cycle.property });
    await db.collection('onboarding').doc(uid).set({ isComplete: true, gscProperty: control.context.cycle.property, revampRunId: 'run-one' });
  }
  await ref().set({ ...control.context.cycle, userId: 'alice', websiteRunId: 'run-one', revision: 1,
    lifecycle: 'active', latestCheckpointId: 'day-28', latestDecision: null, latestDecisionId: null, technical: null });
  await db.collection('pageReviewPlans').doc(planId).set(control.plan);
  control.readPage.mockImplementation(async () => ({ currentPage: structuredClone(control.context.currentPage),
    provenance: { property: control.context.cycle.property, websiteRunId: 'run-one', pageUrl: control.context.cycle.pageUrl,
      finalUrl: control.context.cycle.pageUrl, contentFingerprint: 'synthetic-content' } }));
  control.diagnostics.mockImplementation(async () => structuredClone(control.context.diagnostics));
  control.refresh.mockImplementation(async () => ({ cycle: await readOngoingCycle('alice', id), state: 'skipped' }));
  control.usage.mockImplementation(async (_context, execute) => execute());
  control.create.mockImplementation(async () => response(control.payload));
});

describe('scoped follow-up service and API', () => {
  it('retains the prior decision when confirmed business facts change during generation', async () => {
    const first = await runFollowUpReview('alice', action());
    control.context.currentPage.textContent += ' A new page detail.';
    const readPage = control.readPage.getMockImplementation();
    control.readPage.mockImplementation(async (...args) => {
      const page = await readPage(...args); page.provenance.businessProfileRevision = 0; return page;
    });
    control.create.mockImplementation(async () => {
      const scope = accountWebsiteScope(records.get('onboarding/alice'), records.get('users/alice'));
      records.set(businessProfileRef('alice', scope).path, { scope, revision: 1, profile: { services: ['Roof repair'] } });
      return response(control.payload);
    });
    await expect(runFollowUpReview('alice', action(2))).rejects.toMatchObject({ status: 409 });
    expect((await ref().get()).data().latestDecisionId).toBe(first.decision.id);
    expect(decisionPaths()).toHaveLength(1);
  });

  it('GET restores stored results without any providers, quota or writes', async () => {
    const before = [...records];
    expect((await GET(request())).status).toBe(200);
    expect(await readFollowUpReview('alice', id)).toMatchObject({ decision: null, cycle: { id } });
    expect(control.refresh).not.toHaveBeenCalled(); expect(control.create).not.toHaveBeenCalled(); expect([...records]).toEqual(before);
  });
  it('authenticates identity and blocks cross-account access', async () => {
    expect((await GET(request(null, null))).status).toBe(401);
    expect((await GET(request(null, 'bob'))).status).toBe(404);
    expect((await POST(request({ ...action(), userId: 'bob' }))).status).toBe(403);
    expect(control.refresh).not.toHaveBeenCalled();
  });
  it('enforces rollout, scope and revision before external work', async () => {
    await expect(runFollowUpReview('alice', action(2))).rejects.toMatchObject({ status: 409 });
    process.env.ONGOING_PAGE_REVIEWS_ENABLED = 'false';
    await expect(runFollowUpReview('alice', action())).rejects.toMatchObject({ status: 409 });
    process.env.ONGOING_PAGE_REVIEWS_ENABLED = 'true'; await db.collection('onboarding').doc('alice').update({ revampRunId: 'other-run' });
    await expect(runFollowUpReview('alice', action())).rejects.toMatchObject({ status: 409 });
    expect(control.refresh).not.toHaveBeenCalled();
  });
  it('saves an incomplete-comparison decision without AI and preserves it on unchanged checks', async () => {
    await ref().update({ latestCheckpoint: null, latestCheckpointId: null });
    const first = await runFollowUpReview('alice', action());
    expect(first.decision.outcome).toBe('gather_evidence'); expect(first.cycle.revision).toBe(2);
    const again = await runFollowUpReview('alice', action(2));
    expect(again.unchanged).toBe(true); expect(again.decision.id).toBe(first.decision.id);
    expect(decisionPaths()).toHaveLength(1); expect(control.create).not.toHaveBeenCalled();
    expect([...records.keys()].filter(key => key.startsWith('requestLimits/'))).toHaveLength(0);
  });
  it('saves a verified technical-first decision without AI before a comparison is ready', async () => {
    await ref().update({ latestCheckpoint: null, technical: { checkedAt: new Date().toISOString(),
      publicPage: { checkedAt: new Date().toISOString(), noindex: true, finalUrl: control.context.cycle.pageUrl }, errors: null } });
    const result = await runFollowUpReview('alice', action());
    expect(result.decision).toMatchObject({ outcome: 'fix_technical', canAcceptTasks: false });
    expect(result.decision.whatChanged).toContain('noindex');
    expect(result.decision.nextStep).toContain('If this page should appear in search');
    expect(control.create).not.toHaveBeenCalled(); expect(control.readPage).not.toHaveBeenCalled();
  });
  it('asks whether a different canonical is intentional instead of prescribing an unconditional removal', async () => {
    await ref().update({ latestCheckpoint: null, technical: { checkedAt: new Date().toISOString(), errors: null,
      publicPage: { checkedAt: new Date().toISOString(), finalUrl: control.context.cycle.pageUrl,
        canonicalUrl: `${control.context.cycle.property}another-page` } } });
    const result = await runFollowUpReview('alice', action());
    expect(result.decision.whatChanged).toContain('canonical'); expect(result.decision.nextStep).toContain('Keep it if intentional');
    expect(control.create).not.toHaveBeenCalled();
  });
  it('stores a separate decision and skips paid work for unchanged evidence, including unavailable cached research', async () => {
    const first = await runFollowUpReview('alice', action());
    expect(first.decision).toMatchObject({ outcome: 'keep_monitoring', sourcePlanRevision: 3 });
    expect(first.cycle.confirmedAt).toBe(control.context.cycle.confirmedAt);
    expect(first.cycle.latestDecision).not.toHaveProperty('review'); expect(first.decision).not.toHaveProperty('userId');
    expect(control.usage).toHaveBeenCalledWith(expect.objectContaining({ feature: 'page_follow_up', stage: 'follow_up' }), expect.any(Function));
    const quota = [...records].filter(([key]) => key.startsWith('requestLimits/'));
    control.context.currentPage.fetchedAt = new Date().toISOString();
    const again = await runFollowUpReview('alice', action(2));
    expect(again.unchanged).toBe(true); expect(again.decision.id).toBe(first.decision.id);
    expect(control.create).toHaveBeenCalledTimes(1); expect([...records].filter(([key]) => key.startsWith('requestLimits/'))).toEqual(quota);
    expect((await db.collection('pageReviewPlans').doc(planId).get()).data()).toEqual(control.plan);
  });
  it('keeps the previous decision on provider failure and records the failed generation attempt', async () => {
    const first = await runFollowUpReview('alice', action());
    control.context.currentPage.textContent += ' New current page detail.';
    control.create.mockRejectedValueOnce(new Error('synthetic provider failure'));
    await expect(runFollowUpReview('alice', action(2))).rejects.toThrow();
    expect((await ref().get()).data().latestDecisionId).toBe(first.decision.id);
    expect(decisionPaths()).toHaveLength(1);
    expect([...records].filter(([key]) => key.startsWith('requestLimits/')).every(([, value]) => value.count === 2)).toBe(true);
  });
  it('preserves a saved decision without paid work when previously available technical evidence cannot refresh', async () => {
    const first = await runFollowUpReview('alice', action());
    control.context.diagnostics.inspection = { status: 'unavailable' };
    control.context.diagnostics.facts = control.context.diagnostics.facts.filter(fact => fact.id !== 'I1');
    const result = await runFollowUpReview('alice', action(2));
    expect(result).toMatchObject({ unchanged: true, decision: { id: first.decision.id } });
    expect(result.message).toContain('could not be refreshed'); expect(control.create).toHaveBeenCalledTimes(1);
  });
  it('persists a fresh research check after expiry even when the recommended outcome stays the same', async () => {
    const first = await runFollowUpReview('alice', action());
    const decisionRef = ref().collection('decisions').doc(first.decision.id);
    const saved = (await decisionRef.get()).data(); saved.review.research.checkedAt = '2026-09-01T00:00:00Z'; await decisionRef.set(saved);
    // A failed research call is saved as unavailable, not invented findings.
    control.create.mockImplementation(async value => {
      if (value.tools) throw new Error('synthetic research unavailable');
      return response(control.payload);
    });
    const renewed = await runFollowUpReview('alice', action(2));
    expect(renewed.decision.id).not.toBe(first.decision.id);
    expect(renewed.decision.outcome).toBe(first.decision.outcome);
    const calls = control.create.mock.calls.length;
    const unchanged = await runFollowUpReview('alice', action(3));
    expect(unchanged.unchanged).toBe(true); expect(control.create).toHaveBeenCalledTimes(calls);
  });
  it('does not revive a stale technical finding when the latest technical request failed', async () => {
    await ref().update({ latestCheckpoint: null, technical: { checkedAt: new Date().toISOString(),
      publicPage: { checkedAt: '2026-08-01T00:00:00Z', noindex: true, finalUrl: control.context.cycle.pageUrl },
      errors: { publicPage: 'temporarily_unavailable' } } });
    const result = await runFollowUpReview('alice', action());
    expect(result.decision.outcome).toBe('gather_evidence'); expect(control.create).not.toHaveBeenCalled();
  });
  it('reviews recovered query evidence even after a decision was accepted for the same checkpoint day', async () => {
    const first = await runFollowUpReview('alice', action());
    await ref().collection('decisions').doc(first.decision.id).update({ acceptedAt: new Date().toISOString() });
    control.plan.followUp = { cycleId: id, decisionId: first.decision.id };
    await db.collection('pageReviewPlans').doc(planId).set(control.plan);
    const latest = (await ref().get()).data();
    latest.latestCheckpoint.evidenceRevision = 2;
    latest.latestCheckpoint.post.queries.push({ query: 'another service phrase', clicks: 0, impressions: 2, ctr: 0, position: 20 });
    await ref().set(latest);
    const result = await runFollowUpReview('alice', action(2));
    expect(result.unchanged).not.toBe(true); expect(result.decision.id).not.toBe(first.decision.id);
    expect(result.decision.checkpointRevision).toBe(2); expect(control.create).toHaveBeenCalledTimes(2);
  });
  it.each(['property', 'deletion', 'revision', 'plan_edit'])('rejects a result when %s changes during a provider request', async mode => {
    control.create.mockImplementationOnce(async () => {
      if (mode === 'property') await db.collection('onboarding').doc('alice').update({ revampRunId: 'other-run' });
      if (mode === 'deletion') await db.collection('users').doc('alice').delete();
      if (mode === 'revision') await ref().update({ revision: 2 });
      if (mode === 'plan_edit') await db.collection('pageReviewPlans').doc(planId).update({ revision: 4 });
      return response(control.payload);
    });
    await expect(runFollowUpReview('alice', action())).rejects.toMatchObject({ status: 409 });
    expect(decisionPaths()).toHaveLength(0); expect((await ref().get()).data().latestDecisionId).toBeNull();
  });
  it('rejects fabricated source evidence and preserves the plan', async () => {
    control.payload.evidenceIds = ['W999'];
    await expect(runFollowUpReview('alice', action())).rejects.toMatchObject({ status: 502 });
    expect(decisionPaths()).toHaveLength(0);
    expect((await db.collection('pageReviewPlans').doc(planId).get()).data()).toEqual(control.plan);
  });
  it('uses a shared lease to prevent concurrent generations', async () => {
    let resolve;
    control.create.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = runFollowUpReview('alice', action());
    await vi.waitFor(() => expect(control.create).toHaveBeenCalledTimes(1));
    await expect(runFollowUpReview('alice', action())).rejects.toMatchObject({ status: 409 });
    resolve(response(control.payload)); await first;
    expect(control.create).toHaveBeenCalledTimes(1);
  });
  it('technical-only checks never trigger AI or reset confirmation', async () => {
    const result = await runFollowUpReview('alice', { ...action(), action: 'troubleshoot' });
    expect(control.refresh).toHaveBeenCalledWith('alice', expect.objectContaining({ technicalOnly: true, expectedRevision: 1 }));
    expect(control.create).not.toHaveBeenCalled(); expect(result.cycle.confirmedAt).toBe(control.context.cycle.confirmedAt);
  });
});
