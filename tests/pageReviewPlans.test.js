import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { verifyIdToken: vi.fn(async token => {
    if (!['alice', 'bob'].includes(token)) throw new Error('invalid');
    return { uid: token };
  }) } };
});
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { readPageReviewPlan, savePageReviewPlan, updatePageReviewTask } from '../app/lib/server/pageReviewPlans';
import { GET, POST } from '../app/api/page-review/plan/route';

const property = 'https://example.test/';
const pageUrl = `${property}Services/?Topic=Web`;
const rec = (overrides = {}) => ({ id: 'action-1', type: 'heading', significance: 'primary', benefit: 'search_relevance', basis: 'opportunity',
  label: 'Clarify the main service', location: 'Main heading', currentQuote: 'Local services', proposedText: 'Local website development',
  supportingQuote: 'We build websites', instruction: 'Replace the vague heading with the service offered here.', reason: 'Help visitors understand the page.', targetUrl: null, evidenceIds: ['P1', 'W1'], ...overrides });
const review = (recommendations = [rec()], overrides = {}) => ({
  title: null, description: null,
  analysis: { recommendations, action: 'improve_content', metadataVerdict: 'keep', pageGoal: 'Help people choose website development' },
  evidence: { property, pageUrl, facts: [{ id: 'P1', kind: 'page', label: 'Page title', text: 'Website development' }], current: { queries: [] }, previous: { queries: [] } },
  diagnostics: { facts: [] }, research: { status: 'available', sources: [{ id: 'W1', title: 'Public source', url: 'https://source.test/' }] },
  provenance: { property, pageUrl, websiteRunId: 'site-one', contentFingerprint: 'content-one', generatedAt: '2026-10-10T10:00:00.000Z', reviewVersion: 6 }, ...overrides,
});
const getRequest = (url = pageUrl, uid = 'alice', identity = '') => new Request(`https://app.test/api/page-review/plan?pageUrl=${encodeURIComponent(url)}${identity}`, { headers: uid ? { Authorization: `Bearer ${uid}` } : {} });
const updateRequest = (body, uid = 'alice') => new Request('https://app.test/api/page-review/plan', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid}` } : {}) }, body: JSON.stringify({ pageUrl, ...body }) });
const at = n => `2026-10-10T09:00:0${n}.000Z`;
const savedRecords = () => [...records].filter(([path]) => path.startsWith('pageReviewPlans/'));

beforeEach(async () => {
  reset(); delete process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST;
  for (const userId of ['alice', 'bob']) {
    await db.collection('onboarding').doc(userId).set({ isComplete: true, gscProperty: property, revampRunId: 'site-one' });
    await db.collection('users').doc(userId).set({ gscSiteUrl: property, gscAccessToken: 'stored-test-token', gscExpiresAt: 0 });
  }
});

describe('saved page-review plans', () => {
  it('restores the same saved assessment and prioritized tasks without Google or AI', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network is forbidden'));
    try {
      expect(await readPageReviewPlan('alice', pageUrl)).toBeNull();
      const plan = await savePageReviewPlan('alice', review(), { startedAt: at(0) });
      const response = await GET(getRequest());
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect((await response.json()).plan).toEqual(plan);
      expect(plan).toMatchObject({ property, pageUrl, websiteRunId: 'site-one', revision: 1 });
      expect(plan.tasks[0]).toMatchObject({ priority: 'first', status: 'todo', contentFingerprint: 'content-one', recommendation: { label: 'Clarify the main service' }, facts: [{ id: 'P1' }], sources: [{ id: 'W1' }] });
      expect(plan).not.toHaveProperty('userId'); expect(JSON.stringify(plan)).not.toContain('stored-test-token');
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it('rejects unauthenticated and cross-account requests before any storage work', async () => {
    await savePageReviewPlan('alice', review(), { startedAt: at(0) });
    const before = [...records];
    expect((await GET(getRequest(pageUrl, null))).status).toBe(401);
    expect((await GET(getRequest(pageUrl, 'invalid'))).status).toBe(401);
    expect((await GET(getRequest(pageUrl, 'alice', '&userId=bob'))).status).toBe(403);
    expect((await POST(updateRequest({ userId: 'bob' }))).status).toBe(403);
    expect([...records]).toEqual(before);
  });

  it('isolates users, exact path casing/query strings, properties and rebuilt website runs', async () => {
    await savePageReviewPlan('alice', review(), { startedAt: at(0) });
    expect(await readPageReviewPlan('bob', pageUrl)).toBeNull();
    expect(await readPageReviewPlan('alice', pageUrl.replace('Services', 'services'))).toBeNull();
    expect(await readPageReviewPlan('alice', pageUrl.replace('Topic=Web', 'Topic=Other'))).toBeNull();
    await db.collection('onboarding').doc('alice').update({ revampRunId: 'site-two' });
    expect(await readPageReviewPlan('alice', pageUrl)).toBeNull();
    expect(savedRecords()).toHaveLength(1);
    await expect(savePageReviewPlan('alice', review(), { startedAt: at(1) })).rejects.toMatchObject({ status: 409 });
    await expect(readPageReviewPlan('alice', 'https://other.test/')).rejects.toMatchObject({ status: 403 });
    await db.collection('onboarding').doc('alice').update({ gscProperty: 'https://other.test/' });
    await expect(readPageReviewPlan('alice', pageUrl)).rejects.toMatchObject({ status: 409 });
  });

  it.each(['invalid', 'javascript:alert(1)', `${pageUrl}#details`, 'https://user:secret@example.test/'])('rejects unsafe page URL %s', async url => {
    expect((await GET(getRequest(url))).status).toBe(400);
  });

  it('keeps an omitted useful link task and its original evidence beside a newer heading task', async () => {
    const link = rec({ type: 'internal_link', targetUrl: `${property}web`, currentQuote: 'Our services', location: 'Service card', label: 'Link to service details', benefit: 'navigation', significance: 'supporting' });
    const first = await savePageReviewPlan('alice', review([link]), { startedAt: at(0) });
    const secondReview = review(); secondReview.evidence.facts[0].text = 'New review observation';
    const second = await savePageReviewPlan('alice', secondReview, { startedAt: at(1) });
    expect(second.tasks).toHaveLength(2);
    expect(second.tasks[0].recommendation.type).toBe('heading');
    expect(second.tasks[1]).toMatchObject({ id: first.tasks[0].id, status: 'todo', priority: 'optional', facts: [{ text: 'Website development' }] });
  });

  it('marks omitted tasks for rechecking when the page content changes, and revalidates matching pending tasks', async () => {
    const first = await savePageReviewPlan('alice', review(), { startedAt: at(0) });
    const changed = review([], { provenance: { ...review().provenance, contentFingerprint: 'content-two' } });
    const second = await savePageReviewPlan('alice', changed, { startedAt: at(1) });
    expect(second.tasks[0]).toMatchObject({ id: first.tasks[0].id, status: 'needs_review', contentFingerprint: 'content-one', priority: 'next' });
    const third = await savePageReviewPlan('alice', review([rec()], { provenance: changed.provenance }), { startedAt: at(2) });
    expect(third.tasks).toHaveLength(1);
    expect(third.tasks[0]).toMatchObject({ status: 'todo', contentFingerprint: 'content-two' });
  });

  it('matches a unique unchanged excerpt despite a paraphrased location, without merging different excerpts', async () => {
    const first = await savePageReviewPlan('alice', review(), { startedAt: at(0) });
    const paraphrased = await savePageReviewPlan('alice', review([rec({ location: 'Hero heading' })]), { startedAt: at(1) });
    expect(paraphrased.tasks).toHaveLength(1); expect(paraphrased.tasks[0].id).toBe(first.tasks[0].id);
    const different = await savePageReviewPlan('alice', review([rec({ location: 'Hero heading', currentQuote: 'A different heading' })]), { startedAt: at(2) });
    expect(different.tasks).toHaveLength(2);
    expect(different.tasks.map(task => task.recommendation.currentQuote)).toEqual(['A different heading', 'Local services']);
  });

  it('does not guess which task to replace when an excerpt matches multiple earlier actions', async () => {
    const first = await savePageReviewPlan('alice', review([rec({ location: 'Top of page' }), rec({ location: 'Footer', significance: 'supporting' })]), { startedAt: at(0) });
    expect(first.tasks).toHaveLength(2);
    const ambiguous = await savePageReviewPlan('alice', review([rec({ location: 'Section heading' })]), { startedAt: at(1) });
    expect(ambiguous.tasks).toHaveLength(3);
  });

  it('keeps equivalent metadata tasks stable when the model changes the field label', async () => {
    const metadata = rec({ type: 'metadata', location: 'Page description', currentQuote: 'Old description', proposedText: null });
    const firstReview = review([metadata], { title: 'Same title', description: 'New description' });
    firstReview.analysis.changedFields = ['description'];
    const first = await savePageReviewPlan('alice', firstReview, { startedAt: at(0) });
    const secondReview = structuredClone(firstReview); secondReview.analysis.recommendations[0].location = 'Meta description setting';
    const second = await savePageReviewPlan('alice', secondReview, { startedAt: at(1) });
    expect(second.tasks).toHaveLength(1); expect(second.tasks[0].id).toBe(first.tasks[0].id);
  });

  it('preserves completion during reanalysis, never records a published SEO change and rejects stale checklist writes', async () => {
    const first = await savePageReviewPlan('alice', review(), { startedAt: at(0) });
    const response = await POST(updateRequest({ taskId: first.tasks[0].id, status: 'done', revision: first.revision }));
    expect(response.status).toBe(200); const updated = (await response.json()).plan;
    expect(updated.tasks[0].status).toBe('done'); expect(updated.revision).toBe(2);
    expect((await POST(updateRequest({ taskId: first.tasks[0].id, status: 'dismissed', revision: first.revision }))).status).toBe(409);
    const third = await savePageReviewPlan('alice', review([rec({ proposedText: 'A different new heading' })]), { startedAt: at(1) });
    expect(third.tasks).toHaveLength(1); expect(third.tasks[0]).toEqual(updated.tasks[0]);
    expect([...records.keys()].filter(path => !['onboarding/', 'users/', 'pageReviewPlans/'].some(prefix => path.startsWith(prefix)))).toEqual([]);
  });

  it('preserves dismissed tasks and only reopens them when the owner explicitly asks', async () => {
    const first = await savePageReviewPlan('alice', review(), { startedAt: at(0) });
    const dismissed = await updatePageReviewTask('alice', pageUrl, first.tasks[0].id, 'dismissed', first.revision);
    const newer = await savePageReviewPlan('alice', review(), { startedAt: at(1) });
    expect(newer.tasks[0].status).toBe('dismissed');
    const reopened = await updatePageReviewTask('alice', pageUrl, newer.tasks[0].id, 'todo', newer.revision);
    expect(reopened.tasks[0].status).toBe('todo'); expect(reopened.revision).toBe(dismissed.revision + 2);
  });

  it('rejects older generation finishing last, preserves task revisions, and orders simultaneous starts by transaction commits', async () => {
    const newest = await savePageReviewPlan('alice', review(), { startedAt: at(2) });
    await expect(savePageReviewPlan('alice', review([]), { startedAt: at(1) })).rejects.toMatchObject({ status: 409 });
    expect(await readPageReviewPlan('alice', pageUrl)).toEqual(newest);
    const simultaneous = await savePageReviewPlan('alice', review(), { startedAt: at(2) });
    expect(simultaneous.revision).toBe(2); expect(simultaneous.tasks).toHaveLength(1);
  });

  it('keeps distinct destinations and locations, preserves metadata wording after a newer keep decision', async () => {
    const metadata = rec({ type: 'metadata', location: 'SEO settings', currentQuote: 'Old title', proposedText: null, label: 'Update the title', benefit: 'search_snippet' });
    const first = await savePageReviewPlan('alice', review([metadata], { title: 'Suggested title', description: 'Suggested description' }), { startedAt: at(0) });
    const links = [rec({ type: 'internal_link', location: 'Service card', targetUrl: `${property}one` }), rec({ type: 'internal_link', location: 'Service card', targetUrl: `${property}two` }), rec({ type: 'internal_link', location: 'Footer', targetUrl: `${property}one` })];
    const next = await savePageReviewPlan('alice', review(links), { startedAt: at(1) });
    expect(next.tasks).toHaveLength(4);
    expect(next.tasks.find(task => task.id === first.tasks[0].id).draft).toEqual({ title: 'Suggested title', description: 'Suggested description' });
  });

  it('bounds only the saved large search sample while retaining facts and useful tasks, and fails safely on an oversized plan', async () => {
    const manyQueries = review(); manyQueries.evidence.current.queries = Array.from({ length: 1000 }, (_, i) => ({ query: `Query ${i}` }));
    const first = await savePageReviewPlan('alice', manyQueries, { startedAt: at(0) });
    expect(first.review.evidence.current.queries).toHaveLength(40);
    expect(first.review.evidence.current.queryCoverage).toMatchObject({ savedSample: true, savedRows: 40 });
    expect(first.tasks[0].facts).toHaveLength(1);
    const tooLarge = review(); tooLarge.currentPage = { mainContent: 'x'.repeat(900000) };
    await expect(savePageReviewPlan('alice', tooLarge, { startedAt: at(1) })).rejects.toMatchObject({ status: 409 });
    expect(await readPageReviewPlan('alice', pageUrl)).toEqual(first);
  });

  it('rejects unknown task IDs, invalid state/revision and task writes in another account', async () => {
    const plan = await savePageReviewPlan('alice', review(), { startedAt: at(0) });
    expect((await POST(updateRequest({ taskId: 'a'.repeat(64), status: 'done', revision: 1 }))).status).toBe(404);
    expect((await POST(updateRequest({ taskId: plan.tasks[0].id, status: 'published', revision: 1 }))).status).toBe(400);
    expect((await POST(updateRequest({ taskId: plan.tasks[0].id, status: 'done' }))).status).toBe(400);
    expect((await POST(updateRequest({ taskId: plan.tasks[0].id, status: 'done', revision: 1 }, 'bob'))).status).toBe(404);
    expect(await readPageReviewPlan('alice', pageUrl)).toEqual(plan);
  });

  it.each([{ revampArchivePending: 'pending' }, { revampStatus: 'in-progress' }, { isComplete: false }])('preserves saved work while setup is changing: %j', async change => {
    const plan = await savePageReviewPlan('alice', review(), { startedAt: at(0) });
    await db.collection('onboarding').doc('alice').update(change);
    expect(await readPageReviewPlan('alice', pageUrl)).toEqual(plan);
    await expect(savePageReviewPlan('alice', review(), { startedAt: at(1) })).rejects.toMatchObject({ status: 409 });
    await expect(updatePageReviewTask('alice', pageUrl, plan.tasks[0].id, 'done', plan.revision)).rejects.toMatchObject({ status: 409 });
    expect(await readPageReviewPlan('alice', pageUrl)).toEqual(plan);
  });

  it('sets no-store on error responses as well as successful plans', async () => {
    const response = await GET(getRequest(pageUrl, null));
    expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
