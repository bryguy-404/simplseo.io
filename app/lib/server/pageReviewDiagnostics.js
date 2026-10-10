import { propertyContainsUrl } from '../revampState';
import { getGscConnection } from './gscConnection';
import { fetchCurrentPageContent } from './scrapeContent';
import { RequestError } from './requestAuth';

const LINKED_PAGE_LIMIT = 2;
const clean = (value, limit) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const INSPECTION_LIMITATION = "Google URL Inspection describes Google's stored index view, not a live indexing test. The check time is when SimpleSEO requested it; last crawl time is Google's reported crawl. Missing fields remain unknown.";

function safeHttpUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || (url.port && !['80', '443'].includes(url.port))) return null;
    return url.href;
  } catch { return null; }
}
function scoped(property, value) { return safeHttpUrl(value) && propertyContainsUrl(property, value); }
function inspectionLink(value) {
  const safe = safeHttpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  return url.protocol === 'https:' && url.hostname === 'search.google.com' && !url.port
    && url.pathname === '/search-console/inspect' ? safe : null;
}
function emptyInspection(pageUrl, property) {
  return { status: 'unavailable', source: 'google_url_inspection', url: pageUrl, property,
    checkedAt: new Date().toISOString(), view: 'google_index', inspectionUrl: null,
    verdict: null, coverageState: null, robotsTxtState: null, indexingState: null,
    lastCrawlTime: null, pageFetchState: null, googleCanonical: null, userCanonical: null, crawledAs: null,
    limitation: INSPECTION_LIMITATION };
}
async function inspect(connection, pageUrl, property) {
  const result = emptyInspection(pageUrl, property);
  if (!connection || typeof connection.inspect !== 'function') return result;
  try {
    const payload = await connection.inspect(pageUrl);
    const data = payload?.inspectionResult?.indexStatusResult;
    if (!object(payload) || payload.error || !object(data)) return result;
    const names = ['verdict', 'coverageState', 'robotsTxtState', 'indexingState', 'pageFetchState', 'crawledAs'];
    if (!names.some(name => typeof data[name] === 'string' && data[name].trim())) return result;
    for (const name of names) {
      if (data[name] !== undefined && typeof data[name] !== 'string') return emptyInspection(pageUrl, property);
      result[name] = clean(data[name], name === 'coverageState' ? 400 : 100) || null;
    }
    if (data.lastCrawlTime !== undefined && (typeof data.lastCrawlTime !== 'string' || !Number.isFinite(Date.parse(data.lastCrawlTime)))) return emptyInspection(pageUrl, property);
    result.lastCrawlTime = data.lastCrawlTime || null;
    result.googleCanonical = safeHttpUrl(data.googleCanonical);
    result.userCanonical = safeHttpUrl(data.userCanonical);
    result.inspectionUrl = inspectionLink(payload.inspectionResult.inspectionResultLink);
    result.status = 'available';
    return result;
  } catch { return emptyInspection(pageUrl, property); }
}

