import { publicFetch } from './publicFetch';
import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { propertyContainsUrl } from '../revampState';
import { RequestError, errorResponse } from './requestAuth';

const clean = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

// Always fetch current HTML; callers must not use client-supplied content as
// evidence of what is on a website. Legacy fallback fields remain for old UI.
export async function fetchCurrentPageContent(pageUrl, { property } = {}) {
  if (typeof pageUrl !== 'string' || !pageUrl || pageUrl.length > 2048) throw new RequestError('Enter a valid page URL.');
  if (property && !propertyContainsUrl(property, pageUrl)) throw new RequestError('Page must belong to your connected Search Console property.', 403);
  let response;
  try { response = await publicFetch(pageUrl); }
  catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError('We could not read this page. Check that it is publicly accessible and try again.', 502);
  }
  if (!response.ok) throw new RequestError(`The page returned HTTP ${response.status}. Open the page and fix that response before reviewing it.`, 502);
  const finalUrl = response.url || pageUrl;
  if (property && !propertyContainsUrl(property, finalUrl)) throw new RequestError('This page redirects outside your connected Search Console property. Review a page on the connected website.', 403);
  const contentType = response.headers.get('content-type') || '';
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) throw new RequestError('This URL does not return an HTML page. Choose a public webpage to review.', 422);

  const $ = cheerio.load(await response.text());
  const htmlTitle = clean($('title').first().text(), 500);
  const h1 = clean($('h1').first().text(), 500);
  const seoMetaDescription = clean($('meta[name="description" i]').first().attr('content'), 1000);
  const ogDescription = clean($('meta[property="og:description" i]').first().attr('content'), 1000);
  $('script, style, noscript, iframe, img, video, audio').remove();
  let textContent = '';
  for (const selector of ['main', 'article', '.content', '.main-content', '.post-content', '.entry-content', '#content', '#main', 'body']) {
    const element = $(selector);
    if (element.length) { textContent = clean(element.text(), 6000); if (textContent) break; }
  }
  const headings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, element) => {
    const text = clean($(element).text(), 300);
    if (text && headings.length < 10) headings.push({ tag: element.tagName.toLowerCase(), text });
  });
  return {
    htmlTitle, seoMetaDescription, h1, textContent, headings,
    title: htmlTitle || h1, metaDescription: seoMetaDescription || ogDescription,
    url: pageUrl, finalUrl, fetchedAt: new Date().toISOString(), source: 'website-html',
  };
}

export async function scrapeContentResponse(pageUrl) {
  try { return NextResponse.json({ success: true, data: await fetchCurrentPageContent(pageUrl) }); }
  catch (error) { return errorResponse(error); }
}
