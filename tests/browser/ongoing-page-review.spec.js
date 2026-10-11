const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

// Browser-only fixtures. Publication and cycle endpoints are mocked here;
// their real transaction/authorization guards are covered by server tests.
const uid = 'ongoing-review-alice';
const property = 'https://example.test/';
const pageUrl = `${property}Case/?City=A`;
const otherUrl = `${property}case/?City=a`;
const websiteRunId = 'ongoing-review-run';
const now = '2026-10-10T15:00:00.000Z';
const labels = ['Clarify the opening heading', 'Explain the design process', 'Inspect the page in your editor'];
const taskIds = labels.map(label => createHash('sha256').update(label).digest('hex'));
let app;

const contentFor = url => ({ htmlTitle: 'Website design | Example Studio', seoMetaDescription: 'We build useful websites for local businesses.',
  h1: 'Website design', textContent: 'We build useful websites for local businesses. Our process includes planning, design and launch.',
  headings: [{ tag: 'h1', text: 'Website design' }], url, finalUrl: url, fetchedAt: now, source: 'website-html' });

function evidenceFor(url) {
  const totals = { impressions: 30, clicks: 1, ctr: 1 / 30, position: 11 };
  const history = Array.from({ length: 6 }, (_, index) => {
    const end = new Date('2026-10-07T12:00:00Z'); end.setUTCDate(end.getUTCDate() - index * 28);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 27);
    return { window: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }, totals, totalsStatus: 'available' };
  });
  const period = { totals, totalsStatus: 'available', queries: [], queriesStatus: 'no_data' };
  return { source: 'google_search_console', property, pageUrl: url, window: history[0].window, previousWindow: history[1].window,
    fetchedAt: now, status: 'available', current: period, previous: period, relatedPages: [], history,
    selectedPhrase: { value: '', source: 'none' }, limitations: ['Search activity does not establish what caused a change.'],
    facts: [{ id: 'P1', kind: 'page', label: 'Current page content', text: contentFor(url).textContent }] };
}

function reviewFor(url) {
  const recommendations = [
    { id: 'action-1', type: 'heading', significance: 'primary', benefit: 'page_clarity', basis: 'opportunity', label: labels[0],
      location: 'The first heading', reason: 'A clear heading helps visitors identify the service.', instruction: 'Publish a clearer opening heading if it accurately describes your work.',
      currentQuote: 'Website design', proposedText: 'Useful websites for local businesses', supportingQuote: 'We build useful websites for local businesses.', targetUrl: null, evidenceIds: ['P1'] },
    { id: 'action-2', type: 'content', significance: 'supporting', benefit: 'visitor_decision', basis: 'opportunity', label: labels[1],
      location: 'The existing process section', reason: 'The page names process stages but can explain the next step more clearly.', instruction: 'Describe the planning, design and launch stages in the existing process section.',
      currentQuote: 'Our process includes planning, design and launch.', proposedText: null, supportingQuote: '', targetUrl: null, evidenceIds: ['P1'] },
    { id: 'action-3', type: 'check', significance: 'supporting', benefit: 'diagnosis', basis: 'needs_check', label: labels[2],
      location: 'The published page', reason: 'Downloaded HTML does not establish the visual presentation.', instruction: 'Open the published page to check its heading on a phone.',
      currentQuote: '', proposedText: null, supportingQuote: '', targetUrl: null, evidenceIds: ['P1'] },
  ];
  return { title: null, description: null, currentPage: contentFor(url),
    provenance: { property, websiteRunId, pageUrl: url, finalUrl: url, contentFingerprint: `fixture-${url}`, generatedAt: now, reviewVersion: 6 },
    evidence: evidenceFor(url),
    analysis: { action: 'improve_content', pageGoal: 'Help local businesses understand the website design service.', recommendations,
      metadataVerdict: 'keep', metadataReason: 'The current title and description accurately describe this service.',
      summary: 'Clarify the page heading and explain the existing design process.', reason: 'These are opportunities to help visitors understand the page.',
      nextStep: 'Review each task and publish only changes that fit your business.', evidenceIds: ['P1'], changedFields: [], fieldReasons: {}, targetPageUrl: null,
      strategy: { searchGoal: 'Help local businesses find website design services.', focusArea: 'headings', finding: 'opportunity_to_test',
        priorityReason: 'Clarifying the first heading is the main opportunity supported by this page.', limitation: 'This does not establish a cause of search performance or promise a ranking improvement.',
        checks: ['indexing', 'search_intent', 'content', 'headings', 'metadata', 'internal_links'].map(area => ({ area, status: area === 'headings' ? 'opportunity' : 'unknown',
          finding: area === 'headings' ? 'The existing service can be clearer in the heading.' : 'The available evidence does not establish an issue.', evidenceIds: area === 'headings' ? ['P1'] : [] })) },
      searchFocus: { phrase: 'website design for local businesses', relatedPhrases: [], intent: 'Find a business website design service.',
        reason: 'The page describes this service for local businesses.', source: 'proposed', evidenceIds: ['P1'], supportingQuote: 'We build useful websites for local businesses.', question: null } },
    diagnostics: { inspection: { status: 'unavailable', url, property, checkedAt: now }, facts: [], relatedPages: [], limitations: [] },
    timeline: [{ label: 'Check Google’s next visit', when: 'After 1–2 weeks', description: 'Check whether Google has visited again.' },
      { label: 'Look for early signals', when: 'Around 4 weeks', description: 'Allow for small samples.' },
      { label: 'Review the change', when: 'Around 8–12 weeks', description: 'Allow longer when search activity is sparse.' }],
    research: { status: 'unavailable', summary: '', sources: [], checkedAt: now, limitation: 'Public research is unavailable for this fixture.' } };
}