const stopWords = new Set('the and for with your our from this that a an of to in on by is are home page website websites www com'.split(' '));
function words(value) { return clean(value, 3000).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !stopWords.has(word)); }
function candidates(currentPage, pageUrl, property) {
  const topicWords = new Set(words([currentPage.htmlTitle, currentPage.h1, new URL(pageUrl).pathname].join(' ')));
  const unique = new Map();
  for (const link of (Array.isArray(currentPage.internalLinks) ? currentPage.internalLinks : []).slice(0, 100)) {
    if (!object(link) || typeof link.url !== 'string') continue;
    let url;
    try { url = new URL(link.url); } catch { continue; }
    // Fragments are anchors, not separate fetches. Related reads deliberately
    // avoid query-driven actions, account endpoints and downloadable resources.
    url.hash = '';
    if (!scoped(property, url.href) || url.search || url.href === new URL(pageUrl).href
      || /(?:^|\/)(?:logout|signout|log-out|sign-out|login|signin|sign-in|signup|register|account|admin|checkout|cart|delete|remove|unsubscribe|wp-admin|api)(?:\/|$)/i.test(url.pathname)
      || /\.(?:pdf|zip|gz|xml|json|png|jpe?g|gif|webp|svg|mp[34]|woff2?|css|js)$/i.test(url.pathname)) continue;
    const anchorText = clean(link.text, 240);
    const context = ['main', 'navigation', 'footer', 'body'].includes(link.context) ? link.context : 'body';
    const tokens = new Set(words(`${anchorText} ${url.pathname}`));
    const overlap = [...tokens].filter(word => topicWords.has(word)).length;
    const score = overlap * 3 + (context === 'main' ? 2 : 0)
      + (/\b(?:services?|products?|solutions?|collections?|treatments?|courses?|menu)\b/i.test(`${anchorText} ${url.pathname.replace(/[-/]/g, ' ')}`) ? 2 : 0)
      - (context === 'footer' ? 2 : 0)
      - (/^\/(?:privacy|terms|contact|about)(?:\/|$)/i.test(url.pathname) ? 3 : 0);
    if (score <= 0) continue;
    const previous = unique.get(url.href);
    if (!previous || score > previous.score) unique.set(url.href, { pageUrl: url.href, anchorText, context, score });
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || a.pageUrl.localeCompare(b.pageUrl)).slice(0, LINKED_PAGE_LIMIT);
}

function contentSubset(page) {
  return {
    url: page.url, finalUrl: page.finalUrl, source: page.source, fetchedAt: page.fetchedAt,
    htmlTitle: page.htmlTitle, seoMetaDescription: page.seoMetaDescription, h1: page.h1,
    textContent: clean(page.mainContent || page.textContent, 5000),
    headings: (page.headings || []).slice(0, 16), contentSections: (page.contentSections || []).slice(0, 8),
    internalLinks: (page.internalLinks || []).slice(0, 30), technical: page.technical || null,
    structureCoverage: page.structureCoverage || null,
    subsetLimits: { textCharacters: 5000, headings: 16, sections: 8, internalLinks: 30 },
  };
}
function indexText(inspection) {
  if (inspection.status !== 'available') return 'Google URL Inspection was unavailable; indexing and crawl status remain unknown.';
  return `Google stored index view checked ${inspection.checkedAt}: coverage ${inspection.coverageState || 'unknown'}; verdict ${inspection.verdict || 'unknown'}; robots ${inspection.robotsTxtState || 'unknown'}; indexing rule ${inspection.indexingState || 'unknown'}; fetch ${inspection.pageFetchState || 'unknown'}; last crawl ${inspection.lastCrawlTime || 'unknown'}; Google canonical ${inspection.googleCanonical || 'unknown'}; declared canonical ${inspection.userCanonical || 'unknown'}. This is not a live indexing test.`;
}
function factsFor(currentPage, result) {
  const prefix = `Page ${result.pageUrl}; HTML fetched ${currentPage.fetchedAt || 'at an unknown time'}. `;
  const facts = [];
  if (result.inspection.status === 'available') facts.push({ id: 'I1', kind: 'search', label: 'Google index status for this page', text: `Exact URL ${result.pageUrl}. ${indexText(result.inspection)}` });
  if (currentPage.technical) facts.push({ id: 'P4', kind: 'page', label: 'Current HTTP and indexing directives', text: prefix + clean(JSON.stringify(currentPage.technical), 5000) + ' These source observations do not prove indexing or a ranking cause.' });
  if (Array.isArray(currentPage.headings)) facts.push({ id: 'P5', kind: 'page', label: 'Heading structure in downloaded HTML', text: prefix + clean(JSON.stringify(currentPage.headings.slice(0, 12)), 6000) + ' Flags and text segments describe HTML classes and attributes, not computed or rendered visibility.' });
  if (Array.isArray(currentPage.internalLinks)) facts.push({ id: 'P6', kind: 'page', label: 'Internal links in downloaded HTML', text: prefix + clean(JSON.stringify(currentPage.internalLinks.filter(link => scoped(result.property, link?.url)).slice(0, 40)), 6000) + ' This is a bounded sample of source anchors, not proof that an omitted link is absent or that another page is orphaned.' });
  result.relatedPages.forEach((item, index) => {
    if (item.status !== 'available' && item.inspection.status !== 'available') return;
    const page = item.currentPage;
    facts.push({ id: `D${index + 1}`, kind: 'page', label: 'A linked page on this website', text:
      `URL ${item.pageUrl}; linked from ${item.linkedFrom} with anchor ${JSON.stringify(item.anchorText)} (${item.context}). `
      + (page ? `HTML fetched ${page.fetchedAt}; final URL ${page.finalUrl}; title ${JSON.stringify(page.htmlTitle)}; description ${JSON.stringify(page.seoMetaDescription)}; heading ${JSON.stringify(page.h1)}; excerpt ${JSON.stringify(clean(page.textContent, 2200))}; technical ${clean(JSON.stringify(page.technical), 2500)}. ` : 'Current HTML could not be read. ')
      + indexText(item.inspection) + ' This bounded comparison does not prove competing pages or a ranking cause.' });
  });
  return facts;
}

