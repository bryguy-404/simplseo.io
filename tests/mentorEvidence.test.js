import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  const fake = fakeFirestore(), transact = fake.db.runTransaction;
  let queue = Promise.resolve();
  fake.db.runTransaction = fn => { const next = queue.then(() => transact(fn)); queue = next.catch(() => {}); return next; };
  return fake;
});
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn() }));
vi.mock('../app/lib/server/pageReviewEvidence', () => ({ collectPageReviewEvidence: vi.fn() }));
vi.mock('../app/lib/server/scrapeContent', () => ({ fetchCurrentPageContent: vi.fn() }));
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { businessProfileKey } from '../app/lib/server/businessProfile';
import { newPageScopeKey } from '../app/lib/server/newPageScope';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { fetchCurrentPageContent } from '../app/lib/server/scrapeContent';
import { collectPageReviewEvidence } from '../app/lib/server/pageReviewEvidence';
import { readMentorAccountScope, assertMentorAccountScope, assertMentorEvidenceRevisions, executeMentorEvidenceTool, readMentorWorkspaceContext, runMentorCheck, MENTOR_EVIDENCE_TOOLS } from '../app/lib/server/mentorEvidence';
import { MENTOR_SYSTEM, MENTOR_ANSWER_FORMAT, mentorInputBound, MENTOR_LIMITS } from '../app/lib/mentorPolicy';
import { GOOGLE_GUIDANCE_TOOL } from '../app/lib/mentorDocumentationPolicy';
import { projectMentorCycle, projectMentorTechnical, mentorProjection } from '../app/lib/server/mentorEvidenceProjection';
import { readPageReviewPlan } from '../app/lib/server/pageReviewPlans';
import { newOngoingCycle, readOngoingCycle } from '../app/lib/server/ongoingProgress';
import { readNewPagePlan } from '../app/lib/server/newPagePlanning';
import { mentorHash } from '../app/lib/server/mentorAccountScope';
import { readSavedMentorActivity, refreshSavedMentorActivity, readSharedDashboardOverview } from '../app/lib/server/mentorActivitySnapshots';
import { searchWindow } from '../app/lib/searchWindow';

const site = 'https://example.test/';
const identity = { property: 'sc-domain:example.test', websiteUrl: site, websiteRunId: 'run1' };
const at = new Date('2026-10-11T12:00:00.000Z');
const metrics = { clicks: 6, impressions: 142, ctr: 6 / 142, position: 12.5 };
const period = () => ({ totals: metrics, totalsStatus: 'available', queriesStatus: 'available', queries: [{ query: 'plumber', ...metrics }] });
const evidence = () => ({ property: identity.property, pageUrl: site, fetchedAt: at.toISOString(), window: searchWindow('28', at),
  previousWindow: { startDate: '2026-08-13', endDate: '2026-09-09' }, current: period(), previous: period(), status: 'available', history: [], limitations: [] });
function seed() {
  records.set('users/u1', { gscSiteUrl: identity.property, gscRefreshToken: 'SECRET' });
  records.set('onboarding/u1', { isComplete: true, gscProperty: identity.property, websiteUrl: site, revampRunId: 'run1' });
  records.set(`users/u1/businessProfiles/${businessProfileKey(identity)}`, { revision: 2, scope: identity, confirmedAt: at.toISOString(),
    profile: { businessName: 'Service Company', services: ['Plumbing'], baseLocation: { city: 'South Bend' }, serviceAreas: ['South Bend'] } });
  const key = newPageScopeKey({ userId: 'u1', ...identity });
  records.set(`newPageInventories/${key}`, { userId: 'u1', scope: { userId: 'u1', ...identity }, generation: 'g1', revision: 1,
    initialized: true, limitations: [], sitemaps: [], googleStatus: 'reviewed', robotsStatus: 'reviewed' });
  records.set(`newPageInventories/${key}/pages/home`, { url: site, status: 'fetched', generation: 'g1', observedAt: at.toISOString(),
    content: { htmlTitle: 'Plumbing', textContent: 'First party plumbing evidence.' } });
}
beforeEach(() => {
  reset(); vi.clearAllMocks(); seed();
  collectPageReviewEvidence.mockResolvedValue(evidence());
  getGscConnection.mockResolvedValue({ siteUrl: identity.property, query: vi.fn(async body => ({ rows: body.dimensions ? [] : [metrics] })),
    inspect: vi.fn(async () => ({ inspectionResult: { indexStatusResult: { verdict: 'PASS', lastCrawlTime: '2026-10-01T00:00:00Z' } } })) });
  fetchCurrentPageContent.mockResolvedValue({ htmlTitle: 'Plumber', h1: 'Plumbing', finalUrl: site, fetchedAt: at.toISOString(),
    technical: { httpStatus: 200 }, structuralLimitations: ['HTML, not a live Google test.'] });
});

