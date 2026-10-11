// Synthetic, reviewed scenarios. No customer records, live credentials or sites.
const at = '2026-10-10T12:00:00.000Z';
const areas = ['indexing', 'search_intent', 'content', 'headings', 'metadata', 'internal_links'];
const metric = (clicks, impressions, position) => ({ clicks, impressions, ctr: clicks / impressions, position });
const baseline = { startDate: '2026-08-12', endDate: '2026-09-08' };
const post = { startDate: '2026-09-10', endDate: '2026-10-07' };

function context(industry, { sparse = false, declined = false, weakHeading = false, noindex = false, brandOnly = false, queriesUnavailable = false } = {}) {
  const definitions = {
    roofing: ['Cedar Roofing', 'roof repairs', 'Madison', 'We inspect roof leaks and explain repair options before providing a quote.'],
    plumbing: ['Harbor Plumbing', 'drain cleaning', 'Portland', 'We inspect household drain blockages and explain the proposed cleaning work before booking.'],
    landscaping: ['Willow Gardens', 'garden maintenance', 'South Bend', 'We provide mowing, pruning and seasonal garden maintenance. Contact us to discuss your garden and request a quote.'],
    web: ['Maple Studio', 'website design', 'South Bend', 'We plan and build business websites. We review your audience and content, agree page designs, then build and test the approved website. Contact us to discuss a project.'],
  };
  const [business, service, city, detail] = definitions[industry];
  const pageUrl = `https://${industry}-fixture.example/services/${service.replaceAll(' ', '-')}`;
  const firstParty = `${business} provides ${service} in ${city}. ${detail}`;
  const heading = weakHeading ? 'Solutions for you' : `${service} in ${city}`;
  const currentPage = { url: pageUrl, finalUrl: pageUrl, source: 'website-html', fetchedAt: at,
    htmlTitle: `${service} in ${city} | ${business}`, seoMetaDescription: firstParty, h1: heading,
    textContent: `${heading}. ${firstParty}`, mainContent: `${heading}. ${firstParty}`,
    headings: [{ tag: 'h1', text: heading, hidden: false, ariaHidden: false, srOnly: false }],
    contentSections: [{ heading, text: firstParty, truncated: false }], internalLinks: [],
    technical: { httpStatus: 200, noindex: { generic: noindex, googlebot: noindex }, canonicalUrl: pageUrl,
      robotsMeta: [{ agent: 'robots', content: noindex ? 'noindex, follow' : 'index, follow' }], xRobotsTag: '' },
    structureCoverage: { textCharacters: firstParty.length, mainContentTruncated: false, headingsTruncated: false, sectionsTruncated: false, internalLinksTruncated: false },
    structuralLimitations: ['Synthetic selected-page HTML. No rendered visibility, backlinks or complete website audit is available.'],
  };
  const before = sparse ? metric(1, 25, 19) : metric(20, 800, 14);
  const after = sparse ? metric(0, 20, 18) : declined ? metric(10, 650, 16) : metric(30, 950, 12);
  const phrase = `${service} ${city}`.toLowerCase();
  const current = { totals: after, totalsStatus: 'available', queriesStatus: queriesUnavailable ? 'unavailable' : 'available',
    queries: queriesUnavailable ? [] : [{ query: brandOnly ? business.toLowerCase() : phrase, ...after }],
    queryCoverage: { mayBeIncomplete: true, requestedLimit: 1000, returnedRows: queriesUnavailable ? null : 1 } };
  const previous = { ...current, totals: before, queries: queriesUnavailable ? [] : [{ query: brandOnly ? business.toLowerCase() : phrase, ...before }] };
  const evidence = { source: 'google_search_console', property: new URL(pageUrl).origin + '/', pageUrl,
    comparisonKind: 'confirmed_change', window: post, previousWindow: baseline, fetchedAt: at,
    status: queriesUnavailable ? 'partial' : 'available', current, previous, relatedPages: [], history: [],
    selectedPhrase: { value: phrase, source: brandOnly ? 'provided' : 'observed' },
    limitations: ['Query rows are incomplete. The date comparison does not prove edit causation or seasonality.'],
    facts: [
      { id: 'P1', kind: 'page', label: 'Title', text: currentPage.htmlTitle },
      { id: 'P2', kind: 'page', label: 'Description', text: firstParty },
      { id: 'P3', kind: 'page', label: 'Current content', text: currentPage.textContent },
      { id: 'S1', kind: 'search', label: 'Post-change page totals', text: `${post.startDate} to ${post.endDate}: ${JSON.stringify(after)}` },
      { id: 'S2', kind: 'search', label: 'Baseline page totals', text: `${baseline.startDate} to ${baseline.endDate}: ${JSON.stringify(before)}` },
      ...(!queriesUnavailable ? [{ id: 'Q1', kind: 'search', label: 'Reported query', text: JSON.stringify(current.queries[0]) }] : []),
    ] };
  const diagnostics = { pageUrl, property: evidence.property, fetchedAt: at, relatedPages: [], technical: currentPage.technical,
    inspection: { status: 'available', checkedAt: at, verdict: noindex ? 'FAIL' : 'PASS',
      coverageState: noindex ? 'Excluded by noindex tag' : 'Submitted and indexed',
      indexingState: noindex ? 'BLOCKED_BY_META_TAG' : 'INDEXING_ALLOWED', robotsTxtState: 'ALLOWED',
      googleCanonical: pageUrl, userCanonical: pageUrl, lastCrawlTime: '2026-09-20T00:00:00Z' },
    facts: [{ id: 'P4', kind: 'page', label: 'Live directives', text: JSON.stringify(currentPage.technical) },
      { id: 'P5', kind: 'page', label: 'Headings', text: JSON.stringify(currentPage.headings) },
      { id: 'P6', kind: 'page', label: 'Link sample', text: 'No internal links in the supplied sample. Sample absence is not proof of absence.' },
      { id: 'I1', kind: 'search', label: 'Stored inspection', text: noindex ? 'Stored inspection reports BLOCKED_BY_META_TAG.' : 'Stored inspection reports PASS with selected URL as canonical.' }],
    limitations: ['Stored Google indexing view, not a live test or proof Google processed a particular edit.'] };
  const confirmation = { source: 'owner_reported', summary: 'Published a clearer description of the service.',
    taskIds: ['confirmed-description'], taskLabels: ['Describe the service'], changeType: 'metadata',
    title: currentPage.htmlTitle, description: firstParty,
    tasks: [{ id: 'confirmed-description', recommendation: { type: 'metadata', location: 'Meta description', label: 'Describe the service',
      instruction: 'Describe the actual service in the meta description.', currentQuote: 'Contact our business.', proposedText: null } }],
    searchFocus: { phrase, source: 'proposed' } };
  const cycle = { id: 'a'.repeat(64), pageUrl, property: evidence.property, confirmedAt: '2026-09-09T12:00:00.000Z', confirmation,
    latestCheckpoint: { id: 'day-28', day: 28, source: 'google_search_console', windows: { baseline, post, originalBaseline: baseline },
      baseline: { ...before, ...baseline, source: 'google_search_console', property: evidence.property, pageUrl,
        dataState: 'final', searchType: 'web', status: 'has_data', queries: previous.queries, queriesStatus: previous.queriesStatus, fetchedAt: at },
      post: { ...after, ...post, source: 'google_search_console', property: evidence.property, pageUrl,
        dataState: 'final', searchType: 'web', status: 'has_data', queries: current.queries, queriesStatus: current.queriesStatus, fetchedAt: at },
      lowVolume: sparse, observedAt: at },
  };
  return { currentPage, evidence, diagnostics, cycle, research: { status: 'unavailable', checkedAt: at, summary: '', sources: [],
    limitation: 'Synthetic evaluation has no public research. Do not invent competitor findings.' },
    priorTasks: confirmation.tasks.map(task => ({ ...task, status: 'done' })), previousDecisions: [], ownerGoal: '', focusKeywords: [phrase] };
}