/** Authenticated callers supply their server-fetched page; never accept model URLs. */
export async function collectPageReviewDiagnostics(userId, { pageUrl, property, currentPage }) {
  if (typeof property !== 'string' || !scoped(property, pageUrl)) throw new RequestError('Page must belong to your connected Search Console property.', 403);
  if (!object(currentPage) || (currentPage.url && currentPage.url !== pageUrl)
    || (currentPage.finalUrl && !scoped(property, currentPage.finalUrl))) throw new RequestError('Read the current page before checking its diagnostics.', 409);
  let connection;
  try { connection = await getGscConnection(userId); } catch { connection = null; }
  if (connection && connection.siteUrl !== property) throw new RequestError('Your website setup changed. Reload the page before reviewing it.', 409);
  const selected = candidates(currentPage, pageUrl, property);
  const [inspection, relatedPages] = await Promise.all([
    inspect(connection, pageUrl, property),
    Promise.all(selected.map(async candidate => {
      const [html, inspection] = await Promise.all([
        Promise.resolve().then(() => fetchCurrentPageContent(candidate.pageUrl, { property }))
          .then(page => ({ status: 'available', currentPage: contentSubset(page), httpStatus: page.technical?.httpStatus || null }))
          .catch(error => ({ status: 'unavailable', currentPage: null, httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null })),
        inspect(connection, candidate.pageUrl, property),
      ]);
      return { pageUrl: candidate.pageUrl, linkedFrom: pageUrl, anchorText: candidate.anchorText,
        context: candidate.context, ...html, inspection };
    })),
  ]);
  const result = {
    pageUrl, property, fetchedAt: new Date().toISOString(), inspection, relatedPages,
    technical: currentPage.technical || null, facts: [],
    limits: { maxRelatedPages: LINKED_PAGE_LIMIT, maxInspections: LINKED_PAGE_LIMIT + 1 },
    limitations: [INSPECTION_LIMITATION,
      'At most two relevant public pages linked in the current HTML are read, selected by source-link text and URL relevance. This is not a full-site crawl, a complete internal-link audit, or proof of keyword cannibalization.',
      'Related pages with query strings, account/action paths or non-HTML resource extensions are skipped. Only pages within the connected property are fetched; redirects are checked before they are followed.',
      ...(currentPage.structuralLimitations || []),
    ],
  };
  if (inspection.status === 'unavailable') result.limitations.push('Google URL Inspection for the selected page was unavailable. No indexing state has been inferred from missing data.');
  if (relatedPages.some(item => item.status === 'unavailable' || item.inspection.status === 'unavailable')) result.limitations.push('Some linked-page HTML or Google index observations could not be read. Missing evidence remains unavailable.');
  result.facts = factsFor(currentPage, result);
  return result;
}