function planFor(url) {
  const review = reviewFor(url);
  return { id: createHash('sha256').update(url).digest('hex'), property, websiteRunId, pageUrl: url, revision: 1, createdAt: now, updatedAt: now, review,
    tasks: review.analysis.recommendations.map((recommendation, index) => ({ id: taskIds[index], status: 'todo', priority: index === 0 ? 'first' : index === 1 ? 'next' : 'optional',
      recommendation, facts: review.evidence.facts, sources: [], createdAt: now, reviewedAt: now, contentFingerprint: review.provenance.contentFingerprint,
      draft: null, metadataFields: [], retained: false })) };
}

function progressRecord(url, state = 'collecting') {
  const implementedAt = state === 'collecting' ? '2026-10-10T15:00:00.000Z' : '2026-08-01T15:00:00.000Z';
  return { id: `publication-${url === pageUrl ? 'first' : 'other'}`, pageUrl: url, property, gscProperty: property, websiteRunId, status: 'implemented', implementedAt, confirmationMethod: 'user-confirmed',
    changeType: 'page_content', pageChangeSummary: 'Published a clearer opening heading.', confirmedTaskIds: [taskIds[0]], confirmedTaskLabels: [labels[0]],
    assessment: { schemaVersion: 1, source: 'google_search_console', property, websiteRunId, pageUrl: url, implementedAt, state,
      reason: state === 'collecting' ? 'waiting_for_complete_post_window' : 'enough_search_activity',
      windows: { baseline: state === 'collecting' ? { startDate: '2026-09-12', endDate: '2026-10-09' } : { startDate: '2026-07-04', endDate: '2026-07-31' },
        post: state === 'collecting' ? { startDate: '2026-10-11', endDate: '2026-11-07' } : { startDate: '2026-08-02', endDate: '2026-08-29' }, ready: state === 'ready' },
      baseline: null, post: null, comparison: null }, canStartNextCycle: state === 'ready' };
}

function cycleFor(url, state = 'collecting') {
  return { id: createHash('sha256').update(`cycle:${url}`).digest('hex'), revision: 1, property, websiteRunId, pageUrl: url,
    confirmedAt: '2026-08-01T15:00:00.000Z', lifecycle: 'active', state, readOnly: false, canRecordInterveningChange: true,
    nextReviewAt: state === 'collecting' ? '2026-09-01' : '2026-09-29',
    confirmation: { taskIds: [taskIds[0]], taskLabels: [labels[0]], summary: 'Published a clearer opening heading.' },
    latestCheckpoint: state === 'collecting' ? null : { id: 'checkpoint-28', day: 28, lowVolume: false,
      windows: { baseline: { startDate: '2026-07-04', endDate: '2026-07-31' }, post: { startDate: '2026-08-02', endDate: '2026-08-29' } },
      baseline: { status: 'available', clicks: 12, impressions: 250, position: 18, fetchedAt: now }, post: { status: 'available', clicks: 18, impressions: 350, position: 14, fetchedAt: now } },
    latestDecision: null, technical: null, lastError: null };
}
function decisionFor(cycle, outcome = 'keep_monitoring') {
  return { id: 'fixture-decision', cycleId: cycle.id, pageUrl: cycle.pageUrl, outcome,
    summary: outcome === 'improve_page' ? 'Clarify the existing design process.' : outcome === 'gather_evidence' ? 'There is too little search activity to choose another change.' : 'The available evidence supports continued monitoring.',
    whatChanged: outcome === 'gather_evidence' ? 'Both reporting periods have limited search activity.' : 'The later period shows more reported search activity.',
    meaning: 'This is observed activity; it does not establish that the edit caused a change.',
    nextStep: outcome === 'improve_page' ? 'Review the process task below and publish it if it fits your service.' : 'Keep the current page while we collect the next reporting period.',
    reviewedAt: '2026-09-01T15:00:00.000Z', evidenceIds: ['P1'], proposedTasks: outcome === 'improve_page' ? [reviewFor(cycle.pageUrl).analysis.recommendations[1]] : [],
    acceptedAt: null, canAcceptTasks: outcome === 'improve_page' };
}

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'ongoing-ui-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  await app.firestore().doc(`onboarding/${uid}`).set({ name: 'Ongoing review fixture', websiteUrl: property, gscProperty: property,
    isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', revampRunId: websiteRunId, progressReviewRequired: false,
    revampPages: [{ url: pageUrl, searchDataStatus: 'has_data' }, { url: otherUrl, searchDataStatus: 'has_data' }] });
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
});