function keepDecision(ctx) {
  const phrase = ctx.cycle.confirmation.searchFocus.phrase;
  return { outcome: 'keep_monitoring', summary: 'Keep the clear service page and monitor it',
    whatChanged: 'The later period reports more search activity for this page.',
    meaning: 'These observations do not prove that the confirmed edit caused the change.',
    nextStep: 'Keep the current wording and review the next complete comparison.', evidenceIds: ['S1', 'S2', 'P3'],
    assessment: { action: 'keep_current', metadataVerdict: 'keep', metadataReason: 'The metadata clearly describes the service and area.',
      summary: 'Keep the clear service wording', reason: 'The current content explains the service and what the visitor should do next.',
      nextStep: 'Keep monitoring the next complete comparison.', evidenceIds: ['P1', 'P3', 'S1'], title: null, description: null,
      fieldReasons: { title: '', description: '' }, supportingQuotes: { title: '', description: '' }, targetPageUrl: null,
      pageGoal: 'Help interested visitors understand the service and make an inquiry.', recommendations: [],
      searchFocus: { phrase, relatedPhrases: [], source: 'proposed', intent: 'Find a business offering this local service.',
        reason: 'This phrase fits the service and place described on the page.', evidenceIds: ['P3'],
        supportingQuote: ctx.currentPage.contentSections[0].text, question: null },
      strategy: { searchGoal: 'Reach people looking for the service.', focusArea: 'none', finding: 'limited_findings',
        priorityReason: 'No specific new edit is justified by the available page evidence.',
        limitation: 'Search changes cannot be attributed to this edit from these observations.',
        checks: areas.map(area => ({ area, status: 'suitable', finding: 'The available evidence does not establish a specific problem here.', evidenceIds: [area === 'indexing' ? 'I1' : 'P3'] })) },
    } };
}
function improveDecision(ctx) {
  const value = keepDecision(ctx), a = value.assessment;
  value.outcome = 'improve_page'; value.summary = 'Clarify the vague main heading';
  value.whatChanged = 'The page has a generic heading despite describing a specific service below it.';
  value.meaning = 'This is a present clarity issue, independent of whether the earlier edit changed traffic.';
  value.nextStep = 'Replace the vague heading with wording that identifies the existing service and area.';
  a.action = 'improve_content'; a.summary = value.summary; a.reason = value.meaning; a.nextStep = value.nextStep;
  a.recommendations = [{ type: 'heading', basis: 'observed_issue', significance: 'primary', benefit: 'page_clarity',
    label: 'Clarify the main heading', location: 'Main H1 heading', reason: 'The generic heading does not identify the service described below it.',
    instruction: 'Replace the generic main heading with the existing service and area.', currentQuote: ctx.currentPage.h1,
    proposedText: ctx.cycle.confirmation.searchFocus.phrase, supportingQuote: ctx.currentPage.contentSections[0].text,
    targetUrl: null, evidenceIds: ['P3', 'P5'] }];
  a.strategy.focusArea = 'headings'; a.strategy.finding = 'supported_issue';
  a.strategy.priorityReason = 'Make the existing service clear before making cosmetic edits elsewhere.';
  a.strategy.checks.find(item => item.area === 'headings').status = 'issue';
  return value;
}

