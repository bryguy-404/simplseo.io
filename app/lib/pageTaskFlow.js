import { propertyContainsUrl } from './revampState';

// Keep Google page identity exact: case, trailing slashes and queries may matter.
export function taskPages({ property, trackedPages = [], observedPages = [], keywords = [], focusKeywords = [] }) {
  if (!property) return [];
  const pages = new Map();
  const add = (url, tracked) => {
    if (!url || !propertyContainsUrl(property, url)) return null;
    if (!pages.has(url)) pages.set(url, { url, tracked: null, queries: [], focusKeyword: '' });
    const page = pages.get(url);
    if (tracked) page.tracked = tracked;
    return page;
  };
  trackedPages.forEach(value => add(typeof value === 'string' ? value : value.url, typeof value === 'string' ? null : value));
  observedPages.forEach(value => { const page = add(value.pageUrl); if (page) page.metrics = value; });
  keywords.forEach(row => {
    const page = add(row.page);
    if (page && typeof row.keyword === 'string' && row.keyword.trim()) page.queries.push(row);
  });
  focusKeywords.forEach(row => {
    // A saved keyword alone is not evidence the rebuilt page is current.
    const page = pages.get(row.pageUrl);
    if (page && !row.preRevampArchived && row.keyword) page.focusKeyword = row.keyword;
  });
  return [...pages.values()].map(page => ({ ...page, queries: page.queries.sort((a, b) => (b.impressions || 0) - (a.impressions || 0)) }))
    .sort((a, b) => Number((b.metrics?.impressions || 0) > 0 || b.queries.length > 0 || b.tracked?.searchDataStatus === 'has_data') - Number((a.metrics?.impressions || 0) > 0 || a.queries.length > 0 || a.tracked?.searchDataStatus === 'has_data') || (b.metrics?.impressions || 0) - (a.metrics?.impressions || 0) || a.url.localeCompare(b.url));
}

export function usableSuggestion(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  return !/^(suggested (?:title|description)|hang tight|your ai-powered meta description)/i.test(value.trim());
}

// Retain the existing document identity so confirmed and archived records continue to resolve.
export function seoImplementationId(uid, pageUrl) {
  let hash = 0;
  for (let i = 0; i < pageUrl.length; i++) hash = ((hash << 5) - hash + pageUrl.charCodeAt(i)) | 0;
  return `${uid}_${Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8)}`;
}
