const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const uid = 'page-task-alice';
const pageUrl = 'https://example.test/Case/?City=A';
const otherUrl = 'https://example.test/case/?City=a';
const property = 'https://example.test/';
let app;
let docId;
const suggestion = { title: 'Website design for local businesses | Example', description: 'Explore thoughtful website design for local businesses. See our work and discuss a site that fits your customers.' };
function idFor(url) { let hash = 0; for (let i = 0; i < url.length; i++) hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0; return `${uid}_${Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8)}`; }
const metadata = url => ({ htmlTitle: 'Current website title', seoMetaDescription: 'Current page description', h1: 'Website design', textContent: 'We build useful websites for local businesses.', headings: [{ tag: 'h1', text: 'Website design' }], url, finalUrl: url, fetchedAt: '2026-10-10T15:00:00.000Z', source: 'live_website' });
const checkAreas = ['indexing', 'search_intent', 'content', 'headings', 'metadata', 'internal_links'];
function strategyFor(action, overrides = {}) {
  const focusArea = action === 'revise_metadata' ? 'metadata' : action === 'improve_content' ? 'headings' : ['keep_current', 'collect_data'].includes(action) ? 'none' : 'search_intent';
  const finding = action === 'revise_metadata' ? 'supported_issue' : action === 'keep_current' ? 'limited_findings' : action === 'improve_content' ? 'opportunity_to_test' : 'insufficient_evidence';
  return { searchGoal: 'Help local businesses find and understand the website design service.', focusArea, finding, priorityReason: focusArea === 'none' ? 'The available evidence does not establish a main page change to prioritize.' : 'This is the most useful supported step for clarifying the existing service before making smaller changes.', limitation: 'This review cannot establish what caused search performance or promise a ranking improvement.', checks: checkAreas.map(area => ({ area, status: area === focusArea && finding !== 'insufficient_evidence' ? finding === 'supported_issue' ? 'issue' : 'opportunity' : 'unknown', finding: area === focusArea ? 'The existing page evidence supports reviewing this area.' : 'The available evidence does not establish a specific issue in this area.', evidenceIds: area === focusArea ? [area === 'search_intent' ? 'S1' : 'P1'] : [] })), ...overrides };
}
function historyFor() {
  return Array.from({ length: 6 }, (_, index) => {
    const end = new Date('2026-10-07T12:00:00Z'); end.setUTCDate(end.getUTCDate() - index * 28);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 27);
    return { window: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }, totals: { clicks: 1, impressions: 30, ctr: 1 / 30, position: 11 }, totalsStatus: 'available' };
  });
}
function assessmentFor(url, action = 'revise_metadata') {
  return {
    ...(action === 'revise_metadata' ? suggestion : { title: null, description: null }),
    currentPage: metadata(url),
    provenance: { property, websiteRunId: 'page-task-run', pageUrl: url, finalUrl: url, contentFingerprint: 'fixture-content', generatedAt: new Date().toISOString(), reviewVersion: 5 },
    analysis: { action, strategy: strategyFor(action), pageGoal: 'Help local businesses understand the website design service.', recommendations: ['keep_current', 'collect_data'].includes(action) ? [] : [{ id: 'action-1', type: action === 'revise_metadata' ? 'metadata' : 'check', significance: 'primary', benefit: action === 'revise_metadata' ? 'search_snippet' : 'diagnosis', basis: action === 'revise_metadata' ? 'observed_issue' : 'needs_check', label: action === 'revise_metadata' ? 'Clarify the title and description' : 'Inspect the page and its internal links', location: action === 'revise_metadata' ? 'SEO settings for this page' : 'This exact URL in Google Search Console', reason: 'Use the available page and search evidence to choose a useful next step.', instruction: action === 'revise_metadata' ? 'Use the editor below to review the proposed title and description.' : 'Inspect this URL in Search Console and review its internal links before changing the wording.', currentQuote: action === 'revise_metadata' ? 'Current website title' : '', proposedText: null, supportingQuote: 'We build useful websites for local businesses.', targetUrl: null, evidenceIds: ['P1'] }], metadataVerdict: action === 'revise_metadata' ? 'revise' : 'keep', metadataReason: action === 'revise_metadata' ? 'The wording can describe the existing service more clearly.' : 'The current wording does not need another rewrite.', summary: action === 'revise_metadata' ? 'Name the service already described on this page.' : 'No supported wording change is justified by the current evidence.', reason: action === 'revise_metadata' ? 'The heading names website design, but the current title only says “Current website title”.' : 'There is too little search activity to identify a specific wording problem.', nextStep: action === 'revise_metadata' ? 'Review the wording below and publish it only if it fits your business.' : 'Keep this wording while you collect more search activity.', evidenceIds: ['P1', 'S1'], changedFields: action === 'revise_metadata' ? ['title', 'description'] : [], fieldReasons: { title: 'Name the website design service.', description: 'Summarize the actual service described on the page.' }, targetPageUrl: null },
    evidence: { source: 'google_search_console', property, pageUrl: url, window: { startDate: '2026-09-10', endDate: '2026-10-07' }, previousWindow: { startDate: '2026-08-13', endDate: '2026-09-09' }, fetchedAt: '2026-10-10T15:00:00.000Z', status: 'available', current: { totals: { impressions: 30, clicks: 1, ctr: 1 / 30, position: 11 }, totalsStatus: 'available', queries: [], queriesStatus: 'no_data' }, previous: { totals: { impressions: 25, clicks: 1, ctr: 1 / 25, position: 12 }, totalsStatus: 'available', queries: [], queriesStatus: 'no_data' }, relatedPages: [], history: historyFor(), selectedPhrase: { value: '', source: 'none' }, limitations: ['Search Console can omit some queries. A change in traffic does not prove causation.'], facts: [{ id: 'P1', kind: 'page', label: 'Page heading', text: 'The main heading is Website design.' }, { id: 'S1', kind: 'search', label: 'Recent appearances', text: 'Google reported 30 appearances in the recent period.' }] },
    diagnostics: { inspection: { status: 'available', url, property, checkedAt: '2026-10-10T15:00:00.000Z', verdict: 'PASS', coverageState: 'Submitted and indexed', indexingState: 'INDEXING_ALLOWED', robotsTxtState: 'ALLOWED', pageFetchState: 'SUCCESSFUL', lastCrawlTime: '2026-10-05T12:00:00.000Z', googleCanonical: url, userCanonical: url, inspectionUrl: 'https://search.google.com/search-console/inspect?resource_id=https%3A%2F%2Fexample.test%2F&id=fixture' }, facts: [], relatedPages: [], limitations: [] },
    timeline: [{ label: 'Check Google’s next visit', when: 'After 1–2 weeks', description: 'Check whether Google has crawled the page again.' }, { label: 'Look for early signals', when: 'Around 4 weeks', description: 'Compare relevant searches and allow for small samples.' }, { label: 'Review the change', when: 'Around 8–12 weeks', description: 'Review search activity and customer inquiries; allow longer with sparse data.' }],
    research: { status: 'available', summary: 'Public website context was reviewed without making claims about competitor rankings.', sources: [{ id: 'W1', url: 'https://reference.test/service/', title: 'Service page context' }], checkedAt: '2026-10-10T15:00:00.000Z', limitation: 'Public context is not a Google ranking report.' },
  };
}
function activityFor(url, withQueries = false) {
  const evidence = assessmentFor(url).evidence;
  evidence.current.queries = withQueries ? [{ query: 'local websites', impressions: 7, clicks: 1, ctr: 1 / 7, position: 11 }] : [];
  evidence.current.queriesStatus = withQueries ? 'available' : 'no_data';
  return { success: true, evidence, provenance: { property, pageUrl: url, websiteRunId: 'page-task-run' } };
}