describe('stored mentor evidence', () => {
  it('bounds the actual-shaped homepage tool round without losing saved edits, metrics or task status', async () => {
    const scope = await readMentorAccountScope('u1');
    const key = mentorHash(['u1', identity.property, site, 'run1']);
    const originalCopy = 'Replace this original generated sentence.';
    const editedCopy = 'Owner edit: Request an estimate for residential plumbing in South Bend.';
    const recommendations = ['heading', 'content', 'internal_link'].map((type, index) => ({
      type, basis: 'opportunity', label: `Useful saved improvement ${index + 1}`, location: 'Services section',
      reason: 'The saved page can clarify the service and give visitors a useful next step. '.repeat(5),
      instruction: 'Explain this verified service in the existing section, without making unsupported claims. '.repeat(6),
      proposedText: originalCopy, targetUrl: index === 2 ? `${site}services/plumbing` : null,
    }));
    records.set(`pageReviewPlans/${key}`, { userId: 'u1', ...identity, pageUrl: site, revision: 4, updatedAt: at.toISOString(),
      review: { analysis: { action: 'content_first', metadataVerdict: 'keep', summary: 'Improve the existing service information.',
        nextStep: 'Use the first saved task.', searchFocus: { phrase: 'plumber South Bend', source: 'observed', intent: 'service', reason: 'Relevant to the confirmed service area.' },
        recommendations, strategy: { evidence: 'Duplicated strategy evidence. '.repeat(150) } } },
      tasks: recommendations.map((recommendation, index) => ({ id: `task-${index}`, recommendation,
        status: index === 0 ? 'done' : 'todo', priority: index + 1, draft: editedCopy,
        facts: { fullPage: 'Repeated page and query evidence. '.repeat(200) },
        ...(index === 0 ? { publication: { implementedAt: '2026-09-01T12:00:00Z', cycleId: 'cycle-1' } } : {}) })) });
    const inventoryKey = newPageScopeKey({ userId: 'u1', ...identity });
    records.get(`newPageInventories/${inventoryKey}/pages/home`).content = { htmlTitle: 'Plumbing in South Bend',
      seoMetaDescription: 'Residential plumbing and repair services in South Bend.', textContent: 'Verified service information. '.repeat(400),
      headings: Array.from({ length: 12 }, (_, index) => ({ tag: index ? 'h2' : 'h1', text: `Service section ${index}`,
        segments: ['Repeated structural and page context. '.repeat(120)], sectionText: 'Long page subsection. '.repeat(100) })) };
    const saved = evidence();
    for (const period of [saved.current, saved.previous]) period.queries = Array.from({ length: 20 }, (_, index) => ({
      query: `Reported plumbing query ${index}`, clicks: index === 15 ? 2 : 0, impressions: 3, ctr: 0, position: 12.5 }));
    collectPageReviewEvidence.mockResolvedValue(saved);
    await refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: at });
    vi.clearAllMocks();
    const before = structuredClone([...records]);
    const visible = result => { const { evidenceRevisions: _refs, ...data } = result; return data; };
    const business = visible(await executeMentorEvidenceTool('u1', scope, 'read_business_context', {}));
    const page = visible(await executeMentorEvidenceTool('u1', scope, 'mentor_page_evidence', { pageUrl: site }));
    const work = visible(await executeMentorEvidenceTool('u1', scope, 'mentor_page_work', { pageUrl: site }));
    const request = { model: 'gpt-6.1-sol', store: false, service_tier: 'default', reasoning: { effort: 'low' },
      max_output_tokens: 1800, include: ['reasoning.encrypted_content'], text: { format: MENTOR_ANSWER_FORMAT },
      tools: [...MENTOR_EVIDENCE_TOOLS, GOOGLE_GUIDANCE_TOOL], parallel_tool_calls: true,
      input: [{ role: 'developer', content: MENTOR_SYSTEM }, { role: 'user', content: JSON.stringify({
        question: 'How is my homepage doing, and what should I do next?', selection: { pageUrl: site }, savedBusiness: business }) },
      ...[['mentor_page_evidence', page], ['mentor_page_work', work]].flatMap(([name, result], index) => [
        { type: 'function_call', call_id: `call-${index}`, name, arguments: JSON.stringify({ pageUrl: site }) },
        { type: 'function_call_output', call_id: `call-${index}`, output: JSON.stringify(result) }])] };
    expect(mentorInputBound(request)).toBeLessThan(18000);
    const withDocumentation = { ...request, tools: undefined, parallel_tool_calls: undefined, max_output_tokens: 2600, input: [...request.input,
      { type: 'function_call', call_id: 'docs', name: 'read_google_guidance', arguments: JSON.stringify({ topic: 'Search performance and useful improvements' }) },
      { type: 'function_call_output', call_id: 'docs', output: JSON.stringify({
        sources: [{ id: 'google-guidance', title: 'Google Search guidance', url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
          excerpt: 'Reviewed documentation excerpt. '.repeat(90), retrievedAt: at.toISOString() }] }) }] };
    // The final no-tools request still fits after the real first call used
    // 1,355 input tokens and a representative second call used 4,000.
    // This uses the unchanged complete-request byte bound, not a token guess.
    expect(mentorInputBound(withDocumentation)).toBeLessThan(MENTOR_LIMITS.inputTokens - 1355 - 4000);
    expect(work.data.plan.tasks[0].draft).toBe(editedCopy);
    expect(work.data.plan.tasks[0].recommendation.proposedText).toBe(originalCopy);
    expect(work.data.plan.tasks[0].publication.implementedAt).toBe('2026-09-01T12:00:00Z');
    expect(work.data.plan.taskStatusCounts).toEqual({ done: 1, todo: 2 });
    expect(work.data.plan.projection.excerptedFields).toContain('tasks[0].recommendation.instruction');
    expect(page.data.activity.current.totals).toEqual(metrics);
    expect(page.data.activity.current.savedQueryCount).toBe(20);
    expect(page.data.activity.current.queriesLimited).toBe(true);
    expect(page.data.activity.current.queries[0].clicks).toBe(2);
    expect(page.data.page.projection.partialExcerpt).toBe(true);
    expect([...records]).toEqual(before);
    [getGscConnection, collectPageReviewEvidence, fetchCurrentPageContent].forEach(mock => expect(mock).not.toHaveBeenCalled());
  });

  it('retains mixed-version cautions and failed technical observations in compact evidence', () => {
    const cycle = projectMentorCycle({ id: 'cycle', lifecycle: 'superseded', confirmedAt: '2026-09-01',
      previousCycleId: 'earlier', supersededAt: '2026-09-15', confirmation: { interveningChange: true, searchFocus: { phrase: 'plumber South Bend' } },
      latestCheckpoint: { day: 28, lowVolume: true, source: 'google_search_console', limitation: 'Another edit affected this period.',
        baseline: { clicks: 0, queriesStatus: 'unavailable' }, post: { clicks: 1, queriesStatus: 'available' } },
      technical: { checkedAt: at.toISOString(), errors: { indexing: 'unavailable' },
        issues: [{ code: 'noindex', stale: true, checkedAt: '2026-09-15' }], publicPage: { status: 'available', noindex: true },
        indexing: { status: 'available', lastCrawlTime: '2026-09-01' } } });
    expect(cycle.confirmation.interveningChange).toBe(true);
    expect(cycle.supersededAt).toBe('2026-09-15');
    expect(cycle.latestCheckpoint).toMatchObject({ lowVolume: true, limitation: 'Another edit affected this period.', baseline: { clicks: 0, queriesStatus: 'unavailable' } });
    expect(cycle.technical).toMatchObject({ errors: { indexing: 'unavailable' }, issues: [{ code: 'noindex', stale: true }] });
    const check = projectMentorTechnical({ lastError: 'Partial check', result: { website: { status: 'available', technical: { noindex: true } } },
      failedObservation: { website: { status: 'unavailable', httpStatus: 404 }, indexing: { status: 'unavailable' } } });
    expect(check.result.website.technical.noindex).toBe(true);
    expect(check.failedObservation).toMatchObject({ website: { status: 'unavailable', httpStatus: 404 }, indexing: { status: 'unavailable' } });
    const address = `https://example.test/${'long-path'.repeat(35)}`;
    expect(mentorProjection({ targetUrl: address }).value.targetUrl).toBe(address);
  });
  it('reads account context and pages without any external calls or writes', async () => {
    const scope = await readMentorAccountScope('u1'), before = structuredClone([...records]);
    const profile = await executeMentorEvidenceTool('u1', scope, 'read_business_context', {});
    const workspace = await readMentorWorkspaceContext('u1', scope);
    const page = await executeMentorEvidenceTool('u1', scope, 'mentor_page_evidence', { pageUrl: site });
    expect(profile.data.profile.businessName).toBe('Service Company');
    expect(workspace.pageOptions).toContainEqual({ url: site, title: 'Plumbing' });
    expect(page.data.page.content).toContain('First party');
    expect(page.data.activity).toBeNull();
    expect(JSON.stringify({ scope, profile, page })).not.toContain('SECRET');
    expect([...records]).toEqual(before);
    [getGscConnection, collectPageReviewEvidence, fetchCurrentPageContent].forEach(mock => expect(mock).not.toHaveBeenCalled());
  });

  it('rejects cross-account resource ids and browser-injected identity or metrics', async () => {
    const scope = await readMentorAccountScope('u1');
    records.set('newPagePlans/other', { userId: 'other', ...identity, draft: 'PRIVATE' });
    await expect(executeMentorEvidenceTool('u1', scope, 'mentor_new_page_work', { planId: 'other' })).rejects.toMatchObject({ status: 404 });
    await expect(executeMentorEvidenceTool('u1', scope, 'mentor_page_evidence', { pageUrl: site, userId: 'other' })).rejects.toMatchObject({ status: 400 });
    await expect(executeMentorEvidenceTool('u1', scope, 'mentor_page_evidence', { pageUrl: 'https://private.example.test/' })).rejects.toMatchObject({ status: 403 });
  });

  it.each(['profile', 'website', 'version', 'deletion'])('rejects stale %s identities without refreshing providers', async kind => {
    const scope = await readMentorAccountScope('u1');
    if (kind === 'deletion') records.delete('users/u1');
    else if (kind === 'profile') records.get(`users/u1/businessProfiles/${businessProfileKey(identity)}`).revision++;
    else records.get('onboarding/u1')[kind === 'website' ? 'websiteUrl' : 'revampRunId'] = 'changed';
    await expect(assertMentorAccountScope('u1', scope)).rejects.toMatchObject({ status: 409 });
    expect(getGscConnection).not.toHaveBeenCalled();
  });

  it('keeps website-version plans separate and preserves saved tasks/dates', async () => {
    const scope = await readMentorAccountScope('u1');
    const key = mentorHash(['u1', identity.property, site, 'run1']);
    records.set(`pageReviewPlans/${key}`, { userId: 'u1', ...identity, pageUrl: site, revision: 4,
      updatedAt: at.toISOString(), tasks: [{ id: 't1', status: 'done', publication: { implementedAt: '2026-09-01' } }] });
    records.set('pageProgressCycles/c1', { userId: 'u1', ...identity, pageUrl: site, confirmedAt: '2026-09-01', lifecycle: 'active', nextReviewAt: '2026-11-01' });
    records.set('pageProgressCycles/old', { userId: 'u1', ...identity, websiteRunId: 'old', pageUrl: site, confirmedAt: '2000-01-01' });
    const before = structuredClone([...records]);
    const result = await executeMentorEvidenceTool('u1', scope, 'mentor_page_work', { pageUrl: site });
    expect(result.data.plan.tasks[0].publication.implementedAt).toBe('2026-09-01');
    expect(result.data.cycles).toHaveLength(1); expect(result.data.cycles[0].confirmedAt).toBe('2026-09-01');
    expect([...records]).toEqual(before);
  });

  it('matches the real stored plan and cycle readers and guards changes made during generation', async () => {
    const scope = await readMentorAccountScope('u1'), key = mentorHash(['u1', identity.property, site, 'run1']);
    const plan = { userId: 'u1', ...identity, pageUrl: site, revision: 4, tasks: [
      { id: 't1', status: 'done', recommendation: { type: 'content', label: 'Clarify service' }, draft: 'Owner edited text' },
    ] };
    records.set(`pageReviewPlans/${key}`, plan);
    const cycle = newOngoingCycle({ userId: 'u1', gscProperty: identity.property, websiteRunId: 'run1', pageUrl: site,
      implementedAt: '2026-09-01T12:00:00.000Z', confirmedTaskIds: ['t1'], sourcePlanId: key, sourcePlanRevision: 4 }, plan, { now: at });
    cycle.latestCheckpointId = 'day-28'; cycle.latestCheckpoint = { evidenceRevision: 1, day: 28, baseline: { clicks: 1 }, post: { clicks: 3 } };
    cycle.latestDecisionId = 'decision1'; cycle.latestDecision = { decision: 'keep_monitoring' };
    records.set(`pageProgressCycles/${cycle.id}`, cycle);
    const [readerPlan, readerCycle, result] = await Promise.all([readPageReviewPlan('u1', site), readOngoingCycle('u1', cycle.id),
      executeMentorEvidenceTool('u1', scope, 'mentor_page_work', { pageUrl: site })]);
    expect(result.data.plan.tasks).toEqual(readerPlan.tasks);
    expect(result.data.cycles[0].latestCheckpoint.post.clicks).toBe(readerCycle.latestCheckpoint.post.clicks);
    expect(result.data.cycles[0].latestDecision).toEqual(readerCycle.latestDecision);
    await assertMentorEvidenceRevisions('u1', scope, result.evidenceRevisions);
    records.get(`pageProgressCycles/${cycle.id}`).lastAttemptAt = new Date().toISOString();
    records.get(`pageProgressCycles/${cycle.id}`).revision++;
    await assertMentorEvidenceRevisions('u1', scope, result.evidenceRevisions);
    records.get(`pageReviewPlans/${key}`).revision++;
    await expect(assertMentorEvidenceRevisions('u1', scope, result.evidenceRevisions)).rejects.toMatchObject({ status: 409 });
  });

  it('invalidates new checkpoint evidence, not timestamp-only checks', async () => {
    const scope = await readMentorAccountScope('u1');
    const cycle = newOngoingCycle({ userId: 'u1', gscProperty: identity.property, websiteRunId: 'run1', pageUrl: site,
      implementedAt: '2026-09-01T12:00:00.000Z', confirmedTaskIds: [] }, null, { now: at });
    records.set(`pageProgressCycles/${cycle.id}`, cycle);
    const result = await executeMentorEvidenceTool('u1', scope, 'mentor_page_work', { pageUrl: site });
    records.get(`pageProgressCycles/${cycle.id}`).latestCheckpointId = 'day-28';
    await expect(assertMentorEvidenceRevisions('u1', scope, result.evidenceRevisions)).rejects.toMatchObject({ status: 409 });
  });

  it('hydrates actual new-page plan and publication shapes without exposing private bookkeeping', async () => {
    const scope = await readMentorAccountScope('u1');
    records.set('newPagePlans/plan1', { userId: 'u1', ...identity, revision: 2, status: 'published', publicationId: 'pub1',
      context: { area: { name: 'South Bend' }, services: ['Plumbing'] }, idea: { topic: 'Emergency plumbing' },
      draft: { seoTitle: 'Owner edited title', h1: 'Plumbing help', sections: [{ heading: 'When to call', body: 'Owner copy' }] } });
    records.set('newPagePublications/pub1', { id: 'pub1', userId: 'u1', ...identity, planId: 'plan1', pageUrl: `${site}emergency`,
      verifiedAt: at.toISOString(), ownerDeclaredAt: at.toISOString(), publicPage: { status: 'available' },
      indexing: { status: 'not_indexed', observedAt: at.toISOString() }, activity: { clicks: 0, impressions: 0 }, leaseId: 'PRIVATE_LEASE' });
    const read = await readNewPagePlan('u1', 'plan1');
    const result = await executeMentorEvidenceTool('u1', scope, 'mentor_new_page_work', { planId: 'plan1' });
    expect(result.data.draft).toEqual(read.plan.draft);
    expect(result.data.publications[0].verifiedAt).toBe(read.publication.verifiedAt);
    expect(result.data.publications[0].indexing).toEqual(read.tracking.indexing);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_LEASE');
    await assertMentorEvidenceRevisions('u1', scope, result.evidenceRevisions);
    records.get('newPagePublications/pub1').indexing.status = 'indexed';
    await expect(assertMentorEvidenceRevisions('u1', scope, result.evidenceRevisions)).rejects.toMatchObject({ status: 409 });
  });
});

