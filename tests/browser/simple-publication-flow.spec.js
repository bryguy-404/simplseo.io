const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

// Browser-only fixtures. Publication and cycle endpoints are mocked here;
// their real transaction/authorization guards are covered by server tests.
const uid = 'simple-publication-alice';
const property = 'https://example.test/';
const pageUrl = `${property}Case/?City=A`;
const otherUrl = `${property}case/?City=a`;
const websiteRunId = 'simple-publication-run';
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

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'simple-publication-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  const previous = await app.firestore().collection('implementedSeoTips').where('userId', '==', uid).get();
  const cleanup = app.firestore().batch(); previous.docs.forEach(snapshot => cleanup.delete(snapshot.ref)); await cleanup.commit();
  await app.firestore().doc(`onboarding/${uid}`).set({ name: 'Publication test', websiteUrl: property, gscProperty: property,
    isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', revampRunId: websiteRunId, progressReviewRequired: false,
    revampPages: [{ url: pageUrl, searchDataStatus: 'has_data' }, { url: otherUrl, searchDataStatus: 'has_data' }] });
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
});

async function setup(page, { active = null, failFirstPublication = false, failFirstCycle = false, deferProgress = false } = {}) {
  const state = { plans: new Map([[pageUrl, planFor(pageUrl)], [otherUrl, planFor(otherUrl)]]), active, history: [],
    calls: { generations: [], publications: [], taskUpdates: [], nextCycles: [], progress: [] }, failed: false, cycleFailed: false, browserErrors: [] };
  page.on('pageerror', error => state.browserErrors.push(error.message));
  const progressReady = deferProgress ? new Promise(resolve => { state.releaseProgress = resolve; }) : Promise.resolve();
  if (active) {
    const plan = state.plans.get(active.pageUrl);
    plan.tasks[0] = { ...plan.tasks[0], status: 'done', publication: { implementationId: active.id, pageUrl: active.pageUrl, implementedAt: active.implementedAt, changeType: 'page_content', confirmationMethod: 'user-confirmed' } };
  }
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === '/api/progress') {
      state.calls.progress.push(route.request().method());
      await progressReady;
      return json({ schemaVersion: 1, source: 'google_search_console', property, websiteRunId, paused: false, records: state.active ? [state.active] : [], history: state.history,
        policy: { minImpressionsPerWindow: 100, minCombinedClicks: 10 }, notificationsEnabled: false, automaticOutcomesEnabled: false });
    }
    if (url.pathname === '/api/dashboard/overview') return json({ source: 'google_search_console', property, window: evidenceFor(pageUrl).window,
      totals: { impressions: 30, clicks: 1 }, daily: [], pages: [pageUrl, otherUrl].map(url => ({ pageUrl: url, impressions: 30, clicks: 1 })), coverage: { pages: { limit: 100, returned: 2, complete: false } } });
    if (url.pathname === '/api/page-review/plan') {
      if (route.request().method() === 'GET') return json({ plan: state.plans.get(url.searchParams.get('pageUrl')) || null });
      const body = route.request().postDataJSON(); state.calls.taskUpdates.push(body);
      const plan = state.plans.get(body.pageUrl);
      if (!plan || plan.revision !== body.revision) return json({ error: 'The saved task list changed. Reload it.' }, 409);
      const updated = { ...plan, revision: plan.revision + 1, tasks: plan.tasks.map(task => task.id === body.taskId ? { ...task, status: body.status } : task) };
      state.plans.set(body.pageUrl, updated); return json({ plan: updated });
    }
    if (url.pathname === '/api/page-review/content') {
      const { pageUrl: url } = route.request().postDataJSON();
      return json({ success: true, data: contentFor(url), provenance: reviewFor(url).provenance });
    }
    if (url.pathname === '/api/page-review/activity') {
      const { pageUrl: url } = route.request().postDataJSON();
      return json({ success: true, evidence: evidenceFor(url), provenance: reviewFor(url).provenance });
    }
    if (url.pathname === '/api/page-review/suggestions') {
      const body = route.request().postDataJSON(); state.calls.generations.push(body);
      const plan = state.plans.get(body.pageUrl); return json({ ...plan.review, plan });
    }
    if (url.pathname === '/api/page-review/confirm') {
      const body = route.request().postDataJSON(); state.calls.publications.push(body);
      if (failFirstPublication && !state.failed) { state.failed = true; return json({ error: 'Test publication save unavailable.' }, 503); }
      const plan = state.plans.get(body.pageUrl);
      if (!plan || body.planRevision !== plan.revision) return json({ error: 'The saved task list changed. Reload it.' }, 409);
      const record = { ...progressRecord(body.pageUrl), pageChangeSummary: body.changeSummary, confirmedTaskIds: body.taskIds,
        confirmedTaskLabels: plan.tasks.filter(task => body.taskIds.includes(task.id)).map(task => task.recommendation.label), sourcePlanId: plan.id, sourcePlanRevision: plan.revision };
      const publication = { implementationId: record.id, implementedAt: record.implementedAt, pageUrl: body.pageUrl, changeType: 'page_content', confirmationMethod: 'user-confirmed' };
      const updated = { ...plan, revision: plan.revision + 1, tasks: plan.tasks.map(task => body.taskIds.includes(task.id) ? { ...task, status: 'done', publication } : task) };
      state.plans.set(body.pageUrl, updated); state.active = record;
      return json({ record, plan: updated, alreadyConfirmed: false });
    }
    if (url.pathname === '/api/page-review/cycle') {
      const body = route.request().postDataJSON(); state.calls.nextCycles.push(body);
      if (failFirstCycle && !state.cycleFailed) { state.cycleFailed = true; return json({ error: 'Test next review unavailable.' }, 503); }
      if (!state.active?.canStartNextCycle || state.active.pageUrl !== body.pageUrl) return json({ error: 'This comparison is still collecting data.' }, 409);
      const previous = { ...state.active, status: 'reviewed' };
      state.history.push(previous); state.active = null;
      return json({ success: true, pageUrl: previous.pageUrl, implementedAt: previous.implementedAt, record: previous, alreadyReviewed: false });
    }
    return json({ keywords: [], pages: [], tips: [], suggestions: [], conversations: [], data: [], success: true });
  });
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('region', { name: 'Saved page tasks' })).toBeVisible({ timeout: 15000 });
  return state;
}

