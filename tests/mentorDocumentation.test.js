import { beforeEach, describe, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => (await import('./fakeFirestore')).fakeFirestore());
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
import { reset } from '../app/lib/firebaseAdmin';
import { publicFetch } from '../app/lib/server/publicFetch';
import { lookupGoogleGuidance, readGoogleDocumentation, documentationResearchRequest, researchedDocumentationUrls, selectMentorDocumentationExcerpt, compactMentorDocumentationExcerpt } from '../app/lib/server/mentorDocumentation';
const url = 'https://support.google.com/webmasters/answer/7440203?hl=en';
const html = `<main><h1>Page indexing</h1><p>${'A discovered page is different from a crawled page. '.repeat(10)}</p></main>`;
beforeEach(() => { reset(); vi.clearAllMocks(); publicFetch.mockImplementation(async page => {
  const response = new Response(html, { headers: { 'content-type': 'text/html' } }); Object.defineProperty(response, 'url', { value: page }); return response;
}); });
describe('retrieved official SEO documentation', () => {
  it('retrieves distinct supporting sources for titles, snippets and description ranking claims', async () => {
    const result = await lookupGoogleGuidance('titles');
    expect(result.sources).toHaveLength(3);
    expect(result.sources.map(source => source.url)).toContain('https://developers.google.com/search/docs/appearance/snippet');
    expect(result.sources.some(source => source.url.includes('google-does-not-use-keywords'))).toBe(true);
  });
  it('reads the article body without surrounding feedback or embedded template data', async () => {
    publicFetch.mockImplementation(async page => {
      const response = new Response(`<main><h1>Snippets</h1><div class="devsite-article-body">${'Meta descriptions summarize pages. '.repeat(8)}</div><template>irrelevant template data</template><p>irrelevant navigation</p></main>`, { headers: { 'content-type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: page }); return response;
    });
    const result = await readGoogleDocumentation(url);
    expect(result.excerpt).not.toContain('irrelevant'); expect(result.excerpt).toContain('Meta descriptions');
  });
  it('includes substantive ranking guidance beyond a long introduction without generating a summary', () => {
    const fact = 'The meta description is not used in ranking.';
    const result = selectMentorDocumentationExcerpt({ excerpt: `${'This is an introductory sentence. '.repeat(90)}${fact}` }, 'titles');
    expect(result).toContain(fact); expect(result.length).toBeLessThanOrEqual(2200);
  });
  it('shortens documentation using complete relevant sentences without altering its cached excerpt', () => {
    const qualification = 'The meta description is not used in ranking.';
    const document = { excerpt: `${'This introduction describes a website. '.repeat(40)}${qualification}` };
    const original = document.excerpt, compact = compactMentorDocumentationExcerpt(document, 'titles');
    expect(compact.length).toBeLessThanOrEqual(1200); expect(compact).toContain(qualification); expect(compact.endsWith('.')).toBe(true);
    expect(document.excerpt).toBe(original);
    expect(compactMentorDocumentationExcerpt({ excerpt: `${'Long conditional text '.repeat(70)}does not establish a penalty.` }, 'indexing')).toBe('');
  });
  it('caches successful excerpts and does not fetch twice within seven days', async () => {
    const first = await lookupGoogleGuidance('indexing'); const second = await lookupGoogleGuidance('indexing');
    expect(first.sources).toHaveLength(1); expect(second.documents[0]).toMatchObject({ cached: true, status: 'available' });
    expect(publicFetch).toHaveBeenCalledTimes(1);
  });
  it('retains the original date when an explicit refresh fails', async () => {
    const first = await readGoogleDocumentation(url); publicFetch.mockRejectedValue(new Error('private detail'));
    const after = await readGoogleDocumentation(url, { fresh: true });
    expect(after.status).toBe('stale'); expect(after.observedAt).toBe(first.observedAt);
    expect(after.excerpt).toBe(first.excerpt); expect(JSON.stringify(after)).not.toContain('private detail');
  });
  it('does not represent a failed first retrieval as a source read', async () => {
    publicFetch.mockRejectedValue(new Error('failure'));
    const result = await lookupGoogleGuidance('indexing'); expect(result.sources).toEqual([]); expect(result.documents[0].status).toBe('unavailable');
  });
  it('rejects off-domain and unrelated Google URLs before fetching', async () => {
    await expect(readGoogleDocumentation('https://support.google.com/accounts/answer/1')).rejects.toThrow(); expect(publicFetch).not.toHaveBeenCalled();
  });
  it('uses fixed public topics rather than accepting a private search query', () => {
    const request = documentationResearchRequest('indexing', 'gpt-6.1-sol');
    expect(request.max_tool_calls).toBe(1); expect(request.input).toContain('at most one search'); expect(request.tools[0].filters.allowed_domains).toEqual(['developers.google.com', 'support.google.com']);
    expect(() => documentationResearchRequest('my private metrics 123 alice@example.test', 'model')).toThrow();
  });
  it('requires completed research and accepts only approved retrieved URLs', () => {
    expect(researchedDocumentationUrls({ output: [{ type: 'message', content: [{ annotations: [{ type: 'url_citation', url }] }] }] })).toEqual([]);
    expect(researchedDocumentationUrls({ output: [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url }, { url: 'https://evil.test' }] } }] })).toEqual([url]);
  });
});