describe('shared saved search activity', () => {
  it('reuses six-hour snapshots and explicit fifteen-minute cooldown without a provider request', async () => {
    const scope = await readMentorAccountScope('u1');
    await refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: at });
    await refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: new Date(+at + 1000), force: true });
    await refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: new Date(+at + 3600000) });
    const saved = await readSavedMentorActivity('u1', scope, { pageUrl: site, now: at });
    expect(saved.value.current.totals).toEqual(metrics);
    expect(collectPageReviewEvidence).toHaveBeenCalledTimes(1);
    expect(collectPageReviewEvidence.mock.calls[0][1]).toMatchObject({ includeHistory: false, property: identity.property });
  });

  it('saves the dashboard collector’s exact totals without deriving them from query rows', async () => {
    const scope = await readMentorAccountScope('u1');
    const dashboard = await readSharedDashboardOverview('u1', { now: at });
    const saved = await readSavedMentorActivity('u1', scope, { now: at });
    expect(saved.value.totals).toEqual(dashboard.totals); expect(dashboard.totals).toEqual(metrics);
    expect(dashboard.pages).toEqual([]);
    expect(dashboard.window).toEqual(searchWindow('28', at));
  });

  it('preserves a previous successful observation on failed checks', async () => {
    const scope = await readMentorAccountScope('u1');
    await refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: at });
    collectPageReviewEvidence.mockRejectedValue(Error('unavailable'));
    const next = await refreshSavedMentorActivity('u1', scope, { pageUrl: site, force: true, now: new Date(+at + 3600000) });
    expect(next.lastError).toBeTruthy(); expect(next.value.current.totals.clicks).toBe(6);
    expect(next.lastSuccessAt).toBe(at.toISOString());
  });

  it('retains dated successful data when the rolling window advances and a new check fails', async () => {
    const scope = await readMentorAccountScope('u1');
    await refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: at });
    const tomorrow = new Date(+at + 86400000);
    expect((await readSavedMentorActivity('u1', scope, { pageUrl: site, now: tomorrow })).value.window).toEqual(searchWindow('28', at));
    collectPageReviewEvidence.mockRejectedValue(Error('Google is unavailable'));
    const failed = await refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: tomorrow });
    expect(failed.value.fetchedAt).toBe(at.toISOString());
    expect(failed.lastAttemptAt).toBe(tomorrow.toISOString());
    expect(failed.lastSuccessAt).toBe(at.toISOString());
  });

  it('shares concurrent collection leases and prevents deletion-in-flight resurrection', async () => {
    const scope = await readMentorAccountScope('u1');
    let finish; collectPageReviewEvidence.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: new Date() });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const second = await refreshSavedMentorActivity('u1', scope, { pageUrl: site, now: new Date() });
    expect(second.pending).toBe(true); expect(collectPageReviewEvidence).toHaveBeenCalledTimes(1);
    records.delete('users/u1');
    for (const key of [...records.keys()]) if (key.startsWith('mentorActivitySnapshots/')) records.delete(key);
    finish(evidence());
    await expect(first).rejects.toMatchObject({ status: 409 });
    expect([...records.keys()].some(key => key.startsWith('mentorActivitySnapshots/'))).toBe(false);
  });
});

