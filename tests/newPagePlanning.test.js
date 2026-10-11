import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), inventory: null, query: vi.fn() }));
vi.mock('openai', () => ({ default: class { constructor() { this.responses = { create: mocks.create }; } } }));
vi.mock('../app/lib/firebaseAdmin', async () => { const { fakeFirestore } = await import('./fakeFirestore'); return { ...fakeFirestore(), auth: {} }; });
vi.mock('../app/lib/server/newPageInventory', () => ({ readNewPageInventory: vi.fn(async () => structuredClone(mocks.inventory)) }));
vi.mock('../app/lib/server/newPageTracking', () => ({ readNewPageTracking: vi.fn(async () => ({ publication: null, tracking: null })) }));
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn(async () => ({ siteUrl: 'https://example.test/', query: mocks.query })) }));
vi.mock('../app/lib/server/aiUsage', () => ({ recordPageReviewResponse: vi.fn(async (_metadata, execute) => execute()) }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { publicFetch } from '../app/lib/server/publicFetch';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { recordPageReviewResponse } from '../app/lib/server/aiUsage';
import { readNewPageScope, newPageScopeKey } from '../app/lib/server/newPageScope';
import { readNewPageWorkspace, readNewPagePlan, saveNewPageContext, assessNewPageIdeas, selectNewPageIdea, editNewPagePlan, generateNewPageDraft, suggestNearbyAreas, buildNewPageBundle, suggestedNewPageServices } from '../app/lib/server/newPagePlanning';
import { consumeNewPageQuota } from '../app/lib/server/requestQuota';
import { contextKey } from '../app/components/new-pages/shared';
import { accountWebsiteScope, businessProfileRef } from '../app/lib/server/businessProfile';

const when = new Date('2026-10-10T18:00:00Z');
const context = { area: { name: 'Mishawaka', region: 'Indiana', country: 'United States' }, services: ['plumbing repairs'], facts: 'We repair plumbing in older Mishawaka homes and explain access arrangements.', confirmed: true };
const completed = value => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const research = () => ({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message', content: [{ type: 'output_text', text: 'Plumbing maintenance requires understanding the customer’s property and access needs.', annotations: [{ type: 'url_citation', url: 'https://www.mishawaka.in.gov/', title: 'Mishawaka' }] }] }] });
const idea = () => ({ outcome: 'new_page', topic: 'Plumbing repairs for older Mishawaka homes', service: context.services[0], intendedCustomer: 'Owners of older homes needing plumbing repairs', purpose: 'Explain older-home plumbing access and repair decisions', reason: 'The current page covers general repairs without explaining these distinct access decisions.',
  distinctValue: 'The owner can explain actual access arrangements and repair decisions for older Mishawaka homes.', existingPageUrl: null,
  searchFocus: { phrase: 'older home plumbing repairs mishawaka', source: 'proposed' }, requiredFacts: [], checkedPageUrls: ['https://example.test/services/plumbing'], uncertainPageUrls: [], evidenceIds: ['O1', 'P1'] });
const assessment = () => ({ outcome: 'new_page', summary: 'A focused explanation of older-home plumbing repairs could answer a separate customer need.', questions: [], ideas: [idea()] });
const draft = () => ({ title: 'Older-home plumbing repairs in Mishawaka', description: 'Discuss plumbing repairs and access arrangements for your older Mishawaka home.', h1: 'Plumbing repairs for older Mishawaka homes', slug: '/older-home-plumbing-mishawaka',
  sections: [{ id: 'access', heading: 'Plan access for the repair', body: 'We repair plumbing in older Mishawaka homes and explain access arrangements. Describe the issue and the available access when asking about a repair.' }],
  links: [{ url: 'https://example.test/services/plumbing', text: 'Plumbing repair services', placement: 'link_to' }], optionalPrompts: ['Add a real project example if you have permission to share it.'],
  claims: [{ claim: 'We repair plumbing in older Mishawaka homes.', sourceId: 'O1', quote: 'We repair plumbing in older Mishawaka homes and explain access arrangements.' }] });
const usageKinds = () => [...records.values()].filter(value => value.feature === 'new_page_planning' && value.kind).map(value => [value.kind, value.count]);
let scope;
async function seedInventory(change = {}) {
  mocks.inventory = { id: newPageScopeKey(scope), scope, revision: 1, status: 'ready', updatedAt: when.toISOString(), canContinue: false,
    coverage: { fetched: 1, discovered: 1, failed: 0, pending: 0, excluded: 0, truncated: false, limitations: [], sitemaps: [{ url: 'https://example.test/sitemap.xml', status: 'fetched', checkedAt: when.toISOString() }] },
    pages: [{ url: 'https://example.test/services/plumbing', status: 'fetched', reason: null, observedAt: when.toISOString(), sources: ['sitemap'], content: { h1: 'Plumbing repairs', htmlTitle: 'Plumbing repairs', textContent: 'General plumbing repair services. Ask our team about repairs for your property.', fetchedAt: when.toISOString() } }], ...change };
  await db.collection('newPageInventories').doc(mocks.inventory.id).set({ scope, userId: 'alice', revision: mocks.inventory.revision, leaseUntil: null });
}
async function evaluateAndSelect() {
  const { assessment: reviewed } = await assessNewPageIdeas('alice');
  const selected = await selectNewPageIdea('alice', { assessmentId: reviewed.id, ideaId: reviewed.ideas[0].id });
  return { reviewed, plan: selected.plan };
}
beforeEach(async () => {
  reset(); vi.useFakeTimers(); vi.setSystemTime(when);
  delete process.env.NEW_PAGE_GENERATION_ENABLED;
  await db.collection('users').doc('alice').set({ gscSiteUrl: 'https://example.test/', gscAccessToken: 'fixture' });
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: 'https://example.test/', websiteUrl: 'https://example.test/', revampRunId: 'current', businessName: 'Fixture Plumbing', businessLocation: 'Mishawaka, Indiana' });
  scope = await readNewPageScope('alice');
  await seedInventory(); await saveNewPageContext('alice', context);
  mocks.query.mockReset().mockResolvedValue({ rows: [] });
  mocks.create.mockReset().mockImplementation(async request => {
    const name = request.text?.format?.name;
    if (!name) return research();
    if (name === 'new_page_assessment') return completed(assessment());
    if (name === 'new_page_draft') return completed(draft());
    if (name === 'draft_evidence_audit') return completed({ supported: true, unsupportedClaims: [], duplicatesExistingPage: false, reason: 'All claims match owner facts.' });
    if (name === 'nearby_areas') return completed({ areas: [{ name: 'South Bend', region: 'Indiana', country: 'United States', reason: 'A nearby municipality to consider only if served.', sourceUrl: 'https://www.mishawaka.in.gov/' }] });
    throw new Error('Unknown model request');
  });
  publicFetch.mockReset().mockResolvedValue(new Response('', { status: 404 }));
  vi.mocked(getGscConnection).mockClear(); vi.mocked(recordPageReviewResponse).mockClear();
});
afterEach(() => { vi.useRealTimers(); delete process.env.NEW_PAGE_GENERATION_ENABLED; });

it('preserves an assessment when business facts change during a new model response', async () => {
  const first = await assessNewPageIdeas('alice');
  const saved = structuredClone([...records].find(([path]) => path.startsWith('newPageAssessments/')));
  mocks.inventory.pages[0].content.textContent += ' We also explain water shutoff access.';
  const run = mocks.create.getMockImplementation();
  mocks.create.mockImplementation(async request => {
    const result = await run(request);
    if (request.text?.format?.name === 'new_page_assessment') {
      const raw = accountWebsiteScope(records.get('onboarding/alice'), records.get('users/alice'));
      records.set(businessProfileRef('alice', raw).path, { scope: raw, revision: 1, confirmedAt: when.toISOString(), profile: {
        businessName: 'Fixture Plumbing', businessType: 'Plumber', services: ['Drain repair'], baseLocation: { city: 'Mishawaka', region: 'Indiana', country: 'United States' }, serviceAreas: ['Mishawaka'], goal: 'quotes',
      } });
    }
    return result;
  });
  await expect(assessNewPageIdeas('alice')).rejects.toMatchObject({ status: 409 });
  expect(records.get(saved[0])).toEqual(saved[1]);
  expect((await readNewPageWorkspace('alice')).assessments[0].id).toBe(first.assessment.id);
});

it('shows a profile conflict without erasing separately confirmed area services or saved plans', async () => {
  const { plan } = await evaluateAndSelect();
  const raw = accountWebsiteScope(records.get('onboarding/alice'), records.get('users/alice'));
  records.set(businessProfileRef('alice', raw).path, { scope: raw, revision: 1, confirmedAt: new Date(when.getTime() + 1000).toISOString(), profile: {
    businessName: 'Fixture Plumbing', businessType: 'Plumber', services: ['Drain repair'], baseLocation: { city: 'Mishawaka', region: 'Indiana', country: 'United States' }, serviceAreas: ['Mishawaka'], goal: 'quotes',
  } });
  const result = await readNewPageWorkspace('alice');
  expect(result.profileNotices).toHaveLength(1);
  expect(result.context.services).toEqual(context.services);
  expect(result.plans[0].id).toBe(plan.id);
});

const retiredPage = () => ({ url: 'https://example.test/services/discontinued', status: 'retired', reason: 'owner_confirmed_removed',
  observedAt: when.toISOString(), retirementProof: { httpStatus: 404, ownerConfirmedAt: when.toISOString(), verifiedAt: when.toISOString() } });
it('exposes changed coverage after a removal without generating or altering a saved plan', async () => {
  const { plan } = await evaluateAndSelect();
  mocks.inventory.pages.push({ ...retiredPage(), status: 'failed', reason: 'http_404', retirementProof: undefined });
  await assessNewPageIdeas('alice');
  expect((await readNewPageWorkspace('alice')).assessments[0]).toMatchObject({ outcome: 'needs_information', coverageChanged: false });
  mocks.inventory.pages[1] = retiredPage();
  mocks.inventory.revision++; records.get(`newPageInventories/${mocks.inventory.id}`).revision++;
  mocks.create.mockClear(); vi.mocked(getGscConnection).mockClear();
  const result = await readNewPageWorkspace('alice');
  expect(result.assessments[0]).toMatchObject({ outcome: 'needs_information', coverageChanged: true });
  expect(result.plans[0].id).toBe(plan.id);
  expect(mocks.create).not.toHaveBeenCalled(); expect(getGscConnection).not.toHaveBeenCalled();
});
it('allows a fresh removal to stop blocking assessment but never uses removed copy as website evidence or a link', async () => {
  const removed = { ...retiredPage(), content: { textContent: 'Old claims from a discontinued service.' } };
  mocks.inventory.pages.push(removed);
  const bundle = buildNewPageBundle({ scope, context, inventory: mocks.inventory, priorPlans: [], research: { sources: [] } });
  expect(bundle.unknownPages).toEqual([]); expect(bundle.removedPages[0].url).toBe(removed.url);
  expect(bundle.pages.some(page => page.url === removed.url)).toBe(false);
  expect(bundle.facts.some(fact => fact.url === removed.url)).toBe(false);
  expect((await assessNewPageIdeas('alice')).assessment.outcome).toBe('new_page');
});
it('preserves unchanged removal evidence on recheck while invalidating a missing proof or restored URL', async () => {
  mocks.inventory.pages.push(retiredPage());
  await assessNewPageIdeas('alice');
  const later = new Date(when.getTime() + 86400000); vi.setSystemTime(later);
  mocks.inventory.updatedAt = later.toISOString();
  mocks.inventory.pages[1].observedAt = later.toISOString(); mocks.inventory.pages[1].retirementProof.verifiedAt = later.toISOString();
  mocks.inventory.revision++; records.get(`newPageInventories/${mocks.inventory.id}`).revision++;
  expect((await readNewPageWorkspace('alice')).assessments[0].coverageChanged).toBe(false);
  expect((await assessNewPageIdeas('alice')).unchanged).toBe(true);
  expect(mocks.create).toHaveBeenCalledTimes(2);
  mocks.inventory.pages[1].retirementProof = null;
  expect((await readNewPageWorkspace('alice')).assessments[0].coverageChanged).toBe(true);
  expect((await assessNewPageIdeas('alice')).assessment.outcome).toBe('needs_information');
  mocks.inventory.pages[1] = { ...retiredPage(), status: 'pending', reason: null };
  expect((await readNewPageWorkspace('alice')).assessments[0].coverageChanged).toBe(true);
});

it('reads saved workspace only and visibly prefills unconfirmed services from observed pages', async () => {
  const result = await readNewPageWorkspace('alice');
  expect(result.business.services).toContain('Plumbing repairs');
  expect(result.context).toMatchObject(context);
  expect(result.plans).toEqual([]);
  expect(getGscConnection).not.toHaveBeenCalled(); expect(publicFetch).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
it('requires explicit service-area confirmation and preserves saved contexts across switching', async () => {
  await expect(saveNewPageContext('alice', { ...context, confirmed: false })).rejects.toThrow('Confirm');
  const second = { ...context, area: { ...context.area, name: 'South Bend' } };
  await saveNewPageContext('alice', second); await saveNewPageContext('alice', context);
  const result = await readNewPageWorkspace('alice');
  expect(result.contexts).toHaveLength(2); expect(result.context.area.name).toBe('Mishawaka');
  expect(result.context.provenance).toBe('owner_confirmation'); expect(mocks.create).not.toHaveBeenCalled();
});
it('persists a selected idea under a stable ID without replacing it on repeat selection or reload', async () => {
  const { reviewed, plan } = await evaluateAndSelect();
  expect(plan).toMatchObject({ status: 'draft', revision: 1, draft: null, context: { area: { name: 'Mishawaka' } } });
  const edited = await editNewPagePlan('alice', { planId: plan.id, revision: 1, ownerFacts: 'A private owner note.' });
  const again = await selectNewPageIdea('alice', { assessmentId: reviewed.id, ideaId: reviewed.ideas[0].id });
  expect(again.plan).toEqual(edited.plan);
  expect((await readNewPageWorkspace('alice')).plans[0].ownerFacts).toBeUndefined();
  expect((await readNewPagePlan('alice', plan.id)).plan.ownerFacts).toBe('A private owner note.');
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
it('treats no opportunity as a normal saved result and does not manufacture a selectable idea', async () => {
  mocks.create.mockImplementation(async request => request.tools ? research() : completed({ outcome: 'no_opportunity', summary: 'The current pages cover the confirmed service and area.', questions: [], ideas: [] }));
  const result = await assessNewPageIdeas('alice');
  expect(result.assessment.outcome).toBe('no_opportunity'); expect(result.assessment.ideas).toEqual([]);
  await expect(selectNewPageIdea('alice', { assessmentId: result.assessment.id, ideaId: 'invented' })).rejects.toMatchObject({ status: 409 });
});
it('returns known incomplete coverage without paid research, Google refresh or allowance consumption', async () => {
  mocks.inventory.pages.push({ url: 'https://example.test/services/older-homes', status: 'failed', reason: 'unreadable' });
  mocks.inventory.coverage.failed = 1;
  const result = await assessNewPageIdeas('alice');
  expect(result.assessment.outcome).toBe('needs_information');
  expect(result.assessment.provenance.model).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled(); expect(getGscConnection).not.toHaveBeenCalled(); expect(usageKinds()).toEqual([]);
  expect((await assessNewPageIdeas('alice')).unchanged).toBe(true);
});
it('does not make a paid request for unchanged evidence, including an identical crawl with fresh timestamps', async () => {
  const initial = await assessNewPageIdeas('alice');
  const unchanged = await assessNewPageIdeas('alice');
  expect(unchanged.unchanged).toBe(true); expect(unchanged.assessment.id).toBe(initial.assessment.id);
  const later = new Date(when.getTime() + 86400000); vi.setSystemTime(later);
  mocks.inventory.updatedAt = later.toISOString(); mocks.inventory.revision++;
  mocks.inventory.pages[0].observedAt = later.toISOString(); mocks.inventory.pages[0].content.fetchedAt = later.toISOString();
  mocks.inventory.coverage.sitemaps[0].checkedAt = later.toISOString();
  records.get(`newPageInventories/${mocks.inventory.id}`).revision++;
  expect((await assessNewPageIdeas('alice')).unchanged).toBe(true);
  await expect(selectNewPageIdea('alice', { assessmentId: initial.assessment.id, ideaId: initial.assessment.ideas[0].id })).resolves.toHaveProperty('plan');
  expect(mocks.create).toHaveBeenCalledTimes(2); expect(usageKinds()).toEqual([['assessment', 1]]);
});
it('can retry unavailable public research before seven days instead of caching the failure as complete', async () => {
  mocks.create.mockRejectedValueOnce(new Error('provider unavailable'));
  expect((await assessNewPageIdeas('alice')).assessment.outcome).toBe('needs_information');
  const second = await assessNewPageIdeas('alice');
  expect(second.assessment.outcome).toBe('new_page'); expect(second.unchanged).toBe(false);
  expect(mocks.create).toHaveBeenCalledTimes(3);
});
it('permits explicit fresh research after seven days and preserves a previous result if refresh fails', async () => {
  const first = await assessNewPageIdeas('alice'); vi.setSystemTime(new Date(when.getTime() + 8 * 86400000));
  mocks.inventory.updatedAt = new Date().toISOString();
  for (const page of mocks.inventory.pages) { page.observedAt = new Date().toISOString(); page.content.fetchedAt = new Date().toISOString(); }
  mocks.create.mockRejectedValueOnce(new Error('private provider body'));
  await expect(assessNewPageIdeas('alice')).rejects.toMatchObject({ status: 503 });
  expect((await readNewPageWorkspace('alice')).assessments[0].revision).toBe(first.assessment.revision);
});
it('reserves the assessment allowance before provider calls and rejects excess requests', async () => {
  for (let i = 0; i < 3; i++) await consumeNewPageQuota('alice', 'assessment');
  await expect(assessNewPageIdeas('alice')).rejects.toMatchObject({ status: 429 });
  expect(getGscConnection).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  expect([...records.values()].filter(value => value.kind === 'assessment' && 'leaseUntil' in value)[0].leaseUntil).toBeNull();
});
it('allows one account planning job at a time and releases the lease after completion', async () => {
  let release; let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  mocks.create.mockImplementationOnce(async () => { signalStarted(); await new Promise(resolve => { release = resolve; }); return research(); });
  const first = assessNewPageIdeas('alice'); await started;
  await expect(assessNewPageIdeas('alice')).rejects.toMatchObject({ status: 409 });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  release(); await first;
  expect([...records.values()].filter(value => value.kind === 'assessment' && 'leaseUntil' in value)[0].leaseUntil).toBeNull();
});
it.each(['deletion', 'property', 'area', 'inventory'])('does not save an assessment when %s changes during model work', async change => {
  const defaultCreate = mocks.create.getMockImplementation();
  mocks.create.mockImplementation(async request => {
    const response = await defaultCreate(request);
    if (request.text?.format?.name === 'new_page_assessment') {
      if (change === 'deletion') { records.delete('users/alice'); records.delete('onboarding/alice'); }
      if (change === 'property') records.get('onboarding/alice').gscProperty = 'https://changed.test/';
      if (change === 'area') await saveNewPageContext('alice', { ...context, area: { ...context.area, name: 'South Bend' } });
      if (change === 'inventory') records.get(`newPageInventories/${mocks.inventory.id}`).revision++;
    }
    return response;
  });
  await expect(assessNewPageIdeas('alice')).rejects.toMatchObject({ status: 409 });
  expect([...records.keys()].filter(key => key.startsWith('newPageAssessments/'))).toHaveLength(0);
  if (change === 'deletion') expect(records.has('users/alice')).toBe(false);
});
it('does not select a stale opportunity after meaningful inventory changes', async () => {
  const { assessment: reviewed } = await assessNewPageIdeas('alice');
  mocks.inventory.pages[0].content.textContent += ' We now have dedicated older-home repair information.';
  await expect(selectNewPageIdea('alice', { assessmentId: reviewed.id, ideaId: reviewed.ideas[0].id })).rejects.toThrow('coverage has changed');
  expect([...records.keys()].filter(key => key.startsWith('newPagePlans/'))).toHaveLength(0);
});
it('rejects another owner’s saved assessment and stale draft revisions', async () => {
  const { reviewed, plan } = await evaluateAndSelect();
  records.get(`newPageAssessments/${reviewed.id}`).userId = 'bob';
  await expect(selectNewPageIdea('alice', { assessmentId: reviewed.id, ideaId: reviewed.ideas[0].id })).rejects.toMatchObject({ status: 404 });
  await expect(editNewPagePlan('alice', { planId: plan.id, revision: 0, ownerFacts: 'wrong revision' })).rejects.toMatchObject({ status: 409 });
  expect(records.get(`newPagePlans/${plan.id}`).ownerFacts).toBe('');
});
it('requires essential owner facts and preserves a draft and edits until an updated draft is explicitly accepted', async () => {
  const { plan } = await evaluateAndSelect();
  records.get(`newPagePlans/${plan.id}`).requiredFacts = ['Explain actual access arrangements.'];
  await expect(generateNewPageDraft('alice', { planId: plan.id, revision: 1 })).rejects.toThrow('required');
  const generated = await generateNewPageDraft('alice', { planId: plan.id, revision: 1, ownerFacts: 'We arrange access with the homeowner.' });
  expect(generated.plan.draft).toEqual(draft()); expect(generated.plan.slugCheck.status).toBe('not_found');
  const own = { ...generated.plan.draft, title: 'My carefully reviewed page title' };
  const edited = await editNewPagePlan('alice', { planId: plan.id, revision: generated.plan.revision, draft: own });
  const updated = await generateNewPageDraft('alice', { planId: plan.id, revision: edited.plan.revision, ownerFacts: 'We arrange access and protect the work area.' });
  expect(updated.plan.draft.title).toBe(own.title); expect(updated.plan.proposedDraft.title).toBe(draft().title);
  const accepted = await editNewPagePlan('alice', { planId: plan.id, revision: updated.plan.revision, acceptProposed: true });
  expect(accepted.plan.draft.title).toBe(draft().title); expect(accepted.plan.proposedDraft).toBeNull();
});
it('preserves owner edits and skips generation allowance when draft evidence is unchanged', async () => {
  const { plan } = await evaluateAndSelect();
  const generated = await generateNewPageDraft('alice', { planId: plan.id, revision: 1 });
  const edited = await editNewPagePlan('alice', { planId: plan.id, revision: generated.plan.revision, draft: { ...generated.plan.draft, title: 'Owner edited title' } });
  mocks.create.mockClear();
  const unchanged = await generateNewPageDraft('alice', { planId: plan.id, revision: edited.plan.revision });
  expect(unchanged.unchanged).toBe(true); expect(unchanged.plan.draft.title).toBe('Owner edited title');
  expect(mocks.create).not.toHaveBeenCalled(); expect(usageKinds()).toContainEqual(['draft', 1]);
});
it.each(['unsupported', 'duplicate', 'claimed_fact'])('rejects a %s draft without modifying existing saved copy', async fault => {
  const { plan } = await evaluateAndSelect();
  mocks.create.mockImplementation(async request => request.text?.format?.name === 'new_page_draft'
    ? completed(fault === 'claimed_fact' ? { ...draft(), description: 'Licensed with 40 years of experience.' } : draft())
    : completed({ supported: fault !== 'unsupported', unsupportedClaims: fault === 'unsupported' ? ['Unverified claim'] : [], duplicatesExistingPage: fault === 'duplicate', reason: 'Fixture audit' }));
  await expect(generateNewPageDraft('alice', { planId: plan.id, revision: 1 })).rejects.toMatchObject({ status: 422 });
  expect(records.get(`newPagePlans/${plan.id}`).draft).toBeNull();
});
it.each(['delete', 'revision', 'inventory'])('rejects draft saves after in-flight %s without losing owner changes', async change => {
  const { plan } = await evaluateAndSelect();
  const implementation = mocks.create.getMockImplementation();
  mocks.create.mockImplementation(async request => {
    const result = await implementation(request);
    if (request.text?.format?.name === 'draft_evidence_audit') {
      if (change === 'delete') { records.delete('users/alice'); records.delete('onboarding/alice'); }
      if (change === 'revision') { records.get(`newPagePlans/${plan.id}`).revision++; records.get(`newPagePlans/${plan.id}`).ownerFacts = 'New owner input'; }
      if (change === 'inventory') records.get(`newPageInventories/${mocks.inventory.id}`).revision++;
    }
    return result;
  });
  await expect(generateNewPageDraft('alice', { planId: plan.id, revision: 1 })).rejects.toMatchObject({ status: 409 });
  expect(records.get(`newPagePlans/${plan.id}`).draft).toBeNull();
  if (change === 'revision') expect(records.get(`newPagePlans/${plan.id}`).ownerFacts).toBe('New owner input');
});
it('does not use a successful or redirected URL as an available draft slug', async () => {
  const { plan } = await evaluateAndSelect();
  publicFetch.mockResolvedValue(new Response('<html>Existing page</html>', { status: 200 }));
  await expect(generateNewPageDraft('alice', { planId: plan.id, revision: 1 })).rejects.toMatchObject({ status: 409 });
  expect(records.get(`newPagePlans/${plan.id}`).draft).toBeNull();
});
it('enforces all three daily allowances independently and gates generation without removing saved reads', async () => {
  for (const [kind, limit] of [['assessment', 3], ['draft', 5], ['nearby', 2]]) {
    for (let i = 0; i < limit; i++) await consumeNewPageQuota('alice', kind);
    await expect(consumeNewPageQuota('alice', kind)).rejects.toMatchObject({ status: 429 });
  }
  process.env.NEW_PAGE_GENERATION_ENABLED = 'false';
  expect((await readNewPageWorkspace('alice')).enabled).toBe(false);
  await expect(assessNewPageIdeas('alice')).rejects.toMatchObject({ status: 503 });
  expect(mocks.create).not.toHaveBeenCalled();
});
it('stores sourced nearby suggestions without confirming service coverage or exposing private notes to search', async () => {
  await saveNewPageContext('alice', { ...context, facts: 'Private contact note DO_NOT_SEARCH.' });
  const result = await suggestNearbyAreas('alice');
  expect(result.areas[0].name).toBe('South Bend');
  const searchRequest = mocks.create.mock.calls[0][0];
  expect(searchRequest.max_tool_calls).toBe(2); expect(JSON.stringify(searchRequest)).not.toContain('DO_NOT_SEARCH');
  expect((await readNewPageWorkspace('alice')).context.area.name).toBe('Mishawaka');
  expect(recordPageReviewResponse).toHaveBeenCalledWith(expect.objectContaining({ feature: 'new_page_planning', stage: 'nearby_research' }), expect.any(Function));
});
it('caps total saved plans including older website versions so reads never silently lose plans', async () => {
  const { assessment: reviewed } = await assessNewPageIdeas('alice');
  for (let i = 0; i < 200; i++) await db.collection('newPagePlans').doc(`older-${i}`).set({ ...scope, websiteRunId: 'old', status: 'dismissed', updatedAt: when.toISOString() });
  await expect(selectNewPageIdea('alice', { assessmentId: reviewed.id, ideaId: reviewed.ideas[0].id })).rejects.toThrow('200 saved');
  expect((await readNewPageWorkspace('alice')).history).toHaveLength(200);
});
it('keeps a 100-page assessment within document limits without duplicating a saved input bundle', async () => {
  const first = structuredClone(mocks.inventory.pages[0]);
  first.content.textContent = 'Plumbing repair services and actual access arrangements for local homes. '.repeat(100);
  mocks.inventory.pages = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(first), url: index ? `${scope.websiteUrl}services/page-${index}` : first.url }));
  mocks.inventory.coverage.fetched = 100; mocks.inventory.coverage.discovered = 100;
  const result = await assessNewPageIdeas('alice');
  const stored = records.get(`newPageAssessments/${result.assessment.id}`);
  expect(stored.inputBundle).toBeUndefined();
  expect(stored.evidence.filter(fact => fact.source === 'website')).toHaveLength(100);
  expect(stored.evidence.filter(fact => fact.source === 'website').every(fact => fact.text.length <= 1500)).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(300000);
  const selected = await selectNewPageIdea('alice', { assessmentId: stored.id, ideaId: stored.ideas[0].id });
  const generated = await generateNewPageDraft('alice', { planId: selected.plan.id, revision: 1 });
  expect(generated.plan.draftEvidence).toHaveLength(1);
  expect(Buffer.byteLength(JSON.stringify(generated.plan))).toBeLessThan(350000);
});
it('bounds all 200 prior plans alongside 100 page excerpts without losing any saved topic', async () => {
  const first = structuredClone(mocks.inventory.pages[0]);
  first.content.textContent = 'Actual service and access information. '.repeat(200);
  mocks.inventory.pages = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(first), url: `${scope.websiteUrl}services/page-${index}` }));
  const priorPlans = Array.from({ length: 200 }, (_, index) => ({ id: `saved-${index}`, status: 'draft', context,
    idea: { ...idea(), topic: `Previously saved topic ${index}`, purpose: 'Purpose detail. '.repeat(100), distinctValue: 'Distinct customer value. '.repeat(100), reason: 'Not needed in model context. '.repeat(1000),
      evidenceIds: Array.from({ length: 100 }, (__, n) => `P${n}`), checkedPageUrls: mocks.inventory.pages.map(page => page.url) }, draft: { slug: `/saved-${index}`, h1: `Saved page ${index}`, sections: draft().sections } }));
  const bundle = buildNewPageBundle({ scope, context, inventory: mocks.inventory, priorPlans, research: { status: 'unavailable', sources: [] } });
  expect(bundle.priorPlans).toHaveLength(200);
  expect(bundle.priorPlans.map(plan => plan.idea.topic)).toEqual(priorPlans.map(plan => plan.idea.topic));
  expect(bundle.priorPlans[0]).toMatchObject({ area: context.area, draft: { slug: '/saved-0', h1: 'Saved page 0' } });
  expect(bundle.priorPlans.every(plan => plan.idea.purpose.length <= 250 && plan.idea.distinctValue.length <= 250 && !('reason' in plan.idea) && !('sections' in plan.draft))).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThan(600000);
});
it('invalidates active URL checks after an owner slug edit and keeps proposed checks separate until acceptance', async () => {
  const { plan } = await evaluateAndSelect();
  const generated = await generateNewPageDraft('alice', { planId: plan.id, revision: 1 });
  expect(generated.plan.slugCheck.status).toBe('not_found');
  const edited = await editNewPagePlan('alice', { planId: plan.id, revision: generated.plan.revision, draft: { ...generated.plan.draft, slug: '/owner-chosen-url' } });
  expect(edited.plan.slugCheck).toBeNull();
  const updated = await generateNewPageDraft('alice', { planId: plan.id, revision: edited.plan.revision, ownerFacts: 'The homeowner can explain access restrictions.' });
  expect(updated.plan.draft.slug).toBe('/owner-chosen-url'); expect(updated.plan.slugCheck).toBeNull();
  expect(updated.plan.proposedSlugCheck.url).toBe(new URL(draft().slug, scope.websiteUrl).href);
  const accepted = await editNewPagePlan('alice', { planId: plan.id, revision: updated.plan.revision, acceptProposed: true });
  expect(accepted.plan.draft.slug).toBe(draft().slug); expect(accepted.plan.slugCheck).toEqual(updated.plan.proposedSlugCheck);
  expect(accepted.plan.proposedSlugCheck).toBeNull(); expect(accepted.plan.proposedDraftEvidence).toBeNull();
});
it('returns compact workspace lists and loads full current or historical saved plans only on request', async () => {
  const { plan } = await evaluateAndSelect();
  const page = structuredClone(mocks.inventory.pages[0]);
  mocks.inventory.pages = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(page), url: `${scope.websiteUrl}services/page-${index}` }));
  const evidence = Array.from({ length: 100 }, (_, index) => ({ id: `P${index}`, text: 'Website excerpt. '.repeat(100) }));
  const fullDraft = { ...draft(), sections: Array.from({ length: 10 }, (_, index) => ({ id: `s${index}`, heading: 'A section', body: 'Owner-reviewed copy. '.repeat(200) })) };
  for (let index = 0; index < 199; index++) await db.collection('newPagePlans').doc(`saved-${index}`).set({ ...scope, ...plan, id: `saved-${index}`, websiteRunId: index % 2 ? 'older' : scope.websiteRunId,
    draft: fullDraft, evidence, ownerFacts: 'Saved owner facts.', updatedAt: when.toISOString() });
  for (let index = 0; index < 50; index++) await db.collection('newPageAssessments').doc(`area-${index}`).set({ ...scope, id: `area-${index}`, context, ...assessment(), evidence, inputBundle: { large: evidence }, research: { status: 'available', summary: 'Public research summary.', sources: [] }, updatedAt: when.toISOString() });
  mocks.create.mockClear(); publicFetch.mockClear(); vi.mocked(getGscConnection).mockClear();
  const workspace = await readNewPageWorkspace('alice');
  expect(workspace.plans.length + workspace.history.length).toBe(200);
  expect(workspace.plans.every(item => !item.draft && !item.evidence && !item.ownerFacts)).toBe(true);
  expect(workspace.assessments).toHaveLength(1);
  expect(workspace.assessments.every(item => !item.evidence && !item.inputBundle)).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(workspace))).toBeLessThan(200000);
  const active = await readNewPagePlan('alice', 'saved-0');
  expect(active.plan).toMatchObject({ draft: fullDraft, ownerFacts: 'Saved owner facts.', readOnly: false });
  const history = await readNewPagePlan('alice', 'saved-1');
  expect(history.plan).toMatchObject({ draft: fullDraft, readOnly: true });
  expect(history.tracking).toBeUndefined();
  records.get('newPagePlans/saved-0').userId = 'bob';
  await expect(readNewPagePlan('alice', 'saved-0')).rejects.toMatchObject({ status: 404 });
  expect(mocks.create).not.toHaveBeenCalled(); expect(publicFetch).not.toHaveBeenCalled(); expect(getGscConnection).not.toHaveBeenCalled();
});
it('restores the active area assessment directly even after more than 200 historical assessments', async () => {
  for (let index = 0; index < 201; index++) await db.collection('newPageAssessments').doc(`historic-${index}`).set({ ...scope, websiteRunId: 'older', context, ...assessment(), updatedAt: when.toISOString() });
  const first = await assessNewPageIdeas('alice');
  const loaded = await readNewPageWorkspace('alice');
  expect(loaded.assessments[0].id).toBe(first.assessment.id);
  expect(loaded.assessments[0].context.facts).toBe(context.facts);
  expect(contextKey(loaded.assessments[0].context)).toBe(contextKey(loaded.context));
  await saveNewPageContext('alice', { ...context, area: { ...context.area, name: 'South Bend' } });
  expect((await readNewPageWorkspace('alice')).assessments).toEqual([]);
  await saveNewPageContext('alice', context);
  mocks.create.mockClear();
  expect((await readNewPageWorkspace('alice')).assessments[0].id).toBe(first.assessment.id);
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each(['expired', 'missing', 'old_fetched_page', 'old_retired_page'])('rejects %s website evidence before assessment or drafting consumes a generation allowance', async age => {
  const { plan } = await evaluateAndSelect();
  mocks.create.mockClear(); vi.mocked(getGscConnection).mockClear();
  const allowanceBefore = usageKinds();
  if (age === 'old_retired_page') mocks.inventory.pages.push({ ...retiredPage(), retirementProof: { ...retiredPage().retirementProof, verifiedAt: new Date(when.getTime() - 8 * 86400000).toISOString() } });
  else if (age === 'old_fetched_page') mocks.inventory.pages[0].content.fetchedAt = new Date(when.getTime() - 8 * 86400000).toISOString();
  else mocks.inventory.updatedAt = age === 'expired' ? new Date(when.getTime() - 8 * 86400000).toISOString() : undefined;
  await expect(assessNewPageIdeas('alice')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Refresh website review first') });
  await expect(generateNewPageDraft('alice', { planId: plan.id, revision: plan.revision })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Refresh website review first') });
  expect(mocks.create).not.toHaveBeenCalled(); expect(getGscConnection).not.toHaveBeenCalled(); expect(usageKinds()).toEqual(allowanceBefore);
  expect((await readNewPagePlan('alice', plan.id)).plan.id).toBe(plan.id);
});
const servicePage = (path, h1, extra = {}) => ({ url: `https://example.test${path}`, status: 'fetched', content: { h1, ...extra } });
it('prefills parent services once across geographic descendants while preserving distinct subservices', () => {
  const inventory = { pages: [
    servicePage('/services/web-design/lakeside-wy', 'Web design in Lakeside, WY'),
    servicePage('/services/web-design/accessibility', 'Website accessibility audits'),
    servicePage('/services/web-design', 'Web design — Riverton, WY'),
    servicePage('/services/web-design/riverton', 'Web design in Riverton, WY'),
  ] };
  expect(suggestedNewPageServices({ businessLocation: 'Riverton, WY' }, inventory)).toEqual(['Web design', 'Website accessibility audits']);
});
it('uses site-evidenced full region names and geographic destination labels across region boundaries', () => {
  const places = [['lakeside', 'Lakeside, WY'], ['cedar-city', 'Cedar City, UT'], ['riverton', 'Riverton, WY']];
  const links = places.flatMap(([slug, text]) => ['web-development', 'software'].map(service => ({ url: `https://example.test/services/${service}/${slug}`, text })));
  const inventory = { pages: [
    servicePage('/', 'Our services', { seoMetaDescription: 'Website and software work in Riverton, Wyoming.', internalLinks: links }),
    servicePage('/services/web-development', 'Web Design & Development — Wyoming'),
    servicePage('/services/software', 'Custom Software Development — Wyoming'),
    ...places.flatMap(([slug, place]) => [servicePage(`/services/software/${slug}`, `Software & App Development — ${place}`), servicePage(`/services/web-development/${slug}`, `Web Design & Development — ${place}`)]),
  ] };
  expect(suggestedNewPageServices({ businessLocation: 'Riverton, WY' }, inventory)).toEqual(['Custom Software Development', 'Web Design & Development', 'Software & App Development']);
  inventory.pages[0].content.seoMetaDescription = 'Website and software work for local businesses.';
  expect(suggestedNewPageServices({ businessLocation: 'Riverton, WY' }, inventory)).toContain('Custom Software Development — Wyoming');
});
it.each([
  ['Roof replacement', 'roof-replacement'], ['Drain cleaning', 'drain-cleaning'], ['Landscape design', 'landscape-design'],
])('generalizes service/location cleanup to %s without business-specific rules', (service, slug) => {
  const inventory = { pages: [servicePage(`/services/${slug}`, `${service} in Riverton, WY`), servicePage(`/services/${slug}/lakeside-wy`, `${service} in Lakeside, WY`)] };
  expect(suggestedNewPageServices({ businessLocation: 'Riverton, WY' }, inventory)).toEqual([service]);
});
it('uses an explicit first-party service link label when it matches the service URL', () => {
  const inventory = { pages: [
    servicePage('/', 'Welcome', { internalLinks: [{ url: 'https://example.test/services/web-development', text: 'Web Development' }] }),
    servicePage('/services/web-development', 'Custom websites and software for your growing business'),
  ] };
  expect(suggestedNewPageServices({}, inventory)).toEqual(['Web Development']);
  inventory.pages[0].content.internalLinks[0].text = 'Learn more';
  expect(suggestedNewPageServices({}, inventory)).toEqual(['Custom websites and software for your growing business']);
});
it('does not strip arbitrary hyphens or merge distinct services merely because a parent URL exists', () => {
  const inventory = { pages: [
    servicePage('/services/design-build', 'Design-build — Commercial fit-outs'),
    servicePage('/services/plumbing', 'Plumbing repairs'),
    servicePage('/services/plumbing/older-homes', 'Plumbing repairs in older homes'),
    servicePage('/services/plumbing/emergency', 'Emergency plumbing repairs'),
    servicePage('/services/plumbing/lakeside-wy', 'Plumbing repairs in Lakeside, WY'),
  ] };
  const labels = suggestedNewPageServices({ businessLocation: 'Riverton, WY' }, inventory);
  expect(labels).toContain('Design-build — Commercial fit-outs');
  expect(labels).toContain('Plumbing repairs in older homes');
  expect(labels).toContain('Emergency plumbing repairs');
  expect(labels).not.toContain('Plumbing repairs in Lakeside, WY');
});
it('keeps uncertain geographic-looking headings when region or URL evidence disagrees', () => {
  const inventory = { pages: [servicePage('/services/plumbing', 'Plumbing repairs'),
    servicePage('/services/plumbing/lakeside-wy', 'Plumbing repairs in Lakeside, NY'),
    servicePage('/services/plumbing/special-repairs', 'Plumbing repairs in Lakeside, WY')] };
  expect(suggestedNewPageServices({ businessLocation: 'Riverton, WY' }, inventory)).toEqual(['Plumbing repairs', 'Plumbing repairs in Lakeside, NY', 'Plumbing repairs in Lakeside, WY']);
});
it('bounds combined profile and website suggestions to twelve unique names, keeping comma labels intact', () => {
  const profile = { services: [' Heating, cooling and ventilation ', 'heating, COOLING and ventilation', ...Array.from({ length: 10 }, (_, index) => `Confirmed service ${index}`)] };
  const inventory = { pages: Array.from({ length: 20 }, (_, index) => servicePage(`/services/service-${index}`, `Observed service ${index}`)) };
  const labels = suggestedNewPageServices(profile, inventory);
  expect(labels).toHaveLength(12); expect(labels[0]).toBe('Heating, cooling and ventilation');
  expect(labels.filter(label => normalizeTest(label) === 'heating, cooling and ventilation')).toHaveLength(1);
  expect(labels).toContain('Confirmed service 9');
});
function normalizeTest(value) { return value.toLowerCase().replace(/\s+/g, ' ').trim(); }
it('preserves existing confirmed contexts exactly when new inventory suggests simpler service labels', async () => {
  const confirmed = { ...context, services: ['Heating, cooling and ventilation', 'Custom service — Special projects'] };
  await saveNewPageContext('alice', confirmed);
  const before = structuredClone(records.get(`newPageWorkspaces/${newPageScopeKey(scope)}`));
  mocks.inventory.pages = [servicePage('/services/heating', 'Heating in Mishawaka, Indiana')];
  mocks.create.mockClear();
  const workspace = await readNewPageWorkspace('alice');
  expect(workspace.context.services).toEqual(confirmed.services);
  expect(workspace.business.services).toEqual(['Heating']);
  expect(records.get(`newPageWorkspaces/${newPageScopeKey(scope)}`)).toEqual(before);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('deduplicates case and whitespace before counting services and saves all twelve comma-containing names intact', async () => {
  const labels = Array.from({ length: 12 }, (_, index) => `Service ${index}, scheduled visits`);
  const result = await saveNewPageContext('alice', { ...context, services: [...labels, '  SERVICE 0,  scheduled visits  '] });
  expect(result.context.services).toEqual(labels);
  expect((await readNewPageWorkspace('alice')).context.services).toEqual(labels);
});
it.each([
  [{ confirmed: false }, 'Confirm that you offer'],
  [{ services: [] }, 'Add at least one service'],
  [{ services: Array.from({ length: 13 }, (_, index) => `Service ${index}`) }, 'Choose up to 12 different services'],
  [{ services: ['a'.repeat(121)] }, 'Each service must be a name'],
  [{ services: ['<b>Plumbing</b>'] }, 'Each service must be a name'],
  [{ services: [null] }, 'Each service must be a name'],
  [{ area: null }, 'Enter the area, region and country'],
])('explains service-area validation failures without changing the saved context: %j', async (changes, message) => {
  const before = structuredClone(records.get(`newPageWorkspaces/${newPageScopeKey(scope)}`));
  await expect(saveNewPageContext('alice', { ...context, ...changes })).rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) });
  expect(records.get(`newPageWorkspaces/${newPageScopeKey(scope)}`)).toEqual(before);
});
