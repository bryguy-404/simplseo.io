import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => ({ ...(await import('./fakeFirestore')).fakeFirestore(), auth: {} }));
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { activateFollowUpPlan, savePageReviewPlan, readPageReviewPlanHistory } from '../app/lib/server/pageReviewPlans';
const property = 'https://example.test/';
const cycleId = 'a'.repeat(64), decisionId = 'b'.repeat(64);
const rec = quote => ({ id: 'next', type: 'heading', significance: 'primary', benefit: 'search_relevance', basis: 'opportunity',
  label: 'Clarify the service heading', location: 'Service section', currentQuote: quote, proposedText: 'Local website services',
  supportingQuote: 'We build websites', instruction: 'Clarify this heading.', reason: 'Help readers find the service.', targetUrl: null, evidenceIds: ['P1'] });
const review = quote => ({ title: null, description: null, analysis: { recommendations: [rec(quote)], action: 'improve_content', metadataVerdict: 'keep' },
  evidence: { facts: [{ id: 'P1', text: 'We build websites', kind: 'page' }] }, diagnostics: { facts: [] }, research: { status: 'unavailable' },
  provenance: { property, pageUrl: property, websiteRunId: 'run', contentFingerprint: quote, generatedAt: '2026-10-10T10:00:00Z' } });
let plan;
beforeEach(async () => {
  reset(); vi.stubEnv('ONGOING_PAGE_REVIEWS_ENABLED', 'true'); vi.stubEnv('ONGOING_PAGE_REVIEW_PILOT_UIDS', 'alice');
  await db.collection('users').doc('alice').set({ gscSiteUrl: property, gscAccessToken: 'fixture' });
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: property, revampRunId: 'run' });
  plan = await savePageReviewPlan('alice', review('Old heading'));
  records.get(`pageReviewPlans/${plan.id}`).tasks[0].status = 'done';
  const decision = { id: decisionId, cycleId, outcome: 'improve_page', sourcePlanRevision: plan.revision,
    review: review('Another heading'), acceptedAt: null, checkpointId: 'day-28', checkpointRevision: 1 };
  await db.collection('pageProgressCycles').doc(cycleId).set({ id: cycleId, userId: 'alice', pageUrl: property, property, websiteRunId: 'run',
    confirmedAt: '2026-09-01T12:00:00Z', lifecycle: 'active', revision: 2, latestDecisionId: decisionId, latestDecision: decision,
    latestCheckpointId: 'day-28', latestCheckpoint: { id: 'day-28', evidenceRevision: 1 } });
  await db.collection('pageProgressCycles').doc(cycleId).collection('decisions').doc(decisionId).set(decision);
});
afterEach(() => vi.unstubAllEnvs());
const accept = overrides => activateFollowUpPlan('alice', { cycleId, decisionId, expectedRevision: 2, ...overrides });
it('archives exact previous tasks and activates a new checklist without ending tracking or resetting the date', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('no providers'));
  try {
    const result = await accept();
    expect(result.cycle).toMatchObject({ confirmedAt: '2026-09-01T12:00:00Z', lifecycle: 'active', revision: 3, reviewChangesAllowed: true });
    expect(result.cycle.latestDecision).not.toHaveProperty('review');
    expect(result.decision).not.toHaveProperty('review');
    expect(records.get(`pageProgressCycles/${cycleId}/decisions/${decisionId}`)).toHaveProperty('review');
    expect(result.plan.tasks).toHaveLength(1);
    expect(result.plan.tasks[0]).toMatchObject({ status: 'todo', recommendation: { currentQuote: 'Another heading' } });
    const history = await readPageReviewPlanHistory('alice', property);
    expect(history.history[0].tasks[0]).toMatchObject({ status: 'done', recommendation: { currentQuote: 'Old heading' } });
    expect(history.history[0]).not.toHaveProperty('userId');
    expect((await accept()).alreadyAccepted).toBe(true);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
it('rejects a concurrent owner task edit instead of replacing it', async () => {
  records.get(`pageReviewPlans/${plan.id}`).revision += 1;
  const before = structuredClone([...records]);
  await expect(accept()).rejects.toMatchObject({ status: 409 });
  expect([...records]).toEqual(before);
});
it('does not let a client override the plan revision used by the saved recommendation', async () => {
  records.get(`pageReviewPlans/${plan.id}`).revision += 1;
  const before = structuredClone([...records]);
  await expect(accept({ expectedPlanRevision: plan.revision + 1 })).rejects.toMatchObject({ status: 409 });
  expect([...records]).toEqual(before);
});
it.each(['deleted', 'deleting', 'rebuilt', 'other-owner', 'superseded', 'changed-review', 'stale'])('rejects %s with no partial writes', async condition => {
  if (condition === 'deleted') records.delete('users/alice');
  if (condition === 'deleting') records.get('users/alice').deletionInProgress = true;
  if (condition === 'rebuilt') records.get('onboarding/alice').revampRunId = 'new';
  if (condition === 'other-owner') records.get(`pageProgressCycles/${cycleId}`).userId = 'bob';
  if (condition === 'superseded') records.get(`pageProgressCycles/${cycleId}`).lifecycle = 'superseded';
  if (condition === 'changed-review') records.get(`pageProgressCycles/${cycleId}`).latestDecisionId = 'c'.repeat(64);
  if (condition === 'stale') records.get(`pageProgressCycles/${cycleId}`).revision = 3;
  const before = structuredClone([...records]);
  await expect(accept()).rejects.toMatchObject({ status: expect.any(Number) });
  expect([...records]).toEqual(before);
});
it('refuses activation for a monitoring result and leaves the original plan intact', async () => {
  records.get(`pageProgressCycles/${cycleId}/decisions/${decisionId}`).outcome = 'keep_monitoring';
  const before = structuredClone([...records]);
  await expect(accept()).rejects.toMatchObject({ status: 409 });
  expect([...records]).toEqual(before);
});
it('does not reopen an identical completed task as another improvement', async () => {
  records.get(`pageProgressCycles/${cycleId}/decisions/${decisionId}`).review = review('Old heading');
  const before = structuredClone([...records]);
  await expect(accept()).rejects.toMatchObject({ status: 409 });
  expect([...records]).toEqual(before);
});
it.each(['checkpoint', 'evidence revision'])('requires a new review when the %s changed', async kind => {
  const cycle = records.get(`pageProgressCycles/${cycleId}`);
  if (kind === 'checkpoint') cycle.latestCheckpointId = 'day-56';
  else cycle.latestCheckpoint.evidenceRevision = 2;
  const before = structuredClone([...records]);
  await expect(accept()).rejects.toMatchObject({ status: 409 });
  expect([...records]).toEqual(before);
});
