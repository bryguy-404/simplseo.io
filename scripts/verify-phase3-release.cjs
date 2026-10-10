// Release checks for one explicitly supplied production account.
// Usage: node scripts/verify-phase3-release.cjs <uid> <exact-property> [--draft] [--research]
// --draft makes one explicit review request, including automatic bounded web
// research and one assessment. --research is retained as a compatibility flag
// requiring --draft; research is already included in every current review.
// --draft saves its review/task plan; neither flag confirms an edit.
// Login, OAuth refresh and the optional AI request may update their normal
// session/credential/quota metadata; website work and history must not change.
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

const ORIGIN = 'https://simplseo-io.vercel.app';
const PROJECT = 'simpleseo-90570';
class VerificationFailure extends Error {}
const assert = (condition, message) => { if (!condition) throw new VerificationFailure(message); };
let stage = 'configuration';
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const validDay = value => typeof value === 'string' && dayPattern.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const shiftDay = (day, offset) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
const expectedWindow = date => {
  const pacificDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const endDate = shiftDay(pacificDay, -3);
  return { startDate: shiftDay(endDate, -27), endDate };
};
const sameIds = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const validMetrics = row => row && Number.isFinite(row.clicks) && Number.isFinite(row.impressions)
  && row.clicks >= 0 && row.impressions >= 0 && row.clicks <= row.impressions
  && (row.impressions === 0 ? row.ctr === null && row.position === null
    : Number.isFinite(row.ctr) && row.ctr >= 0 && row.ctr <= 1 && Number.isFinite(row.position) && row.position >= 1);
const recentTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Math.abs(Date.now() - Date.parse(value)) < 5 * 60 * 1000;
const RECOMMENDATION_TYPES = ['heading', 'content', 'internal_link', 'technical', 'metadata', 'check'];
const REVIEW_ACTIONS = ['revise_metadata', 'keep_current', 'improve_content', 'review_page', 'collect_data', 'investigate_visibility'];
const textWithin = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;