async function signIn(page) {
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('region', { name: 'Saved page tasks' })).toBeVisible({ timeout: 15000 });
}

async function setup(page, { state: status = 'collecting', outcome = 'keep_monitoring', saved = false, failAction, deferReview = false, enabled = true, configure } = {}) {
  const cycle = cycleFor(pageUrl, status);
  if (outcome === 'gather_evidence' && cycle.latestCheckpoint) Object.assign(cycle.latestCheckpoint, { lowVolume: true, baseline: { status: 'available', clicks: 0, impressions: 8, position: 22, fetchedAt: now }, post: { status: 'available', clicks: 1, impressions: 18, position: 19, fetchedAt: now } });
  const state = { cycle, history: [], plan: planFor(pageUrl), decision: saved ? decisionFor(cycle, outcome) : null,
    calls: { followups: [], publications: [], ai: [], taskUpdates: [], history: 0 }, errors: [], failed: false };
  state.plan.tasks[0] = { ...state.plan.tasks[0], status: 'done', publication: { implementationId: 'fixture-old', pageUrl, implementedAt: cycle.confirmedAt, changeType: 'page_content', confirmationMethod: 'user-confirmed' } };
  configure?.(state);
  const reviewReady = deferReview ? new Promise(resolve => { state.releaseReview = resolve; }) : Promise.resolve();
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === '/api/progress') return json({ records: enabled ? [] : [progressRecord(pageUrl)], history: [],
      ongoing: { enabled, records: enabled ? [state.cycle] : [], history: state.history, nextCursor: null } });
    if (url.pathname === '/api/dashboard/overview') return json({ source: 'google_search_console', property, window: evidenceFor(pageUrl).window,
      totals: { impressions: 30, clicks: 1 }, daily: [], pages: [pageUrl, otherUrl].map(url => ({ pageUrl: url, impressions: 30, clicks: 1 })), coverage: { pages: { limit: 100, returned: 2, complete: false } } });
    if (url.pathname === '/api/page-review/plan') {
      if (url.searchParams.has('history')) { state.calls.history++; return json({ history: [{ ...planFor(pageUrl), archivedAt: now }], nextCursor: null }); }
      if (route.request().method() === 'GET') return json({ plan: url.searchParams.get('pageUrl') === pageUrl ? state.plan : planFor(otherUrl) });
      state.calls.taskUpdates.push(route.request().postDataJSON()); return json({ plan: state.plan });
    }
    if (url.pathname === '/api/page-review/content') { const { pageUrl: target } = route.request().postDataJSON(); return json({ success: true, data: contentFor(target), provenance: reviewFor(target).provenance }); }
    if (url.pathname === '/api/page-review/activity') { const { pageUrl: target } = route.request().postDataJSON(); return json({ success: true, evidence: evidenceFor(target), provenance: reviewFor(target).provenance }); }
    if (url.pathname === '/api/page-review/suggestions') { state.calls.ai.push(route.request().postDataJSON()); return json({ ...state.plan.review, plan: state.plan }); }
    if (url.pathname === '/api/page-review/follow-up') {
      if (route.request().method() === 'GET') return json({ cycle: state.cycle, decision: state.decision });
      const body = route.request().postDataJSON(); state.calls.followups.push(body);
      if (failAction === body.action && !state.failed) { state.failed = true; return json({ error: 'The saved review changed. Reload before trying again.' }, 409); }
      if (body.action === 'review') { await reviewReady; state.decision = decisionFor(state.cycle, outcome); state.cycle = { ...state.cycle, revision: state.cycle.revision + 1, state: 'reviewed' }; }
      if (body.action === 'troubleshoot') state.cycle = { ...state.cycle, revision: state.cycle.revision + 1, technical: { checkedAt: now, publicPage: { status: 'available', checkedAt: now }, indexing: { status: 'available', coverageState: 'Submitted and indexed', checkedAt: now }, issues: [{ code: 'noindex', message: 'The live page declares noindex. Review this setting if the page should appear in Google.' }] } };
      if (body.action === 'accept_tasks') {
        state.decision = { ...state.decision, acceptedAt: now, canAcceptTasks: false };
        state.cycle = { ...state.cycle, revision: state.cycle.revision + 1 };
        state.plan = { ...state.plan, review: { ...state.plan.review, provenance: { ...state.plan.review.provenance, reviewVersion: 'follow_up_1' }, evidence: { ...state.plan.review.evidence, comparisonKind: 'confirmed_change', checkpointId: state.cycle.latestCheckpoint.id, history: [] } }, revision: state.plan.revision + 1, followUp: { cycleId: state.cycle.id, decisionId: state.decision.id }, archivedTasksAvailable: true };
      }
      return json({ cycle: state.cycle, decision: state.decision, ...(body.action === 'accept_tasks' ? { plan: state.plan } : {}) });
    }
    if (url.pathname === '/api/page-review/confirm') {
      const body = route.request().postDataJSON(); state.calls.publications.push(body);
      if (body.previousCycleId !== state.cycle.id || body.previousCycleRevision !== state.cycle.revision || body.interveningChange !== true) return json({ error: 'Reload the current tracking cycle.' }, 409);
      const record = { ...progressRecord(pageUrl), id: 'fixture-new', pageChangeSummary: body.changeSummary, confirmedTaskIds: body.taskIds || [], confirmedTaskLabels: (body.taskIds || []).map(id => state.plan.tasks.find(task => task.id === id).recommendation.label) };
      const publication = { implementationId: record.id, implementedAt: record.implementedAt, pageUrl, changeType: 'page_content', confirmationMethod: 'user-confirmed' };
      state.plan = { ...state.plan, revision: state.plan.revision + 1, tasks: state.plan.tasks.map(task => body.taskIds?.includes(task.id) ? { ...task, status: 'done', publication } : task) };
      state.history.push({ ...state.cycle, lifecycle: 'superseded' }); state.cycle = { ...cycleFor(pageUrl), id: 'fixture-new-cycle', confirmedAt: record.implementedAt, confirmation: { taskIds: record.confirmedTaskIds, taskLabels: record.confirmedTaskLabels, summary: body.changeSummary } }; state.decision = null;
      return json({ record, plan: state.plan });
    }
    return json({ keywords: [], pages: [], tips: [], suggestions: [], conversations: [], data: [], success: true });
  });
  await signIn(page);
  if (enabled) await expect(page.getByText('Loading your saved review…', { exact: true })).toHaveCount(0);
  return state;
}
const card = page => page.getByRole('region', { name: 'Ongoing progress for /Case/?City=A', exact: true });
async function captureFixture(page, name) {
  const style = await page.addStyleTag({ content: 'header, [class*="fixed bottom-"], nextjs-portal { visibility: hidden !important; }' });
  await card(page).evaluate(element => {
    const label = document.createElement('p'); label.dataset.fixtureLabel = 'true';
    label.textContent = 'Isolated example — no live account data';
    label.style.cssText = 'padding:10px;border:1px solid #6b7280;border-radius:6px;font-size:12px;font-weight:600;';
    element.prepend(label);
  });
  await card(page).screenshot({ path: `/private/tmp/simpleseo-phase7-preview-${name}.png`, animations: 'disabled' });
  await card(page).locator('[data-fixture-label]').evaluate(element => element.remove());
  await style.evaluate(element => element.remove());
}

