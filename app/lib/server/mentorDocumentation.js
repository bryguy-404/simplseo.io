import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { db } from '../firebaseAdmin';
import { publicFetch } from './publicFetch';
import { GOOGLE_SEO_TOPICS, approvedGoogleDocumentationUrl } from '../mentorDocumentationPolicy';

const TTL = 7 * 86400000;
const idFor = url => `google-${createHash('sha256').update(url).digest('hex').slice(0, 20)}`;
export async function readGoogleDocumentation(url, { deadline = Date.now() + 15000, signal, fresh = false } = {}) {
  url = approvedGoogleDocumentationUrl(url);
  if (!url) throw new Error('Only official Google SEO documentation can be used.');
  const ref = db.collection('mentorDocumentationCache').doc(idFor(url));
  const previous = (await ref.get()).data();
  if (!fresh && previous?.extractionVersion === 2 && previous?.url === url && typeof previous.excerpt === 'string' && Date.parse(previous.observedAt) + TTL > Date.now()) {
    return { ...previous, status: 'available', cached: true };
  }
  try {
    const response = await publicFetch(url, { deadline, signal, allowedHostname: new URL(url).hostname });
    if (!response.ok || !approvedGoogleDocumentationUrl(response.url) || !/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('Documentation unavailable.');
    const $ = load(await response.text());
    $('script,style,template,nav,header,footer,aside,.devsite-toc,.devsite-nav,.feedback-button,devsite-feedback,devsite-thumb-rating').remove();
    const body = $('.devsite-article-body').first();
    const article = body.length ? body : $('article,main,[role=main]').first();
    const excerpt = (article.length ? article : $('body')).text().replace(/\s+/g, ' ').trim().slice(0, 12000);
    if (excerpt.length < 120) throw new Error('Documentation unavailable.');
    const item = { id: idFor(url), url, extractionVersion: 2, title: $('h1').first().text().trim().slice(0, 180) || $('title').text().slice(0, 180),
      excerpt, observedAt: new Date().toISOString(), type: 'google_documentation' };
    await ref.set(item);
    return { ...item, status: 'available', cached: false };
  } catch {
    return previous?.url === url && previous.excerpt ? { ...previous, status: 'stale', cached: true,
      limitation: 'This dated reference could not be refreshed. Do not describe it as current verified guidance.' }
      : { id: idFor(url), url, status: 'unavailable', limitation: 'Google documentation could not be retrieved. Do not cite this as reviewed evidence.' };
  }
}

export async function lookupGoogleGuidance(topic, options = {}) {
  const entry = GOOGLE_SEO_TOPICS[topic];
  if (!entry) throw new Error('Choose a supported SEO documentation topic.');
  const documents = await Promise.all([entry.url, ...(entry.relatedUrls || [])].slice(0, 3).map(url => readGoogleDocumentation(url, options)));
  return { topic, documents, sources: documents.filter(document => document.excerpt).map(document => ({ id: document.id, title: document.title || entry.title,
    url: document.url, observedAt: document.observedAt, type: document.type, status: document.status })),
    limitation: documents.map(document => document.limitation).filter(Boolean).join(' ') || null };
}

// Topic-specific passages prevent a long introduction from crowding out the
// actual documented answer. Extracted sentences remain source text, not an AI
// summary. No account question is sent to Google or the research provider.
export function selectMentorDocumentationExcerpt(document, topic) {
  const text = document.excerpt || '', terms = GOOGLE_SEO_TOPICS[topic]?.excerptTerms || [];
  if (!terms.length || text.length <= 2200) return text.slice(0, 2200);
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
  const ranked = sentences.map((sentence, index) => ({ sentence: sentence.trim(), index,
    score: terms.reduce((sum, term) => sum + (sentence.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0 && item.sentence.length <= 1600).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = []; let length = 0;
  for (const item of ranked) if (length + item.sentence.length + 2 <= 2200) { selected.push(item); length += item.sentence.length + 2; }
  return selected.length ? selected.sort((a, b) => a.index - b.index).map(item => item.sentence).join('\n\n') : text.slice(0, 2200);
}

// Shorten the already selected passage without clipping a qualification or
// negation halfway through a sentence. Cached documentation stays unchanged.
export function compactMentorDocumentationExcerpt(document, topic, maxChars = 1200) {
  const text = document.excerpt || '';
  if (text.length <= maxChars) return text;
  const terms = GOOGLE_SEO_TOPICS[topic]?.excerptTerms || [];
  const sentences = (text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || []).map((sentence, index) => ({ sentence: sentence.trim(), index,
    score: terms.reduce((sum, term) => sum + (sentence.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(item => item.sentence.length <= maxChars).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = []; let length = 0;
  for (const item of sentences) if (length + item.sentence.length + (selected.length ? 2 : 0) <= maxChars) {
    selected.push(item); length += item.sentence.length + (selected.length > 1 ? 2 : 0);
  }
  return selected.sort((a, b) => a.index - b.index).map(item => item.sentence).join('\n\n');
}

export function documentationResearchRequest(topic, model, maxOutputTokens = 1400) {
  const entry = GOOGLE_SEO_TOPICS[topic];
  if (!entry) throw new Error('Choose a supported SEO topic.');
  // Fixed public topic queries are the privacy boundary. Never concatenate a
  // user question, conversation, account URL, business facts or GSC data here.
  return { model, store: false, service_tier: 'default', reasoning: { effort: 'low' }, max_output_tokens: maxOutputTokens,
    max_tool_calls: 1, tools: [{ type: 'web_search', search_context_size: 'low',
      filters: { allowed_domains: ['developers.google.com', 'support.google.com'] } }], tool_choice: 'required',
    include: ['web_search_call.action.sources'], input: `Find official Google documentation for: ${entry.query}. Use only Google Search Central documentation/blog or Search Console/Business Profile Help answer pages. Briefly identify useful sources; no speculation. Use at most one search.` };
}

export function researchedDocumentationUrls(response) {
  if (!response?.output?.some(item => item.type === 'web_search_call' && item.status === 'completed')) return [];
  const urls = [];
  for (const item of response.output) {
    for (const source of item.action?.sources || []) { const url = approvedGoogleDocumentationUrl(source.url); if (url) urls.push(url); }
    for (const content of item.content || []) for (const annotation of content.annotations || []) {
      const url = annotation.type === 'url_citation' && approvedGoogleDocumentationUrl(annotation.url); if (url) urls.push(url);
    }
  }
  return [...new Set(urls)].slice(0, 2);
}
