const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

// Isolated UI fixtures. Server tests exercise the real unchanged-review guard.
// These tests never generate drafts or confirm changes in a real account.
const uid = 'page-update-alice';
const property = 'https://example.test/';
const pageUrl = `${property}Case/?City=A`;
const otherUrl = `${property}case/?City=a`;
const websiteRunId = 'page-update-run';
const now = '2026-10-10T15:00:00.000Z';
const labels = ['Clarify the opening heading', 'Explain the design process', 'Inspect the page in your editor'];
const taskIds = labels.map(label => createHash('sha256').update(label).digest('hex'));
let app;

const contentFor = url => ({ htmlTitle: url === pageUrl ? 'Home design | Example Studio' : 'Other service | Example Studio', seoMetaDescription: 'We build useful websites for local businesses.',
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

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'page-update-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  await app.firestore().doc(`onboarding/${uid}`).set({ name: 'Update test', websiteUrl: property, gscProperty: property,
    isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', revampRunId: websiteRunId, progressReviewRequired: false,
    revampPages: [{ url: pageUrl, searchDataStatus: 'has_data' }, { url: otherUrl, searchDataStatus: 'has_data' }] });
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
});

async function setup(page) {
  const state = { plans: new Map([[pageUrl, planFor(pageUrl)], [otherUrl, planFor(otherUrl)]]), calls: [], errors: [],
    updateStatus: 'unchanged', delayContent: null, contentReady: Promise.resolve(), checkReady: Promise.resolve() };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    const json = body => route.fulfill({ json: body });
    if (url.pathname === '/api/progress') return json({ schemaVersion: 1, source: 'google_search_console', property, websiteRunId,
      paused: false, records: [], history: [], policy: { minImpressionsPerWindow: 100, minCombinedClicks: 10 }, notificationsEnabled: false, automaticOutcomesEnabled: false });
    if (url.pathname === '/api/dashboard/overview') return json({ source: 'google_search_console', property, window: evidenceFor(pageUrl).window,
      totals: { impressions: 60, clicks: 2 }, daily: [], pages: [pageUrl, otherUrl].map(url => ({ pageUrl: url, impressions: 30, clicks: 1 })),
      coverage: { pages: { limit: 100, returned: 2, complete: false } } });
    if (url.pathname === '/api/page-review/plan') return json({ plan: state.plans.get(url.searchParams.get('pageUrl')) || null });
    if (url.pathname === '/api/page-review/content') {
      const { pageUrl: target } = route.request().postDataJSON();
      if (target === state.delayContent) await state.contentReady;
      return json({ success: true, data: contentFor(target), provenance: reviewFor(target).provenance });
    }
    if (url.pathname === '/api/page-review/activity') {
      const { pageUrl: target } = route.request().postDataJSON();
      return json({ success: true, evidence: evidenceFor(target), provenance: reviewFor(target).provenance });
    }
    if (url.pathname === '/api/page-review/suggestions') {
      const body = route.request().postDataJSON(); state.calls.push(body);
      await state.checkReady;
      const plan = state.plans.get(body.pageUrl);
      const message = state.updateStatus === 'incomplete' ? 'We couldn’t finish checking for updates. Your saved plan is unchanged. Try again later.' : 'Your saved plan is up to date.';
      return json({ ...plan.review, plan, updateCheck: { status: state.updateStatus, checkedAt: now, message },
        checkContext: { currentPage: contentFor(body.pageUrl), evidence: evidenceFor(body.pageUrl), provenance: reviewFor(body.pageUrl).provenance } });
    }
    return json({ keywords: [], pages: [], tips: [], suggestions: [], conversations: [], data: [], success: true });
  });
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled({ timeout: 15000 });
  return state;
}