function contentAssessment(url) {
  const review = assessmentFor(url, 'improve_content');
  review.analysis = { ...review.analysis, summary: 'Make the opening heading describe the service.', reason: 'A clearer heading can help visitors understand what this page offers.', nextStep: 'Review the heading suggestion and publish it only if it accurately describes this page.', recommendations: [
    { id: 'action-1', type: 'heading', significance: 'primary', benefit: 'page_clarity', basis: 'opportunity', label: 'Make the opening heading more specific', location: 'The first heading at the top of this page', reason: 'The page already describes local website design, so the heading can make that purpose clearer.', instruction: 'Replace the opening heading only if the proposed wording accurately describes this page.', currentQuote: 'Website design', proposedText: 'Useful websites for local businesses', supportingQuote: 'We build useful websites for local businesses.', targetUrl: null, evidenceIds: ['P1'] },
    { id: 'action-2', type: 'internal_link', significance: 'supporting', benefit: 'navigation', basis: 'needs_check', label: 'Check a helpful link to the related service', location: 'The existing service explanation on this page', reason: 'An existing related page may answer the visitor’s next question.', instruction: 'Read the related page and add a descriptive link only where it helps the visitor.', currentQuote: '', proposedText: null, supportingQuote: 'We build useful websites for local businesses.', targetUrl: otherUrl, evidenceIds: ['P1'] },
    { id: 'action-3', type: 'check', significance: 'supporting', benefit: 'diagnosis', basis: 'needs_check', label: 'Check the heading in your website editor', location: 'The opening heading in the published page', reason: 'Downloaded HTML does not establish how the heading is rendered.', instruction: 'View the page in a browser before changing any visually hidden or decorative text.', currentQuote: '', proposedText: null, supportingQuote: '', targetUrl: null, evidenceIds: ['P1'] },
  ] };
  review.evidence.relatedPages = [{ pageUrl: otherUrl, impressions: 2, clicks: 0 }];
  review.diagnostics.relatedPages = [{ pageUrl: otherUrl, status: 'unavailable' }];
  review.analysis.strategy.checks = review.analysis.strategy.checks.map(check => check.area === 'headings' ? { ...check, evidenceIds: ['P1', 'W1'] } : check);
  return review;
}

function limitedLinkAssessment(url) {
  const review = contentAssessment(url);
  review.analysis.recommendations = [{ ...review.analysis.recommendations[1], id: 'action-1' }];
  review.analysis.strategy = strategyFor('keep_current', { priorityReason: 'The evidence supports a small navigation improvement, not a larger page rewrite.', checks: strategyFor('keep_current').checks.map(check => check.area === 'internal_links' ? { ...check, status: 'opportunity', finding: 'A clearer link may help visitors reach the existing service page.', evidenceIds: ['P1'] } : check) });
  review.analysis.summary = 'A helpful service link is a small navigation improvement.';
  review.analysis.reason = 'This does not establish that the link explains search performance.';
  return review;
}

function automaticAssessment(review) {
  return { ...review, provenance: { ...review.provenance, reviewVersion: 6 }, analysis: { ...review.analysis, searchFocus: { phrase: 'website design for local businesses', relatedPhrases: ['business website design'], intent: 'Find a service that builds useful business websites.', reason: 'This page describes website design for local businesses, so this focus helps customers who do not know the brand.', source: 'proposed', evidenceIds: ['P1'], supportingQuote: 'We build useful websites for local businesses.', question: null } } };
}
function planFor(review, previous) {
  const now = new Date().toISOString();
  const candidates = review.analysis.recommendations.map((recommendation, index) => {
    const old = previous?.tasks.find(task => task.recommendation.label === recommendation.label);
    if (old && ['done', 'dismissed'].includes(old.status)) return old;
    return { id: old?.id || `task-${(previous?.tasks.length || 0) + index + 1}`, status: 'todo', priority: recommendation.significance === 'primary' ? 'first' : recommendation.benefit === 'navigation' ? 'optional' : 'next', recommendation, facts: review.evidence.facts.filter(fact => recommendation.evidenceIds.includes(fact.id)), sources: review.research.sources.filter(source => recommendation.evidenceIds.includes(source.id)), createdAt: old?.createdAt || now, reviewedAt: now, contentFingerprint: review.provenance.contentFingerprint, draft: recommendation.type === 'metadata' ? { title: review.title, description: review.description } : null, retained: false };
  });
  const retained = (previous?.tasks || []).filter(task => !candidates.some(item => item.id === task.id)).map(task => ({ ...task, retained: true, priority: task.priority === 'first' ? 'next' : task.priority, status: ['done', 'dismissed'].includes(task.status) || task.contentFingerprint === review.provenance.contentFingerprint ? task.status : 'needs_review' }));
  const priorityOrder = { first: 0, next: 1, optional: 2 };
  return { id: 'saved-plan', revision: (previous?.revision || 0) + 1, updatedAt: now, review, tasks: [...candidates, ...retained].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]) };
}

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'page-task-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  docId = idFor(pageUrl);
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  const previous = await app.firestore().collection('implementedSeoTips').where('userId', '==', uid).get();
  const cleanup = app.firestore().batch();
  previous.docs.forEach(snapshot => cleanup.delete(snapshot.ref));
  await cleanup.commit();
  await app.firestore().doc(`onboarding/${uid}`).set({ name: 'Page task', websiteUrl: property, gscProperty: property, isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', revampRunId: 'page-task-run', progressReviewRequired: false, revampPages: [{ url: pageUrl, searchDataStatus: 'has_data' }, { url: otherUrl, searchDataStatus: 'no_data' }] });
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
  await app.firestore().doc(`users/${uid}/revampHistory/page-task-run`).set({ complete: true, runId: 'page-task-run' });
  await app.firestore().doc(`users/${uid}/revampHistory/page-task-run/records/old-record`).set({ collection: 'implementedSeoTips', sourceId: docId, data: { title: 'Old archived website title', pageUrl } });
  await app.firestore().doc(`implementedSeoTips/${docId}`).set({ userId: uid, pageUrl, status: 'implemented', title: 'Old archived website title', implementedAt: '2025-01-01', preRevampArchived: true });
  await app.firestore().doc(`implementedSeoTips/${idFor(otherUrl)}`).delete();
});
async function setup(page, { failGeneration = false, withQueries = false, redirects = {}, staleConfirmation = false, assessment = null, activity = null, persisted = false } = {}) {
  const calls = { generations: [], content: [], activity: [], confirmations: [], planReads: [], taskUpdates: [], plans: new Map() };
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/progress' || url.pathname === '/api/revamp/prepare-write') return route.continue();
    if (url.pathname === '/api/dashboard/overview') return json({ source: 'google_search_console', property, window: { startDate: '2026-09-10', endDate: '2026-10-07' }, totals: { impressions: 30, clicks: 1, ctr: 1 / 30, position: 11 }, daily: [], pages: [{ pageUrl, impressions: 30, clicks: 1, ctr: 1 / 30, position: 11 }], coverage: { pages: { limit: 100, returned: 1, complete: false } } });
    if (url.pathname === '/api/gsc/fetch-keywords') return json({ property, keywords: withQueries ? [{ page: pageUrl, keyword: 'local websites', impressions: 7, clicks: 1 }] : [] });
    if (url.pathname === '/api/focus-keywords') return json({ keywords: [] });
    if (url.pathname === '/api/page-review/plan') {
      if (route.request().method() === 'GET') { const target = url.searchParams.get('pageUrl'); calls.planReads.push(target); return json({ plan: calls.plans.get(target) || null }); }
      const body = route.request().postDataJSON(); calls.taskUpdates.push(body);
      const previous = calls.plans.get(body.pageUrl);
      if (!previous || previous.revision !== body.revision) return json({ error: 'Your task list changed elsewhere. Reload it before updating.' }, 409);
      const plan = { ...previous, revision: previous.revision + 1, updatedAt: new Date().toISOString(), tasks: previous.tasks.map(task => task.id === body.taskId ? { ...task, status: body.status } : task) };
      calls.plans.set(body.pageUrl, plan); return json({ plan });
    }
    if (url.pathname === '/api/page-review/content') { const body = route.request().postDataJSON(); calls.content.push(body.pageUrl); return json({ success: true, data: { ...metadata(body.pageUrl), finalUrl: redirects[body.pageUrl] || body.pageUrl } }); }
    if (url.pathname === '/api/page-review/activity') { const body = route.request().postDataJSON(); calls.activity.push(body.pageUrl); return json(activity ? activity(body) : activityFor(body.pageUrl, withQueries)); }
    if (url.pathname === '/api/page-review/suggestions') {
      const body = route.request().postDataJSON(); calls.generations.push(body);
      if (failGeneration) return json({ error: 'Draft service temporarily unavailable.' }, 503);
      let review = assessment ? assessment(body) : assessmentFor(body.pageUrl);
      if (persisted) {
        review = automaticAssessment(review);
        const plan = planFor(review, calls.plans.get(body.pageUrl)); calls.plans.set(body.pageUrl, plan);
        return json({ ...review, plan });
      }
      return json(review);
    }
    if (url.pathname === '/api/page-review/confirm') {
      // Browser flow: a mocked HTTP boundary writes only the local demo fixture.
      // Real server fetch/transaction/ownership behavior is tested in manualPageReview.test.js.
      if (staleConfirmation) return json({ error: 'Your website setup changed. Reload and review the current page before confirming.' }, 409);
      const body = route.request().postDataJSON();
      calls.confirmations.push(body);
      const record = { id: idFor(body.pageUrl), userId: uid, pageUrl: body.pageUrl, ...(body.changeType === 'page_content' ? { changeType: 'page_content', pageChangeSummary: body.changeSummary } : { title: body.title, description: body.description }), implementedAt: new Date().toISOString(), status: 'implemented', preRevampArchived: false, websiteRunId: 'page-task-run', gscProperty: property, confirmationMethod: 'user-confirmed' };
      await app.firestore().doc(`implementedSeoTips/${record.id}`).set(record);
      return json({ record, alreadyConfirmed: false });
    }
    return json({ keywords: [], pages: [], tips: [], suggestions: [], conversations: [], data: [], success: true });
  });
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  return calls;
}

