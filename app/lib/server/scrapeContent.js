import { publicFetch } from './publicFetch';
import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { propertyContainsUrl } from '../revampState';
import { RequestError, errorResponse } from './requestAuth';

const clean = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
const HEADING_LIMIT = 30;
const LINK_LIMIT = 100;
const SECTION_LIMIT = 16;

function httpUrl(raw, base, { stripHash = false } = {}) {
  try {
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || (url.port && !['80', '443'].includes(url.port)) || url.href.length > 2048) return null;
    if (stripHash) url.hash = '';
    return url.href;
  } catch { return null; }
}

// These are attributes/classes in the downloaded source, never a rendered or
// computed-style visibility test. Keep descendant text separate for animated H1s.
function sourceFlags($, element) {
  const ancestry = $(element).parents().addBack().toArray();
  return {
    srOnly: ancestry.some(node => /(?:^|\s)(?:sr-only|visually-hidden|screen-reader-only|screen-reader-text)(?:\s|$)/i.test($(node).attr('class') || '')),
    ariaHidden: ancestry.some(node => ($(node).attr('aria-hidden') || '').toLowerCase() === 'true'),
    hidden: ancestry.some(node => $(node).attr('hidden') !== undefined || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test($(node).attr('style') || '')),
  };
}

function headingSegments($, element) {
  const segments = [];
  function visit(node) {
    if (segments.length >= 12) return;
    if (node.type === 'text') {
      const text = clean(node.data, 300);
      if (text) segments.push({ text, ...sourceFlags($, node.parent) });
    } else for (const child of node.children || []) visit(child);
  }
  visit(element);
  return segments;
}

function noindexSignals(robotsMeta, header) {
  const hasNoindex = text => /(?:^|[\s,;])(?:noindex|none)(?:$|[\s,;])/i.test(text);
  let generic = robotsMeta.some(item => item.agent === 'robots' && hasNoindex(item.content));
  let googlebot = robotsMeta.some(item => item.agent === 'googlebot' && hasNoindex(item.content));
  let agent = '';
  for (let directive of header.split(',')) {
    const scoped = directive.trim().match(/^([a-z0-9_*.-]+)\s*:\s*(.*)$/i);
    if (scoped) { agent = scoped[1].toLowerCase(); directive = scoped[2]; }
    if (hasNoindex(directive)) {
      if (!agent || agent === '*') generic = true;
      if (agent === 'googlebot') googlebot = true;
    }
  }
  return { generic, googlebot: generic || googlebot };
}

function linkContext($, node) {
  if ($(node).closest('nav, [role="navigation"], header').length) return 'navigation';
  if ($(node).closest('footer').length) return 'footer';
  return $(node).closest('main, article, [role="main"]').length ? 'main' : 'body';
}

