import { describe, expect, it } from 'vitest';
import { taskPages, usableSuggestion, seoImplementationId } from '../app/lib/pageTaskFlow';

describe('manual page task selection', () => {
  it('retains exact page identity, includes tracked pages without data, and rejects foreign URLs', () => {
    const pages = taskPages({ property: 'https://example.test/',
      trackedPages: ['https://example.test/Case/?City=A', 'https://example.test/case/?City=a', 'https://other.test/page'],
      observedPages: [{ pageUrl: 'https://example.test/Case/?City=A', impressions: 20, clicks: 1, ctr: .05 }],
      keywords: [{ page: 'https://example.test/Case/?City=A', keyword: 'real query', impressions: 2 }, { page: 'https://other.test/page', keyword: 'foreign', impressions: 50 }],
    });
    expect(pages.map(page => page.url)).toEqual(['https://example.test/Case/?City=A', 'https://example.test/case/?City=a']);
    expect(pages[0].metrics.impressions).toBe(20); // Page aggregates never replaced with query subset totals.
    expect(pages[0].queries[0].keyword).toBe('real query');
    expect(pages[1].metrics).toBeUndefined();
  });
  it('does not bring back archived keywords or create a page solely from an old assignment', () => {
    const pages = taskPages({ property: 'sc-domain:example.test', trackedPages: ['https://example.test/current'],
      focusKeywords: [{ pageUrl: 'https://example.test/current', keyword: 'old', preRevampArchived: true }, { pageUrl: 'https://example.test/retired', keyword: 'retired' }] });
    expect(pages).toHaveLength(1); expect(pages[0].focusKeyword).toBe('');
  });
  it('never accepts loading or failure placeholders as drafts', () => {
    for (const value of ['', null, undefined, 'Suggested Title', 'Suggested Description', "Hang tight—we're crafting a fresh meta title.", 'Your AI-powered meta description will appear here shortly.']) expect(usableSuggestion(value)).toBe(false);
    expect(usableSuggestion('Useful service page | Real business')).toBe(true);
  });
  it('retains the existing implementation document hash but distinguishes exact URLs', () => {
    expect(seoImplementationId('uid', 'https://example.test/Case/?City=A')).toMatch(/^uid_[a-f0-9]{8}$/);
    expect(seoImplementationId('uid', 'https://example.test/Case/?City=A')).not.toBe(seoImplementationId('uid', 'https://example.test/case/?City=a'));
  });
});