async function openDetails(page, text) {
  const summary = page.locator('summary').filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first();
  await expect(summary).toBeVisible();
  if (await summary.evaluate(element => !element.parentElement.open)) await summary.click();
}

test('no-keyword task generates only on request, retries a failed save, preserves archives and freezes confirmed values', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await openDetails(page, 'Current title and description');
  await expect(page.getByText('Current website title', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Improve a page', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected page and search activity' }).getByText('Clicks from Google', { exact: true })).toBeVisible();
  expect(calls.generations).toHaveLength(0);
  await page.screenshot({ path: 'test-results/design-current-page.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('heading', { name: 'Fix this issue first', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveValue(suggestion.title);
  expect(calls.generations).toEqual([{ pageUrl, focusKeywords: [], includeResearch: true }]);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/design-draft-desktop.png', fullPage: true });
  await page.getByRole('region', { name: 'Page assessment' }).screenshot({ path: 'test-results/refinement-assessment-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/design-draft-mobile.png', fullPage: true });
  await page.getByRole('region', { name: 'Page assessment' }).screenshot({ path: 'test-results/refinement-assessment-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('button[title="Switch to light mode"]:visible').press('Space');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.getByRole('heading', { name: 'Improve a page', exact: true })).toHaveCSS('color', await page.locator('body').evaluate(el => getComputedStyle(el).color));
  await page.screenshot({ path: 'test-results/design-draft-light.png', fullPage: true, animations: 'disabled' });
  await page.locator('button[title="Switch to dark mode"]:visible').press('Space');
  await page.getByRole('textbox', { name: 'Suggested page title (SEO title)' }).fill('');
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Suggested page title (SEO title)' }).fill('Reviewed title published on my website');
  await page.getByRole('checkbox', { name: 'I published these title and description changes on this page.' }).check();
  await page.getByRole('button', { name: 'Confirm change and start tracking' }).click();
  let failSave = true;
  await page.route('**/api/page-review/confirm', route => {
    if (!failSave) return route.fallback();
    failSave = false;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test save unavailable' }) });
  });
  await page.getByRole('button', { name: 'Yes, I published these changes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your confirmation was not saved' })).toBeVisible();
  expect((await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data().preRevampArchived).toBe(true);
  await page.getByRole('button', { name: 'Yes, I published these changes' }).click();
  await expect(page.getByRole('heading', { name: 'Your confirmed website change' })).toBeVisible();
  const record = (await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data();
  expect(record).toMatchObject({ userId: uid, pageUrl, status: 'implemented', preRevampArchived: false, title: 'Reviewed title published on my website', description: suggestion.description });
  expect(record).not.toHaveProperty('preStats');
  expect((await app.firestore().doc(`users/${uid}/revampHistory/page-task-run/records/old-record`).get()).data().data.title).toBe('Old archived website title');
  await expect(page.getByText('Collecting search data', { exact: true })).toBeVisible();
  await page.reload();
  await openDetails(page, 'Published changes (1)');
  await expect(page.locator('#page-progress').getByText('Reviewed title published on my website', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toHaveCount(0);
  expect(calls.generations).toHaveLength(1);
  await page.screenshot({ path: 'test-results/phase3-page-task.png', fullPage: true });
});

test('redirect sources cannot generate or confirm; destination is reviewed and tracked explicitly', async ({ page }) => {
  const destination = 'https://example.test/New-page/?Campaign=A';
  await app.firestore().doc(`implementedSeoTips/${idFor(destination)}`).delete();
  const calls = await setup(page, { redirects: { [pageUrl]: destination } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Review destination page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
  expect(calls.generations).toHaveLength(0);
  await page.getByRole('button', { name: 'Review destination page' }).click();
  await expect(page.getByLabel('Choose a page to improve')).toHaveValue(destination);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  expect(calls.generations[0].pageUrl).toBe(destination);
  await page.getByRole('checkbox', { name: 'I published these title and description changes on this page.' }).check();
  await page.getByRole('button', { name: 'Confirm change and start tracking' }).click();
  await page.getByRole('button', { name: 'Yes, I published these changes' }).click();
  await expect(page.getByRole('heading', { name: 'Your confirmed website change' })).toBeVisible();
  expect((await app.firestore().doc(`implementedSeoTips/${idFor(destination)}`).get()).data().pageUrl).toBe(destination);
  expect((await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data().preRevampArchived).toBe(true);
});

test('a stale-draft rejection remains visible and never shows a saved change', async ({ page }) => {
  await setup(page, { staleConfirmation: true });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  await app.firestore().doc(`onboarding/${uid}`).update({ revampRunId: 'newer-run' });
  await page.getByRole('checkbox', { name: 'I published these title and description changes on this page.' }).check();
  await page.getByRole('button', { name: 'Confirm change and start tracking' }).click();
  await page.getByRole('button', { name: 'Yes, I published these changes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your confirmation was not saved' })).toBeVisible();
  expect((await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data().preRevampArchived).toBe(true);
});

test('failed suggestion cannot become an implementation and unknown URL deep links stay within known pages', async ({ page }) => {
  const calls = await setup(page, { failGeneration: true });
  await page.goto(`/low-ctr?page=${encodeURIComponent('https://other.test/private')}`);
  await expect(page.getByRole('alert').filter({ hasText: 'That exact page is not in your current tracked pages' })).toBeVisible();
  await openDetails(page, 'Current title and description');
  await expect(page.getByText('Current website title', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Draft service temporarily unavailable.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
  expect(calls.generations[0].pageUrl).toBe(pageUrl);
  expect(calls.content.every(value => value.startsWith(property))).toBe(true);
  expect((await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data().preRevampArchived).toBe(true);
});

test('exact-case page links remain distinct and automatic focus does not preselect a query', async ({ page }) => {
  const calls = await setup(page, { withQueries: true });
  await page.goto(`/low-ctr?page=${encodeURIComponent(otherUrl)}`);
  await expect(page.getByLabel('Choose a page to improve')).toHaveValue(otherUrl);
  await expect(page.getByLabel('Search phrase to consider')).toHaveCount(0);
  await openDetails(page, 'Current title and description');
  await expect(page.getByText('Current website title', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  expect(calls.generations[0]).toEqual({ pageUrl: otherUrl, focusKeywords: [], includeResearch: true });
  await page.getByLabel('Choose a page to improve').selectOption(pageUrl);
  await expect(page.getByText('Find your next useful changes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
  await openDetails(page, 'Current title and description');
  await expect(page.getByText('Current website title', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  expect(calls.generations[1]).toEqual({ pageUrl, focusKeywords: [], includeResearch: true });
});

test('keeping current wording never offers a draft or confirmation', async ({ page }) => {
  const calls = await setup(page, { assessment: body => assessmentFor(body.pageUrl, 'keep_current') });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Include web research' })).toHaveCount(0);
  await expect(page.getByText('Web research included. Your website won’t change.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('heading', { name: 'No clear change identified', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keep your current title and description', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/phase4-keep-current.png', fullPage: true });
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy page title (SEO title)' })).toHaveCount(0);
  await page.getByText('Why this recommendation?', { exact: true }).click();
  await expect(page.getByText('The main heading is Website design.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Page assessment' }).getByText('2026-09-10–2026-10-07', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/phase4-evidence-expanded.png', fullPage: true });
  expect(calls.generations).toEqual([{ pageUrl, focusKeywords: [], includeResearch: true }]);
  expect((await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data().preRevampArchived).toBe(true);
});

test('unavailable research and search data are explicit and never shown as zero measurements', async ({ page }) => {
  const calls = await setup(page, { assessment: body => {
    const review = assessmentFor(body.pageUrl, 'collect_data');
    review.analysis = { ...review.analysis, summary: 'Wait for more information before changing the wording.', reason: 'The available page content does not show a clear wording problem.', evidenceIds: ['P1'] };
    review.evidence = { ...review.evidence, status: 'unavailable', current: { totals: null, totalsStatus: 'unavailable', queries: [], queriesStatus: 'unavailable' }, previous: { totals: null, totalsStatus: 'unavailable', queries: [], queriesStatus: 'unavailable' }, facts: review.evidence.facts.slice(0, 1) };
    review.diagnostics.inspection = { status: 'unavailable', url: body.pageUrl, checkedAt: '2026-10-10T15:00:00.000Z' };
    review.research = { status: 'unavailable', summary: '', sources: [], checkedAt: '2026-10-10T15:00:00.000Z', limitation: 'Web research could not be completed. No competitor claims were used.' };
    return review;
  } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('heading', { name: 'We need more evidence to choose the main improvement', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Web research was unavailable' })).toBeVisible();
  await expect(page.getByText('Search data was unavailable for this review.', { exact: false })).toBeVisible();
  await page.getByText('Why this recommendation?', { exact: true }).click();
  const assessment = page.getByRole('region', { name: 'Page assessment' });
  await expect(assessment.getByText('Search totals are unavailable for this period.', { exact: true })).toHaveCount(2);
  await expect(assessment.locator('dd')).toHaveCount(0);
  await expect(assessment.getByText('Google reported 30 appearances in the recent period.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
  expect(calls.generations[0].includeResearch).toBe(true);
});

test('research sources and a diagnostics-only related page remain inspectable', async ({ page }) => {
  const relatedUrl = 'https://example.test/Related-service/?Location=A';
  await setup(page, { assessment: body => {
    const review = assessmentFor(body.pageUrl, 'review_page');
    review.analysis = { ...review.analysis, summary: 'Review the service page for this search.', reason: 'A separate service page may be a closer match.', nextStep: 'Read the service page before deciding what to edit.', targetPageUrl: relatedUrl, evidenceIds: ['P1', 'D1', 'W1'] };
    review.diagnostics.relatedPages = [{ pageUrl: relatedUrl, status: 'available', currentPage: metadata(relatedUrl) }];
    review.diagnostics.facts = [{ id: 'D1', kind: 'page', label: 'Existing service page', text: `This existing linked service page was read: ${relatedUrl}` }];
    review.research = { status: 'available', summary: '### Public website context\n\nA **service example** provides context for how services are described. Read [the supplied source](https://COMPETITOR.test:443/services/).\n\n- [Unlisted source](https://unlisted.test/) is not verified.\n- [Unsafe link](javascript:alert%281%29) is not a citation.\n\n![External image](https://images.test/tracker.png)\n\n<a href="https://unlisted.test/raw">Raw HTML link</a>', sources: [{ id: 'W1', url: 'https://competitor.test/services/', title: 'Example service page' }], checkedAt: '2026-10-10T15:00:00.000Z', limitation: 'Public website context is not a report of Google rankings.' };
    return review;
  } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('heading', { name: 'We need more evidence to choose the main improvement', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review recommended page', exact: true })).toBeVisible();
  await expect(page.getByLabel('Choose a page to improve').locator('option').filter({ hasText: relatedUrl })).toHaveCount(0);
  await page.getByText('Why this recommendation?', { exact: true }).click();
  const summary = page.locator('[aria-label="Web research summary"]');
  await expect(summary.getByRole('heading', { name: 'Public website context' })).toBeVisible();
  await expect(summary.locator('strong')).toHaveText('service example');
  await expect(summary.getByRole('link', { name: 'the supplied source (opens in a new tab)' })).toHaveAttribute('href', 'https://competitor.test/services/');
  await expect(summary.getByRole('link')).toHaveCount(1);
  await expect(summary.getByText('Unlisted source', { exact: true })).toBeVisible();
  await expect(summary.getByText('Unsafe link', { exact: true })).toBeVisible();
  await expect(summary.locator('img')).toHaveCount(0);
  await expect(summary).not.toContainText('[the supplied source]');
  await page.getByRole('heading', { name: 'Web research', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/phase4-research-citations.png', fullPage: false });
  const source = page.getByRole('link', { name: 'Example service page Opens in a new tab' });
  await expect(source).toHaveAttribute('href', 'https://competitor.test/services/');
  await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('button', { name: 'Review recommended page', exact: true }).click();
  await expect(page.getByLabel('Choose a page to improve')).toHaveValue(relatedUrl);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Page assessment' })).toHaveCount(0);
});

test('legacy drafts, missing v5 strategy and unresolved evidence cannot enable saving', async ({ page }) => {
  let responseCount = 0;
  await setup(page, { assessment: body => {
    responseCount += 1;
    const review = assessmentFor(body.pageUrl, responseCount >= 6 ? 'review_page' : 'revise_metadata');
    if (responseCount === 1) delete review.analysis;
    else if (responseCount === 2) review.analysis.evidenceIds = ['invented-source'];
    else if (responseCount === 3) delete review.analysis.strategy;
    else if (responseCount === 4) review.provenance.reviewVersion = 4;
    else if (responseCount === 5) review.analysis.strategy.checks[0].evidenceIds = ['invented-check-source'];
    else {
      review.analysis.targetPageUrl = responseCount === 6 ? 'https://other.test/service/' : body.pageUrl;
      review.diagnostics.relatedPages = [{ pageUrl: review.analysis.targetPageUrl, status: 'available', currentPage: metadata(review.analysis.targetPageUrl) }];
    }
    return review;
  } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  for (let index = 0; index < 7; index += 1) {
    await page.getByRole('button', { name: index === 0 ? 'Analyze this page' : 'Analyze again' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'A complete, supported page assessment was not returned' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
  }
});

test('editing the business goal keeps the previous assessment until a new review succeeds', async ({ page }) => {
  const calls = await setup(page, { withQueries: true });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  await openDetails(page, 'Tell us more about this page (optional)');
  await page.getByLabel('What should this page help visitors do?', { exact: false }).fill('Explain my current website design service.');
  await expect(page.getByRole('region', { name: 'Page assessment' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  await page.getByRole('button', { name: 'Analyze again' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  expect(calls.generations.map(call => ({ focusKeywords: call.focusKeywords, includeResearch: call.includeResearch }))).toEqual([{ focusKeywords: [], includeResearch: true }, { focusKeywords: [], includeResearch: true }]);
  expect(calls.generations[1].goal).toBe('Explain my current website design service.');
});

test('selected page totals, query counts and six-period history load before any AI request', async ({ page }) => {
  const calls = await setup(page, { activity: body => {
    const result = activityFor(body.pageUrl, true);
    result.evidence.current.queries = Array.from({ length: 7 }, (_, index) => ({ query: `website service ${index + 1}`, clicks: 1, impressions: 7, ctr: 1 / 7, position: 11 }));
    return result;
  } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  const activity = page.getByRole('region', { name: 'Selected page and search activity' });
  await expect(activity.getByRole('heading', { name: '/Case/?City=A', exact: true })).toBeVisible();
  await expect(activity.locator('dd')).toHaveText(['1', '30']);
  await expect(page.getByLabel('Choose a page to improve').locator(`option[value="${pageUrl}"]`)).toContainText('1 click · 30 appearances');
  await expect(page.getByLabel('Choose a page to improve').locator(`option[value="${otherUrl}"]`)).toContainText('No reported data');
  await openDetails(page, 'See searches for this page');
  const queries = activity.getByRole('table', { name: 'Search phrases for the selected page' });
  await expect(queries.getByRole('row')).toHaveCount(6);
  await expect(queries.getByRole('row', { name: 'website service 1 1 7 11', exact: true })).toBeVisible();
  await activity.getByRole('button', { name: 'Show all 7 searches' }).click();
  await expect(queries.getByRole('row')).toHaveCount(8);
  await expect(activity.locator('dd')).toHaveText(['1', '30']);
  await activity.getByText('Search history · about six months', { exact: true }).click();
  await expect(activity.getByRole('table', { name: 'Search history for the selected page' }).getByRole('row')).toHaveCount(7);
  await expect(activity.getByText(/older numbers may describe its previous version/)).toBeVisible();
  expect(calls.generations).toHaveLength(0);
  expect(calls.activity).toEqual([pageUrl]);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/phase4-page-activity.png', fullPage: true });
});

test('a late activity response cannot put the previous page’s counts on the selected page', async ({ page }) => {
  await setup(page, { activity: body => {
    const result = activityFor(body.pageUrl);
    result.evidence.current = { totals: null, totalsStatus: 'no_data', queries: [], queriesStatus: 'no_data' };
    return result;
  } });
  let releaseOld;
  let markOldStarted;
  let markOldFinished;
  const oldStarted = new Promise(resolve => { markOldStarted = resolve; });
  const oldFinished = new Promise(resolve => { markOldFinished = resolve; });
  const released = new Promise(resolve => { releaseOld = resolve; });
  await page.route('**/api/page-review/activity', async route => {
    const body = route.request().postDataJSON();
    if (body.pageUrl !== pageUrl) return route.fallback();
    markOldStarted();
    await released;
    const old = activityFor(pageUrl); old.evidence.current.totals.impressions = 9999;
    try { await route.fulfill({ status: 200, json: old }); } catch { /* The page switch aborts this request. */ }
    markOldFinished();
  });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await oldStarted;
  await page.getByLabel('Choose a page to improve').selectOption(otherUrl);
  const activity = page.getByRole('region', { name: 'Selected page and search activity' });
  await expect(activity.getByRole('heading', { name: '/case/?City=a', exact: true })).toBeVisible();
  await expect(activity.getByText(/Google returned no page totals/)).toBeVisible();
  releaseOld();
  await oldFinished;
  await expect(activity.locator('dd')).toHaveCount(0);
  await expect(activity).not.toContainText('9,999');
  await openDetails(page, 'See searches for this page');
  await expect(activity.getByText(/Google returned no search phrases/)).toBeVisible();
});

test('unavailable or mismatched activity never becomes zero counts and can be retried', async ({ page }) => {
  let attempt = 0;
  await setup(page, { activity: body => {
    attempt += 1;
    const result = activityFor(body.pageUrl);
    if (attempt === 1) result.provenance.websiteRunId = 'stale-website-run';
    else result.evidence.current = { totals: null, totalsStatus: 'unavailable', queries: [], queriesStatus: 'unavailable' };
    return result;
  } });
  let failFirstRead = true;
  await page.route('**/api/page-review/activity', route => {
    if (!failFirstRead) return route.fallback();
    failFirstRead = false;
    return route.fulfill({ status: 503, json: { error: 'Page activity is temporarily unavailable. Please retry.' } });
  });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  const activity = page.getByRole('region', { name: 'Selected page and search activity' });
  await expect(activity.getByRole('alert')).toContainText('Page activity is temporarily unavailable');
  await expect(activity.locator('dd')).toHaveCount(0);
  await activity.getByRole('button', { name: 'Retry page activity' }).click();
  await expect(activity.getByRole('alert')).toContainText('this exact page could not be verified');
  await expect(page.getByLabel('Choose a page to improve').locator(`option[value="${pageUrl}"]`)).toContainText('Activity unavailable');
  await expect(activity.locator('dd')).toHaveCount(0);
  await activity.getByRole('button', { name: 'Retry page activity' }).click();
  await expect(activity.getByText(/Page totals are unavailable right now/)).toBeVisible();
  await openDetails(page, 'See searches for this page');
  await expect(activity.getByText('Search phrases are unavailable for this period.', { exact: true })).toBeVisible();
  await expect(activity.locator('dd')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
});

test('keeping metadata can still recommend investigating visibility with the exact page context', async ({ page }) => {
  await setup(page, { assessment: body => {
    const review = assessmentFor(body.pageUrl, 'investigate_visibility');
    review.analysis = { ...review.analysis, metadataVerdict: 'keep', metadataReason: 'The existing title describes the service accurately.', summary: 'Check why this page has little search visibility.', reason: 'Several periods show little activity, which a cosmetic rewrite would not explain.', nextStep: 'Inspect this URL in Search Console and review its internal links before changing the wording.' };
    return review;
  } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  const assessment = page.getByRole('region', { name: 'Page assessment' });
  await expect(assessment.getByRole('heading', { name: 'Keep your current title and description', exact: true })).toBeVisible();
  await expect(assessment.getByRole('heading', { name: 'We need more evidence to choose the main improvement', exact: true })).toBeVisible();
  await expect(assessment.getByRole('link', { name: `${pageUrl} (opens in a new tab)`, exact: true })).toHaveAttribute('href', pageUrl);
  await expect(assessment.getByText(/Inspect this URL in Search Console/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
});

test('generalized page review prioritizes a concrete action, preserves metadata and shows inspection evidence', async ({ page }) => {
  const calls = await setup(page, { assessment: body => {
    const review = contentAssessment(body.pageUrl);
    review.diagnostics.relatedPages[0].comparison = { phrases: ['local website design', 'website consultation'], window: review.evidence.window, previousWindow: review.evidence.previousWindow, current: { status: 'available', queries: [{ query: 'local website design', clicks: 1, impressions: 8, ctr: 0.125, position: 12.4 }] }, previous: { status: 'unavailable', queries: [] }, limitation: 'Partial reported queries do not establish that these pages compete or explain a ranking change.' };
    return review;
  }, activity: body => {
    const result = activityFor(body.pageUrl, true);
    result.evidence.current.queries = [{ query: 'less seen search', clicks: 0, impressions: 2, position: null }, { query: 'local website design', clicks: 1, impressions: 20, position: 9.25 }];
    return result;
  } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await openDetails(page, 'See searches for this page');
  const queries = page.getByRole('table', { name: 'Search phrases for the selected page' });
  await expect(queries.getByRole('row').nth(1)).toHaveText('local website design1209.3');
  await expect(queries.getByRole('row').nth(2)).toHaveText('less seen search02Unavailable');
  await openDetails(page, 'Tell us more about this page (optional)');
  await page.getByLabel('What should this page help visitors do?', { exact: false }).fill('Help local businesses request a website consultation.');
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  const assessment = page.getByRole('region', { name: 'Page assessment' });
  await expect(assessment.getByRole('heading', { name: 'Make the opening heading more specific' })).toBeVisible();
  await expect(assessment.getByRole('heading', { name: 'Main improvement to test', exact: true })).toBeVisible();
  await expect(assessment.getByRole('article').first()).toHaveAttribute('aria-label', 'Make the opening heading more specific');
  await expect(assessment.getByRole('article').first().getByText('Main opportunity · Heading', { exact: true })).toBeVisible();
  await expect(assessment.getByRole('article').first().getByText('Helps visitors understand this page', { exact: true })).toBeVisible();
  await expect(assessment.getByText('Useful websites for local businesses', { exact: true })).toBeVisible();
  await expect(assessment.getByText('Keep your current title and description', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
  await expect(assessment.getByRole('heading', { name: 'Match to customer searches', exact: true })).not.toBeVisible();
  await assessment.getByText('What we checked', { exact: true }).focus();
  await assessment.getByText('What we checked', { exact: true }).press('Enter');
  for (const name of ['Google access and indexing', 'Match to customer searches', 'Useful page content', 'Page headings', 'Search title and description', 'Links within your website']) await expect(assessment.getByRole('heading', { name, exact: true })).toBeVisible();
  await assessment.getByText('Sources for page headings', { exact: true }).focus();
  await assessment.getByText('Sources for page headings', { exact: true }).press('Enter');
  await expect(assessment.getByText('The main heading is Website design.', { exact: true }).filter({ visible: true })).toBeVisible();
  const checks = assessment.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^What we checked$/ }) });
  await page.keyboard.press('Tab');
  await expect(checks.getByRole('link', { name: 'Service page context (opens in a new tab)' })).toBeFocused();
  await expect(checks.getByRole('link', { name: 'Service page context (opens in a new tab)' })).toHaveAttribute('href', 'https://reference.test/service/');
  await page.setViewportSize({ width: 390, height: 844 });
  await checks.screenshot({ path: 'test-results/prioritized-checks-mobile.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await assessment.getByText('What we checked', { exact: true }).press('Enter');
  expect(calls.generations[0].goal).toBe('Help local businesses request a website consultation.');
  const inspection = page.getByRole('region', { name: 'Google index check' });
  await expect(inspection.getByText('Submitted and indexed', { exact: true })).toBeVisible();
  await expect(inspection.getByText(`Exact URL: ${pageUrl}`, { exact: true })).toBeVisible();
  await expect(inspection.getByRole('link', { name: 'Open Google’s inspection', exact: false })).toHaveAttribute('href', /https:\/\/search.google.com\/search-console\/inspect\?/);
  await expect(inspection.getByText(/Last crawl reported by Google/)).toBeVisible();
  await inspection.getByText('Index and page-read details', { exact: true }).focus();
  await inspection.getByText('Index and page-read details', { exact: true }).press('Enter');
  await expect(inspection.getByText(/not a browser-rendered page/)).toBeVisible();
  await expect(inspection.getByText('Page content could not be read.', { exact: true })).toBeVisible();
  const comparison = inspection.getByRole('region', { name: `Search comparison for ${otherUrl}`, exact: true });
  await expect(comparison.getByText('2026-09-10–2026-10-07', { exact: true })).toBeVisible();
  await expect(comparison.getByText('2026-08-13–2026-09-09', { exact: true })).toBeVisible();
  await expect(comparison.locator('dd')).toHaveText(['1', '8', '12.4']);
  await expect(comparison.getByText('Not reported for this page and period.', { exact: true })).toBeVisible();
  await expect(comparison.getByText('Search comparison unavailable for this period.', { exact: true })).toBeVisible();
  await comparison.screenshot({ path: 'test-results/generalized-related-comparison.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
  await page.setViewportSize({ width: 390, height: 844 });
  await comparison.screenshot({ path: 'test-results/generalized-related-comparison-mobile.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await inspection.getByText('Index and page-read details', { exact: true }).click();
  const secondary = assessment.getByRole('article', { name: 'Check a helpful link to the related service' });
  await expect(secondary.getByRole('link')).not.toBeVisible();
  await secondary.locator('summary').first().click();
  await expect(secondary.getByRole('link')).toHaveAttribute('href', otherUrl);
  await secondary.locator('summary').first().click();
  await assessment.getByText('After publishing: when to check progress', { exact: true }).click();
  await expect(assessment.getByText(/After 1–2 weeks/)).toBeVisible();
  await expect(assessment.getByText(/Around 8–12 weeks/)).toBeVisible();
  await assessment.getByText('After publishing: when to check progress', { exact: true }).click();
  const componentScreenshot = { animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' };
  await assessment.screenshot({ path: 'test-results/generalized-review-desktop.png', ...componentScreenshot });
  await page.setViewportSize({ width: 390, height: 844 });
  await assessment.screenshot({ path: 'test-results/generalized-review-mobile.png', ...componentScreenshot });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('button[title="Switch to light mode"]:visible').press('Space');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(assessment.getByRole('heading', { name: 'Make the opening heading more specific' })).toHaveCSS('color', await page.locator('body').evaluate(el => getComputedStyle(el).color));
  await assessment.screenshot({ path: 'test-results/generalized-review-light.png', ...componentScreenshot });
});

test('published content edits save their own summary and reload without fictional metadata changes', async ({ page }) => {
  const calls = await setup(page, { assessment: body => contentAssessment(body.pageUrl) });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  const confirmation = page.getByRole('region', { name: 'Track a published page-content change' });
  await confirmation.locator('summary').click();
  await expect(confirmation.getByRole('button', { name: 'Track this published page change', exact: true })).toBeDisabled();
  await confirmation.getByLabel('What did you actually publish?', { exact: true }).fill('Updated the first heading to describe the existing website design service.');
  await confirmation.getByRole('checkbox').check();
  await confirmation.getByLabel('What did you actually publish?', { exact: true }).fill('Published a clearer opening heading about website design for local businesses.');
  await expect(confirmation.getByRole('checkbox')).not.toBeChecked();
  await confirmation.getByRole('checkbox').check();
  await confirmation.getByRole('button', { name: 'Track this published page change', exact: true }).click();
  let failFirstSave = true;
  await page.route('**/api/page-review/confirm', route => {
    if (!failFirstSave) return route.fallback();
    failFirstSave = false;
    return route.fulfill({ status: 503, json: { error: 'Test content confirmation unavailable.' } });
  });
  await page.getByRole('button', { name: 'Yes, track my published page change' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your confirmation was not saved' })).toBeVisible();
  expect((await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data().preRevampArchived).toBe(true);
  await page.getByRole('button', { name: 'Yes, track my published page change' }).click();
  await expect(page.getByRole('heading', { name: 'Your page-content change is saved' })).toBeVisible();
  await openDetails(page, 'Published changes (1)');
  await expect(page.locator('#page-progress').getByText('Published a clearer opening heading about website design for local businesses.', { exact: true })).toBeVisible();
  expect(calls.confirmations[0]).toMatchObject({ pageUrl, changeType: 'page_content', published: true, changeSummary: 'Published a clearer opening heading about website design for local businesses.' });
  expect(calls.confirmations[0]).not.toHaveProperty('title');
  expect(calls.confirmations[0]).not.toHaveProperty('description');
  const record = (await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data();
  expect(record.changeType).toBe('page_content');
  expect(record).not.toHaveProperty('title');
  await page.reload();
  await openDetails(page, 'Published changes (1)');
  await expect(page.getByText('Published a clearer opening heading about website design for local businesses.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Confirmed page title (SEO title)' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Confirmed page description (meta description)' })).toHaveCount(0);
  expect(calls.generations).toHaveLength(1);
});

test('a small link opportunity is honestly limited and never promoted to the main improvement', async ({ page }) => {
  await setup(page, { assessment: body => limitedLinkAssessment(body.pageUrl) });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  const assessment = page.getByRole('region', { name: 'Page assessment' });
  await expect(assessment.getByRole('heading', { name: 'Only small improvements found', exact: true })).toBeVisible();
  await expect(assessment.getByText('Small supporting improvement · Internal link', { exact: true })).toBeVisible();
  await expect(assessment.getByText('Helps visitors find the next useful page', { exact: true })).toBeVisible();
  await expect(assessment.getByRole('heading', { name: 'Improve the page content first', exact: true })).toHaveCount(0);
  await expect(assessment.getByRole('heading', { name: 'Main improvement to test', exact: true })).toHaveCount(0);
  await expect(assessment.getByText(/Start here|Main opportunity/)).toHaveCount(0);
  await expect(assessment.getByRole('article')).toHaveCount(1);
  await expect(assessment.getByRole('article').getByRole('link')).toHaveAttribute('href', otherUrl);
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
  await assessment.screenshot({ path: 'test-results/prioritized-limited-findings.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
});

test('business goal waits for the current analysis and editing it retains the saved review', async ({ page }) => {
  const calls = await setup(page, { assessment: body => contentAssessment(body.pageUrl) });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  let release;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  let first = true;
  await page.route('**/api/page-review/suggestions', async route => {
    if (!first) return route.fallback();
    first = false; started(); await released;
    try { await route.fulfill({ status: 200, json: contentAssessment(pageUrl) }); } catch { /* The browser may close during a failed test. */ }
  });
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await waiting;
  await expect(page.getByLabel('What should this page help visitors do?', { exact: false })).toBeDisabled();
  release();
  await expect(page.getByRole('region', { name: 'Page assessment' })).toBeVisible();
  await openDetails(page, 'Tell us more about this page (optional)');
  await page.getByLabel('What should this page help visitors do?', { exact: false }).fill('Explain my existing website design service.');
  await page.getByRole('button', { name: 'Analyze again' }).click();
  await expect(page.getByRole('heading', { name: 'Make the opening heading more specific' })).toBeVisible();
  await expect.poll(() => calls.generations[0]?.goal).toBe('Explain my existing website design service.');
  await openDetails(page, 'Tell us more about this page (optional)');
  await page.getByLabel('What should this page help visitors do?', { exact: false }).fill('Help visitors understand the service before contacting me.');
  await expect(page.getByRole('region', { name: 'Page assessment' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Track a published page-content change' })).toBeVisible();
});

test('invalid action evidence, unlisted destinations and unsafe inspection links cannot enable confirmation', async ({ page }) => {
  let attempt = 0;
  await setup(page, { assessment: body => {
    const review = contentAssessment(body.pageUrl);
    attempt += 1;
    if (attempt === 1) review.analysis.recommendations[0].evidenceIds = ['invented'];
    if (attempt === 2) review.analysis.recommendations[1].targetUrl = 'https://example.test/unlisted-page/';
    if (attempt === 3) review.diagnostics.inspection.inspectionUrl = 'https://evil.test/search-console/inspect';
    return review;
  } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: index === 0 ? 'Analyze this page' : 'Analyze again' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'A complete, supported page assessment was not returned' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Page assessment' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Track a published page-content change' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toHaveCount(0);
  }
});

test('automatic focus and multiple saved tasks survive reload, page switches, failed analysis and checklist updates', async ({ page }) => {
  const calls = await setup(page, { persisted: true, assessment: body => contentAssessment(body.pageUrl) });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await expect(page.getByLabel('Search phrase to consider')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  const tasks = page.getByRole('region', { name: 'Saved page tasks' });
  await expect(tasks.getByRole('heading', { name: 'Your next changes' })).toBeVisible();
  await expect(tasks.getByRole('article')).toHaveCount(3);
  for (const label of ['Make the opening heading more specific', 'Check a helpful link to the related service', 'Check the heading in your website editor']) await expect(tasks.getByRole('article', { name: label }).getByRole('heading')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Automatically selected search focus' }).getByRole('heading')).toHaveText('website design for local businesses');
  await expect(page.getByText('A suggested topic to test, not measured search demand.', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(calls.generations[0].focusKeywords).toEqual([]);
  await page.reload();
  await expect(tasks.getByRole('article')).toHaveCount(3);
  expect(calls.generations).toHaveLength(1);
  await page.getByLabel('Choose a page to improve').selectOption(otherUrl);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await expect(tasks).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Automatically selected search focus' })).toHaveCount(0);
  await page.getByLabel('Choose a page to improve').selectOption(pageUrl);
  await expect(tasks.getByRole('article')).toHaveCount(3);
  expect(calls.generations).toHaveLength(1);
  const failed = route => route.fulfill({ status: 503, json: { error: 'Analysis temporarily unavailable. Your saved tasks are unchanged.' } });
  await page.route('**/api/page-review/suggestions', failed);
  await page.getByRole('button', { name: 'Analyze again' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Analysis temporarily unavailable' })).toBeVisible();
  await expect(tasks.getByRole('article')).toHaveCount(3);
  await page.unroute('**/api/page-review/suggestions', failed);
  const first = tasks.getByRole('article', { name: 'Check the heading in your website editor' });
  await first.locator(':scope > details > summary').click();
  await first.getByRole('button', { name: 'Mark check complete' }).click();
  await expect(tasks.getByText('2 remaining · Saved', { exact: false })).toBeVisible();
  await expect(tasks.getByText('Completed and dismissed (1)', { exact: true })).toBeVisible();
  expect(calls.confirmations).toHaveLength(0);
  expect((await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data().preRevampArchived).toBe(true);
  await page.reload();
  await expect(tasks.getByText('2 remaining · Saved', { exact: false })).toBeVisible();
  await tasks.getByText('Completed and dismissed (1)', { exact: true }).click();
  await first.locator(':scope > details > summary').click();
  await first.getByRole('button', { name: 'Reopen task' }).click();
  await expect(tasks.getByText('3 remaining · Saved', { exact: false })).toBeVisible();
  expect(calls.confirmations).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await tasks.screenshot({ path: 'test-results/saved-page-plan-mobile.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
  await page.setViewportSize({ width: 1280, height: 850 });
  await tasks.screenshot({ path: 'test-results/saved-page-plan-desktop.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
  await page.getByRole('region', { name: 'Automatically selected search focus' }).screenshot({ path: 'test-results/automatic-search-focus-desktop.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
  await page.locator('button[title="Switch to light mode"]:visible').press('Space');
  await tasks.screenshot({ path: 'test-results/saved-page-plan-light.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
  await page.getByRole('region', { name: 'Automatically selected search focus' }).screenshot({ path: 'test-results/automatic-search-focus-light.png', animations: 'disabled', style: 'header, .fixed { visibility: hidden !important; }' });
});

test('reanalysis retains earlier tasks and metadata wording when the latest review does not repeat them', async ({ page }) => {
  let second = false;
  const calls = await setup(page, { persisted: true, assessment: body => second ? assessmentFor(body.pageUrl, 'keep_current') : assessmentFor(body.pageUrl) });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  const tasks = page.getByRole('region', { name: 'Saved page tasks' });
  await expect(tasks.getByRole('article')).toHaveCount(1);
  second = true;
  await page.getByRole('button', { name: 'Analyze again' }).click();
  await openDetails(page, 'Full analysis and sources');
  await expect(page.getByRole('heading', { name: 'Keep your current title and description', exact: true })).toBeVisible();
  await expect(tasks.getByRole('article')).toHaveCount(1);
  await expect(tasks.getByText('Saved from an earlier review. Check that it still fits.', { exact: true })).toBeVisible();
  await expect(tasks.getByText('Suggested title', { exact: true })).toBeVisible();
  await expect(tasks.getByText(suggestion.title, { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start tracking published edits' })).toBeDisabled();
  await expect(tasks.getByRole('checkbox', { name: 'I published this edit' })).not.toBeChecked();
  await page.reload();
  await expect(tasks.getByText(suggestion.title, { exact: true })).toBeVisible();
  expect(calls.generations).toHaveLength(2);
  expect(calls.confirmations).toHaveLength(0);
});

test('a changed page warns about saved suggestions and a failed checklist update does not pretend to save', async ({ page }) => {
  const calls = await setup(page, { persisted: true, assessment: body => contentAssessment(body.pageUrl) });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  const tasks = page.getByRole('region', { name: 'Saved page tasks' });
  await expect(tasks.getByRole('article')).toHaveCount(3);
  await page.route('**/api/page-review/content', route => route.fulfill({ status: 200, json: { success: true, data: metadata(pageUrl), provenance: { contentFingerprint: 'changed-content' } } }));
  await page.reload();
  await expect(page.getByText('Your website changed since this analysis.', { exact: false })).toBeVisible();
  await page.route('**/api/page-review/plan', route => route.request().method() === 'POST' ? route.fulfill({ status: 409, json: { error: 'Your task list changed elsewhere. Reload it before updating.' } }) : route.fallback());
  await tasks.getByRole('article').first().getByRole('button', { name: 'Dismiss' }).click();
  await expect(tasks.getByRole('alert')).toContainText('Your task status was not confirmed as saved');
  await expect(tasks.getByText('3 remaining · Saved', { exact: false })).toBeVisible();
  expect(calls.confirmations).toHaveLength(0);
});

test('a saved plan for another exact page is rejected and new v6 responses require a saved plan and search focus', async ({ page }) => {
  await setup(page);
  await page.route('**/api/page-review/plan?*', route => route.fulfill({ status: 200, json: { plan: planFor(automaticAssessment(contentAssessment(otherUrl))) } }));
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('alert').filter({ hasText: 'The saved tasks for this exact page could not be verified' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved page tasks' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeDisabled();
  await page.unroute('**/api/page-review/plan?*');
  await page.getByRole('button', { name: 'Retry saved tasks' }).click();
  await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeEnabled();
  await page.route('**/api/page-review/suggestions', route => route.fulfill({ status: 200, json: automaticAssessment(assessmentFor(pageUrl)) }));
  await page.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The new task list could not be verified as saved' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
});
