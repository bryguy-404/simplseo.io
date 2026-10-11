export const GOOGLE_SEO_TOPICS = {
  indexing: { title: 'Page indexing', url: 'https://support.google.com/webmasters/answer/7440203?hl=en', query: 'Google Search Console page indexing discovered crawled currently not indexed' },
  crawling: { title: 'How Google Search works', url: 'https://developers.google.com/search/docs/fundamentals/how-search-works', query: 'Google Search Central crawling rendering indexing requirements' },
  canonical: { title: 'Duplicate URLs and canonicalization', url: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls', query: 'Google Search Central duplicate URLs canonical selection' },
  titles: { title: 'Titles, descriptions and snippets', url: 'https://developers.google.com/search/docs/appearance/title-link',
    relatedUrls: ['https://developers.google.com/search/docs/appearance/snippet', 'https://developers.google.com/search/blog/2009/09/google-does-not-use-keywords-meta-tag'],
    excerptTerms: ['meta description', 'ranking', 'descriptive', 'concise', 'snippet'], query: 'Google Search Central title links meta descriptions snippets ranking' },
  content: { title: 'Helpful, reliable content', url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content', query: 'Google Search Central helpful reliable people first content service pages' },
  links: { title: 'Link best practices', url: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable', query: 'Google Search Central crawlable internal links descriptive anchor text' },
  local: { title: 'Local ranking guidance', url: 'https://support.google.com/business/answer/7091?hl=en', query: 'Google Business Profile improve local ranking relevance distance prominence' },
  performance: { title: 'Search Console performance', url: 'https://support.google.com/webmasters/answer/7042828?hl=en', query: 'Google Search Console clicks impressions average position omitted queries performance' },
  structured_data: { title: 'Structured data guidelines', url: 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies', query: 'Google Search Central structured data rich results eligibility guidelines' },
  sitemaps: { title: 'Build and submit a sitemap', url: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap', query: 'Google Search Central sitemap discovery submitting sitemap indexing not guaranteed' },
  mobile: { title: 'Page experience', url: 'https://developers.google.com/search/docs/appearance/page-experience', query: 'Google Search Central mobile page experience Core Web Vitals' },
  spam: { title: 'Spam policies', url: 'https://developers.google.com/search/docs/essentials/spam-policies', query: 'Google Search Central spam policies doorway scaled content manual actions' },
  manual_actions: { title: 'Manual Actions report', url: 'https://support.google.com/webmasters/answer/9044175?hl=en', query: 'Google Search Console Manual Actions report human reviewer notifications' },
  updates: { title: 'Google ranking updates', url: 'https://developers.google.com/search/docs/appearance/ranking-systems-guide', query: 'Google Search Central current ranking updates official guidance' },
  international: { title: 'Localized website versions', url: 'https://developers.google.com/search/docs/specialty/international/localized-versions', query: 'Google Search Central localized versions hreflang international websites' },
};

export function approvedGoogleDocumentationUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const allowed = url.hostname === 'developers.google.com' && /^\/search\/(?:docs|blog)(?:\/|$)/.test(url.pathname)
      || url.hostname === 'support.google.com' && /^\/(?:webmasters|business)\/answer\/\d+/.test(url.pathname);
    if (!allowed) return null;
    url.hash = ''; return url.href;
  } catch { return null; }
}

export const GOOGLE_GUIDANCE_TOOL = { type: 'function', name: 'read_google_guidance', description:
  'Read current saved or fetched official Google guidance for an SEO question. Request latest only if current guidance or an unfamiliar topic needs public research. This tool never receives private account data.', strict: true,
  parameters: { type: 'object', additionalProperties: false, properties: {
    topic: { type: 'string', enum: Object.keys(GOOGLE_SEO_TOPICS) }, latest: { type: 'boolean' },
  }, required: ['topic', 'latest'] } };