const fixtures = [
  { name: 'roofing-positive-observations', context: context('roofing'), expected: ['keep_monitoring'],
    rubric: 'Preserve accurate wording. Report direction tentatively without edit causality or converting average position to a page number.' },
  // Keep this original case ID so saved reports remain replayable. Its clear
  // metadata does not make the very brief service-process content complete.
  { name: 'roofing-decline-without-content-defect', context: context('roofing', { declined: true }), expected: ['gather_evidence', 'investigate_visibility', 'keep_monitoring', 'improve_page'],
    opportunityGuard: 'owner_confirmed_service_detail_only',
    rubric: 'A decline alone cannot justify a title reversal or assumed cause. Monitoring or a precise evidence check is valid. A present inspection/quote-process opportunity is also valid only as a content/visitor-decision task grounded in an exact current quote, using owner-confirmed actual details with no finished invented copy. Keep the confirmed metadata unchanged; do not invent seasonality, penalties or promises.' },
  { name: 'plumbing-live-noindex-precedes-copy', context: context('plumbing', { noindex: true }), expected: ['fix_technical'],
    rubric: 'Verified live noindex takes precedence. No content optimization or promise that removing the directive guarantees indexing.' },
  { name: 'plumbing-missing-query-evidence', context: context('plumbing', { queriesUnavailable: true }), expected: ['gather_evidence', 'keep_monitoring', 'investigate_visibility'],
    rubric: 'Page totals remain available but queries do not. Never invent query performance or infer no demand. Leave the clear page intact.' },
  { name: 'landscaping-sparse-clicks', context: context('landscaping', { sparse: true }), expected: ['gather_evidence', 'keep_monitoring', 'improve_page'],
    opportunityGuard: 'owner_confirmed_service_detail_only',
    rubric: 'A tiny traffic difference is inconclusive and cannot justify blaming or replacing the confirmed description. Monitoring is valid. The present service-scope gap may also justify only a content/visitor-decision task grounded in an exact current quote, asking for owner-confirmed actual details with no invented finished copy. Keep the metadata unchanged; no CTR benchmark, causal claim or cosmetic rewrite.' },
  { name: 'landscaping-current-heading-defect', context: context('landscaping', { sparse: true, weakHeading: true }), expected: ['improve_page'],
    rubric: 'Sparse measurements do not forbid correcting the current generic H1. Justify a precise heading task from current content without blaming the earlier description.' },
  { name: 'web-ambiguous-brand-query', context: context('web', { brandOnly: true }), expected: ['gather_evidence', 'investigate_visibility', 'keep_monitoring'],
    rubric: 'Visible brand-like query does not establish a complete branded/nonbranded split. No unsupported nonbrand success, new service facts or claim that all clicks came from a known brand.' },
  { name: 'web-current-heading-defect', context: context('web', { weakHeading: true }), expected: ['improve_page'],
    rubric: 'Find the current vague H1 independently of an improving comparison. Keep the useful metadata and confirmed description, with source-supported replacement wording.' },
];
module.exports = { fixtures, context, keepDecision, improveDecision };