test('page switches show loading immediately, clear old wording, and block edits until content arrives', async ({ page }) => {
  const state = await setup(page);
  await page.getByText('Current title and description', { exact: true }).click();
  await expect(page.getByText('Home design | Example Studio', { exact: true })).toBeVisible();
  state.delayContent = otherUrl;
  state.contentReady = new Promise(resolve => { state.releaseContent = resolve; });
  try {
    await page.getByLabel('Choose a page to improve').selectOption(otherUrl);
    await expect(page.getByText('Loading this page…', { exact: true })).toBeVisible();
    await expect(page.locator('[aria-label="Page review workspace"]')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Home design | Example Studio', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
    await expect(page.getByRole('article', { name: labels[0], exact: true }).getByRole('checkbox', { name: 'I published this edit', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Start tracking published edits', exact: true })).toBeDisabled();
  } finally { state.releaseContent(); }
  await expect(page.getByText('Loading this page…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
  await page.getByText('Current title and description', { exact: true }).click();
  await expect(page.getByText('Other service | Example Studio', { exact: true })).toBeVisible();
  expect(state.calls).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test('late content for an abandoned selection cannot replace the current page', async ({ page }) => {
  const state = await setup(page);
  state.delayContent = otherUrl;
  state.contentReady = new Promise(resolve => { state.releaseContent = resolve; });
  await page.getByLabel('Choose a page to improve').selectOption(otherUrl);
  await expect(page.getByText('Loading this page…', { exact: true })).toBeVisible();
  await page.getByLabel('Choose a page to improve').selectOption(pageUrl);
  state.releaseContent();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
  await page.getByText('Current title and description', { exact: true }).click();
  await expect(page.getByText('Home design | Example Studio', { exact: true })).toBeVisible();
  await expect(page.getByText('Other service | Example Studio', { exact: true })).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test('unchanged checks are quiet and preserve saved tasks and the pending publication selection', async ({ page }) => {
  const state = await setup(page);
  const savedBefore = JSON.stringify(state.plans.get(pageUrl));
  const check = page.getByRole('button', { name: 'Check for updates', exact: true });
  await expect(check).not.toHaveClass(/bg-primary/);
  await expect(page.getByRole('button', { name: 'Analyze again', exact: true })).toHaveCount(0);
  const task = page.getByRole('article', { name: labels[0], exact: true });
  const selected = task.getByRole('checkbox', { name: 'I published this edit', exact: true });
  await selected.check();
  state.checkReady = new Promise(resolve => { state.releaseCheck = resolve; });
  try {
    await check.click();
    await expect(page.getByRole('button', { name: 'Checking for updates…', exact: true })).toBeDisabled();
    await expect(selected).toBeChecked();
    await expect(selected).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Start tracking published edits', exact: true })).toBeDisabled();
  } finally { state.releaseCheck(); }
  await expect(page.getByText('Your saved plan is up to date.', { exact: true })).toBeVisible();
  await expect(selected).toBeChecked();
  await expect(page.getByRole('button', { name: 'Start tracking published edits', exact: true })).toBeEnabled();
  expect(JSON.stringify(state.plans.get(pageUrl))).toBe(savedBefore);
  await check.click();
  await expect(page.getByText('Your saved plan is up to date.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved page tasks' }).getByRole('article')).toHaveCount(3);
  expect(state.calls).toHaveLength(2);
  await page.getByLabel('Choose a page to improve').selectOption(otherUrl);
  await expect(check).toBeEnabled();
  await expect(page.getByText('Your saved plan is up to date.', { exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('incomplete checks retain tasks without claiming the plan is up to date', async ({ page }) => {
  const state = await setup(page);
  state.updateStatus = 'incomplete';
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByText('We couldn’t finish checking for updates. Your saved plan is unchanged. Try again later.', { exact: true })).toBeVisible();
  await expect(page.getByText('Your saved plan is up to date.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Saved page tasks' }).getByRole('article')).toHaveCount(3);
  expect(state.plans.get(pageUrl).revision).toBe(1);
  expect(state.errors).toEqual([]);
});

test('a page without a saved review keeps the primary Analyze this page action', async ({ page }) => {
  const state = await setup(page);
  state.plans.delete(otherUrl);
  await page.getByLabel('Choose a page to improve').selectOption(otherUrl);
  const analyze = page.getByRole('button', { name: 'Analyze this page', exact: true });
  await expect(analyze).toBeEnabled();
  await expect(analyze).toHaveClass(/bg-primary/);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

