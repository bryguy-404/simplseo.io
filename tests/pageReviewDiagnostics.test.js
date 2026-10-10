import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', () => ({ auth: {}, db: {} }));
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn() }));
vi.mock('../app/lib/server/scrapeContent', () => ({ fetchCurrentPageContent: vi.fn() }));
import { getGscConnection } from '../app/lib/server/gscConnection';
import { fetchCurrentPageContent } from '../app/lib/server/scrapeContent';
import { collectPageReviewDiagnostics } from '../app/lib/server/pageReviewDiagnostics';

const property = 'https://example.test/';
const pageUrl = property;
const currentPage = {
  url: pageUrl, finalUrl: pageUrl, fetchedAt: '2026-10-10T16:00:00Z', source: 'website-html',
  htmlTitle: 'Example Studio | Design and Software', h1: 'Design and Software', textContent: 'We design useful websites and software.',
  headings: [{ tag: 'h1', text: 'Design and Software', segments: [] }], technical: { httpStatus: 200, canonicalStatus: 'missing', noindex: { generic: false, googlebot: false } },
  internalLinks: [
    { url: `${property}services/design`, text: 'Design services', context: 'main' },
    { url: `${property}services/software`, text: 'Software services', context: 'navigation' },
    { url: `${property}services/training`, text: 'Training services', context: 'main' },
  ],
};
const inspectionPayload = (overrides = {}) => ({ inspectionResult: {
  inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=https%3A%2F%2Fexample.test%2F&id=opaque',
  indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', robotsTxtState: 'ALLOWED', indexingState: 'INDEXING_ALLOWED',
    pageFetchState: 'SUCCESSFUL', lastCrawlTime: '2026-10-08T05:26:00Z', googleCanonical: pageUrl, userCanonical: pageUrl, crawledAs: 'MOBILE', ...overrides },
} });
let inspect;
const collect = options => collectPageReviewDiagnostics('alice', { pageUrl, property, currentPage, ...options });
beforeEach(() => {
  inspect = vi.fn(async () => inspectionPayload());
  getGscConnection.mockReset().mockResolvedValue({ siteUrl: property, inspect });
  fetchCurrentPageContent.mockReset().mockImplementation(async url => ({ ...currentPage, url, finalUrl: url, htmlTitle: `Title for ${url}`, mainContent: 'A useful service page with examples.', internalLinks: [] }));
});