const tasksFor = page => page.getByRole('region', { name: 'Saved page tasks' });
const taskFor = (page, index) => tasksFor(page).getByRole('article', { name: labels[index], exact: true });
const checkboxFor = (page, index) => taskFor(page, index).getByRole('checkbox', { name: 'I published this edit', exact: true });
const publishButton = page => page.getByRole('region', { name: 'Confirm published edits' }).getByRole('button', { name: 'Start tracking published edits', exact: true });

async function capture(page, name, modal = false) {
  if (!modal) await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `test-results/${name}`, fullPage: !modal, animations: 'disabled' });
}

async function openTask(page, index) {
  const details = taskFor(page, index).locator(':scope > details');
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
}

test('selecting edits and cancelling publication does not write tasks, start tracking, or spend another analysis', async ({ page }) => {
  const state = await setup(page);
  await expect(publishButton(page)).toBeDisabled();
  await expect(checkboxFor(page, 0)).toBeEnabled();
  await capture(page, 'simple-publication-tasks-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'simple-publication-tasks-mobile.png');
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(taskFor(page, 2).getByRole('checkbox')).toHaveCount(0);
  await checkboxFor(page, 0).check();
  await expect(publishButton(page)).toBeEnabled();
  expect(state.plans.get(pageUrl).tasks.every(task => task.status === 'todo')).toBe(true);
  expect(state.active).toBeNull();
  expect(state.calls.taskUpdates).toHaveLength(0);
  expect(state.calls.publications).toHaveLength(0);
  expect(state.calls.generations).toHaveLength(0);

  await publishButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Are these changes live on your website?' });
  await expect(dialog.getByRole('link')).toHaveAttribute('href', pageUrl);
  await expect(dialog.getByRole('listitem').filter({ hasText: labels[0] })).toHaveText(labels[0]);
  await expect(dialog.getByText(labels[1], { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Yes, start tracking', exact: true })).toBeDisabled();
  await capture(page, 'simple-publication-dialog-desktop.png', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'simple-publication-dialog-mobile.png', true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByRole('button', { name: 'Not yet', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(checkboxFor(page, 0)).toBeChecked();
  expect(state.calls.taskUpdates).toHaveLength(0);
  expect(state.calls.publications).toHaveLength(0);
  expect(state.calls.generations).toHaveLength(0);
  expect((await app.firestore().collection('implementedSeoTips').where('userId', '==', uid).get()).empty).toBe(true);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Switch to light mode', exact: true }).press('Space');
  await expect(page.getByRole('heading', { name: 'Improve a page', exact: true })).toHaveCSS('color', await page.locator('body').evaluate(element => getComputedStyle(element).color));
  await capture(page, 'simple-publication-tasks-light.png');
  await publishButton(page).click();
  await capture(page, 'simple-publication-dialog-light.png', true);
  await dialog.getByRole('button', { name: 'Not yet', exact: true }).click();
  expect(state.calls.publications).toHaveLength(0);

  // Completing an investigation updates only its checklist status.
  await openTask(page, 2);
  await taskFor(page, 2).getByRole('button', { name: 'Mark check complete', exact: true }).click();
  await expect.poll(() => state.calls.taskUpdates.length).toBe(1);
  expect(state.calls.taskUpdates[0]).toMatchObject({ pageUrl, taskId: taskIds[2], status: 'done' });
  expect(state.calls.publications).toHaveLength(0);
  expect(state.active).toBeNull();
});

test('a failed publication preserves the selected edit; retry confirms only that task and restores collecting state', async ({ page }) => {
  const state = await setup(page, { failFirstPublication: true });
  await expect(checkboxFor(page, 0)).toBeEnabled();
  await checkboxFor(page, 0).check();
  await publishButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Are these changes live on your website?' });
  await dialog.getByRole('textbox', { name: 'What did you publish?', exact: true }).fill('Published a clearer opening heading for the existing design service.');
  await dialog.getByRole('checkbox', { name: 'I confirm these edits are live on this exact page.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Yes, start tracking', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Test publication save unavailable.');
  // The modal correctly hides the workspace from the accessibility tree.
  await expect(page.locator(`article[aria-label="${labels[0]}"] [role="checkbox"]`)).toHaveAttribute('aria-checked', 'true');
  expect(state.active).toBeNull();
  expect(state.plans.get(pageUrl).tasks.map(task => task.status)).toEqual(['todo', 'todo', 'todo']);
  expect(state.calls.taskUpdates).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Yes, start tracking', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collecting search data', exact: true })).toBeVisible();
  await expect(page.getByText('First comparison check: Nov 10, 2026', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Confirm published edits' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  expect(state.calls.publications).toHaveLength(2);
  expect(state.calls.publications[1]).toEqual(state.calls.publications[0]);
  expect(state.calls.publications[1]).toMatchObject({ pageUrl, changeType: 'page_content', published: true, taskIds: [taskIds[0]], planRevision: 1 });
  expect(state.plans.get(pageUrl).tasks.map(task => task.status)).toEqual(['done', 'todo', 'todo']);
  expect(state.plans.get(otherUrl).tasks.every(task => task.status === 'todo')).toBe(true);
  const implementedAt = state.active.implementedAt;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Collecting search data', exact: true })).toBeVisible({ timeout: 15000 });
  expect(state.browserErrors).toEqual([]);
  await expect(page.getByRole('button', { name: 'Start another review', exact: true })).toHaveCount(0);
  expect(state.active.implementedAt).toBe(implementedAt);
  expect(state.calls.publications).toHaveLength(2);
  expect(state.calls.generations).toHaveLength(0);
  await tasksFor(page).getByText('Completed and dismissed (1)', { exact: true }).click();
  await expect(taskFor(page, 0).getByText('Published', { exact: true })).toBeVisible();
  await capture(page, 'simple-publication-collecting-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(element => element.clientWidth));
  await capture(page, 'simple-publication-collecting-mobile.png');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Switch to light mode', exact: true }).press('Space');
  await expect(page.getByRole('heading', { name: 'Improve a page', exact: true })).toHaveCSS('color', await page.locator('body').evaluate(element => getComputedStyle(element).color));
  await capture(page, 'simple-publication-collecting-light.png');
});

test('restored tracking belongs only to the exact selected page and does not block another page', async ({ page }) => {
  const state = await setup(page, { active: progressRecord(pageUrl) });
  await expect(page.getByRole('heading', { name: 'Collecting search data', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Confirm published edits' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: /^Choose a page to improve/ }).selectOption(otherUrl);
  await expect(page.getByRole('heading', { name: 'Collecting search data', exact: true })).toHaveCount(0);
  await expect(checkboxFor(page, 0)).toBeEnabled();
  await expect(checkboxFor(page, 0)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
  await checkboxFor(page, 0).check();
  await page.getByRole('combobox', { name: /^Choose a page to improve/ }).selectOption(pageUrl);
  await expect(page.getByRole('heading', { name: 'Collecting search data', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: /^Choose a page to improve/ }).selectOption(otherUrl);
  await expect(checkboxFor(page, 0)).not.toBeChecked();
  expect(state.calls.generations).toHaveLength(0);
  expect(state.calls.publications).toHaveLength(0);
  expect(state.calls.nextCycles).toHaveLength(0);
  expect(state.plans.get(otherUrl).tasks.every(task => task.status === 'todo')).toBe(true);
});

test('a completed comparison can start another review without losing published tasks or generating automatically', async ({ page }) => {
  const previous = progressRecord(pageUrl, 'ready');
  const state = await setup(page, { active: previous, failFirstCycle: true });
  await expect(page.getByRole('heading', { name: 'Comparison available', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start another review', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Test next review unavailable.' })).toBeVisible();
  expect(state.active).toBe(previous);
  expect(state.history).toHaveLength(0);
  expect(state.calls.generations).toHaveLength(0);
  await page.getByRole('button', { name: 'Start another review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
  expect(state.calls.nextCycles).toEqual([{ pageUrl, implementedAt: previous.implementedAt }, { pageUrl, implementedAt: previous.implementedAt }]);
  expect(state.history).toEqual([{ ...previous, status: 'reviewed' }]);
  expect(state.calls.generations).toHaveLength(0);
  expect(state.calls.publications).toHaveLength(0);
  await page.getByText('Previous comparisons (1)', { exact: true }).click();
  const history = page.getByRole('article', { name: 'Previous comparison for /Case/?City=A on 2026-08-01', exact: true });
  await expect(history).toBeVisible();
  await expect(history.getByText(previous.pageChangeSummary, { exact: true })).toBeVisible();
  await tasksFor(page).getByText('Completed and dismissed (1)', { exact: true }).click();
  await expect(taskFor(page, 0).getByText('Published', { exact: true })).toBeVisible();
  await expect(taskFor(page, 0).getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect.poll(() => state.calls.generations.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
  expect(state.plans.get(pageUrl).tasks[0].publication.implementedAt).toBe(previous.implementedAt);
  expect(state.plans.get(pageUrl).tasks[1].status).toBe('todo');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
  expect(state.calls.generations).toHaveLength(1);
  expect(state.history[0].assessment).toEqual(previous.assessment);
});

test('publication and analysis stay disabled until existing progress has been checked', async ({ page }) => {
  const state = await setup(page, { deferProgress: true });
  try {
    await expect(checkboxFor(page, 0)).toBeDisabled();
    await expect(publishButton(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
    expect(state.calls.generations).toHaveLength(0);
    expect(state.calls.publications).toHaveLength(0);
  } finally { state.releaseProgress(); }
  await expect(checkboxFor(page, 0)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
});