test('collecting shows a clear date and collapsed changes without generating a review', async ({ page }) => {
  const state = await setup(page);
  await expect(card(page).getByRole('heading', { name: 'Collecting search data' })).toBeVisible();
  await expect(card(page).getByText('First comparison check: Sep 1, 2026')).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Review my results' })).toHaveCount(0);
  const changes = card(page).getByText('Published changes (1)', { exact: true });
  await changes.focus(); await page.keyboard.press('Enter');
  await expect(card(page).getByText(labels[0], { exact: true })).toBeVisible();
  await changes.press('Enter');
  await captureFixture(page, 'collecting');
  await page.screenshot({ path: '/private/tmp/simpleseo-phase7-collecting-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/simpleseo-phase7-collecting-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.ai).toHaveLength(0); expect(state.calls.publications).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test('completed comparison reviews once and restores the saved decision across refresh and sign-in', async ({ page }) => {
  const state = await setup(page, { state: 'review_due' });
  await card(page).getByRole('button', { name: 'Review my results', exact: true }).click();
  await expect(card(page).getByRole('heading', { name: 'Keep monitoring this page' })).toBeVisible();
  await captureFixture(page, 'monitoring');
  expect(state.calls.followups).toEqual([{ cycleId: state.cycle.id, expectedRevision: 1, action: 'review' }]);
  expect(state.cycle.confirmedAt).toBe('2026-08-01T15:00:00.000Z'); expect(state.cycle.lifecycle).toBe('active');
  await page.reload(); await expect(card(page).getByText('What it means', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await signIn(page); await expect(card(page).getByRole('heading', { name: 'Keep monitoring this page' })).toBeVisible();
  expect(state.calls.followups).toHaveLength(1); expect(state.calls.ai).toHaveLength(0); expect(state.calls.publications).toHaveLength(0);
});

test('inconclusive review keeps dated observations available without promising results', async ({ page }) => {
  const state = await setup(page, { state: 'reviewed', saved: true, outcome: 'gather_evidence' });
  state.cycle.latestCheckpoint.lowVolume = true;
  await page.reload();
  await expect(card(page).getByRole('heading', { name: 'More evidence is needed' })).toBeVisible();
  await captureFixture(page, 'inconclusive');
  await card(page).getByText('View dated search results', { exact: true }).click();
  await expect(card(page).getByText('This period is inconclusive.', { exact: false })).toBeVisible();
  await expect(card(page).getByRole('cell', { name: '18', exact: true })).toHaveCount(1);
  await page.screenshot({ path: '/private/tmp/simpleseo-phase7-inconclusive-desktop.png', fullPage: true });
  expect(state.calls.followups).toHaveLength(0);
});

test('early troubleshooting only runs diagnostics and does not change the publication date', async ({ page }) => {
  const state = await setup(page);
  await card(page).getByRole('button', { name: 'Something seems wrong' }).click();
  await expect(card(page).getByText('The live page declares noindex.', { exact: false })).toBeVisible();
  expect(state.calls.followups[0].action).toBe('troubleshoot');
  expect(state.cycle.confirmedAt).toBe('2026-08-01T15:00:00.000Z'); expect(state.cycle.lifecycle).toBe('active');
  expect(state.calls.ai).toHaveLength(0); expect(state.calls.publications).toHaveLength(0);
});

test('failed updates preserve the previous decision and dated observations', async ({ page }) => {
  const state = await setup(page, { state: 'reviewed', saved: true, failAction: 'review' });
  await card(page).getByRole('button', { name: 'Check this review for updates' }).click();
  await expect(card(page).getByRole('alert')).toContainText('Reload before trying again');
  await expect(card(page).getByText('What it means', { exact: true })).toBeVisible();
  await card(page).getByText('Why this recommendation?', { exact: true }).click();
  await expect(card(page).getByText('The later period shows more reported search activity.', { exact: true })).toBeVisible();
  await card(page).getByRole('button', { name: 'Reload saved review' }).click();
  await expect(card(page).getByRole('alert')).toHaveCount(0);
  expect(state.calls.followups).toHaveLength(1); expect(state.cycle.revision).toBe(1);
});

test('accepting justified next tasks keeps tracking active and makes earlier full task lists readable', async ({ page }) => {
  const state = await setup(page, { state: 'reviewed', saved: true, outcome: 'improve_page' });
  await captureFixture(page, 'actionable');
  await card(page).getByRole('button', { name: 'Use these next tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Your next published edits' })).toBeVisible();
  expect(state.calls.followups[0]).toMatchObject({ action: 'accept_tasks', expectedRevision: 1, expectedPlanRevision: 1, decisionId: 'fixture-decision' });
  expect(state.cycle.confirmedAt).toBe('2026-08-01T15:00:00.000Z'); expect(state.calls.publications).toHaveLength(0);
  await page.getByText('Earlier task lists', { exact: true }).click();
  expect(state.calls.history).toBe(0);
  await page.getByRole('button', { name: 'Load earlier tasks' }).click();
  await page.getByText('Tasks saved Oct 10, 2026', { exact: true }).click();
  await expect(page.getByText('Read-only tasks saved before a later review.', { exact: false })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Your next published edits' })).toBeVisible();
  expect(state.calls.followups).toHaveLength(1); expect(state.calls.publications).toHaveLength(0);
});

test('additional selected edits require an explicit warning and cancellation changes nothing', async ({ page }) => {
  const state = await setup(page);
  await card(page).getByRole('button', { name: 'Record another published edit' }).click();
  await page.getByRole('article', { name: labels[1], exact: true }).getByRole('checkbox', { name: 'I published this edit' }).check();
  await page.getByRole('button', { name: 'Start tracking published edits' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Another published edit starts a new tracking cycle today');
  await expect(dialog.getByRole('button', { name: 'Yes, start tracking' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Not yet' }).click();
  expect(state.calls.publications).toHaveLength(0); expect(state.cycle.revision).toBe(1);
  await page.getByRole('button', { name: 'Back to monitoring' }).click();
  await expect(page.getByRole('heading', { name: 'Your next published edits' })).toHaveCount(0);
});

test('an owner-confirmed additional edit creates new tracking and preserves the previous cycle', async ({ page }) => {
  const state = await setup(page);
  const prior = state.cycle.id;
  await card(page).getByRole('button', { name: 'Record another published edit' }).click();
  await page.getByRole('article', { name: labels[1], exact: true }).getByRole('checkbox', { name: 'I published this edit' }).check();
  await page.getByRole('button', { name: 'Start tracking published edits' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'I confirm these edits are live on this exact page.' }).check();
  await dialog.getByRole('button', { name: 'Yes, start tracking', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.calls.publications[0]).toMatchObject({ previousCycleId: prior, previousCycleRevision: 1, interveningChange: true, taskIds: [taskIds[1]] });
  await page.getByText('Previous published changes (1)', { exact: true }).click();
  await expect(page.getByText('Saved history. Later edits are tracked separately.', { exact: true })).toBeVisible();
  expect(state.history[0].confirmedAt).toBe('2026-08-01T15:00:00.000Z');
  expect(state.calls.followups).toHaveLength(0);
});

test('an external published edit uses owner wording and the same cycle confirmation boundary', async ({ page }) => {
  const state = await setup(page);
  await card(page).getByRole('button', { name: 'Record another published edit' }).click();
  await page.getByText('Published a different edit?', { exact: true }).click();
  await page.getByLabel('What did you actually publish?', { exact: true }).fill('Fixed an accidental noindex setting in my website editor.');
  await page.getByRole('button', { name: 'Review this published edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Is this additional edit live?' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Yes, track this additional edit' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.calls.publications[0]).toMatchObject({ previousCycleRevision: 1, interveningChange: true, changeSummary: 'Fixed an accidental noindex setting in my website editor.' });
  expect(state.calls.publications[0].taskIds).toBeUndefined();
});

test('switching pages discards a slow follow-up response and does not show another page’s review', async ({ page }) => {
  const state = await setup(page, { state: 'review_due', deferReview: true });
  await card(page).getByRole('button', { name: 'Review my results' }).click();
  await expect(card(page).getByText('Reviewing the evidence for this page…', { exact: true })).toBeVisible();
  await page.getByLabel('Choose a page to improve').selectOption(otherUrl);
  state.releaseReview();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText('What changed', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Saved page tasks' })).toBeVisible();
  expect(state.calls.publications).toHaveLength(0); expect(state.errors).toEqual([]);
});

test('feature-off accounts retain the legacy tracking flow without follow-up calls', async ({ page }) => {
  const state = await setup(page, { enabled: false });
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Collecting search data', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Something seems wrong' })).toHaveCount(0);
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.ai).toHaveLength(0);
});

test('a newer checkpoint marks the previous decision as history until explicitly reviewed', async ({ page }) => {
  const state = await setup(page, { state: 'review_due', saved: true, outcome: 'improve_page' });
  await expect(card(page).getByRole('heading', { name: 'New results ready to review' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Review my results', exact: true })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Use these next tasks' })).toHaveCount(0);
  await expect(card(page).getByText('What it means', { exact: true })).not.toBeVisible();
  await card(page).getByText('Previous review · Sep 1, 2026', { exact: true }).click();
  await expect(card(page).getByText('This earlier recommendation has not been reassessed', { exact: false })).toBeVisible();
  await card(page).getByRole('button', { name: 'Review my results', exact: true }).click();
  await expect(card(page).getByRole('button', { name: 'Use these next tasks' })).toBeVisible();
  expect(state.calls.followups).toHaveLength(1);
});

test('technical checks explain missing pages and link only to validated Google inspection', async ({ page }) => {
  const state = await setup(page);
  state.cycle.technical = { checkedAt: now, publicPage: { status: 'unavailable', httpStatus: 404, checkedAt: now }, indexing: { status: 'available', checkedAt: now, coverageState: 'Not indexed', inspectionUrl: `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(property)}&id=fixture` }, issues: [{ code: 'not_found', message: 'This page returned a not-found response. Check the live address.' }] };
  await page.reload();
  await expect(card(page).getByText('Website check: Page not found (404)', { exact: false })).toBeVisible();
  await expect(card(page).getByRole('link', { name: 'Open Google inspection' })).toHaveAttribute('href', state.cycle.technical.indexing.inspectionUrl);
  state.cycle.technical.indexing.inspectionUrl = 'https://example.test/search-console/inspect';
  await page.reload();
  await expect(card(page).getByRole('link', { name: 'Open Google inspection' })).toHaveCount(0);
  expect(state.calls.followups).toHaveLength(0);
});

test('a lost Google connection keeps dated results and provides a reconnect link', async ({ page }) => {
  const state = await setup(page, { state: 'reviewed', saved: true });
  state.cycle = { ...state.cycle, state: 'error', lastError: { checkedAt: now, connection: 'reconnect_required' } };
  await page.reload();
  await expect(card(page).getByRole('link', { name: 'Reconnect Google in website setup' })).toHaveAttribute('href', '/revamp');
  await card(page).getByText('View dated search results', { exact: true }).click();
  await expect(card(page).getByRole('table')).toBeVisible();
  await expect(card(page).getByText('What it means', { exact: true })).toBeVisible();
  expect(state.calls.followups).toHaveLength(0);
});

test('a saved follow-up with overlapping comparison windows cannot enable publication', async ({ page }) => {
  const state = await setup(page, { state: 'reviewed', saved: true, outcome: 'improve_page' });
  await card(page).getByRole('button', { name: 'Use these next tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Your next changes', exact: true })).toBeFocused();
  expect(state.plan.review.provenance.reviewVersion).toBe('follow_up_1');
  state.plan.review.evidence.previousWindow = state.plan.review.evidence.window;
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'The saved tasks for this exact page could not be verified' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start tracking published edits' })).toHaveCount(0);
  expect(state.calls.publications).toHaveLength(0);
});

test('checking progress restores a newer saved decision from another session without another analysis', async ({ page }) => {
  const state = await setup(page, { state: 'reviewed', saved: true });
  state.decision = { ...decisionFor(state.cycle, 'gather_evidence'), id: 'newer-saved-decision', summary: 'Another reporting period needs more evidence.' };
  state.cycle = { ...state.cycle, revision: 2, latestDecision: state.decision };
  await page.getByRole('button', { name: 'Check progress', exact: true }).click();
  await expect(card(page).getByText('Another reporting period needs more evidence.', { exact: true })).toBeVisible();
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.ai).toHaveLength(0);
});

test('a publication recorded in another session clears local edit selection and reloads the saved task list', async ({ page }) => {
  const state = await setup(page);
  await card(page).getByRole('button', { name: 'Record another published edit' }).click();
  await page.getByRole('article', { name: labels[1], exact: true }).getByRole('checkbox', { name: 'I published this edit' }).check();
  state.cycle = { ...state.cycle, id: createHash('sha256').update('another-session-cycle').digest('hex'), confirmedAt: now };
  state.plan = { ...state.plan, revision: 2, tasks: state.plan.tasks.map(task => task.id === taskIds[1] ? { ...task, status: 'done', publication: { implementationId: 'another-session', pageUrl, implementedAt: now, changeType: 'page_content', confirmationMethod: 'user-confirmed' } } : task) };
  await page.getByRole('button', { name: 'Check progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next published edits' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start tracking published edits' })).toHaveCount(0);
  await page.getByText('Completed and dismissed (2)', { exact: true }).click();
  await expect(page.getByRole('article', { name: labels[1], exact: true })).toBeVisible();
  expect(state.calls.publications).toHaveLength(0);
});

// The visual overview uses historical, labeled fixtures with a fixed clock.
// No metric is derived from a live customer account and no AI endpoint is used.
const metricCard = (page, name) => card(page).getByRole('article', { name, exact: true });
const observed = '2026-09-01T15:00:00.000Z';
function datedCheckpoint(state, before = {}, after = {}) {
  state.cycle.latestCheckpoint.baseline = { ...state.cycle.latestCheckpoint.baseline, ...before, fetchedAt: observed };
  state.cycle.latestCheckpoint.post = { ...state.cycle.latestCheckpoint.post, ...after, fetchedAt: observed };
}

test('visual collecting progress gives accessible elapsed time without pretending results exist', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-15T15:00:00.000Z'));
  const state = await setup(page);
  const bar = card(page).getByRole('progressbar', { name: 'Time until next comparison', exact: true });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-valuemin', '0');
  await expect(bar).toHaveAttribute('aria-valuemax', '100');
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeLessThan(100);
  await expect(card(page).getByText('14 days since your changes', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Clicks')).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Review my results', exact: true })).toHaveCount(0);
  await captureFixture(page, 'collecting');
  await page.reload();
  await expect(card(page).getByText('14 days since your changes', { exact: true })).toBeVisible();
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.ai).toHaveLength(0); expect(state.calls.publications).toHaveLength(0);
});

test('visual result cards show gains and lower-is-better position before any AI review', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-01T15:00:00.000Z'));
  const state = await setup(page, { state: 'review_due', configure: value => datedCheckpoint(value, { clicks: 12, impressions: 250, position: 18 }, { clicks: 15, impressions: 350, position: 13 }) });
  for (const name of ['Clicks', 'Appearances in search', 'Average position']) await expect(metricCard(page, name)).toBeVisible();
  await expect(metricCard(page, 'Clicks').getByText('previously 12', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Clicks').getByText('15', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Clicks')).toContainText('3 more clicks');
  await expect(metricCard(page, 'Average position')).toContainText('5 positions better');
  await expect(card(page).getByText('Comparing two 28-day periods', { exact: true })).toBeVisible();
  await expect(card(page).getByText(/Before: Jul 4, 2026.*Jul 31, 2026/).first()).toBeVisible();
  await expect(card(page).getByRole('table')).not.toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Review my results', exact: true })).toBeVisible();
  await captureFixture(page, 'improving');
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.ai).toHaveLength(0); expect(state.calls.publications).toHaveLength(0);
});

test('visual result cards make declines and a worse position understandable without color alone', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-01T15:00:00.000Z'));
  const state = await setup(page, { state: 'review_due', configure: value => datedCheckpoint(value, { clicks: 18, impressions: 350, position: 13 }, { clicks: 12, impressions: 250, position: 18 }) });
  await expect(metricCard(page, 'Clicks')).toContainText('6 fewer clicks');
  await expect(metricCard(page, 'Appearances in search')).toContainText(/100 fewer/);
  await expect(metricCard(page, 'Average position')).toContainText('5 positions worse');
  await expect(metricCard(page, 'Average position').getByText('previously 13', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Average position').getByText('18', { exact: true })).toBeVisible();
  await captureFixture(page, 'declining');
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.publications).toHaveLength(0);
});

test('visual metrics distinguish genuine zero activity from unavailable observations', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-01T15:00:00.000Z'));
  const state = await setup(page, { state: 'review_due', configure: value => datedCheckpoint(value,
    { status: 'no_data', clicks: 0, impressions: 0, position: null }, { status: 'no_data', clicks: 0, impressions: 0, position: null }) });
  await expect(metricCard(page, 'Clicks').getByText('0', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Clicks').getByText('previously 0', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Appearances in search').getByText('0', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Appearances in search').getByText('previously 0', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Average position')).toContainText('—');
  expect(await metricCard(page, 'Clicks').innerText()).not.toMatch(/Infinity|NaN|more clicks|fewer clicks/);
  state.cycle.latestCheckpoint.post = { status: 'unavailable', clicks: null, impressions: null, position: null, fetchedAt: observed };
  // The collector also flags unavailable checkpoints as lowVolume. That flag
  // cannot turn a failed observation into evidence of low traffic.
  state.cycle.latestCheckpoint.lowVolume = true;
  await page.reload();
  await expect(metricCard(page, 'Clicks').getByText('0', { exact: true })).toHaveCount(0);
  await expect(metricCard(page, 'Clicks').getByText('previously 0', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Clicks')).toContainText('—');
  await expect(card(page).getByText('A small amount of activity so far. More time will help confirm the direction.', { exact: true })).toHaveCount(0);
  await expect(card(page).getByText('Some numbers aren’t available yet. Missing data doesn’t mean zero traffic.', { exact: true })).toBeVisible();
  expect(await metricCard(page, 'Clicks').innerText()).not.toMatch(/more clicks|fewer clicks|100%/);
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.ai).toHaveLength(0);
});

test('visual low-volume overview stays cautious and accessible on mobile with saved restoration', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-01T15:00:00.000Z'));
  const state = await setup(page, { state: 'reviewed', saved: true, outcome: 'gather_evidence', configure: value => datedCheckpoint(value) });
  await expect(card(page).getByText('A small amount of activity so far. More time will help confirm the direction.', { exact: true })).toBeVisible();
  await expect(metricCard(page, 'Clicks')).toContainText('1 more click');
  await captureFixture(page, 'inconclusive');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Clicks', 'Appearances in search', 'Average position']) await expect(metricCard(page, name)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const reasoning = card(page).getByText('Why this recommendation?', { exact: true });
  await reasoning.focus(); await page.keyboard.press('Enter');
  await expect(card(page).getByText('Both reporting periods have limited search activity.', { exact: true })).toBeVisible();
  await reasoning.press('Enter');
  await captureFixture(page, 'inconclusive-mobile');
  await page.reload();
  await expect(metricCard(page, 'Clicks')).toContainText('1 more click');
  await expect(card(page).getByText('Both reporting periods have limited search activity.', { exact: true })).not.toBeVisible();
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.ai).toHaveLength(0); expect(state.calls.publications).toHaveLength(0);
});

test('visual progress at its expected date waits for actual collection instead of claiming readiness', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-05T15:00:00.000Z'));
  const state = await setup(page);
  await expect(card(page).getByRole('progressbar', { name: 'Time until next comparison' })).toHaveAttribute('aria-valuenow', '100');
  await expect(card(page).getByText('Waiting for the latest search data', { exact: true })).toBeVisible();
  await expect(card(page).getByRole('heading', { name: 'New results ready to review', exact: true })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Review my results', exact: true })).toHaveCount(0);
  await expect(metricCard(page, 'Clicks')).toHaveCount(0);
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.ai).toHaveLength(0);
});

test('visual results remain dated and readable when a later collection fails', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-29T15:00:00.000Z'));
  const state = await setup(page, { state: 'reviewed', saved: true, configure: value => {
    datedCheckpoint(value); value.cycle.state = 'error'; value.cycle.lastError = { checkedAt: '2026-09-29T12:00:00.000Z', source: 'google_search_console' };
  } });
  await expect(card(page).getByText('A recent check could not finish.', { exact: false })).toBeVisible();
  await expect(metricCard(page, 'Clicks').getByText('18', { exact: true })).toBeVisible();
  await expect(card(page).getByText(/After: Aug 2, 2026.*Aug 29, 2026/).first()).toBeVisible();
  await expect(card(page).getByText('What it means', { exact: true })).toBeVisible();
  await page.reload();
  await expect(metricCard(page, 'Clicks').getByText('18', { exact: true })).toBeVisible();
  expect(state.calls.followups).toHaveLength(0); expect(state.calls.publications).toHaveLength(0);
});
