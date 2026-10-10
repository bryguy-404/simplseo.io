// Controlled useful-action evaluation; no production account or website reads.
// --list is offline. --live makes exactly six bounded Sol analysis requests.
// Add --case EXACT_CASE_NAME to run exactly one requested case instead.
// No search calls, automatic retries, writes or publication confirmations.
// The research-unavailable fixtures isolate diagnosis; live research is checked
// separately by the release verifier, never invented by this evaluation.
require('dotenv').config({ path: '.env.local', quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');

const shiftDay = (day, days) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const windows = Array.from({ length: 6 }, (_, index) => ({
  startDate: shiftDay('2026-09-10', -28 * index), endDate: shiftDay('2026-10-07', -28 * index),
}));
const metrics = (clicks, impressions, position) => ({ clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions ? position : null });
const sparse = metrics(0, 12, 38);
const strong = metrics(180, 2400, 3.4);
const page = {
  url: 'https://copper-plumbing.example/drain-cleaning',
  htmlTitle: 'Drain Cleaning in Dayton | Copper Plumbing',
  seoMetaDescription: 'Copper Plumbing clears blocked kitchen and bathroom drains in Dayton. Learn about our drain cleaning service and contact us to discuss your blockage.',
  h1: 'Drain Cleaning in Dayton', headings: [{ tag: 'h2', text: 'What happens during a drain cleaning visit' }],
  textContent: 'Copper Plumbing provides drain cleaning in Dayton. We clear blocked kitchen sinks, bathroom sinks and shower drains. We ask about the blockage, inspect the accessible drain, explain the proposed work and answer questions before starting. Contact Copper Plumbing to discuss your blockage and arrange a visit. We do not offer emergency, overnight or heating services.',
};
const sampleCases = [
  {
    name: 'accurate-metadata-persistent-low-visibility', page, periodMetrics: Array.from({ length: 6 }, () => sparse),
    queries: [{ query: 'drain cleaning dayton', ...sparse }], focus: 'drain cleaning dayton',
    actions: ['investigate_visibility'], verdicts: ['keep'],
    rubric: 'Retain accurate metadata; investigate visibility with a specific owner check. Do not assert an indexing failure, invent a cause, or end with merely waiting.',
  },
  {
    name: 'supported-content-gap-with-accurate-metadata',
    page: { ...page, headings: [], textContent: 'Copper Plumbing provides drain cleaning in Dayton. We clear blocked kitchen sinks, bathroom sinks and shower drains. Contact Copper Plumbing to discuss your blockage and arrange a visit. We serve homeowners throughout Dayton. Call our team to discuss availability and arrange a visit.' },
    periodMetrics: Array.from({ length: 6 }, () => metrics(8, 420, 7)),
    queries: [{ query: 'how drain cleaning works', ...metrics(4, 300, 7) }], focus: 'how drain cleaning works',
    actions: ['improve_content'], verdicts: ['keep'],
    rubric: 'Keep service metadata; suggest explaining the actual appointment/inspection process. Ask the owner for truthful details rather than inventing methods, prices or guarantees.',
  },
  {
    name: 'specific-query-better-reviewed-on-observed-service-page',
    page: { ...page, url: 'https://copper-plumbing.example/', htmlTitle: 'Local Plumbing Services in Dayton | Copper Plumbing',
      seoMetaDescription: 'Copper Plumbing helps Dayton homeowners with plumbing repairs and drain cleaning. Explore our services and contact us to discuss your plumbing needs.',
      h1: 'Plumbing services for Dayton homeowners', headings: [{ tag: 'h2', text: 'Our services' }],
      textContent: 'Copper Plumbing provides plumbing repairs and drain cleaning in Dayton. This homepage introduces our business and lists our services. Visit our dedicated drain cleaning page for information about blocked kitchen sinks, bathroom sinks and shower drains. Contact us to discuss your plumbing needs.' },
    periodMetrics: Array.from({ length: 6 }, () => metrics(12, 400, 10)),
    queries: [{ query: 'drain cleaning dayton', ...metrics(0, 24, 25) }], focus: 'drain cleaning dayton',
    relatedPages: [{ pageUrl: page.url, ...metrics(35, 600, 6) }],
    actions: ['review_page'], verdicts: ['keep'], targetPageUrl: page.url,
    rubric: 'Review the exact supplied drain-cleaning URL before changing the broad homepage. Do not claim that the service page was read or prove superiority from its metrics.',
  },
  {
    name: 'missing-metadata-repair-despite-sparse-search',
    page: { ...page, htmlTitle: 'Home', seoMetaDescription: '' }, periodMetrics: Array.from({ length: 6 }, () => sparse),
    queries: [{ query: 'drain cleaning dayton', ...sparse }], focus: 'drain cleaning dayton',
    actions: ['revise_metadata'], verdicts: ['revise'],
    rubric: 'Fix the generic title and missing description using supported service/location facts. Do not let sparse metrics block an obvious content-grounded repair.',
  },
  {
    name: 'clear-wording-stable-useful-search-activity', page, periodMetrics: Array.from({ length: 6 }, () => strong),
    queries: [{ query: 'drain cleaning dayton', ...metrics(130, 1700, 3.2) }, { query: 'copper plumbing', ...metrics(50, 700, 3.9) }],
    focus: 'drain cleaning dayton', actions: ['keep_current'], verdicts: ['keep'],
    rubric: 'Retain clear wording without inventing busywork, uplift predictions or proof of why the page ranks. A warranted no-edit result remains successful.',
  },
  {
    name: 'missing-business-context-and-unavailable-search',
    page: { url: 'https://unidentified-business.example/', htmlTitle: 'Welcome to Our Website', seoMetaDescription: '',
      h1: 'Welcome', headings: [], textContent: 'Welcome to our website. We are working on this page and will publish more details soon. Please return later for information about our business, services and contact options. There are no current service, business name or location details in this page.' },
    periodMetrics: Array.from({ length: 6 }, () => null), queries: [],
    actions: ['collect_data', 'improve_content'], verdicts: ['uncertain'],
    rubric: 'Request the missing factual business/page context; do not invent a service, place or title from generic filler. Missing reporting must not become zero traffic.',
  },
];

function fixtureEvidence(sample) {
  const currentPage = sample.page;
  const history = windows.map((window, index) => ({ window, totals: sample.periodMetrics[index], totalsStatus: sample.periodMetrics[index] ? 'available' : 'unavailable' }));
  const facts = [
    { id: 'P1', kind: 'page', label: 'Current title', text: currentPage.htmlTitle },
    { id: 'P2', kind: 'page', label: 'Current description', text: currentPage.seoMetaDescription || 'No meta description tag found.' },
    { id: 'P3', kind: 'page', label: 'Current page content', text: currentPage.textContent },
  ];
  const metricText = value => `${value.impressions} impressions, ${value.clicks} clicks, average position ${value.position}`;
  history.forEach((period, index) => {
    if (period.totals) facts.push({ id: `H${index + 1}`, kind: 'search', label: 'Synthetic search history', text: `${period.window.startDate} through ${period.window.endDate}: ${metricText(period.totals)}. Controlled fixture, not live Google observations.` });
  });
  for (const index of [0, 1]) if (history[index].totals) facts.push({ id: `S${index + 1}`, kind: 'search', label: 'Synthetic page totals', text: `${windows[index].startDate} through ${windows[index].endDate}: ${metricText(history[index].totals)}.` });
  sample.queries.forEach((query, index) => facts.push({ id: `Q${index + 1}`, kind: 'search', label: 'Synthetic page query', text: `${query.query}: ${metricText(query)}.` }));
  const relatedPages = sample.relatedPages || [];
  relatedPages.forEach((row, index) => facts.push({ id: `R${index + 1}`, kind: 'search', label: 'Synthetic other observed page', text: `Query ${sample.focus}; page ${row.pageUrl}: ${metricText(row)}. Page content has not been fetched.` }));
  const period = index => ({ totals: history[index].totals, totalsStatus: history[index].totalsStatus,
    queries: index ? [] : sample.queries, queriesStatus: history[index].totals ? (sample.queries.length ? 'available' : 'no_data') : 'unavailable' });
  return {
    source: 'evaluation_fixture', property: new URL(currentPage.url).origin + '/', pageUrl: currentPage.url,
    fetchedAt: '2026-10-10T16:00:00.000Z', window: windows[0], previousWindow: windows[1], history,
    status: history[0].totals ? 'available' : 'unavailable', current: period(0), previous: period(1), relatedPages,
    relatedPagesStatus: sample.focus ? (relatedPages.length ? 'available' : 'no_data') : 'not_requested',
    selectedPhrase: { value: sample.focus || '', source: sample.focus ? 'observed' : 'none' }, facts,
    limitations: [
      'All search numbers in this controlled evaluation are synthetic, not live customer data.',
      'Six adjacent finalized periods provide search history, not evidence of when metadata was edited or whether it caused a change.',
      'Query rows are partial. Search activity does not establish indexing status or causality.',
    ],
  };
}

async function main() {
  const [mode, selectionFlag, caseName, ...extra] = process.argv.slice(2);
  if (!['--list', '--live'].includes(mode) || extra.length || (selectionFlag !== undefined && (selectionFlag !== '--case' || !caseName))) {
    throw new Error('Use --list or --live, optionally followed by --case EXACT_CASE_NAME.');
  }
  const selectedCases = caseName ? sampleCases.filter(sample => sample.name === caseName) : sampleCases;
  if (!selectedCases.length) throw new Error('Select an exact known evaluation case.');
  if (mode === '--list') {
    console.log(JSON.stringify({ requests: selectedCases.length, inputs: 'controlled fixtures only',
      cases: selectedCases.map(sample => ({ case: sample.name, acceptedActions: sample.actions, acceptedMetadataVerdicts: sample.verdicts, rubric: sample.rubric })) }, null, 2));
    return;
  }
  if (!process.env.OPENAI_API_KEY || process.env.SIMPLESEO_TEST_MODE === '1') throw new Error('The configured evaluation account is unavailable.');
  const policySource = fs.readFileSync(path.join(__dirname, '../app/lib/pageReviewPolicy.js'), 'utf8');
  const { PAGE_REVIEW_MODEL, buildReviewRequest, responseText, validatePageAssessment } = await import(`data:text/javascript;base64,${Buffer.from(policySource).toString('base64')}`);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 45000 });
  const research = { status: 'unavailable', summary: '', sources: [], checkedAt: '2026-10-10T16:00:00.000Z',
    limitation: 'Controlled evaluation: no research request is made and no competitor findings are invented.' };
  let passed = 0;
  for (const [index, sample] of selectedCases.entries()) {
    const start = Date.now(), evidence = fixtureEvidence(sample);
    let completion;
    try {
      completion = await client.responses.create(buildReviewRequest({ currentPage: sample.page, evidence, research, focusKeywords: sample.focus ? [sample.focus] : [] }));
    } catch (error) {
      console.log(JSON.stringify({ request: index + 1, case: sample.name, model: PAGE_REVIEW_MODEL, elapsedMs: Date.now() - start,
        pass: false, valid: false, failureStage: 'provider', status: Number.isInteger(error.status) ? error.status : null,
        error: 'Evaluation provider request failed; provider error details omitted.' }));
      continue;
    }
    let generatedText;
    try {
      generatedText = responseText(completion);
    } catch {
      console.log(JSON.stringify({ request: index + 1, case: sample.name, model: completion.model || PAGE_REVIEW_MODEL,
        elapsedMs: Date.now() - start, pass: false, valid: false, failureStage: 'completion',
        completionStatus: completion.status, usage: completion.usage,
        error: 'The response was incomplete, refused, or had no generated text.' }));
      continue;
    }
    try {
      const result = validatePageAssessment(generatedText, { currentPage: sample.page, evidence, research });
      const acceptedAction = sample.actions.includes(result.analysis.action);
      const acceptedVerdict = sample.verdicts.includes(result.analysis.metadataVerdict);
      const acceptedTarget = !sample.targetPageUrl || result.analysis.targetPageUrl === sample.targetPageUrl;
      const pass = acceptedAction && acceptedVerdict && acceptedTarget;
      if (pass) passed += 1;
      console.log(JSON.stringify({ request: index + 1, case: sample.name, model: completion.model || PAGE_REVIEW_MODEL,
        elapsedMs: Date.now() - start, valid: true, acceptedAction, acceptedVerdict, acceptedTarget, pass,
        usage: completion.usage, rubricForHumanReview: sample.rubric, result }));
    } catch {
      // The only source inputs here are controlled fixtures. Preserve generated
      // JSON for local diagnosis, never raw SDK errors or response/request headers.
      let rawModelOutput;
      try { rawModelOutput = JSON.parse(generatedText); } catch { rawModelOutput = null; }
      console.log(JSON.stringify({ request: index + 1, case: sample.name, model: completion.model || PAGE_REVIEW_MODEL,
        elapsedMs: Date.now() - start, pass: false, valid: false, failureStage: 'validation', usage: completion.usage,
        rawModelOutput, error: rawModelOutput === null ? 'Completed generated text was not valid JSON.' : 'Completed generated JSON did not meet the review policy.' }));
    }
  }
  console.log(JSON.stringify({ requests: selectedCases.length, passed, failed: selectedCases.length - passed,
    syntheticInputs: true, researchCalls: 0, websiteWrites: 0, accountWrites: 0,
    limitation: 'Action/verdict checks need human review of the explanation and evidence. This does not demonstrate ranking improvement.' }));
  if (passed !== selectedCases.length) process.exitCode = 1;
}
main().catch(() => { console.error('Evaluation could not complete. No account or website content was changed.'); process.exitCode = 1; });
