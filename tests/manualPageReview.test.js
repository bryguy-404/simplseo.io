import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn(), query: vi.fn(), property: 'https://example.test/' }));
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: {
    verifyIdToken: vi.fn(async token => { if (!['alice', 'bob'].includes(token)) throw Error('invalid'); return { uid: token }; }),
  } };
});
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn(async () => ({ siteUrl: mocks.property, query: mocks.query })) }));
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
vi.mock('openai', () => ({ default: class { constructor(options) { mocks.options(options); this.responses = { create: mocks.create }; } } }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { publicFetch } from '../app/lib/server/publicFetch';
import { POST as content } from '../app/api/page-review/content/route';
import { POST as suggestions } from '../app/api/page-review/suggestions/route';
import { validateReviewSuggestions } from '../app/lib/server/manualPageReview';
import { consumePageReviewQuota } from '../app/lib/server/requestQuota';
import { GET as savedPlan } from '../app/api/page-review/plan/route';
import { PAGE_REVIEW_MODEL } from '../app/lib/pageReviewPolicy';

const pageUrl = 'https://example.test/Services?Topic=Design';
const pageHtml = '<html><head><title>Custom Web Design | Example Studio</title><meta name="description" content="Custom websites and ongoing maintenance for local businesses."></head><body><main><h1>Web design for local businesses</h1><p>Example Studio builds custom websites for local businesses. Read about the design process, project planning and ongoing website maintenance. Contact Example Studio to discuss your website.</p></main></body></html>';
const draft = { title: 'Custom Web Design | Example Studio', description: 'Explore custom website design and ongoing maintenance from Example Studio. Learn about the process and contact us to discuss your website.' };
const reviewChecks = [
  { area: 'indexing', status: 'unknown', finding: 'Google inspection is unavailable.', evidenceIds: [] },
  { area: 'search_intent', status: 'suitable', finding: 'The page explains a website design service.', evidenceIds: ['P3'] },
  { area: 'content', status: 'suitable', finding: 'The page describes planning and maintenance.', evidenceIds: ['P3'] },
  { area: 'headings', status: 'suitable', finding: 'The main heading identifies the service.', evidenceIds: ['P3'] },
  { area: 'metadata', status: 'opportunity', finding: 'The description could mention the planning process.', evidenceIds: ['P2', 'P3'] },
  { area: 'internal_links', status: 'unknown', finding: 'No useful link evidence is supplied.', evidenceIds: [] },
];
const reviewStrategy = {
  searchGoal: 'Help people looking for website design understand this service.', focusArea: 'metadata', finding: 'opportunity_to_test',
  priorityReason: 'The page offers planning information that the description could communicate.',
  limitation: 'This is a clarity opportunity, not evidence of a ranking problem.', checks: reviewChecks,
};
const searchFocus = { phrase: 'custom website design', relatedPhrases: ['website design services'], intent: 'Find help designing a business website.', reason: 'The page describes custom website design and maintenance.', source: 'proposed', evidenceIds: ['P3'], supportingQuote: 'Example Studio builds custom websites for local businesses.', question: null };
const assessment = {
  searchFocus,
  action: 'revise_metadata', metadataVerdict: 'revise', metadataReason: 'The description omits the useful project planning information on the page.', summary: 'Explain what visitors can learn about the design process.',
  reason: 'The page explains project planning and the design process, but the description only mentions services.',
  nextStep: 'Review the new description, then publish it on your website if it accurately describes the page.',
  evidenceIds: ['P2', 'P3'], ...draft,
  fieldReasons: { title: '', description: 'Mention the design process so visitors know what they can learn before contacting the studio.' },
  supportingQuotes: { title: '', description: 'Read about the design process, project planning and ongoing website maintenance.' },
  targetPageUrl: null,
  pageGoal: 'Help visitors understand the website design service.',
  strategy: reviewStrategy,
  recommendations: [{ type: 'metadata', basis: 'opportunity', significance: 'primary', benefit: 'search_snippet', label: 'Explain the planning process', location: 'Page description', reason: 'Help visitors understand the page before visiting.', instruction: 'Review the suggested description and publish it in your website editor.', currentQuote: '', proposedText: null, supportingQuote: '', targetUrl: null, evidenceIds: ['P2', 'P3'] }],
};
const keepAssessment = {
  searchFocus,
  action: 'keep_current', metadataVerdict: 'keep', metadataReason: 'Both fields accurately describe the service and the business.', summary: 'Your current wording clearly describes this page.',
  reason: 'The title identifies the service and business, while the description accurately summarizes the website work offered.',
  nextStep: 'Keep this wording and review another page when you have a useful change to consider.',
  evidenceIds: ['P1', 'P2'], title: null, description: null,
  fieldReasons: { title: '', description: '' }, supportingQuotes: { title: '', description: '' }, targetPageUrl: null,
  pageGoal: 'Help visitors understand the website design service.', recommendations: [],
  strategy: { ...reviewStrategy, focusArea: 'none', finding: 'limited_findings', priorityReason: 'No clear change is supported by this review.',
    checks: reviewChecks.map(check => check.area === 'metadata' ? { ...check, status: 'suitable', finding: 'The title and description accurately describe the service.' } : check) },
};
const completion = payload => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload), annotations: [] }] }] });
const researchCompletion = () => ({ status: 'completed', output: [
  { type: 'web_search_call', status: 'completed' },
  { type: 'message', content: [{ type: 'output_text', text: 'A public guide explains website planning and accessibility.', annotations: [
    { type: 'url_citation', url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development', title: 'Learn web development', start_index: 0, end_index: 15 },
  ] }] },
] });
const htmlResponse = (html = pageHtml, { url = pageUrl, status = 200, type = 'text/html; charset=utf-8' } = {}) => {
  const response = new Response(html, { status, headers: { 'Content-Type': type } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
const request = (body = {}, uid = 'alice', signal) => new Request('https://simplseo.test/api/page-review', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid}` } : {}) },
  body: JSON.stringify({ pageUrl, ...body }), ...(signal ? { signal } : {}),
});

beforeEach(async () => {
  reset(); mocks.property = 'https://example.test/'; mocks.create.mockReset(); mocks.options.mockReset(); mocks.query.mockReset().mockResolvedValue({ rows: [] }); publicFetch.mockReset();
  process.env.OPENAI_API_KEY = 'isolated-test-key';
  delete process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST;
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: mocks.property, revampRunId: 'new-website' });
  await db.collection('users').doc('alice').set({ gscSiteUrl: mocks.property, gscAccessToken: 'test-only' });
  publicFetch.mockImplementation(async () => htmlResponse());
  mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : completion(assessment));
});
afterEach(() => { vi.useRealTimers(); });

describe('current website page review', () => {
  it('rejects anonymous and cross-account calls before scraping or spending', async () => {
    for (const endpoint of [content, suggestions]) {
      expect((await endpoint(request({}, null))).status).toBe(401);
      expect((await endpoint(request({ userId: 'bob' }))).status).toBe(403);
    }
    expect(publicFetch).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    expect([...records.keys()]).toEqual(['onboarding/alice', 'users/alice']);
  });

  it('returns exact current HTML tags separately from legacy h1 and Open Graph fallbacks', async () => {
    publicFetch.mockResolvedValue(htmlResponse('<html><head><meta property="og:description" content="An Open Graph description"></head><body><h1>A visible page heading</h1></body></html>'));
    const response = await content(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data).toMatchObject({ htmlTitle: '', seoMetaDescription: '', h1: 'A visible page heading', title: 'A visible page heading', metaDescription: 'An Open Graph description', source: 'website-html', url: pageUrl, finalUrl: pageUrl });
    expect(Date.parse(result.data.fetchedAt)).toBeGreaterThan(0);
    expect(result.provenance).toMatchObject({ property: mocks.property, websiteRunId: 'new-website' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('ignores supplied provenance and current page content, while preserving URL case and query', async () => {
    const response = await suggestions(request({ focusKeywords: [], currentPage: { textContent: 'Forged free certified awards', fetchedAt: 'fake-date' }, previousAttempts: [{ title: 'Old failed advice', clicks: 0 }], onboarding: { businessName: 'Fake Company' } }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ ...draft, currentPage: { htmlTitle: 'Custom Web Design | Example Studio', url: pageUrl } });
    expect(publicFetch).toHaveBeenCalledWith(pageUrl, { property: mocks.property });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const providerInput = mocks.create.mock.calls[1][0];
    expect(providerInput).toMatchObject({ model: PAGE_REVIEW_MODEL, store: false, text: { format: { type: 'json_schema', strict: true } } });
    const facts = JSON.parse(providerInput.input[1].content);
    expect(facts.optionalFocusKeywords).toEqual([]);
    expect(facts.webpage.textContent).toContain('Example Studio');
    expect(providerInput.input[1].content).not.toMatch(/Forged|Old failed advice|Fake Company/);
    expect(result.analysis).toMatchObject({ action: 'revise_metadata', changedFields: ['description'] });
    expect(result.evidence.facts.map(item => item.id)).toEqual(expect.arrayContaining(['P1', 'P2', 'P3', 'S1', 'S2', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']));
    expect(result.research.status).toBe('available');
    expect([...records.keys()].filter(key => !['requestLimits/', 'users/', 'pageReviewPlans/'].some(prefix => key.startsWith(prefix)))).toEqual(['onboarding/alice']);
  });

  it('rejects another property, URL credentials and fragments before fetching', async () => {
    expect((await suggestions(request({ pageUrl: 'https://elsewhere.test/page' }))).status).toBe(403);
    expect((await content(request({ pageUrl: 'https://secret:password@example.test/page' }))).status).toBe(400);
    expect((await content(request({ pageUrl: `${pageUrl}#section` }))).status).toBe(400);
    expect(publicFetch).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keeps an optional owner goal in private assessment data, not public web research', async () => {
    const goal = '  Help visitors request an accessible website consultation.  ';
    const response = await suggestions(request({ goal }));
    expect(response.status).toBe(200);
    expect((await response.json()).ownerGoal).toBe(goal.trim());
    const researchInput = mocks.create.mock.calls.find(([body]) => body.tools)[0];
    const assessmentInput = mocks.create.mock.calls.find(([body]) => !body.tools)[0];
    expect(JSON.stringify(researchInput)).not.toContain(goal.trim());
    expect(JSON.parse(assessmentInput.input[1].content).ownerGoal).toBe(goal.trim());
  });

  it('collects related-page query comparisons before assessing, without exposing private searches to web research', async () => {
    const relatedUrl = 'https://example.test/services/website-planning';
    const phrase = 'private planning search';
    publicFetch.mockImplementation(async url => htmlResponse(pageHtml.replace('</main>', `<a href="${relatedUrl}">Website planning service</a></main>`), { url }));
    mocks.query.mockImplementation(async body => ({ rows: body.dimensions?.[0] === 'query'
      ? [{ keys: [phrase], clicks: 2, impressions: 20, ctr: 0.1, position: 12 }]
      : [] }));
    const response = await suggestions(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    const comparison = result.diagnostics.relatedPages[0].comparison;
    expect(comparison).toMatchObject({ pageUrl: relatedUrl, phrases: [phrase],
      current: { status: 'available', queries: [{ query: phrase, clicks: 2 }] },
      previous: { status: 'available', queries: [{ query: phrase, impressions: 20 }] } });
    expect(comparison.window).toEqual(result.evidence.window);
    expect(comparison.previousWindow).toEqual(result.evidence.previousWindow);
    const researchInput = mocks.create.mock.calls.find(([body]) => body.tools)[0];
    const assessmentInput = mocks.create.mock.calls.find(([body]) => !body.tools)[0];
    expect(JSON.stringify(researchInput)).not.toContain(phrase);
    expect(JSON.parse(assessmentInput.input[1].content).diagnostics.relatedPages[0].comparison).toEqual(comparison);
    const comparisons = mocks.query.mock.calls.filter(([body]) => body.dimensionFilterGroups?.[0]?.filters.some(filter => filter.operator === 'includingRegex'));
    expect(comparisons).toHaveLength(2);
    expect(comparisons.every(([body]) => body.dimensionFilterGroups[0].filters[0].expression === relatedUrl)).toBe(true);
  });

  it('rejects malformed or excessive goals before fetching or spending', async () => {
    for (const goal of ['x'.repeat(181), 'First line\nSecond line', { service: 'invented' }]) {
      expect((await suggestions(request({ goal }))).status).toBe(400);
    }
    expect(publicFetch).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects cross-property redirects, non-HTML responses and failed pages without asking AI', async () => {
    for (const [options, expected] of [[{ url: 'https://elsewhere.test/' }, 403], [{ type: 'application/pdf' }, 422], [{ status: 404 }, 502]]) {
      publicFetch.mockResolvedValue(htmlResponse(pageHtml, options));
      expect((await suggestions(request())).status).toBe(expected);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('shows same-property redirects for review but requires the exact destination before generating', async () => {
    publicFetch.mockImplementation(async () => htmlResponse(pageHtml, { url: 'https://example.test/actual-page' }));
    const result = await (await content(request())).json();
    expect(result.provenance).toMatchObject({ pageUrl, finalUrl: 'https://example.test/actual-page' });
    expect((await suggestions(request())).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('allows readable current-page inspection but prevents invention for an empty JavaScript shell', async () => {
    publicFetch.mockImplementation(async () => htmlResponse('<html><head><title>A JavaScript site</title></head><body><div id="app"></div><script>startApp()</script></body></html>'));
    expect((await content(request())).status).toBe(200);
    const response = await suggestions(request());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain('not enough readable');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not return old URL-keyword cache values or reuse content from an earlier website run', async () => {
    await db.collection('seoMetaTitles').doc('old-cache').set({ userId: 'alice', pageUrl, title: 'Old website title' });
    const first = await (await suggestions(request())).json();
    await db.collection('onboarding').doc('alice').update({ revampRunId: 'next-website' });
    publicFetch.mockResolvedValue(htmlResponse(pageHtml.replace('Custom Web Design', 'Website Planning')));
    mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : completion({ ...assessment, title: 'Website Planning | Example Studio' }));
    const second = await (await suggestions(request())).json();
    expect(second.provenance.contentFingerprint).not.toBe(first.provenance.contentFingerprint);
    expect(second.provenance.websiteRunId).toBe('next-website');
    expect(second.currentPage.htmlTitle).toContain('Website Planning');
    expect(second.title).toBe('Website Planning | Example Studio');
    expect(mocks.create).toHaveBeenCalledTimes(4);
  });

  it('discards a result if the website run changes during generation', async () => {
    mocks.create.mockImplementation(async body => { if (body.tools) return researchCompletion(); await db.collection('onboarding').doc('alice').update({ revampRunId: 'changed-during-request' }); return completion(assessment); });
    const response = await suggestions(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('setup changed');
  });

  it('does not present truncated, placeholder, unsupported numeric or claim-filled output as a draft', async () => {
    for (const bad of [
      { ...assessment, title: '[Your Business] | Website Services' },
      { ...assessment, description: 'Free certified website design with 25 years of experience. Contact our award-winning team today.' },
      { ...assessment, description: 'Guaranteed rankings and guaranteed results from our expert team. Contact us for a website today.' },
      { ...assessment, title: '', description: '' },
    ]) {
      mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : completion(bad));
      expect((await suggestions(request())).status).toBe(502);
    }
    mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : { ...completion(assessment), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
    expect((await suggestions(request())).status).toBe(502);
  });

  it('returns actionable provider failures without exposing provider response contents', async () => {
    mocks.create.mockRejectedValue(Error('provider-secret details'));
    const response = await suggestions(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/temporarily unavailable/);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it('bounds scraped content and refuses oversized keyword input', async () => {
    publicFetch.mockResolvedValue(htmlResponse(`<html><head><title>${'T'.repeat(2000)}</title></head><body><h1>${'H'.repeat(1000)}</h1><main>${'Website design '.repeat(1000)}</main></body></html>`));
    const result = await (await content(request())).json();
    expect(result.data.htmlTitle.length).toBe(500);
    expect(result.data.h1.length).toBe(500);
    expect(result.data.textContent.length).toBe(6000);
    expect((await suggestions(request({ focusKeywords: ['x'.repeat(121)] }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('evidence-backed assessment integration', () => {
  it('saves the automatic focus and tasks, then restores them without another AI call', async () => {
    const generated = await (await suggestions(request())).json();
    expect(generated.plan.review.analysis.searchFocus).toMatchObject({ phrase: searchFocus.phrase, source: 'proposed' });
    expect(generated.plan.tasks).toHaveLength(1);
    const calls = mocks.create.mock.calls.length;
    const response = await savedPlan(new Request(`https://simplseo.test/api/page-review/plan?pageUrl=${encodeURIComponent(pageUrl)}`, { headers: { Authorization: 'Bearer alice' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.json()).plan).toEqual(generated.plan);
    expect(mocks.create).toHaveBeenCalledTimes(calls);
    expect([...records.keys()].filter(key => key.startsWith('implementedSeoTips/'))).toEqual([]);
  });

  it('keeps the saved plan intact when a later analysis fails or omits a required focus', async () => {
    const generated = await (await suggestions(request())).json();
    for (const mode of ['provider-failure', 'missing-focus']) {
      const incomplete = { ...assessment }; delete incomplete.searchFocus;
      mocks.create.mockImplementation(async body => {
        if (body.tools) return researchCompletion();
        if (mode === 'provider-failure') throw Error('private-provider-error');
        return completion(incomplete);
      });
      expect((await suggestions(request())).status).toBe(mode === 'provider-failure' ? 503 : 502);
      const response = await savedPlan(new Request(`https://simplseo.test/api/page-review/plan?pageUrl=${encodeURIComponent(pageUrl)}`, { headers: { Authorization: 'Bearer alice' } }));
      expect((await response.json()).plan).toEqual(generated.plan);
    }
  });

  it('retains omitted earlier tasks and uses them as private review context', async () => {
    const first = await (await suggestions(request())).json();
    mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : completion(keepAssessment));
    const next = await (await suggestions(request())).json();
    expect(next.plan.tasks).toHaveLength(1);
    expect(next.plan.tasks[0].id).toBe(first.plan.tasks[0].id);
    expect(next.plan.tasks[0].status).toBe('todo');
    const privateRequest = mocks.create.mock.calls.filter(([body]) => !body.tools).at(-1)[0];
    expect(privateRequest.input[1].content).toContain(assessment.recommendations[0].label);
    const publicRequest = mocks.create.mock.calls.filter(([body]) => body.tools).at(-1)[0];
    expect(JSON.stringify(publicRequest)).not.toContain(assessment.recommendations[0].label);
  });

  it('changes the content fingerprint when only an internal link changes', async () => {
    publicFetch.mockResolvedValue(htmlResponse(pageHtml.replace('</main>', '<a href="/one">Explore the service</a></main>')));
    const first = await (await content(request())).json();
    publicFetch.mockResolvedValue(htmlResponse(pageHtml.replace('</main>', '<a href="/two">Explore the service</a></main>')));
    const second = await (await content(request())).json();
    expect(first.data.textContent).toBe(second.data.textContent);
    expect(first.provenance.contentFingerprint).not.toBe(second.provenance.contentFingerprint);
  });

  it('rejects a missing strategy, invented check citations and a supporting task presented as the primary opportunity', async () => {
    const missing = { ...assessment }; delete missing.strategy;
    const invented = { ...assessment, strategy: { ...reviewStrategy, checks: reviewChecks.map(check => check.area === 'content' ? { ...check, evidenceIds: ['P99'] } : check) } };
    const inconsistent = { ...assessment, recommendations: assessment.recommendations.map(item => ({ ...item, significance: 'supporting' })) };
    for (const payload of [missing, invented, inconsistent]) {
      mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : completion(payload));
      const response = await suggestions(request());
      expect(response.status).toBe(502);
      expect((await response.json()).error).toMatch(/clearly supported review/);
    }
    expect([...records.keys()].filter(key => !['requestLimits/', 'users/', 'pageReviewPlans/'].some(prefix => key.startsWith(prefix)))).toEqual(['onboarding/alice']);
  });

  it('returns a useful keep-current decision without inventing a draft or an edit', async () => {
    mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : completion(keepAssessment));
    const response = await suggestions(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const result = await response.json();
    expect(result).toMatchObject({ title: null, description: null, analysis: { action: 'keep_current', changedFields: [], evidenceIds: ['P1', 'P2'], strategy: { finding: 'limited_findings' } }, provenance: { reviewVersion: 6, model: PAGE_REVIEW_MODEL } });
    expect(result.evidence.current).toMatchObject({ totals: null, totalsStatus: 'no_data', queriesStatus: 'no_data' });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenCalledTimes(8);
    expect([...records.keys()].filter(key => !['requestLimits/', 'users/', 'pageReviewPlans/'].some(prefix => key.startsWith(prefix)))).toEqual(['onboarding/alice']);
  });

  it('keeps accurate metadata while offering a visibility investigation as the useful next action', async () => {
    const visibility = { ...keepAssessment, action: 'investigate_visibility',
      summary: 'Check whether customers can find this service page.',
      reason: 'The title describes the service, but the available search history remains sparse.',
      nextStep: 'Inspect this exact URL in Search Console, then check whether relevant pages link to it.',
      strategy: { ...keepAssessment.strategy, finding: 'insufficient_evidence', focusArea: 'internal_links', priorityReason: 'The review lacks link evidence to explain sparse visibility.' },
      evidenceIds: ['P1', 'H1', 'H6'], recommendations: [{ ...assessment.recommendations[0], type: 'check', basis: 'needs_check', benefit: 'diagnosis', label: 'Review relevant internal links', location: 'Page content', instruction: 'Check whether the service links describe their destination.' }] };
    mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : completion(visibility));
    const response = await suggestions(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ title: null, description: null,
      analysis: { action: 'investigate_visibility', metadataVerdict: 'keep', metadataReason: keepAssessment.metadataReason, changedFields: [] },
      provenance: { reviewVersion: 6 } });
    expect([...records.keys()].filter(key => !['requestLimits/', 'users/', 'pageReviewPlans/'].some(prefix => key.startsWith(prefix)))).toEqual(['onboarding/alice']);
  });

  it('uses strict bounded Responses output, private storage settings and no automatic retries', async () => {
    expect((await suggestions(request())).status).toBe(200);
    expect(mocks.options).toHaveBeenCalledExactlyOnceWith({ apiKey: 'isolated-test-key', maxRetries: 0, timeout: 45000 });
    const [body, options] = mocks.create.mock.calls[1];
    expect(body).toMatchObject({ model: PAGE_REVIEW_MODEL, store: false, max_output_tokens: 9000, reasoning: { effort: 'medium' },
      text: { format: { name: 'page_review', type: 'json_schema', strict: true, schema: { additionalProperties: false } } } });
    expect(body).not.toHaveProperty('tools');
    expect(body.model).not.toBe('gpt-4-turbo');
    expect(options.timeout).toBe(65000);
    expect(options.signal.aborted).toBe(false);
  });

  it('sends only public webpage context to automatic web search, then combines dated private evidence for analysis', async () => {
    const privatePhrase = 'private-customer-query-marker';
    mocks.query.mockImplementation(async body => body.dimensions?.[0] === 'query'
      ? { rows: [{ keys: [privatePhrase], clicks: 11, impressions: 12345, ctr: 11 / 12345, position: 13.25 }] }
      : body.dimensions?.[0] === 'page' ? { rows: [] }
        : { rows: [{ clicks: 11, impressions: 12345, ctr: 11 / 12345, position: 13.25 }] });
    mocks.create.mockResolvedValueOnce(researchCompletion()).mockResolvedValueOnce(completion({ ...assessment, evidenceIds: ['P2', 'P3', 'W1'] }));
    const response = await suggestions(request({ includeResearch: true, focusKeywords: [privatePhrase], userId: 'alice' }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const [searchBody, searchOptions] = mocks.create.mock.calls[0];
    const [analysisBody] = mocks.create.mock.calls[1];
    expect(searchBody).toMatchObject({ model: PAGE_REVIEW_MODEL, store: false, max_output_tokens: 1800, max_tool_calls: 2,
      tool_choice: 'required', tools: [{ type: 'web_search', search_context_size: 'low' }] });
    expect(searchOptions.timeout).toBe(45000);
    const publicInput = JSON.parse(searchBody.input[1].content);
    expect(Object.keys(publicInput).sort()).toEqual(['heading', 'headings', 'pageUrl', 'publicPageExcerpt', 'title']);
    expect(publicInput).toMatchObject({ pageUrl, title: draft.title, heading: 'Web design for local businesses' });
    expect(publicInput.publicPageExcerpt).toContain('Example Studio');
    expect(publicInput.publicPageExcerpt.length).toBeLessThanOrEqual(3500);
    expect(publicInput.headings.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(searchBody)).not.toMatch(/private-customer-query-marker|12345|alice|isolated-test-key|new-website/);
    const analysisInput = JSON.parse(analysisBody.input[1].content);
    expect(analysisBody).not.toHaveProperty('tools');
    expect(analysisInput.evidence.current.queries[0].query).toBe(privatePhrase);
    expect(analysisInput.evidence.fetchedAt).toBeTruthy();
    expect(analysisInput.research).toMatchObject({ status: 'available', sources: [{ id: 'W1', url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development' }] });
    const result = await response.json();
    expect(result.research.status).toBe('available');
    expect(result.analysis.evidenceIds).toContain('W1');
    expect(result.research.limitation).toContain('not a report of competitor Google rankings');
  });

  it('finishes one page-only assessment when automatic research fails, without hiding the missing research', async () => {
    mocks.create.mockRejectedValueOnce(new Error('private-search-provider-error')).mockResolvedValueOnce(completion(keepAssessment));
    const response = await suggestions(request({ includeResearch: true }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const result = await response.json();
    expect(result.research).toMatchObject({ status: 'unavailable', summary: '', sources: [] });
    expect(result.research.limitation).toContain('Web research was unavailable');
    expect(result.analysis.action).toBe('keep_current');
    expect(JSON.stringify(result)).not.toContain('private-search-provider-error');
    expect(JSON.parse(mocks.create.mock.calls[1][0].input[1].content).research.status).toBe('unavailable');
  });

  it('does not imply research succeeded when a response has citations but no completed web search', async () => {
    const failedResearch = researchCompletion();
    failedResearch.output = failedResearch.output.filter(item => item.type !== 'web_search_call');
    mocks.create.mockResolvedValueOnce(failedResearch).mockResolvedValueOnce(completion(keepAssessment));
    const result = await (await suggestions(request({ includeResearch: true }))).json();
    expect(result.research.status).toBe('unavailable');
    expect(result.research.sources).toEqual([]);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    completion({ ...assessment, evidenceIds: ['P2', 'W99'] }),
    completion({ ...assessment, supportingQuotes: { title: '', description: 'An invented statement that is not on the page.' } }),
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private-provider-refusal' }] }] },
    { ...completion(assessment), status: 'incomplete' },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"action":' }] }] },
  ])('rejects ungrounded citations, fabricated support and incomplete/refused output %#', async providerResult => {
    mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : providerResult);
    const response = await suggestions(request());
    expect(response.status).toBe(502);
    const result = await response.json();
    expect(result.error).toContain('clearly supported review');
    expect(result).not.toHaveProperty('title');
    expect(JSON.stringify(result)).not.toContain('private-provider-refusal');
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it('keeps genuine totals while honestly representing a failed Google query sample', async () => {
    mocks.query.mockImplementation(async body => {
      if (body.dimensions) throw Error('private-google-provider-error');
      return { rows: [{ clicks: 3, impressions: 100, ctr: 0.03, position: 8 }] };
    });
    const response = await suggestions(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.evidence.status).toBe('partial');
    expect(result.evidence.current).toMatchObject({ totals: { clicks: 3, impressions: 100 }, totalsStatus: 'available', queries: [], queriesStatus: 'unavailable' });
    const supplied = JSON.parse(mocks.create.mock.calls[1][0].input[1].content);
    expect(supplied.evidence.status).toBe('partial');
    expect(supplied.evidence.limitations.join(' ')).toContain('Missing metrics have not been treated as zero');
    expect(JSON.stringify(result)).not.toContain('private-google-provider-error');
  });

  it('stops before analysis if the website run changes while automatic research is running', async () => {
    mocks.create.mockImplementationOnce(async () => {
      await db.collection('onboarding').doc('alice').update({ revampRunId: 'changed-during-research' });
      return researchCompletion();
    });
    const response = await suggestions(request({ includeResearch: true }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('setup changed');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toHaveProperty('tools');
  });

  it('discards research if the connected property changes before the private analysis call', async () => {
    mocks.create.mockImplementationOnce(async () => {
      mocks.property = 'https://new-property.test/';
      return researchCompletion();
    });
    const response = await suggestions(request());
    expect(response.status).toBe(409);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toHaveProperty('tools');
  });

  it('stops before analysis if the request is cancelled during research', async () => {
    const controller = new AbortController();
    mocks.create.mockImplementationOnce(async () => { controller.abort(); return researchCompletion(); });
    const response = await suggestions(request({ includeResearch: true }, 'alice', controller.signal));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('cancelled');
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false, true])('always researches when the legacy includeResearch flag is %s', async includeResearch => {
    const response = await suggestions(request({ includeResearch }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[0][0].tools).toEqual([{ type: 'web_search', search_context_size: 'low' }]);
    expect((await response.json()).research.status).toBe('available');
  });

});

describe('page-review spending boundaries', () => {
  it('allows twenty researched reviews per user per day and blocks the next request before provider spending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
    mocks.create.mockImplementation(async body => body.tools ? researchCompletion() : completion(keepAssessment));
    for (let index = 0; index < 20; index += 1) {
      expect((await suggestions(request())).status).toBe(200);
      vi.advanceTimersByTime(60000);
    }
    expect(mocks.create).toHaveBeenCalledTimes(40);
    const response = await suggestions(request());
    expect(response.status).toBe(429);
    expect((await response.json()).error).not.toMatch(/turn off|disable|research allowance/i);
    expect(mocks.create).toHaveBeenCalledTimes(40);
    await db.collection('onboarding').doc('bob').set({ isComplete: true, gscProperty: mocks.property, revampRunId: 'bob-current-website' });
    await db.collection('users').doc('bob').set({ gscSiteUrl: mocks.property, gscAccessToken: 'test-only' });
    expect((await suggestions(request({}, 'bob'))).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(42);
  });

  it('counts unsuccessful attempts and stops a burst before the next research or analysis call', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
    mocks.create.mockRejectedValue(new Error('provider failure'));
    for (let index = 0; index < 5; index += 1) expect((await suggestions(request())).status).toBe(503);
    expect((await suggestions(request())).status).toBe(429);
    expect(mocks.create).toHaveBeenCalledTimes(10);
  });

  it('resets the daily allowance in its next UTC day bucket', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
    for (let index = 0; index < 20; index += 1) { await consumePageReviewQuota('alice'); vi.advanceTimersByTime(60000); }
    await expect(consumePageReviewQuota('alice')).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
    await expect(consumePageReviewQuota('alice')).resolves.toBeUndefined();
  });
});

it('validates that numeric claims come from the page, without rejecting supported facts', () => {
  expect(validateReviewSuggestions(JSON.stringify({ title: 'Explore 3 Website Design Options', description: 'Read about 3 website design options and the planning process for a business website.' }), { htmlTitle: '', seoMetaDescription: '', h1: '', textContent: 'Read about 3 website design options.', headings: [] }).title).toContain('3');
});
