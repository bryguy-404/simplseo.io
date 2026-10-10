import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), property: 'https://example.test/' }));
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: {
    verifyIdToken: vi.fn(async token => { if (!['alice', 'bob'].includes(token)) throw Error('invalid'); return { uid: token }; }),
  } };
});
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn(async () => ({ siteUrl: mocks.property })) }));
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
vi.mock('openai', () => ({ default: class { constructor() { this.chat = { completions: { create: mocks.create } }; } } }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { publicFetch } from '../app/lib/server/publicFetch';
import { POST as content } from '../app/api/page-review/content/route';
import { POST as suggestions } from '../app/api/page-review/suggestions/route';
import { validateReviewSuggestions } from '../app/lib/server/manualPageReview';

const pageUrl = 'https://example.test/Services?Topic=Design';
const pageHtml = '<html><head><title>Custom Web Design | Example Studio</title><meta name="description" content="Custom websites and ongoing maintenance for local businesses."></head><body><main><h1>Web design for local businesses</h1><p>Example Studio builds custom websites for local businesses. Read about the design process, project planning and ongoing website maintenance. Contact Example Studio to discuss your website.</p></main></body></html>';
const draft = { title: 'Custom Web Design | Example Studio', description: 'Explore custom website design and ongoing maintenance from Example Studio. Learn about the process and contact us to discuss your website.' };
const completion = payload => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }] });
const htmlResponse = (html = pageHtml, { url = pageUrl, status = 200, type = 'text/html; charset=utf-8' } = {}) => {
  const response = new Response(html, { status, headers: { 'Content-Type': type } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
const request = (body = {}, uid = 'alice') => new Request('https://simplseo.test/api/page-review', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid}` } : {}) },
  body: JSON.stringify({ pageUrl, ...body }),
});

beforeEach(async () => {
  reset(); mocks.property = 'https://example.test/'; mocks.create.mockReset(); publicFetch.mockReset();
  process.env.OPENAI_API_KEY = 'isolated-test-key';
  delete process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST;
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: mocks.property, revampRunId: 'new-website' });
  publicFetch.mockImplementation(async () => htmlResponse());
  mocks.create.mockResolvedValue(completion(draft));
});

describe('current website page review', () => {
  it('rejects anonymous and cross-account calls before scraping or spending', async () => {
    for (const endpoint of [content, suggestions]) {
      expect((await endpoint(request({}, null))).status).toBe(401);
      expect((await endpoint(request({ userId: 'bob' }))).status).toBe(403);
    }
    expect(publicFetch).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    expect([...records.keys()]).toEqual(['onboarding/alice']);
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
    expect(publicFetch).toHaveBeenCalledWith(pageUrl);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const providerInput = mocks.create.mock.calls[0][0];
    expect(providerInput).toMatchObject({ model: 'gpt-4-turbo', response_format: { type: 'json_object' } });
    const facts = JSON.parse(providerInput.messages[1].content);
    expect(facts.optionalFocusKeywords).toEqual([]);
    expect(facts.webpage.textContent).toContain('Example Studio');
    expect(providerInput.messages[1].content).not.toMatch(/Forged|Old failed advice|Fake Company/);
    expect([...records.keys()].filter(key => !key.startsWith('requestLimits/'))).toEqual(['onboarding/alice']);
  });

  it('rejects another property, URL credentials and fragments before fetching', async () => {
    expect((await suggestions(request({ pageUrl: 'https://elsewhere.test/page' }))).status).toBe(403);
    expect((await content(request({ pageUrl: 'https://secret:password@example.test/page' }))).status).toBe(400);
    expect((await content(request({ pageUrl: `${pageUrl}#section` }))).status).toBe(400);
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
    const second = await (await suggestions(request())).json();
    expect(second.provenance.contentFingerprint).not.toBe(first.provenance.contentFingerprint);
    expect(second.provenance.websiteRunId).toBe('next-website');
    expect(second.currentPage.htmlTitle).toContain('Website Planning');
    expect(second.title).toBe(draft.title);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it('discards a result if the website run changes during generation', async () => {
    mocks.create.mockImplementation(async () => { await db.collection('onboarding').doc('alice').update({ revampRunId: 'changed-during-request' }); return completion(draft); });
    const response = await suggestions(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('setup changed');
  });

  it('does not present truncated, placeholder, unsupported numeric or claim-filled output as a draft', async () => {
    for (const bad of [
      { ...draft, title: '[Your Business] | Website Services' },
      { ...draft, description: 'Free certified website design with 25 years of experience. Contact our award-winning team today.' },
      { ...draft, description: 'Guaranteed rankings and guaranteed results from our expert team. Contact us for a website today.' },
      { title: '', description: '' },
    ]) {
      mocks.create.mockResolvedValue(completion(bad));
      expect((await suggestions(request())).status).toBe(502);
    }
    mocks.create.mockResolvedValue({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(draft) } }] });
    expect((await suggestions(request())).status).toBe(502);
  });

  it('returns actionable provider failures without exposing provider response contents', async () => {
    mocks.create.mockRejectedValue(Error('provider-secret details'));
    const response = await suggestions(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/temporarily unavailable/);
    expect(mocks.create).toHaveBeenCalledTimes(1);
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

it('validates that numeric claims come from the page, without rejecting supported facts', () => {
  expect(validateReviewSuggestions(JSON.stringify({ title: 'Explore 3 Website Design Options', description: 'Read about 3 website design options and the planning process for a business website.' }), { htmlTitle: '', seoMetaDescription: '', h1: '', textContent: 'Read about 3 website design options.', headings: [] }).title).toContain('3');
});
