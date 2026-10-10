import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', () => ({ auth: {}, db: {} }));
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
import { publicFetch } from '../app/lib/server/publicFetch';
import { fetchCurrentPageContent } from '../app/lib/server/scrapeContent';

const property = 'https://example.test/';
const pageUrl = `${property}Services?Topic=Design`;
function response(html, { url = pageUrl, status = 200, headers = {}, redirectChain } = {}) {
  const result = new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
  Object.defineProperty(result, 'url', { value: url });
  if (redirectChain) Object.defineProperty(result, 'redirectChain', { value: redirectChain });
  return result;
}
const read = () => fetchCurrentPageContent(pageUrl, { property });
beforeEach(() => publicFetch.mockReset());

describe('downloaded structure and source-only visibility evidence', () => {
  it('preserves separate screen-reader and aria-hidden heading text without asserting rendered visibility', async () => {
    publicFetch.mockResolvedValue(response('<html><head><title>Actual title</title><meta name="description" content="Actual description"></head><body><nav>Navigation text</nav><main><h1><span class="sr-only">Local design services</span><span aria-hidden="true">Development <b>Solutions.</b></span></h1><section><h2>Our work</h2><p>Projects and examples.</p></section><section hidden><h2>Template content</h2></section></main><script>secret script</script></body></html>'));
    const result = await read();
    expect(publicFetch).toHaveBeenCalledExactlyOnceWith(pageUrl, { property });
    expect(result).toMatchObject({ htmlTitle: 'Actual title', seoMetaDescription: 'Actual description', url: pageUrl, finalUrl: pageUrl });
    expect(result.headings[0]).toMatchObject({ tag: 'h1', srOnly: false, ariaHidden: false, hidden: false });
    expect(result.headings[0].segments).toEqual([
      { text: 'Local design services', srOnly: true, ariaHidden: false, hidden: false },
      { text: 'Development', srOnly: false, ariaHidden: true, hidden: false },
      { text: 'Solutions.', srOnly: false, ariaHidden: true, hidden: false },
    ]);
    expect(result.headings.find(item => item.text === 'Template content').hidden).toBe(true);
    expect(result.textContent).not.toContain('Navigation text');
    expect(result.textContent).not.toContain('secret script');
    expect(result.contentSections[0]).toMatchObject({ heading: 'Our work', text: 'Our workProjects and examples.', truncated: false });
    expect(result.structuralLimitations.join(' ')).toContain('not a browser rendering');
    expect(result).not.toHaveProperty('visibleH1');
  });

  it('bounds the legacy text, richer main content, sections, heading segments and internal links with coverage counts', async () => {
    const html = `<main><p>${'Words '.repeat(3000)}</p>${Array.from({ length: 40 }, (_, index) => `<section><h2>Section ${index}</h2><p>${'Detail '.repeat(300)}</p></section>`).join('')}${Array.from({ length: 120 }, (_, index) => `<a href="/services/${index}">Service ${index}</a>`).join('')}</main>`;
    publicFetch.mockResolvedValue(response(html));
    const result = await read();
    expect(result.textContent).toHaveLength(6000);
    expect(result.mainContent).toHaveLength(12000);
    expect(result.headings).toHaveLength(30);
    expect(result.contentSections).toHaveLength(16);
    expect(result.contentSections.every(item => item.text.length <= 1200 && item.truncated)).toBe(true);
    expect(result.internalLinks).toHaveLength(100);
    expect(result.structureCoverage).toMatchObject({ mainContentTruncated: true, headingsTruncated: true, sectionsTruncated: true, internalLinksTruncated: true, headingCount: 40, sectionCount: 40, internalLinkCount: 120 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('technical observations and URL boundaries', () => {
  it('reads canonical, robots and redirect metadata without turning their absence into an indexing verdict', async () => {
    const finalUrl = `${property}new-page`;
    const redirectChain = [{ url: pageUrl, status: 301, destination: finalUrl }];
    publicFetch.mockResolvedValue(response('<head><link rel="alternate canonical" href="/preferred"><meta name="ROBOTS" content="index, follow"><meta name="Googlebot" content="noindex"></head><body><h1>Example</h1></body>', { url: finalUrl, redirectChain, headers: { 'x-robots-tag': 'otherbot: noindex' } }));
    const result = await read();
    expect(result.technical).toMatchObject({ httpStatus: 200, requestedUrl: pageUrl, finalUrl, redirected: true, redirectChain, canonicalUrl: `${property}preferred`, canonicalStatus: 'declared', canonicalInProperty: true, noindex: { generic: false, googlebot: true } });
    expect(result.technical.robotsMeta).toEqual([{ agent: 'robots', content: 'index, follow' }, { agent: 'googlebot', content: 'noindex' }]);
    expect(result.technical).not.toHaveProperty('indexed');
    publicFetch.mockResolvedValue(response('<main>Plain page</main>'));
    expect((await read()).technical).toMatchObject({ canonicalUrl: null, canonicalStatus: 'missing', robotsMeta: [], xRobotsTag: '', noindex: { generic: false, googlebot: false } });
  });

  it.each([
    ['noindex, nofollow', true, true], ['googlebot: noindex, noarchive', false, true],
    ['bingbot: noindex', false, false], ['none', true, true], ['index, follow', false, false],
    ['bingbot: noarchive, googlebot: noindex', false, true],
  ])('interprets scoped X-Robots-Tag %s without applying another crawler’s rule to Google', async (header, generic, googlebot) => {
    publicFetch.mockResolvedValue(response('<main>Page</main>', { headers: { 'x-robots-tag': header } }));
    expect((await read()).technical.noindex).toEqual({ generic, googlebot });
  });

  it('resolves HTML base URLs but retains only credential-free same-property anchors', async () => {
    publicFetch.mockResolvedValue(response('<head><base href="https://example.test/catalog/"><link rel="canonical" href="https://other.test/canonical"></head><body><nav><a href="../services">Services</a></nav><main><a href="item#details">Item</a><a href="item#details">Item</a><a href="#details">In-page</a><a href="https://evil.test/">Outside</a><a href="https://user:secret@example.test/private">Secret</a><a href="javascript:alert(1)">Script</a><a href="https://example.test:8080/">Port</a></main><footer><a href="/contact">Contact</a></footer></body>'));
    const result = await read();
    expect(result.internalLinks).toEqual([
      { url: `${property}catalog/item`, text: 'Item', context: 'main', rel: '' },
      { url: `${property}services`, text: 'Services', context: 'navigation', rel: '' },
      { url: `${property}contact`, text: 'Contact', context: 'footer', rel: '' },
    ]);
    expect(result.technical).toMatchObject({ canonicalUrl: 'https://other.test/canonical', canonicalInProperty: false });
  });

  it('rejects unsafe input before fetching and off-property final destinations even with a mocked transport', async () => {
    for (const url of ['javascript:alert(1)', 'https://user:pass@example.test/a', `${property}a#fragment`, 'https://example.test:8080/a', 'https://elsewhere.test/a']) {
      await expect(fetchCurrentPageContent(url, { property })).rejects.toMatchObject({ status: expect.any(Number) });
    }
    expect(publicFetch).not.toHaveBeenCalled();
    publicFetch.mockResolvedValue(response('<main>External</main>', { url: 'https://elsewhere.test/a' }));
    await expect(read()).rejects.toMatchObject({ status: 403 });
  });

  it('distinguishes HTTP failure and non-HTML from an empty HTML page and never leaks transport secrets', async () => {
    publicFetch.mockResolvedValue(response('Not found', { status: 404 }));
    await expect(read()).rejects.toMatchObject({ status: 502, httpStatus: 404 });
    publicFetch.mockResolvedValue(response('{}', { headers: { 'content-type': 'application/json' } }));
    await expect(read()).rejects.toMatchObject({ status: 422 });
    publicFetch.mockRejectedValue(new Error('private transport diagnostics'));
    await expect(read()).rejects.toThrow('could not read this page');
    publicFetch.mockResolvedValue(response('<main></main>'));
    expect((await read()).textContent).toBe('');
  });
});
