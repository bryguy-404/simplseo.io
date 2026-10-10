import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { getGscConnection } from './gscConnection';
import { fetchCurrentPageContent } from './scrapeContent';
import { RequestError } from './requestAuth';
import { collectPageReviewEvidence } from './pageReviewEvidence';
import { consumePageReviewQuota } from './requestQuota';
import { PAGE_REVIEW_MODEL, buildReviewRequest, buildResearchRequest, responseText, validatePageAssessment, parseWebResearch } from '../pageReviewPolicy';

export async function readCurrentPageForReview(userId, pageUrl) {
  let parsed;
  try { parsed = new URL(pageUrl); } catch { throw new RequestError('Enter a valid page URL.'); }
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || parsed.username || parsed.password || parsed.hash) throw new RequestError('Use the full public page URL without a fragment or login details.');
  const [snapshot, connection] = await Promise.all([db.collection('onboarding').doc(userId).get(), getGscConnection(userId)]);
  if (!snapshot.exists) throw new RequestError('Complete your website setup before reviewing a page.', 409);
  const onboarding = snapshot.data();
  const property = onboarding.gscProperty || connection.siteUrl;
  if (property !== connection.siteUrl) throw new RequestError('Your website connection changed. Reconnect Search Console and try again.', 409);
  if (!propertyContainsUrl(property, pageUrl)) throw new RequestError('Page must belong to your connected Search Console property.', 403);
  const currentPage = await fetchCurrentPageContent(pageUrl, { property });
  const websiteRunId = onboarding.revampRunId || null;
  const contentFingerprint = createHash('sha256').update(JSON.stringify({
    userId, websiteRunId, property, pageUrl, finalUrl: currentPage.finalUrl,
    title: currentPage.htmlTitle, description: currentPage.seoMetaDescription,
    h1: currentPage.h1, textContent: currentPage.textContent, headings: currentPage.headings,
  })).digest('hex');
  await assertReviewStillCurrent(userId, { property, websiteRunId });
  return { currentPage, provenance: { property, websiteRunId, pageUrl, finalUrl: currentPage.finalUrl, contentFingerprint } };
}

async function assertReviewStillCurrent(userId, provenance) {
  const [snapshot, connection] = await Promise.all([db.collection('onboarding').doc(userId).get(), getGscConnection(userId)]);
  const onboarding = snapshot.data();
  if (!onboarding || (onboarding.revampRunId || null) !== provenance.websiteRunId
    || (onboarding.gscProperty || connection.siteUrl) !== provenance.property || connection.siteUrl !== provenance.property) {
    throw new RequestError('Your website setup changed while this page was being reviewed. Reload the page and try again.', 409);
  }
}

function normalizeKeywords(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list) || list.length > 5 || list.some(item => typeof item !== 'string' || item.length > 120)) throw new RequestError('Use at most five short focus keywords.');
  return list.map(item => item.trim()).filter(Boolean);
}

export function validateReviewSuggestions(payload, currentPage) {
  let parsed;
  try { parsed = JSON.parse(payload); } catch { throw new RequestError('The suggestion service returned an incomplete draft. Please try again.', 502); }
  const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
  const description = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
  const text = `${title} ${description}`;
  if (title.length < 10 || title.length > 90 || description.length < 40 || description.length > 220
    || /[\r\n]|<[^>]*>|\[[^\]]*\]|```|insert\s+(?:business|brand|keyword|title|description)\b|\b(?:lorem ipsum|placeholder|guaranteed? rankings?|guaranteed? results|#1 ranking)\b/i.test(text)) {
    throw new RequestError('The suggestion service did not return a usable title and description. Please try again.', 502);
  }
  // Guard common fabricated marketing specifics in addition to the prompt.
  const evidence = [currentPage.htmlTitle, currentPage.seoMetaDescription, currentPage.h1, currentPage.textContent, ...currentPage.headings.map(item => item.text)].join(' ').toLowerCase();
  const numbers = text.match(/\d+(?:[.,]\d+)*/g) || [];
  const sourceNumbers = new Set(evidence.match(/\d+(?:[.,]\d+)*/g) || []);
  const factualTerms = /\b(?:free|certified|licensed|insured|award[- ]winning|same[- ]day|guaranteed?)\b/gi;
  if (numbers.some(number => !sourceNumbers.has(number)) || [...text.matchAll(factualTerms)].some(match => !evidence.includes(match[0].toLowerCase()))) {
    throw new RequestError('The draft included a claim we could not find on this page. Please try again and review any new suggestion before using it.', 502);
  }
  return { title, description };
}

async function researchPage(openai, currentPage, signal) {
  try {
    const response = await openai.responses.create(buildResearchRequest(currentPage), { timeout: 45000, ...(signal ? { signal } : {}) });
    return parseWebResearch(response);
  } catch {
    return { status: 'unavailable', summary: '', sources: [], checkedAt: new Date().toISOString(),
      limitation: 'Web research was unavailable. This review uses your website and available Search Console evidence only.' };
  }
}

export async function generatePageReviewSuggestions(userId, pageUrl, keywordInput, { signal } = {}) {
  const focusKeywords = normalizeKeywords(keywordInput);
  const review = await readCurrentPageForReview(userId, pageUrl);
  const { currentPage } = review;
  if (currentPage.finalUrl !== pageUrl) throw new RequestError('This page redirects to another URL. Review the destination page before generating suggestions.', 409);
  if (currentPage.textContent.length < 80 || currentPage.textContent.split(/\s+/).length < 12) {
    throw new RequestError('There is not enough readable page content to draft an accurate suggestion. This may be a JavaScript-only page. Review its title and description manually or make its main content available in the page HTML.', 422);
  }
  if (!process.env.OPENAI_API_KEY) throw new RequestError('Suggestions are temporarily unavailable. You can still review the current page content.', 503);
  await consumePageReviewQuota(userId);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 45000 });
  const [evidence, research] = await Promise.all([
    collectPageReviewEvidence(userId, { pageUrl, property: review.provenance.property, currentPage, focusKeywords }),
    researchPage(openai, currentPage, signal),
  ]);
  await assertReviewStillCurrent(userId, review.provenance);
  if (signal?.aborted) throw new RequestError('The page review was cancelled.', 409);
  let response;
  try {
    response = await openai.responses.create(buildReviewRequest({ currentPage, evidence, research, focusKeywords }),
      { timeout: 45000, ...(signal ? { signal } : {}) });
  } catch {
    throw new RequestError('The page review service is temporarily unavailable. Your website has not been changed. Please try again later.', 503);
  }
  let result;
  try { result = validatePageAssessment(responseText(response), { currentPage, evidence, research }); }
  catch { throw new RequestError('The service did not return a clearly supported review. Your website has not been changed. Please try again.', 502); }
  await assertReviewStillCurrent(userId, review.provenance);
  return { ...result, currentPage, evidence, research, provenance: { ...review.provenance, generatedAt: new Date().toISOString(), reviewVersion: 3, model: PAGE_REVIEW_MODEL } };
}
