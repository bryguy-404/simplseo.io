import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ default: class { constructor() { this.responses = { create: api.create }; } } }));
vi.mock('../app/lib/firebaseAdmin', async () => ({ ...(await import('./fakeFirestore')).fakeFirestore(), auth: {} }));
vi.mock('../app/lib/server/onboardingInventory', () => ({ readOnboardingInventory: vi.fn(), onboardingInventoryScope: vi.fn(), onboardingInventoryKey: () => 'inventory1' }));
vi.mock('../app/lib/server/aiUsage', () => ({ recordPageReviewResponse: vi.fn(async (_input, run) => run()) }));
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { readOnboardingInventory, onboardingInventoryScope } from '../app/lib/server/onboardingInventory';
import { recordPageReviewResponse } from '../app/lib/server/aiUsage';
import { extractOnboardingBusiness, readOnboardingExtraction } from '../app/lib/server/onboardingExtraction';
import { buildOnboardingEvidence, buildOnboardingExtractionRequest, validateOnboardingExtraction } from '../app/lib/onboardingExtractionPolicy';
const session = { id: 'current', revision: 1, state: 'draft', mode: 'new', originalScope: { property: null, websiteUrl: null, websiteRunId: null },
  websiteUrl: 'https://example.test/', google: { status: 'not_connected' } };
const scope = { userId: 'u1', property: 'https://example.test/', websiteUrl: 'https://example.test/', preview: false, websiteRunId: null };
const phrase = 'Example Plumbing is a plumbing company. We provide drain cleaning in South Bend. Do you offer quotes? Yes, contact us to request a quote.';
const inventory = () => ({ id: 'inventory1', revision: 2, pages: [{ url: scope.websiteUrl, status: 'fetched', content: {
  htmlTitle: 'Example Plumbing', h1: 'Example Plumbing', mainContent: phrase, fetchedAt: '2026-10-11T02:00:00Z', structuredData: { items: [] } } }], coverage: { fetched: 1 } });
const fact = value => ({ value, evidence: [{ sourceId: 'S1', quote: phrase }] });
const output = () => ({ businessName: fact('Example Plumbing'), businessType: fact('plumbing company'), services: [fact('drain cleaning')], locations: [fact('South Bend')],
  faqs: [{ question: 'Do you offer quotes?', answer: 'Yes, contact us to request a quote.', evidence: [{ sourceId: 'S1', quote: phrase }] }], questions: [] });