describe('explicit mentor checks', () => {
  it('checks one page, distinguishes stored indexing from live HTML, and shares a cooldown', async () => {
    const scope = await readMentorAccountScope('u1');
    const result = await runMentorCheck('u1', scope, { kind: 'technical', pageUrl: site }, { now: at });
    expect(result.result.website.technical.httpStatus).toBe(200);
    expect(result.result.indexing.meaning).toContain('stored indexing');
    await runMentorCheck('u1', scope, { kind: 'technical', pageUrl: site }, { now: new Date(+at + 1000) });
    expect(fetchCurrentPageContent).toHaveBeenCalledTimes(1);
    expect(collectPageReviewEvidence).not.toHaveBeenCalled();
    expect([...records.values()].find(value => value.kind === 'mentor_check').count).toBe(1);
  });

  it('guards live technical findings and inventory revisions before a generated answer is returned', async () => {
    const scope = await readMentorAccountScope('u1');
    await runMentorCheck('u1', scope, { kind: 'technical', pageUrl: site }, { now: at });
    const result = await executeMentorEvidenceTool('u1', scope, 'mentor_page_evidence', { pageUrl: site });
    const ref = result.evidenceRevisions.find(value => value.kind === 'technical');
    expect(ref).toBeTruthy();
    records.get(`mentorCheckOperations/${ref.id}`).lastAttemptAt = '2027-01-01';
    records.get(`mentorCheckOperations/${ref.id}`).result.checkedAt = '2027-01-01';
    await assertMentorEvidenceRevisions('u1', scope, result.evidenceRevisions);
    records.get(`mentorCheckOperations/${ref.id}`).result.website.technical.httpStatus = 404;
    await expect(assertMentorEvidenceRevisions('u1', scope, result.evidenceRevisions)).rejects.toMatchObject({ status: 409 });
    const inventory = await executeMentorEvidenceTool('u1', scope, 'mentor_find_pages', { query: null });
    const inventoryRef = inventory.evidenceRevisions[0];
    records.get(`newPageInventories/${inventoryRef.id}`).revision++;
    await expect(assertMentorEvidenceRevisions('u1', scope, inventory.evidenceRevisions)).rejects.toMatchObject({ status: 409 });
  });

  it('enforces twenty checks and does not count cached checks again', async () => {
    const scope = await readMentorAccountScope('u1');
    const key = `requestLimits/mentor-check-${mentorHash(['u1', at.toISOString().slice(0, 10)])}`;
    records.set(key, { userId: 'u1', count: 20 });
    await expect(runMentorCheck('u1', scope, { kind: 'technical', pageUrl: site }, { now: at })).rejects.toMatchObject({ status: 429 });
    expect(fetchCurrentPageContent).not.toHaveBeenCalled();
  });

  it('does not mutate plans or publish anything when running checks', async () => {
    const scope = await readMentorAccountScope('u1');
    records.set('pageReviewPlans/saved', { userId: 'u1', ownerEdits: 'keep this', publication: '2026-01-01' });
    const original = structuredClone(records.get('pageReviewPlans/saved'));
    await runMentorCheck('u1', scope, { kind: 'activity', pageUrl: site }, { now: at });
    expect(records.get('pageReviewPlans/saved')).toEqual(original);
    await expect(runMentorCheck('u1', scope, { kind: 'technical', pageUrl: 'https://other.test/' }, { now: at })).rejects.toMatchObject({ status: 400 });
  });
});
