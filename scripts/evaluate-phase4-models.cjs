// Explicit bounded paid evaluation: at most six analysis requests, no search,
// account writes, website edits or confirmations. Inputs are public/synthetic.
// Usage: node scripts/evaluate-phase4-models.cjs --live
// Optional separate research check: --live --research (one web request only).
require('dotenv').config({ path: '.env.local', quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const OpenAI = require('openai');

async function main() {
  const mode = process.argv.slice(2).join(' ');
  if (!['--live', '--live --research'].includes(mode)) throw new Error('Use --live for the bounded paid model evaluation.');
  if (!process.env.OPENAI_API_KEY || process.env.SIMPLESEO_TEST_MODE === '1') throw new Error('The configured OpenAI evaluation account is unavailable.');
  const policySource = fs.readFileSync(path.join(__dirname, '../app/lib/pageReviewPolicy.js'), 'utf8');
  const { buildReviewRequest, buildResearchRequest, parseWebResearch, responseText, validatePageAssessment } = await import(`data:text/javascript;base64,${Buffer.from(policySource).toString('base64')}`);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60000 });
  const response = await fetch('https://bryandevelops.com/', { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error('The public homepage could not be read.');
  const $ = cheerio.load(await response.text());
  const clean = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const homepage = { url: 'https://bryandevelops.com/', htmlTitle: clean($('title').first().text(), 500), seoMetaDescription: clean($('meta[name="description"]').attr('content'), 1000), h1: clean($('h1').first().text(), 500), headings: [] };
  $('script,style,noscript,iframe,img,video,audio').remove();
  homepage.textContent = clean(($('main').length ? $('main') : $('body')).text(), 6000);
  $('h1,h2,h3,h4,h5,h6').each((_, item) => { if (homepage.headings.length < 10) homepage.headings.push({ tag: item.tagName, text: clean($(item).text(), 300) }); });
  if (mode === '--live --research') {
    const start = Date.now();
    const completion = await client.responses.create(buildResearchRequest(homepage), { timeout: 45000 });
    const research = parseWebResearch(completion);
    console.log(JSON.stringify({ case: 'public-homepage-research', model: completion.model, elapsedMs: Date.now() - start, usage: completion.usage, research,
      annotations: completion.output.filter(item => item.type === 'message').flatMap(item => item.content || []).flatMap(item => item.annotations || []) }));
    return;
  }
  const service = {
    url: 'https://copper-plumbing.example/drain-cleaning', htmlTitle: 'Drain Cleaning in Dayton | Copper Plumbing',
    seoMetaDescription: 'Copper Plumbing clears blocked kitchen and bathroom drains in Dayton. Learn about our drain cleaning service and contact us to discuss your blockage.',
    h1: 'Drain Cleaning in Dayton', headings: [{ tag: 'h1', text: 'Drain Cleaning in Dayton' }],
    textContent: 'Copper Plumbing provides drain cleaning in Dayton. We clear blocked kitchen sinks, bathroom sinks and shower drains. Our team discusses the symptoms, inspects the accessible drain and explains the proposed work before starting. Contact Copper Plumbing to discuss your blockage and arrange a visit. We do not offer emergency, overnight or heating services.',
  };
  const cases = [
    { name: 'public-homepage-content-only', page: homepage, expected: ['keep_current', 'collect_data'] },
    { name: 'clear-service-weak-click-data', page: service, expected: ['keep_current'] },
    { name: 'vague-title-missing-description', page: { ...service, htmlTitle: 'Home', seoMetaDescription: '' }, expected: ['revise_metadata'] },
  ];
  let count = 0;
  for (const sample of cases) {
    const currentPage = sample.page;
    const synthetic = sample.name !== 'public-homepage-content-only';
    const totals = synthetic ? { clicks: 0, impressions: 12, ctr: 0, position: 28 } : null;
    const facts = [
      { id: 'P1', kind: 'page', label: 'Current title', text: currentPage.htmlTitle },
      { id: 'P2', kind: 'page', label: 'Current description', text: currentPage.seoMetaDescription || 'No meta description tag found.' },
      { id: 'P3', kind: 'page', label: 'Page content', text: currentPage.textContent.slice(0, 2200) },
      ...(synthetic ? [{ id: 'S1', kind: 'search', label: 'Synthetic test observations', text: '12 impressions, 0 clicks, average position 28. This is an isolated evaluation fixture, not actual Google observations.' }] : []),
    ];
    const evidence = { source: synthetic ? 'evaluation_fixture' : 'unavailable', pageUrl: currentPage.url, status: synthetic ? 'available' : 'unavailable', window: { startDate: '2026-09-10', endDate: '2026-10-07' }, previousWindow: { startDate: '2026-08-13', endDate: '2026-09-09' }, current: { totals, queries: [] }, previous: { totals: null, queries: [] }, relatedPages: [], facts, limitations: ['No reliable performance comparison is available. Sparse clicks and query rows do not justify an edit by themselves.'] };
    const research = { status: 'not_requested', summary: '', sources: [], checkedAt: null, limitation: 'No web research in this evaluation.' };
    for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) {
      count += 1;
      const start = Date.now();
      try {
        const completion = await client.responses.create(buildReviewRequest({ currentPage, evidence, research, model }));
        const text = responseText(completion);
        let result, validationError;
        try { result = validatePageAssessment(text, { currentPage, evidence, research }); }
        catch (error) { validationError = error.message; }
        console.log(JSON.stringify({ request: count, case: sample.name, model, elapsedMs: Date.now() - start, valid: Boolean(result), expectedAction: Boolean(result && sample.expected.includes(result.analysis.action)), usage: completion.usage, result: result || JSON.parse(text), ...(validationError ? { validationError } : {}) }));
      } catch (error) {
        console.log(JSON.stringify({ request: count, case: sample.name, model, elapsedMs: Date.now() - start, valid: false, status: error.status || null, error: 'Evaluation request failed; provider details omitted.' }));
      }
    }
  }
}
main().catch(() => { console.error('Evaluation could not complete. No account data or website content was changed.'); process.exitCode = 1; });