describe('bounded first-party diagnostics', () => {
  it('checks current Google state and at most two relevant source links with exact property and timestamps', async () => {
    const result = await collect();
    expect(getGscConnection).toHaveBeenCalledExactlyOnceWith('alice');
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(fetchCurrentPageContent).toHaveBeenCalledTimes(2);
    expect(fetchCurrentPageContent.mock.calls).toEqual([
      [`${property}services/design`, { property }], [`${property}services/software`, { property }],
    ]);
    expect(result.inspection).toMatchObject({ status: 'available', url: pageUrl, property, source: 'google_url_inspection', view: 'google_index',
      coverageState: 'Submitted and indexed', lastCrawlTime: '2026-10-08T05:26:00Z', googleCanonical: pageUrl, checkedAt: expect.any(String) });
    expect(result.relatedPages[0]).toMatchObject({ pageUrl: `${property}services/design`, status: 'available', linkedFrom: pageUrl, anchorText: 'Design services',
      currentPage: { url: `${property}services/design`, fetchedAt: currentPage.fetchedAt }, inspection: { url: `${property}services/design` } });
    expect(result.facts.map(item => item.id)).toEqual(['I1', 'P4', 'P5', 'P6', 'D1', 'D2']);
    expect(result.facts.find(item => item.id === 'I1').text).toContain('not a live indexing test');
    expect(result.limits).toEqual({ maxRelatedPages: 2, maxInspections: 3 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('does not fetch guessed pages when there are no related source anchors', async () => {
    const result = await collect({ currentPage: { ...currentPage, internalLinks: [] } });
    expect(fetchCurrentPageContent).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledExactlyOnceWith(pageUrl);
    expect(result.relatedPages).toEqual([]);
  });

  it('rejects changed properties and unsafe selected-page scope before any inspection or website fetch', async () => {
    getGscConnection.mockResolvedValue({ siteUrl: 'https://elsewhere.test/', inspect });
    await expect(collect()).rejects.toMatchObject({ status: 409 });
    expect(inspect).not.toHaveBeenCalled();
    expect(fetchCurrentPageContent).not.toHaveBeenCalled();
    for (const unsafe of ['https://elsewhere.test/a', 'https://user:pass@example.test/a', `${property}a#fragment`, 'file:///secret', 'https://example.test:8080/a']) {
      await expect(collect({ pageUrl: unsafe })).rejects.toMatchObject({ status: 403 });
    }
  });

  it('rejects mismatched source content so another page cannot be used as evidence', async () => {
    await expect(collect({ currentPage: { ...currentPage, url: `${property}other` } })).rejects.toMatchObject({ status: 409 });
    await expect(collect({ currentPage: { ...currentPage, finalUrl: 'https://elsewhere.test/' } })).rejects.toMatchObject({ status: 409 });
    expect(inspect).not.toHaveBeenCalled();
    expect(fetchCurrentPageContent).not.toHaveBeenCalled();
  });

  it('deduplicates fragment anchors and excludes credentials, off-property pages, ports, query actions and unsafe resources', async () => {
    const urls = [
      'https://elsewhere.test/services/design', 'https://example.test.evil.test/services/design', 'https://user:secret@example.test/services/design',
      'http://127.0.0.1/services/design', 'https://example.test:8080/services/design', 'javascript:alert(1)',
      `${property}services/design?delete=true`, `${property}logout`, `${property}api/services/design`, `${property}services/design.pdf`,
      `${property}services/design#one`, `${property}services/design#two`,
    ];
    const result = await collect({ currentPage: { ...currentPage, internalLinks: urls.map(url => ({ url, text: 'Design services', context: 'main' })) } });
    expect(result.relatedPages).toHaveLength(1);
    expect(fetchCurrentPageContent).toHaveBeenCalledExactlyOnceWith(`${property}services/design`, { property });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('bounds richer linked-page content and diagnostic facts', async () => {
    fetchCurrentPageContent.mockImplementation(async url => ({ ...currentPage, url, finalUrl: url, mainContent: 'x'.repeat(20000),
      headings: Array.from({ length: 30 }, () => ({ text: 'Heading' })), contentSections: Array.from({ length: 16 }, () => ({ text: 'Section' })),
      internalLinks: Array.from({ length: 100 }, () => ({ url: `${property}services` })) }));
    const result = await collect();
    for (const page of result.relatedPages.map(item => item.currentPage)) {
      expect(page.textContent.length).toBe(5000);
      expect(page.headings).toHaveLength(16);
      expect(page.contentSections).toHaveLength(8);
      expect(page.internalLinks).toHaveLength(30);
    }
    expect(result.facts.every(item => item.text.length < 10000)).toBe(true);
  });
});

describe('Google inspection semantics, errors and safe links', () => {
  it('keeps missing crawl/canonical fields unknown for discovered pages, without inventing a live test or crawl time', async () => {
    inspect.mockResolvedValue({ inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' } } });
    const result = await collect();
    expect(result.inspection).toMatchObject({ status: 'available', coverageState: 'Discovered - currently not indexed', lastCrawlTime: null,
      googleCanonical: null, userCanonical: null, inspectionUrl: null, robotsTxtState: null, indexingState: null });
    expect(result.inspection).not.toHaveProperty('liveIndexable');
  });

  it.each([
    'https://evil.test/search-console/inspect', 'https://search.google.com.evil.test/search-console/inspect',
    'https://user:secret@search.google.com/search-console/inspect', 'http://search.google.com/search-console/inspect',
    'https://search.google.com/redirect?url=https://evil.test', 'javascript:alert(1)', 'https://search.google.com/search-console/inspect#fragment',
  ])('never exposes an unsafe inspection link %s', async link => {
    const payload = inspectionPayload(); payload.inspectionResult.inspectionResultLink = link;
    inspect.mockResolvedValue(payload);
    expect((await collect()).inspection).toMatchObject({ status: 'available', inspectionUrl: null });
  });

  it.each([{}, { error: { message: 'private failure' } }, { inspectionResult: { indexStatusResult: {} } },
    inspectionPayload({ verdict: { malicious: true } }), inspectionPayload({ lastCrawlTime: 'not-a-date' })])('represents malformed inspection data as unavailable %#', async payload => {
    inspect.mockResolvedValue(payload);
    const result = await collect();
    expect(result.inspection).toMatchObject({ status: 'unavailable', lastCrawlTime: null, coverageState: null });
    expect(result.facts.some(item => item.id === 'I1')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private failure');
  });

  it('retains readable linked HTML when Google is unavailable and retains Google state when linked HTML fails', async () => {
    inspect.mockImplementation(async url => { if (url === pageUrl) throw new Error('private Google failure'); return inspectionPayload(); });
    fetchCurrentPageContent.mockRejectedValue(Object.assign(new Error('private HTTP failure'), { httpStatus: 404 }));
    const result = await collect();
    expect(result.inspection.status).toBe('unavailable');
    expect(result.relatedPages.every(item => item.status === 'unavailable' && item.httpStatus === 404 && item.inspection.status === 'available')).toBe(true);
    expect(result.relatedPages.every(item => item.currentPage === null)).toBe(true);
    expect(result.facts.find(item => item.id === 'D1').text).toContain('Current HTML could not be read');
    expect(JSON.stringify(result)).not.toMatch(/private Google|private HTTP/);
  });

  it('still collects first-party HTML when the account connection fails without replacing missing inspection with zeros', async () => {
    getGscConnection.mockRejectedValue(new Error('private refresh credential'));
    const result = await collect();
    expect(result.inspection).toMatchObject({ status: 'unavailable', verdict: null, lastCrawlTime: null });
    expect(result.relatedPages.every(item => item.status === 'available' && item.inspection.status === 'unavailable')).toBe(true);
    expect(inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private refresh');
  });
});