// Always fetch current HTML; callers must not use client-supplied content as
// evidence of what is on a website. Legacy fallback fields remain for old UI.
export async function fetchCurrentPageContent(pageUrl, { property, deadline, signal, allowedHostname } = {}) {
  if (typeof pageUrl !== 'string' || !pageUrl || pageUrl.length > 2048 || !httpUrl(pageUrl)
    || new URL(pageUrl).hash) throw new RequestError('Enter a valid page URL.');
  if (property && !propertyContainsUrl(property, pageUrl)) throw new RequestError('Page must belong to your connected Search Console property.', 403);
  let response;
  const fetchOptions = { ...(property ? { property } : {}), ...(deadline !== undefined ? { deadline } : {}),
    ...(signal ? { signal } : {}), ...(allowedHostname ? { allowedHostname } : {}) };
  try { response = await publicFetch(pageUrl, Object.keys(fetchOptions).length ? fetchOptions : undefined); }
  catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError('We could not read this page. Check that it is publicly accessible and try again.', 502);
  }
  if (!response.ok) {
    const error = new RequestError(`The page returned HTTP ${response.status}. Open the page and fix that response before reviewing it.`, 502);
    error.httpStatus = response.status;
    throw error;
  }
  const finalUrl = response.url || pageUrl;
  if (property && !propertyContainsUrl(property, finalUrl)) throw new RequestError('This page redirects outside your connected Search Console property. Review a page on the connected website.', 403);
  if (allowedHostname && new URL(finalUrl).hostname !== allowedHostname) throw new RequestError('This page redirects outside your selected website.', 403);
  const contentType = response.headers.get('content-type') || '';
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) throw new RequestError('This URL does not return an HTML page. Choose a public webpage to review.', 422);

  const html = await response.text();
  const $ = cheerio.load(html);
  const htmlTitle = clean($('title').first().text(), 500);
  const h1 = clean($('h1').first().text(), 500);
  const seoMetaDescription = clean($('meta[name="description" i]').first().attr('content'), 1000);
  const ogDescription = clean($('meta[property="og:description" i]').first().attr('content'), 1000);
  const baseUrl = httpUrl($('base[href]').first().attr('href') || finalUrl, finalUrl) || finalUrl;
  const canonicalNodes = $('link[rel]').filter((_, node) => /(?:^|\s)canonical(?:\s|$)/i.test($(node).attr('rel') || ''));
  const canonicalDeclarations = canonicalNodes.toArray().slice(0, 5).map(node => {
    const href = $(node).attr('href') || '';
    return { href: clean(href, 2048), url: href ? httpUrl(href, baseUrl) : null };
  });
  const canonicalUrl = canonicalDeclarations.find(item => item.url)?.url || null;
  const robotsMeta = $('meta[name]').toArray().filter(node => /^(?:robots|googlebot)$/i.test($(node).attr('name') || ''))
    .slice(0, 10).map(node => ({ agent: $(node).attr('name').toLowerCase(), content: clean($(node).attr('content'), 1000) }));
  const xRobotsTag = clean(response.headers.get('x-robots-tag'), 2000);
  const technical = {
    httpStatus: response.status, contentType: clean(contentType, 200), requestedUrl: pageUrl, finalUrl,
    redirected: finalUrl !== pageUrl, redirectChain: Array.isArray(response.redirectChain) ? response.redirectChain.slice(0, 5) : [],
    canonicalUrl, canonicalStatus: !canonicalNodes.length ? 'missing' : canonicalNodes.length > 1 ? 'multiple' : canonicalUrl ? 'declared' : 'invalid',
    canonicalDeclarations, canonicalInProperty: canonicalUrl && property ? propertyContainsUrl(property, canonicalUrl) : null,
    robotsMeta, xRobotsTag, noindex: noindexSignals(robotsMeta, xRobotsTag),
  };
  $('script, style, noscript, iframe, img, video, audio, template').remove();
  let textContent = '', mainContent = '', contentSource = 'none', fullTextLength = 0;
  for (const selector of ['main', 'article', '[role="main"]', '.content', '.main-content', '.post-content', '.entry-content', '#content', '#main', 'body']) {
    const element = $(selector);
    if (element.length) {
      const text = clean(element.text(), html.length);
      if (text) { textContent = text.slice(0, 6000); mainContent = text.slice(0, 12000); fullTextLength = text.length; contentSource = selector; break; }
    }
  }
  const headingNodes = $('h1, h2, h3, h4, h5, h6');
  const headings = headingNodes.toArray().slice(0, HEADING_LIMIT).map(element => ({
    tag: element.tagName.toLowerCase(), text: clean($(element).text(), 500),
    ...sourceFlags($, element), segments: headingSegments($, element),
  })).filter(item => item.text);
  // Bounded section excerpts preserve useful material later in long pages,
  // instead of spending the entire evidence allowance on navigation/hero text.
  const sectionNodes = $('main section, article section, [role="main"] section, section').toArray();
  const contentSections = sectionNodes.slice(0, SECTION_LIMIT).map(node => {
    const text = clean($(node).text(), html.length);
    return { heading: clean($(node).find('h1,h2,h3').first().text(), 300), text: text.slice(0, 1200), truncated: text.length > 1200 };
  }).filter(item => item.text);
  const linkScope = property || new URL(finalUrl).origin + '/';
  const seenLinks = new Set();
  const allInternalLinks = [];
  $('a[href]').each((_, node) => {
    const raw = $(node).attr('href');
    if (!raw?.trim() || raw.trim().startsWith('#')) return;
    const url = httpUrl(raw, baseUrl, { stripHash: true });
    if (!url || !propertyContainsUrl(linkScope, url)) return;
    const text = clean($(node).text() || $(node).attr('aria-label'), 240);
    const context = linkContext($, node);
    const key = `${url}\n${text}\n${context}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    allInternalLinks.push({ url, text, context, rel: clean($(node).attr('rel'), 100) });
  });
  // Prefer content links in the bounded view, while retaining navigation links.
  const internalLinks = allInternalLinks.sort((a, b) => Number(b.context === 'main') - Number(a.context === 'main')).slice(0, LINK_LIMIT);
  return {
    htmlTitle, seoMetaDescription, h1, textContent, headings, mainContent, contentSections, internalLinks, technical,
    structureCoverage: {
      contentSource, textCharacters: fullTextLength, mainContentTruncated: fullTextLength > 12000,
      headingCount: headingNodes.length, headingsTruncated: headingNodes.length > HEADING_LIMIT,
      sectionCount: sectionNodes.length, sectionsTruncated: sectionNodes.length > SECTION_LIMIT,
      internalLinkCount: allInternalLinks.length, internalLinksTruncated: allInternalLinks.length > LINK_LIMIT,
    },
    structuralLimitations: [
      'This is downloaded HTML, not a browser rendering. JavaScript, responsive CSS and computed visibility were not evaluated. Screen-reader, aria-hidden and hidden flags describe source markup only.',
      'Content, headings, sections and links are bounded excerpts. Missing text in an excerpt does not prove it is absent from the full page.',
      'These HTTP and HTML observations do not by themselves establish Google indexing status or a ranking cause.',
    ],
    title: htmlTitle || h1, metaDescription: seoMetaDescription || ogDescription,
    url: pageUrl, finalUrl, fetchedAt: new Date().toISOString(), source: 'website-html',
  };
}

export async function scrapeContentResponse(pageUrl) {
  try { return NextResponse.json({ success: true, data: await fetchCurrentPageContent(pageUrl) }); }
  catch (error) { return errorResponse(error); }
}