const result = value => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const options = (extra = {}) => ({ expectedRevision: 1, requestId: 'extract-0001', ...extra });
beforeEach(async () => {
  reset(); await db.collection('users').doc('u1').set({}); await db.collection('onboarding').doc('u1').set({ isComplete: false });
  await db.collection('users').doc('u1').collection('onboardingSessions').doc('current').set(session);
  await db.collection('onboardingInventories').doc('inventory1').set({ revision: 2 });
  readOnboardingInventory.mockReset().mockImplementation(async () => inventory());
  onboardingInventoryScope.mockReset().mockImplementation(async (_uid, supplied, { tx } = {}) => {
    const { readWorkSession } = await import('../app/lib/server/onboardingWork'); await readWorkSession('u1', { expectedSession: supplied, tx }); return scope;
  });
  recordPageReviewResponse.mockClear(); api.create.mockReset().mockResolvedValue(result(output())); vi.stubEnv('OPENAI_API_KEY', 'test-key');
});
afterEach(() => vi.unstubAllEnvs());
describe('source-backed business extraction', () => {
  it('requires a validated Google scope before any paid extraction or quota reservation', async () => {
    onboardingInventoryScope.mockResolvedValue({ ...scope, preview: true });
    await expect(extractOnboardingBusiness('u1', options())).rejects.toMatchObject({ status: 409 });
    expect(api.create).not.toHaveBeenCalled();
    expect([...records.values()].some(value => value.kind === 'extraction')).toBe(false);
  });
  it('allows a rollback to disable new extraction while retaining saved reads and manual setup', async () => {
    const saved = await extractOnboardingBusiness('u1', options());
    vi.stubEnv('ONBOARDING_EXTRACTION_ENABLED', 'false');
    expect((await extractOnboardingBusiness('u1', options({ requestId: 'extract-0002' }))).unchanged).toBe(true);
    readOnboardingInventory.mockImplementation(async () => { const value = inventory(); value.pages[0].content.mainContent += ' New evidence.'; return value; });
    await expect(extractOnboardingBusiness('u1', options({ requestId: 'extract-0003' }))).rejects.toMatchObject({ status: 409 });
    expect(await readOnboardingExtraction('u1')).toEqual(saved.extraction); expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('saves observations separately from profile and restores them without provider work', async () => {
    const saved = await extractOnboardingBusiness('u1', options());
    expect(saved.extraction).toMatchObject({ status: 'ready', requiresOwnerConfirmation: true, provenance: 'website_observation', businessName: { value: 'Example Plumbing' } });
    expect(saved.extraction.businessName.evidence[0].url).toBe(scope.websiteUrl);
    expect((await db.collection('users').doc('u1').collection('onboardingSessions').doc('current').get()).data()).toEqual(session);
    expect(await readOnboardingExtraction('u1')).toEqual(saved.extraction);
    const repeated = await extractOnboardingBusiness('u1', options({ requestId: 'extract-0002' }));
    expect(repeated.unchanged).toBe(true); expect(api.create).toHaveBeenCalledTimes(1);
    expect(recordPageReviewResponse).toHaveBeenCalledWith(expect.objectContaining({ feature: 'onboarding_extraction' }), expect.any(Function));
  });
  it('does not charge unchanged extraction when only fetch timestamps change', async () => {
    await extractOnboardingBusiness('u1', options());
    readOnboardingInventory.mockImplementation(async () => { const value = inventory(); value.pages[0].content.fetchedAt = '2026-10-11T04:00:00Z'; return value; });
    expect((await extractOnboardingBusiness('u1', options({ requestId: 'extract-0002' }))).unchanged).toBe(true);
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('returns useful missing-information state with no paid request when no readable evidence exists', async () => {
    readOnboardingInventory.mockResolvedValue({ ...inventory(), pages: [{ url: scope.websiteUrl, status: 'failed', reason: 'http_404' }] });
    expect((await extractOnboardingBusiness('u1', options())).extraction).toMatchObject({ status: 'needs_information', businessName: null, services: [] });
    expect(api.create).not.toHaveBeenCalled(); expect([...records.values()].some(value => value.feature === 'onboarding' && value.kind === 'extraction')).toBe(false);
  });
  it('rejects unsupported claims and preserves the previous saved facts', async () => {
    const saved = await extractOnboardingBusiness('u1', options());
    readOnboardingInventory.mockImplementation(async () => { const value = inventory(); value.pages[0].content.mainContent += ' Updated business hours.'; return value; });
    api.create.mockResolvedValue(result({ ...output(), services: [fact('24/7 emergency service')] }));
    await expect(extractOnboardingBusiness('u1', options({ requestId: 'extract-0002' }))).rejects.toMatchObject({ status: 502 });
    expect(await readOnboardingExtraction('u1')).toEqual(saved.extraction);
  });
  it.each(['delete', 'revision', 'inventory'])('rejects %s changes during a paid request without writing stale facts', async action => {
    api.create.mockImplementation(async () => {
      if (action === 'delete') await db.collection('users').doc('u1').delete();
      if (action === 'revision') await db.collection('users').doc('u1').collection('onboardingSessions').doc('current').update({ revision: 2 });
      if (action === 'inventory') await db.collection('onboardingInventories').doc('inventory1').update({ revision: 3 });
      return result(output());
    });
    await expect(extractOnboardingBusiness('u1', options())).rejects.toMatchObject({ status: 409 });
    expect(records.has('onboardingExtractions/inventory1')).toBe(false);
  });
  it('allows a saved read before a website has been entered', async () => {
    await db.collection('users').doc('u1').collection('onboardingSessions').doc('current').update({ websiteUrl: '' });
    expect(await readOnboardingExtraction('u1')).toBeNull(); expect(api.create).not.toHaveBeenCalled();
  });
});
describe('extraction request and deterministic evidence validation', () => {
  it('keeps structured website assertions separately identified from downloaded and rendered text', () => {
    const value = inventory(); value.pages[0].content.structuredData.items = [{ types: ['LocalBusiness'], name: 'Example Plumbing', address: 'South Bend' }];
    value.pages[0].content.renderedSupplement = { status: 'available', content: { mainContent: 'Rendered provider content describes Example Plumbing.' }, observedAt: '2026-10-11T02:00:00Z' };
    const bundle = buildOnboardingEvidence(value);
    expect(bundle.sources.map(source => source.kind)).toEqual(['website_html', 'website_json_ld', 'provider_rendered_html']);
    expect(bundle.sources[1].text).toContain('Schema type: LocalBusiness');
  });
  it('does not pass model-generated questions that assume invented business facts to the owner', () => {
    const value = output(); value.questions = ['When did you open your second office in Atlantis?'];
    expect(validateOnboardingExtraction(value, buildOnboardingEvidence(inventory())).questions.join(' ')).not.toContain('Atlantis');
  });
  it.each(['Our portfolio example has an office in Tokyo.', 'Tokyo is the client location, not our office or a stated service area.', 'We do not serve Tokyo.'])('rejects third-party or negated location evidence: %s', quote => {
    const value = output(), evidence = buildOnboardingEvidence(inventory());
    evidence.sources[0].text += ` ${quote}`;
    value.locations.push({ value: 'Tokyo', evidence: [{ sourceId: 'S1', quote }] });
    expect(() => validateOnboardingExtraction(value, evidence)).toThrow();
  });
  it('uses existing model strict output with no tools or storage and treats source instructions as data', () => {
    const request = buildOnboardingExtractionRequest(buildOnboardingEvidence(inventory()));
    expect(request).toMatchObject({ model: 'gpt-6.1-sol', store: false, text: { format: { strict: true } } });
    expect(request).not.toHaveProperty('tools'); expect(request.instructions).toContain('untrusted data');
  });
  it.each(['value', 'quote', 'sourceId', 'faq'])('rejects unsupported %s', type => {
    const value = output();
    if (type === 'value') value.businessName.value = 'Some other business';
    if (type === 'quote') value.services[0].evidence[0].quote = 'Invented drain cleaning quote';
    if (type === 'sourceId') value.locations[0].evidence[0].sourceId = 'OTHER_ACCOUNT';
    if (type === 'faq') value.faqs[0].answer = 'All quotes are free and guaranteed';
    expect(() => validateOnboardingExtraction(value, buildOnboardingEvidence(inventory()))).toThrow();
  });
  it('bounds total website evidence and records incomplete extraction instead of implying complete knowledge', () => {
    const many = inventory(); many.pages = Array.from({ length: 100 }, (_, index) => ({ ...many.pages[0], url: `https://example.test/${index}`, content: { ...many.pages[0].content, mainContent: 'x'.repeat(12000) } }));
    const bundle = buildOnboardingEvidence(many);
    expect(bundle.sources.reduce((total, source) => total + source.text.length, 0)).toBeLessThanOrEqual(60000);
    expect(bundle.limitations.join(' ')).toContain('omitted pages');
  });
});