async function main() {
  const [uid, property, ...flags] = process.argv.slice(2);
  assert(/^[A-Za-z0-9_-]{1,128}$/.test(uid || '') && property && flags.every(flag => ['--draft', '--research'].includes(flag))
    && new Set(flags).size === flags.length && (!flags.includes('--research') || flags.includes('--draft')),
  'Provide an exact UID and property; --research requires --draft, and no other or duplicate flags are accepted.');
  assert(process.env.FIREBASE_PROJECT_ID === PROJECT, 'The configured Firebase project must be the existing production project.');
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Remove emulator settings before production verification.');
  let homepage;
  try { homepage = new URL(property); } catch { throw new VerificationFailure('Provide the exact HTTPS homepage URL-prefix property.'); }
  assert(homepage.protocol === 'https:' && !homepage.username && !homepage.password && !homepage.port
    && homepage.pathname === '/' && !homepage.search && !homepage.hash && homepage.href === property, 'Provide the exact HTTPS homepage URL-prefix property.');
  assert(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY && process.env.NEXT_PUBLIC_FIREBASE_API_KEY, 'Required local verification credentials are unavailable.');
  const insideProperty = pageUrl => { try { const parsed = new URL(pageUrl); return parsed.origin === homepage.origin && parsed.pathname.startsWith(homepage.pathname) && !parsed.username && !parsed.password && !parsed.hash; } catch { return false; } };
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: PROJECT, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  let before;
  let summary;

  async function snapshotAccount() {
    const [setup, implementations, history] = await Promise.all([
      db.doc(`onboarding/${uid}`).get(),
      db.collection('implementedSeoTips').where('userId', '==', uid).get(),
      db.collection('users').doc(uid).collection('revampHistory').get(),
    ]);
    const historyRecords = await Promise.all(history.docs.map(run => run.ref.collection('records').get()));
    const archiveDocuments = [
      ...implementations.docs.filter(doc => doc.data().preRevampArchived),
      ...history.docs,
      ...historyRecords.flatMap(result => result.docs),
    ];
    return {
      setup: setup.data(),
      activeIds: implementations.docs.filter(doc => !doc.data().preRevampArchived && doc.data().status === 'implemented').map(doc => doc.id).sort(),
      historyRuns: history.docs.filter(doc => doc.data().complete).map(doc => doc.id),
      historyRecords: new Map(history.docs.map((run, index) => [run.id, historyRecords[index].docs.map(doc => doc.id)])),
      archives: new Map(archiveDocuments.map(doc => [doc.ref.path, doc.updateTime])),
    };
  }

  function verifySetup(setup, runId) {
    assert(setup?.isComplete === true && setup.revampStatus === 'complete' && setup.progressReviewRequired === false
      && setup.revampArchivePending !== true && setup.gscProperty === property && typeof setup.revampRunId === 'string'
      && /^[\w-]+$/.test(setup.revampRunId) && (!runId || setup.revampRunId === runId), 'Account setup, property, website run or progress state does not match the verified account.');
  }

  async function api(path, { method = 'GET', body, headers = {}, timeout = 90000 } = {}) {
    return fetch(`${ORIGIN}/api/${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(timeout),
    });
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return typeof value === 'string' && value.length <= 2048 && ['http:', 'https:'].includes(url.protocol)
        && !url.username && !url.password && (!url.port || ['80', '443'].includes(url.port));
    } catch { return false; }
  }
  const sourceFlags = value => value && ['srOnly', 'ariaHidden', 'hidden'].every(key => typeof value[key] === 'boolean');
  const validHeading = value => value && /^h[1-6]$/.test(value.tag) && textWithin(value.text, 1, 500) && sourceFlags(value)
    && Array.isArray(value.segments) && value.segments.length <= 12
    && value.segments.every(segment => textWithin(segment.text, 1, 300) && sourceFlags(segment));
  const validSection = value => value && textWithin(value.heading, 0, 300) && textWithin(value.text, 1, 1200) && typeof value.truncated === 'boolean';
  const validInternalLink = value => value && insideProperty(value.url) && textWithin(value.text, 0, 240)
    && ['main', 'navigation', 'footer', 'body'].includes(value.context) && textWithin(value.rel, 0, 100);

  function verifyTechnical(technical, requestedUrl, finalUrl) {
    assert(technical && Number.isInteger(technical.httpStatus) && technical.httpStatus >= 200 && technical.httpStatus < 300
      && /^text\/html|^application\/xhtml\+xml/i.test(technical.contentType) && technical.contentType.length <= 200
      && technical.requestedUrl === requestedUrl && technical.finalUrl === finalUrl
      && technical.redirected === (requestedUrl !== finalUrl)
      && Array.isArray(technical.redirectChain) && technical.redirectChain.length <= 5
      && technical.redirectChain.every(step => insideProperty(step.url) && insideProperty(step.destination) && [301, 302, 303, 307, 308].includes(step.status))
      && ['missing', 'declared', 'multiple', 'invalid'].includes(technical.canonicalStatus)
      && (technical.canonicalUrl === null || safeHttpUrl(technical.canonicalUrl))
      && [null, true, false].includes(technical.canonicalInProperty)
      && Array.isArray(technical.canonicalDeclarations) && technical.canonicalDeclarations.length <= 5
      && technical.canonicalDeclarations.every(item => textWithin(item.href, 0, 2048) && (item.url === null || safeHttpUrl(item.url)))
      && Array.isArray(technical.robotsMeta) && technical.robotsMeta.length <= 10
      && technical.robotsMeta.every(item => ['robots', 'googlebot'].includes(item.agent) && textWithin(item.content, 0, 1000))
      && textWithin(technical.xRobotsTag, 0, 2000) && typeof technical.noindex?.generic === 'boolean' && typeof technical.noindex.googlebot === 'boolean',
    'Current HTTP, redirect, canonical or robots observations are invalid.');
  }

  function verifyHtmlStructure(page, expectedUrl, subset = false) {
    assert(page && page.source === 'website-html' && page.url === expectedUrl && insideProperty(page.finalUrl) && recentTimestamp(page.fetchedAt)
      && textWithin(page.htmlTitle, 0, 500) && textWithin(page.seoMetaDescription, 0, 1000) && textWithin(page.h1, 0, 500)
      && textWithin(page.textContent, 0, subset ? 5000 : 6000)
      && Array.isArray(page.headings) && page.headings.length <= (subset ? 16 : 30) && page.headings.every(validHeading)
      && Array.isArray(page.contentSections) && page.contentSections.length <= (subset ? 8 : 16) && page.contentSections.every(validSection)
      && Array.isArray(page.internalLinks) && page.internalLinks.length <= (subset ? 30 : 100) && page.internalLinks.every(validInternalLink),
    'The richer HTML structure is missing, unsafe or exceeds its evidence limits.');
    const coverage = page.structureCoverage;
    assert(coverage && textWithin(coverage.contentSource, 1, 40)
      && ['textCharacters', 'headingCount', 'sectionCount', 'internalLinkCount'].every(key => Number.isInteger(coverage[key]) && coverage[key] >= 0)
      && ['mainContentTruncated', 'headingsTruncated', 'sectionsTruncated', 'internalLinksTruncated'].every(key => typeof coverage[key] === 'boolean'),
    'HTML excerpt coverage is missing or invalid.');
    if (subset) assert(page.subsetLimits?.textCharacters === 5000 && page.subsetLimits.headings === 16
      && page.subsetLimits.sections === 8 && page.subsetLimits.internalLinks === 30, 'Linked-page excerpts are not explicitly bounded.');
    else assert(textWithin(page.mainContent, 0, 12000) && Array.isArray(page.structuralLimitations)
      && page.structuralLimitations.length > 0 && page.structuralLimitations.every(value => textWithin(value, 1, 1000)),
    'HTML structure limitations or the richer main content are invalid.');
    verifyTechnical(page.technical, expectedUrl, page.finalUrl);
  }

  function verifyInspection(inspection, pageUrl) {
    assert(inspection && ['available', 'unavailable'].includes(inspection.status) && inspection.source === 'google_url_inspection'
      && inspection.url === pageUrl && inspection.property === property && inspection.view === 'google_index'
      && recentTimestamp(inspection.checkedAt) && textWithin(inspection.limitation, 1, 1000), 'Google inspection provenance is invalid.');
    const names = ['verdict', 'coverageState', 'robotsTxtState', 'indexingState', 'pageFetchState', 'crawledAs'];
    assert(names.every(name => inspection[name] === null || textWithin(inspection[name], 1, name === 'coverageState' ? 400 : 100))
      && (inspection.lastCrawlTime === null || typeof inspection.lastCrawlTime === 'string' && Number.isFinite(Date.parse(inspection.lastCrawlTime)))
      && ['googleCanonical', 'userCanonical'].every(name => inspection[name] === null || safeHttpUrl(inspection[name])),
    'Google index fields do not preserve valid observations and unknown values.');
    if (inspection.inspectionUrl !== null) {
      let link;
      try { link = new URL(inspection.inspectionUrl); } catch { throw new VerificationFailure('Google inspection link is invalid.'); }
      assert(safeHttpUrl(inspection.inspectionUrl) && link.protocol === 'https:' && link.hostname === 'search.google.com'
        && !link.port && !link.hash && link.pathname === '/search-console/inspect', 'Google inspection link is unsafe.');
    }
    if (inspection.status === 'unavailable') assert([...names, 'lastCrawlTime', 'googleCanonical', 'userCanonical', 'inspectionUrl'].every(name => inspection[name] === null),
      'Unavailable Google inspection has invented state or a link.');
    else assert(names.some(name => inspection[name] !== null), 'Available Google inspection contains no reported state.');
  }

  function comparisonPhrases(evidence) {
    const phrases = [];
    const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    for (const value of [evidence.selectedPhrase.value, ...evidence.current.queries.map(row => row.query)]) {
      if (!textWithin(value, 1, 1024) || phrases.includes(value)) continue;
      if (`(?-i)^(?:${[...phrases, value].map(escaped).join('|')})$`.length > 4096) continue;
      phrases.push(value);
      if (phrases.length === 3) break;
    }
    return phrases;
  }

  function verifyComparison(comparison, pageUrl, evidence, phrases) {
    if (!phrases.length) {
      assert(comparison === null || comparison === undefined, 'A linked-page search comparison has no supplied phrases.');
      return;
    }
    assert(comparison && comparison.source === 'google_search_console' && comparison.pageUrl === pageUrl
      && comparison.property === property && recentTimestamp(comparison.checkedAt)
      && JSON.stringify(comparison.phrases) === JSON.stringify(phrases)
      && JSON.stringify(comparison.window) === JSON.stringify(evidence.window)
      && JSON.stringify(comparison.previousWindow) === JSON.stringify(evidence.previousWindow)
      && textWithin(comparison.limitation, 1, 1000), 'Linked-page comparison has invalid phrases, dates or exact-page provenance.');
    for (const period of [comparison.current, comparison.previous]) {
      assert(period && ['available', 'no_data', 'unavailable'].includes(period.status)
        && Array.isArray(period.queries) && period.queries.length <= phrases.length
        && (period.status === 'available' ? period.queries.length > 0 : period.queries.length === 0)
        && period.queries.every(row => phrases.includes(row.query) && validMetrics(row))
        && new Set(period.queries.map(row => row.query)).size === period.queries.length,
      'Linked-page comparison misrepresents missing data or includes invalid or unrequested query rows.');
    }
  }

  function verifyDiagnostics(diagnostics, currentPage, evidence) {
    const phrases = comparisonPhrases(evidence);
    assert(diagnostics && diagnostics.pageUrl === property && diagnostics.property === property && recentTimestamp(diagnostics.fetchedAt)
      && diagnostics.limits?.maxRelatedPages === 2 && diagnostics.limits.maxInspections === 3 && diagnostics.limits.maxSearchRequests === 4
      && Array.isArray(diagnostics.relatedPages) && diagnostics.relatedPages.length <= 2
      && new Set(diagnostics.relatedPages.map(page => page.pageUrl)).size === diagnostics.relatedPages.length
      && JSON.stringify(diagnostics.technical) === JSON.stringify(currentPage.technical)
      && Array.isArray(diagnostics.limitations) && diagnostics.limitations.length > 0 && diagnostics.limitations.every(value => textWithin(value, 1, 1000)),
    'Page diagnostics scope, source observations or request bounds are invalid.');
    verifyInspection(diagnostics.inspection, property);
    for (const related of diagnostics.relatedPages) {
      assert(insideProperty(related.pageUrl) && related.pageUrl !== property && !new URL(related.pageUrl).search
        && currentPage.internalLinks.some(link => link.url === related.pageUrl) && related.linkedFrom === property
        && textWithin(related.anchorText, 0, 240) && ['main', 'navigation', 'footer', 'body'].includes(related.context)
        && ['available', 'unavailable'].includes(related.status)
        && (related.httpStatus === null || Number.isInteger(related.httpStatus) && related.httpStatus >= 200 && related.httpStatus <= 599),
      'A related-page diagnostic is not grounded in a safe current-page link.');
      verifyInspection(related.inspection, related.pageUrl);
      verifyComparison(related.comparison, related.pageUrl, evidence, phrases);
      if (related.status === 'available') {
        verifyHtmlStructure(related.currentPage, related.pageUrl, true);
        assert(related.httpStatus === related.currentPage.technical.httpStatus, 'A related HTTP observation disagrees with its fetched content.');
      } else assert(related.currentPage === null, 'An unavailable related page contains invented HTML.');
    }
    assert(Array.isArray(diagnostics.facts) && diagnostics.facts.length >= 3 && diagnostics.facts.length <= 6
      && diagnostics.facts.every(fact => /^(?:P[4-6]|I1|D[12])$/.test(fact.id)
        && fact.kind === (fact.id === 'I1' ? 'search' : 'page') && textWithin(fact.label, 1, 200) && textWithin(fact.text, 1, 20000))
      && new Set(diagnostics.facts.map(fact => fact.id)).size === diagnostics.facts.length
      && ['P4', 'P5', 'P6'].every(id => diagnostics.facts.some(fact => fact.id === id))
      && diagnostics.facts.some(fact => fact.id === 'I1') === (diagnostics.inspection.status === 'available'),
    'Diagnostic source IDs, availability or fact bounds are invalid.');
    for (let index = 0; index < 2; index += 1) {
      const page = diagnostics.relatedPages[index];
      assert(diagnostics.facts.some(fact => fact.id === `D${index + 1}`) === Boolean(page && (page.status === 'available' || page.inspection.status === 'available'
        || page.comparison && [page.comparison.current, page.comparison.previous].some(period => period.status !== 'unavailable'))),
        'A related-page fact misrepresents available evidence.');
    }
  }

  function verifyTimeline(timeline) {
    const expected = [
      { label: 'Check Google’s next visit', when: 'After 1–2 weeks', description: 'After publishing, check whether Google has crawled the page again. A crawl does not guarantee a ranking change.' },
      { label: 'Look for early signals', when: 'Around 4 weeks', description: 'Compare relevant search phrases, clicks and appearances with the earlier period. Small samples can be noisy.' },
      { label: 'Review the change', when: 'Around 8–12 weeks', description: 'Assess the same relevant searches and customer inquiries. Allow longer when data is sparse. These are review checkpoints, not promised results.' },
    ];
    assert(JSON.stringify(timeline) === JSON.stringify(expected), 'Review checkpoints do not match the server-owned estimates and limitations.');
  }

  function verifyRecommendations(draft, sourceIds) {
    const analysis = draft.analysis;
    const passages = [draft.currentPage.htmlTitle, draft.currentPage.seoMetaDescription, draft.currentPage.h1,
      draft.currentPage.textContent, draft.currentPage.mainContent, ...draft.currentPage.headings.map(item => item.text),
      ...draft.currentPage.contentSections.flatMap(item => [item.text, item.heading]),
      ...draft.currentPage.internalLinks.map(item => item.text)].filter(value => typeof value === 'string');
    const exactQuote = value => passages.some(passage => passage.includes(value.trim()));
    const exactTechnicalQuote = value => [draft.currentPage.technical.xRobotsTag, draft.currentPage.technical.canonicalUrl,
      ...draft.currentPage.technical.robotsMeta.map(item => item.content),
    ].some(passage => typeof passage === 'string' && passage.includes(value.trim()));
    const plain = (value, max) => textWithin(value, 1, max) && !/[\r\n]|<[^>]*>|```|https?:\/\//i.test(value);
    assert(plain(analysis.pageGoal, 200) && Array.isArray(analysis.recommendations) && analysis.recommendations.length <= 6
      && (analysis.recommendations.length > 0 || ['keep_current', 'collect_data'].includes(analysis.action)),
    'The expert review has no valid page goal or executable recommendations.');
    const strategy = analysis.strategy;
    const areas = ['indexing', 'search_intent', 'content', 'headings', 'metadata', 'internal_links'];
    assert(strategy && plain(strategy.searchGoal, 220) && [...areas, 'none'].includes(strategy.focusArea)
      && ['supported_issue', 'opportunity_to_test', 'limited_findings', 'insufficient_evidence'].includes(strategy.finding)
      && plain(strategy.priorityReason, 400) && plain(strategy.limitation, 320)
      && Array.isArray(strategy.checks) && strategy.checks.length === areas.length
      && strategy.checks.every((check, index) => check.area === areas[index] && ['issue', 'opportunity', 'suitable', 'unknown'].includes(check.status)
        && plain(check.finding, 260) && Array.isArray(check.evidenceIds) && check.evidenceIds.length <= 5
        && (check.status === 'unknown' || check.evidenceIds.length > 0)
        && new Set(check.evidenceIds).size === check.evidenceIds.length && check.evidenceIds.every(id => sourceIds.has(id))),
    'The review has no valid six-area opportunity comparison or has invented evidence.');
    const primary = analysis.recommendations.filter(item => item.significance === 'primary');
    assert(primary.length <= 1 && (!primary.length || analysis.recommendations[0] === primary[0]), 'The main opportunity must appear first and be unique.');
    if (['supported_issue', 'opportunity_to_test'].includes(strategy.finding)) {
      const issue = strategy.finding === 'supported_issue';
      assert(primary.length === 1 && primary[0].basis === (issue ? 'observed_issue' : 'opportunity')
        && strategy.checks.some(check => check.area === strategy.focusArea && check.status === (issue ? 'issue' : 'opportunity')),
      'The main action disagrees with the prioritized finding.');
    } else if (strategy.finding === 'limited_findings') assert(strategy.focusArea === 'none' && !primary.length,
      'Small supporting improvements are presented as the main problem.');
    else assert((strategy.focusArea === 'none' || strategy.checks.some(check => check.area === strategy.focusArea && check.status === 'unknown'))
      && (!primary.length || primary[0].type === 'check' && primary[0].basis === 'needs_check' && primary[0].benefit === 'diagnosis'),
    'An uncertain diagnosis is presented as a supported fix.');
    const targets = new Set([...draft.currentPage.internalLinks.map(item => item.url),
      ...draft.evidence.relatedPages.map(item => item.pageUrl), ...draft.diagnostics.relatedPages.map(item => item.pageUrl)]);
    const labels = new Set();
    for (const [index, item] of analysis.recommendations.entries()) {
      assert(item && item.id === `action-${index + 1}` && RECOMMENDATION_TYPES.includes(item.type)
        && ['observed_issue', 'opportunity', 'needs_check'].includes(item.basis)
        && ['primary', 'supporting'].includes(item.significance)
        && ['page_clarity', 'search_relevance', 'visitor_decision', 'navigation', 'index_access', 'search_snippet', 'diagnosis'].includes(item.benefit)
        && plain(item.label, 90) && plain(item.location, 140) && plain(item.reason, 400) && plain(item.instruction, 600)
        && !labels.has(item.label.toLowerCase()) && textWithin(item.currentQuote, 0, 500)
        && (!item.currentQuote || exactQuote(item.currentQuote) || item.type === 'technical' && exactTechnicalQuote(item.currentQuote))
        && textWithin(item.supportingQuote, 0, 500)
        && Array.isArray(item.evidenceIds) && item.evidenceIds.length >= 1 && item.evidenceIds.length <= 5
        && new Set(item.evidenceIds).size === item.evidenceIds.length && item.evidenceIds.every(id => sourceIds.has(id))
        && item.evidenceIds.some(id => /^(?:P[1-6]|I1)$/.test(id)),
      'An action card has invalid source references, text, order or a quote absent from the selected page.');
      labels.add(item.label.toLowerCase());
      if (item.type === 'internal_link') assert(targets.has(item.targetUrl) && insideProperty(item.targetUrl) && item.targetUrl !== property,
        'An internal-link recommendation targets an unknown or out-of-property URL.');
      else assert(item.targetUrl === null, 'An unrelated action card contains a target URL.');
      if (item.type === 'metadata') assert(analysis.metadataVerdict === 'revise', 'A metadata action conflicts with the metadata verdict.');
      if (item.type === 'technical' && item.basis === 'observed_issue') assert(item.evidenceIds.some(id => id === 'I1' || id === 'P4'),
        'An observed technical issue lacks direct technical or Google inspection evidence.');
      if (item.proposedText === null) assert(item.supportingQuote === '', 'An action with no proposed wording has an unexpected supporting quote.');
      else assert(['heading', 'content', 'internal_link'].includes(item.type) && item.basis !== 'needs_check'
        && plain(item.proposedText, 1000) && !/\[[^\]]*\]|\b(?:lorem ipsum|placeholder)\b/i.test(item.proposedText)
        && textWithin(item.supportingQuote, 8, 500) && exactQuote(item.supportingQuote),
      'Proposed action wording lacks an exact first-party supporting quote or is not ready to review.');
    }
  }

  function verifyCurrentPage(page, provenance, runId, generated = false) {
    assert(page?.source === 'website-html' && page.url === property && page.finalUrl === property
      && typeof page.htmlTitle === 'string' && page.htmlTitle.length <= 500
      && typeof page.seoMetaDescription === 'string' && page.seoMetaDescription.length <= 1000
      && typeof page.h1 === 'string' && typeof page.textContent === 'string' && page.textContent.length <= 6000
      && Array.isArray(page.headings) && page.headings.length <= 30 && recentTimestamp(page.fetchedAt), 'The homepage HTML response or its current source metadata is invalid.');
    verifyHtmlStructure(page, property);
    assert(provenance?.property === property && provenance.websiteRunId === runId && provenance.pageUrl === property
      && provenance.finalUrl === property && /^[a-f0-9]{64}$/.test(provenance.contentFingerprint)
      && (!generated || recentTimestamp(provenance.generatedAt)), 'The page review provenance does not match the exact current website.');
    const fingerprint = createHash('sha256').update(JSON.stringify({
      userId: uid, websiteRunId: runId, property, pageUrl: property, finalUrl: page.finalUrl,
      title: page.htmlTitle, description: page.seoMetaDescription,
      h1: page.h1, textContent: page.textContent, headings: page.headings,
      mainContent: page.mainContent, contentSections: page.contentSections,
      internalLinks: page.internalLinks, technical: page.technical,
    })).digest('hex');
    assert(provenance.contentFingerprint === fingerprint, 'The content fingerprint does not match the returned current website content.');
  }

  function verifyReviewEvidence(evidence, startedAt, hasPageContent = true) {
    const allowedWindows = [expectedWindow(startedAt), expectedWindow(new Date())];
    assert(evidence?.source === 'google_search_console' && evidence.property === property && evidence.pageUrl === property
      && recentTimestamp(evidence.fetchedAt) && ['available', 'partial', 'unavailable'].includes(evidence.status)
      && validDay(evidence.window?.startDate) && validDay(evidence.window?.endDate)
      && allowedWindows.some(window => window.startDate === evidence.window.startDate && window.endDate === evidence.window.endDate)
      && evidence.previousWindow?.startDate === shiftDay(evidence.window.startDate, -28)
      && evidence.previousWindow?.endDate === shiftDay(evidence.window.startDate, -1), 'Review evidence has an invalid property, page, timestamp or observation window.');
    const statuses = [];
    for (const period of [evidence.current, evidence.previous]) {
      assert(period && ['available', 'no_data', 'unavailable'].includes(period.totalsStatus)
        && ['available', 'no_data', 'unavailable'].includes(period.queriesStatus), 'Review evidence does not distinguish unavailable observations from missing data.');
      const totalsValid = period.totalsStatus === 'available' ? validMetrics(period.totals) && period.totals.impressions > 0
        : period.totalsStatus === 'no_data' ? period.totals === null || (validMetrics(period.totals) && period.totals.impressions === 0)
          : period.totals === null;
      assert(totalsValid && Array.isArray(period.queries) && period.queries.length <= 1000
        && (period.queriesStatus === 'available' ? period.queries.length > 0 : period.queries.length === 0)
        && period.queries.every(row => textWithin(row.query, 1, 1024) && validMetrics(row))
        && new Set(period.queries.map(row => row.query)).size === period.queries.length, 'Review totals or query observations are invalid.');
      const coverage = period.queryCoverage;
      assert(coverage?.coverage === 'reported_queries' && coverage.mayBeIncomplete === true && coverage.requestedLimit === 1000
        && coverage.order === 'impressions_descending'
        && (period.queriesStatus === 'unavailable'
          ? coverage.returnedRows === null && coverage.selectedForReview === null && coverage.hitRowLimit === null
          : coverage.returnedRows === period.queries.length && coverage.selectedForReview === Math.min(40, period.queries.length)
            && coverage.hitRowLimit === (period.queries.length === 1000))
        && period.queries.every((row, index) => !index || period.queries[index - 1].impressions > row.impressions
          || (period.queries[index - 1].impressions === row.impressions && period.queries[index - 1].clicks >= row.clicks)),
      'Query coverage, impressions ordering or missing-data semantics are invalid.');
      statuses.push(period.totalsStatus, period.queriesStatus);
    }
    assert(Array.isArray(evidence.history) && evidence.history.length === 6, 'The URL history does not contain six observation windows.');
    for (const [index, period] of evidence.history.entries()) {
      assert(period.window?.startDate === shiftDay(evidence.window.startDate, -28 * index)
        && period.window?.endDate === shiftDay(evidence.window.endDate, -28 * index)
        && ['available', 'no_data', 'unavailable'].includes(period.totalsStatus), 'The URL history windows are not adjacent, complete or newest first.');
      const totalsValid = period.totalsStatus === 'available' ? validMetrics(period.totals) && period.totals.impressions > 0
        : period.totalsStatus === 'no_data' ? period.totals === null || (validMetrics(period.totals) && period.totals.impressions === 0)
          : period.totals === null;
      assert(totalsValid, 'Historical URL metrics do not preserve missing data and unavailable reads.');
      if (index < 2) {
        const recent = index === 0 ? evidence.current : evidence.previous;
        assert(period.totalsStatus === recent.totalsStatus
          && JSON.stringify(period.totals) === JSON.stringify(recent.totals), 'Recent totals disagree with the same history window.');
      } else statuses.push(period.totalsStatus);
    }
    const successes = statuses.filter(status => status !== 'unavailable').length;
    assert(evidence.status === (successes === 8 ? 'available' : successes ? 'partial' : 'unavailable')
      && evidence.selectedPhrase?.value === '' && evidence.selectedPhrase?.source === 'none'
      && Array.isArray(evidence.relatedPages) && evidence.relatedPages.length === 0 && evidence.relatedPagesStatus === 'not_requested'
      && Array.isArray(evidence.limitations) && evidence.limitations.length > 0 && evidence.limitations.every(value => textWithin(value, 1, 1000)),
    'Review evidence availability or the no-keyword verification scope is invalid.');
    assert(Array.isArray(evidence.facts) && evidence.facts.length >= (hasPageContent ? 3 : 0) && evidence.facts.length <= 51
      && evidence.facts.every(fact => /^(?:P[1-3]|S[12]|H[1-6]|Q(?:[1-9]|[1-3][0-9]|40))$/.test(fact.id)
        && fact.kind === (fact.id.startsWith('P') ? 'page' : 'search') && textWithin(fact.label, 1, 200) && textWithin(fact.text, 1, 5000))
      && new Set(evidence.facts.map(fact => fact.id)).size === evidence.facts.length
      && (hasPageContent ? ['P1', 'P2', 'P3'].every(id => evidence.facts.some(fact => fact.id === id)) : evidence.facts.every(fact => fact.kind === 'search')),
    'Review source facts are missing or invalid.');
    const queryFacts = evidence.facts.filter(fact => /^Q\d+$/.test(fact.id));
    assert(queryFacts.length === Math.min(40, evidence.current.queries.length)
      && queryFacts.every((fact, index) => fact.id === `Q${index + 1}` && fact.text.includes(JSON.stringify(evidence.current.queries[index].query))),
    'The model query facts do not match the bounded highest-impression query rows.');
    for (const [index, key] of ['current', 'previous'].entries()) {
      assert(evidence.facts.some(fact => fact.id === `S${index + 1}`) === (evidence[key].totalsStatus !== 'unavailable'),
        'A recent total source fact misrepresents an unavailable observation.');
    }
    for (const [index, period] of evidence.history.entries()) {
      assert(evidence.facts.some(fact => fact.id === `H${index + 1}`) === (period.totalsStatus !== 'unavailable'),
        'A historical source fact misrepresents an unavailable observation.');
    }
  }

  function verifyResearch(research) {
    assert(research && textWithin(research.limitation, 1, 1000) && Array.isArray(research.sources)
      && ['available', 'unavailable'].includes(research.status),
    'The review did not report its automatic research attempt.');
    if (research.status === 'available') {
      assert(recentTimestamp(research.checkedAt) && textWithin(research.summary, 1, 3500)
        && research.sources.length > 0 && research.sources.length <= 5
        && research.sources.every((source, index) => {
          try {
            const url = new URL(source.url);
            return source.id === `W${index + 1}` && textWithin(source.title, 1, 180)
              && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.port
              && url.hostname.includes('.') && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':')
              && !/(?:^|\.)(?:localhost|local|internal|lan|test|invalid|example|home\.arpa)$/.test(url.hostname);
          } catch { return false; }
        }) && new Set(research.sources.map(source => source.url)).size === research.sources.length,
      'Web research did not return usable, dated public sources.');
    } else {
      assert(research.summary === '' && research.sources.length === 0
        && recentTimestamp(research.checkedAt),
      'Missing research was presented as sourced research.');
    }
  }

  function verifyAssessment(draft) {
    const analysis = draft.analysis;
    const sourceIds = new Set([...draft.evidence.facts, ...draft.diagnostics.facts, ...(draft.research.status === 'available' ? draft.research.sources : [])].map(source => source.id));
    assert(analysis && REVIEW_ACTIONS.includes(analysis.action) && textWithin(analysis.summary, 1, 120)
      && textWithin(analysis.reason, 1, 420) && textWithin(analysis.nextStep, 1, 260)
      && ['keep', 'revise', 'uncertain'].includes(analysis.metadataVerdict) && textWithin(analysis.metadataReason, 1, 260)
      && (analysis.action === 'revise_metadata') === (analysis.metadataVerdict === 'revise')
      && (analysis.action !== 'keep_current' || analysis.metadataVerdict === 'keep')
      && Array.isArray(analysis.evidenceIds) && analysis.evidenceIds.length >= 1 && analysis.evidenceIds.length <= 5
      && analysis.evidenceIds.every(id => sourceIds.has(id)) && analysis.evidenceIds.some(id => /^P[1-6]$/.test(id))
      && new Set(analysis.evidenceIds).size === analysis.evidenceIds.length && Array.isArray(analysis.changedFields)
      && ['title', 'description'].every(field => typeof analysis.fieldReasons?.[field] === 'string' && analysis.fieldReasons[field].length <= 220),
    'The assessment action, explanation or source references are invalid.');
    if (analysis.action === 'investigate_visibility') assert(analysis.evidenceIds.some(id => /^(?:S|Q|H|I)\d+$/.test(id) || id === 'P4'),
      'A visibility investigation lacks direct search, inspection or technical evidence.');
    verifyRecommendations(draft, sourceIds);
    if (analysis.action === 'revise_metadata') {
      assert(typeof draft.title === 'string' && typeof draft.description === 'string', 'A metadata revision did not include both fields.');
      const changed = [];
      for (const field of ['title', 'description']) {
        const original = field === 'title' ? draft.currentPage.htmlTitle : draft.currentPage.seoMetaDescription;
        if (draft[field] === original) {
          assert(analysis.fieldReasons[field] === '', 'An unchanged field has a misleading change explanation.');
        } else {
          assert(textWithin(draft[field], field === 'title' ? 10 : 40, field === 'title' ? 90 : 220)
            && !/[\r\n]|<[^>]*>|\[[^\]]*\]|```|\b(?:lorem ipsum|placeholder)\b/i.test(draft[field])
            && textWithin(analysis.fieldReasons[field], 1, 220), 'A changed title or description is not usable or lacks its explanation.');
          changed.push(field);
        }
      }
      assert(changed.length > 0 && sameIds(changed, analysis.changedFields) && analysis.targetPageUrl === null,
        'The metadata revision does not match its declared changed fields.');
    } else {
      assert(draft.title === null && draft.description === null && analysis.changedFields.length === 0
        && analysis.fieldReasons.title === '' && analysis.fieldReasons.description === '', 'A non-revision decision incorrectly includes editable draft fields.');
      if (analysis.action === 'review_page') {
        assert(analysis.targetPageUrl !== property && [...draft.evidence.relatedPages, ...draft.diagnostics.relatedPages].some(row => row.pageUrl === analysis.targetPageUrl)
          && insideProperty(analysis.targetPageUrl), 'The suggested alternative page is not supported by scoped evidence.');
      } else assert(analysis.targetPageUrl === null, 'The assessment includes an unexpected target page.');
    }
  }

  try {
    stage = 'account safeguards';
    before = await snapshotAccount();
    verifySetup(before.setup);
    assert(before.historyRuns.includes(before.setup.revampRunId), 'The current website archive is not complete.');
    const account = await app.auth().getUser(uid);
    assert(account.uid === uid && !account.disabled, 'The exact account is unavailable.');

    stage = 'temporary verification session';
    const customToken = await app.auth().createCustomToken(uid);
    const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }), redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const session = await signIn.json();
    assert(signIn.ok && session.idToken && (await app.auth().verifyIdToken(session.idToken)).uid === uid, 'Verification login failed.');
    const headers = { Authorization: `Bearer ${session.idToken}` };

    stage = 'new route authorization';
    const routes = [
      ['dashboard/overview', 'GET'], ['page-review/content', 'POST'], ['page-review/activity', 'POST'],
      ['page-review/suggestions', 'POST'], ['page-review/confirm', 'POST'], ['page-review/plan', 'GET'], ['page-review/plan', 'POST'],
    ];
    // Confirmation is probed only anonymously or with a mismatched supplied UID.
    // Never send a confirmation that the account could authorize successfully.
    for (const [path, method] of routes) {
      const anonymous = await api(path, { method, ...(method === 'POST' ? { body: {} } : {}) });
      assert(anonymous.status === 401, `Anonymous ${path} was not rejected with 401.`);
      const otherUid = `${uid}-phase3-cross-account-probe`;
      const crossAccount = await api(method === 'GET' ? `${path}?userId=${encodeURIComponent(otherUid)}` : path, {
        method, headers, ...(method === 'POST' ? { body: { userId: otherUid } } : {}),
      });
      assert(crossAccount.status === 403, `Cross-account ${path} was not rejected with 403.`);
    }

    stage = 'current Google overview';
    const startedAt = new Date();
    const overviewResponse = await api('dashboard/overview', { headers });
    assert(overviewResponse.ok, 'The current Google overview request failed.');
    const overview = await overviewResponse.json();
    const allowedWindows = [expectedWindow(startedAt), expectedWindow(new Date())];
    assert(overview.schemaVersion === 1 && overview.source === 'google_search_console' && overview.property === property
      && overview.dataState === 'final' && overview.searchType === 'web' && recentTimestamp(overview.fetchedAt)
      && validDay(overview.window?.startDate) && validDay(overview.window?.endDate)
      && allowedWindows.some(window => window.startDate === overview.window.startDate && window.endDate === overview.window.endDate)
      && validMetrics(overview.totals), 'The overview source, metrics or complete 28-day window is invalid.');
    assert(Array.isArray(overview.daily) && overview.daily.length <= 28 && overview.daily.every(row => validDay(row.date)
      && row.date >= overview.window.startDate && row.date <= overview.window.endDate && validMetrics(row))
      && new Set(overview.daily.map(row => row.date)).size === overview.daily.length, 'The dated overview observations are invalid.');
    assert(Array.isArray(overview.pages) && overview.pages.length <= 100 && overview.pages.every(row => insideProperty(row.pageUrl) && validMetrics(row))
      && new Set(overview.pages.map(row => row.pageUrl)).size === overview.pages.length
      && overview.coverage?.pages?.complete === false && overview.coverage.pages.limit === 100
      && overview.coverage.pages.returned === overview.pages.length && overview.coverage.isIndexingReport === false
      && overview.coverage.daily?.omitsDaysWithoutData === true, 'The overview page scope or coverage labels are invalid.');

    stage = 'current homepage HTML';
    const contentResponse = await api('page-review/content', { method: 'POST', headers, body: { pageUrl: property } });
    assert(contentResponse.ok, 'The current homepage HTML request failed.');
    const content = await contentResponse.json();
    assert(content.success === true, 'The current homepage could not be read.');
    verifyCurrentPage(content.data, content.provenance, before.setup.revampRunId);

    stage = 'read-only homepage search history';
    const activityStartedAt = new Date();
    const activityResponse = await api('page-review/activity', { method: 'POST', headers, body: { pageUrl: property } });
    assert(activityResponse.ok && activityResponse.headers.get('cache-control') === 'private, no-store', 'The homepage activity request failed or returned cacheable private data.');
    const activity = await activityResponse.json();
    assert(activity.success === true && activity.provenance?.property === property && activity.provenance.pageUrl === property
      && activity.provenance.websiteRunId === before.setup.revampRunId, 'The homepage activity belongs to a different property, URL or website version.');
    verifyReviewEvidence(activity.evidence, activityStartedAt, false);

    let draftMetadata = { requested: false };
    if (flags.includes('--draft')) {
      stage = 'one explicit current-page review';
      const reviewStartedAt = new Date();
      const draftResponse = await api('page-review/suggestions', { method: 'POST', headers, timeout: 150000,
        body: { pageUrl: property, focusKeywords: [] } });
      assert(draftResponse.ok, 'The one requested review did not return a usable response. No retry or confirmation was attempted.');
      const draft = await draftResponse.json();
      verifyCurrentPage(draft.currentPage, draft.provenance, before.setup.revampRunId, true);
      assert(draft.provenance.reviewVersion === 6 && /^gpt-[\w.-]{1,80}$/.test(draft.provenance.model), 'The assessment is not from the current review implementation.');
      verifyReviewEvidence(draft.evidence, reviewStartedAt);
      verifyResearch(draft.research);
      verifyDiagnostics(draft.diagnostics, draft.currentPage, draft.evidence);
      verifyTimeline(draft.timeline);
      assert(draft.ownerGoal === '', 'The review unexpectedly introduced an owner-supplied goal.');
      verifyAssessment(draft);
      const focus = draft.analysis.searchFocus;
      assert(focus && ['observed', 'proposed', 'needs_input'].includes(focus.source)
        && (focus.source === 'needs_input' ? focus.phrase === null && textWithin(focus.question, 1, 180) : textWithin(focus.phrase, 1, 120))
        && textWithin(focus.reason, 1, 320), 'The automatic search focus is missing or invalid.');
      if (focus.source === 'observed') assert([...draft.evidence.current.queries, ...draft.evidence.previous.queries]
        .some(row => row.query.trim().toLowerCase() === focus.phrase.trim().toLowerCase()), 'Observed search focus was not returned by Google.');
      const restoredResponse = await api(`page-review/plan?pageUrl=${encodeURIComponent(property)}`, { headers });
      assert(restoredResponse.ok && restoredResponse.headers.get('cache-control') === 'private, no-store', 'Saved plan could not be read securely.');
      const restored = (await restoredResponse.json()).plan;
      assert(draft.plan && restored && restored.id === draft.plan.id && restored.revision === draft.plan.revision
        && JSON.stringify(restored.tasks) === JSON.stringify(draft.plan.tasks)
        && restored.review.provenance.generatedAt === draft.provenance.generatedAt
        && JSON.stringify(restored.review.analysis.searchFocus) === JSON.stringify(focus), 'Saved tasks or search focus changed when loaded again.');
      draftMetadata = { requested: true, requests: 1, model: draft.provenance.model, action: draft.analysis.action, metadataVerdict: draft.analysis.metadataVerdict,
        searchFocus: focus, planRestored: true, savedTaskCount: restored.tasks.length, savedPlanRevision: restored.revision,
        pageGoal: draft.analysis.pageGoal, strategy: draft.analysis.strategy, reviewSummary: draft.analysis.summary, reviewReason: draft.analysis.reason,
        recommendations: draft.analysis.recommendations,
        indexCoverage: draft.diagnostics.inspection.coverageState,
        ...(draft.analysis.action === 'revise_metadata' ? { titleLength: draft.title.length, descriptionLength: draft.description.length, changedFields: draft.analysis.changedFields } : {}),
        evidenceStatus: draft.evidence.status, evidenceSourceCount: draft.evidence.facts.length,
        queryRowsReturned: draft.evidence.current.queries.length, queryFacts: draft.evidence.facts.filter(fact => /^Q\d+$/.test(fact.id)).length,
        inspectionStatus: draft.diagnostics.inspection.status, relatedPagesRead: draft.diagnostics.relatedPages.filter(page => page.status === 'available').length,
        linkedComparisonPeriodsAvailable: draft.diagnostics.relatedPages.flatMap(page => page.comparison ? [page.comparison.current, page.comparison.previous] : []).filter(period => period.status !== 'unavailable').length,
        diagnosticsSourceCount: draft.diagnostics.facts.length, recommendationCount: draft.analysis.recommendations.length, timelineCheckpoints: draft.timeline.length,
        reviewVersion: draft.provenance.reviewVersion, historyWindows: draft.evidence.history.length, researchAutomatic: true, researchStatus: draft.research.status, researchSourceCount: draft.research.sources.length,
        generatedAt: draft.provenance.generatedAt };
    }

    stage = 'progress and history safeguards';
    const progressResponse = await api('progress', { headers });
    assert(progressResponse.ok, 'Progress is unavailable.');
    const progress = await progressResponse.json();
    assert(progress.source === 'google_search_console' && progress.property === property && progress.paused === false
      && progress.automaticOutcomesEnabled === false && progress.notificationsEnabled === false
      && Array.isArray(progress.records) && sameIds(progress.records.map(record => record.id), before.activeIds)
      && progress.records.every(record => insideProperty(record.pageUrl)), 'Progress ownership, active changes or automatic-outcome safeguards failed.');
    const historyResponse = await api('revamp/history', { headers });
    assert(historyResponse.ok, 'Previous website history is unavailable.');
    const history = await historyResponse.json();
    assert(Array.isArray(history.runs) && sameIds(history.runs.map(run => run.id), before.historyRuns), 'The history run list changed or is incomplete.');
    const recordResponse = await api(`revamp/history?runId=${encodeURIComponent(before.setup.revampRunId)}`, { headers });
    assert(recordResponse.ok, 'The current archived record list is unavailable.');
    const historyRecords = await recordResponse.json();
    assert(Array.isArray(historyRecords.records) && sameIds(historyRecords.records.map(record => record.id), before.historyRecords.get(before.setup.revampRunId)), 'Archived records are missing from the history response.');

    summary = {
      anonymousRoutesBlocked: routes.length, crossAccountRoutesBlocked: routes.length,
      overviewStatus: overviewResponse.status, window: overview.window, observedPagesReturned: overview.pages.length,
      dailyObservations: overview.daily.length, totals: { clicks: overview.totals.clicks, impressions: overview.totals.impressions },
      isIndexingReport: false, currentHtmlStatus: contentResponse.status,
      currentHtmlTitle: content.data.htmlTitle.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 180),
      htmlFetchedAt: content.data.fetchedAt, exactHomepageVerified: true,
      activityStatus: activity.evidence.status, activityWindows: activity.evidence.history.length,
      draft: draftMetadata, activeChanges: progress.records.length, automaticOutcomesEnabled: false, notificationsEnabled: false,
      historyRunsAvailable: history.runs.length, authorizedConfirmationAttempted: false,
    };
  } finally {
    try {
      if (before) {
        const after = await snapshotAccount();
        verifySetup(after.setup, before.setup.revampRunId);
        assert(sameIds(after.activeIds, before.activeIds), 'Active implementation IDs changed during verification.');
        assert(sameIds(after.archives.keys(), before.archives.keys()) && [...before.archives].every(([path, updateTime]) => after.archives.get(path)?.isEqual(updateTime)), 'An archived record or archive snapshot changed during verification.');
        if (summary) { summary.activeImplementationIdsUnchanged = true; summary.archiveSnapshotsUnchanged = before.archives.size; }
      }
    } finally { await app.delete(); }
  }
  console.log(JSON.stringify(summary));
}

main().catch(error => {
  // Provider, Firebase and fetch errors can contain sensitive request details.
  // Only our own fixed verification messages may reach logs.
  console.error(JSON.stringify({ verificationFailed: true, stage,
    error: error instanceof VerificationFailure ? error.message : 'The verification step failed. Credentials and response bodies were not logged.',
    authorizedConfirmationAttempted: false,
  }));
  process.exitCode = 1;
});
