const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const uid = 'visual-dashboard-pilot';
const property = 'https://example.test/';
const websiteRunId = 'visual-dashboard-run';
const observedAt = '2026-10-10T15:00:00Z';
let app;

const overview = {
  schemaVersion: 1, source: 'google_search_console', property,
  window: { startDate: '2026-09-10', endDate: '2026-10-07' }, fetchedAt: observedAt,
  totals: { impressions: 142, clicks: 6, ctr: 6 / 142, position: 12 },
  pages: [{ pageUrl: property, impressions: 142, clicks: 6 }],
  daily: [{ date: '2026-09-10', impressions: 12, clicks: 1 }, { date: '2026-09-17', impressions: 16, clicks: 2 }, { date: '2026-09-24', impressions: 22, clicks: 0 }, { date: '2026-10-01', impressions: 31, clicks: 3 }],
  coverage: { pages: { limit: 100, returned: 1, complete: false }, daily: { omitsDaysWithoutData: true } },
};
const cycle = (overrides = {}) => ({ kind: 'cycle', id: 'homepage-cycle', pageUrl: property, confirmedAt: '2026-10-01T15:00:00Z', nextReviewAt: '2026-11-01', latestCheckpoint: null, technical: null, lastError: null, ...overrides });
const draft = (id = 'draft-a') => ({ kind: 'new_page', id, topic: `Roof repairs · ${id}`, status: 'draft', hasDraft: true, updatedAt: observedAt });
const workResponse = (items = [], extra = {}) => ({ enabled: true, items, scope: { property, websiteRunId }, sources: Object.fromEntries(['plans', 'cycles', 'legacy', 'newPages'].map(source => [source, { error: null, scanned: 0, hasMore: false }])), nextCursor: null, coverage: { partial: false }, ...extra });
const checkpoint = {
  id: 'checkpoint-28', evidenceRevision: 1, day: 28,
  windows: { baseline: { startDate: '2026-07-04', endDate: '2026-07-31' }, post: { startDate: '2026-08-02', endDate: '2026-08-29' } },
  baseline: { status: 'available', clicks: 6, impressions: 142, position: 12 },
  post: { status: 'available', clicks: 9, impressions: 200, position: 8, fetchedAt: observedAt },
};

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'visual-dashboard-browser');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
  await app.firestore().doc(`onboarding/${uid}`).set({ businessName: 'Example Studio', websiteUrl: property, gscProperty: property, isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', revampRunId: websiteRunId, progressReviewRequired: false, revampPages: [property] });
});
test.afterAll(async () => app?.delete());

async function openDashboard(page, options = {}) {
  const state = { overview: structuredClone(options.overview || overview), work: options.work || workResponse(), overviewStatus: options.overviewStatus || 200, workStatus: 200, requests: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.stack || error.message));
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    // This suite uses emulator email/password auth, not Google's remote login
    // SDK. A harmless script fixture avoids that SDK loader's rejected Event.
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return request.resourceType() === 'script' ? route.fulfill({ contentType: 'application/javascript', body: '' }) : route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    state.requests.push({ path: url.pathname, query: url.search, method: request.method() });
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (url.pathname === '/api/dashboard/config') return json({ enabled: true });
    if (url.pathname === '/api/dashboard/overview') return json(state.overview, state.overviewStatus);
    if (url.pathname === '/api/dashboard/work') return json(url.searchParams.has('cursor') && options.nextWork ? options.nextWork : state.work, state.workStatus);
    if (url.pathname === '/api/onboarding/workspace') return json({ eligible: false });
    if (url.pathname === '/api/mentor/context') return json({ enabled: false });
    if (url.pathname === '/api/progress') return json({ records: [], history: [], ongoing: { enabled: true, records: [], history: [] } });
    return json({ success: true, keywords: [], pages: [], conversations: [], data: [] });
  });
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByTestId('visual-progress-dashboard')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Loading saved work…', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Loading search activity…', { exact: true })).toHaveCount(0);
  return state;
}

test('weekly bars preserve partial dates and have keyboard-accessible daily numbers', async ({ page }) => {
  const state = await openDashboard(page);
  await expect(page.getByRole('heading', { name: 'Make your first useful change' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Weekly reported appearances/ })).toBeVisible();
  await expect(page.getByText('1/7 days · partial')).toHaveCount(4);
  const toggle = page.getByRole('button', { name: 'Clicks', exact: true });
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: /^Weekly reported clicks/ })).toBeVisible();
  await page.getByText('View daily numbers and reporting details', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Reported daily search activity, Pacific dates' }).getByRole('rowheader', { name: '2026-09-10' })).toBeVisible();
  expect(state.requests.some(request => request.method !== 'GET')).toBe(false);
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: '/tmp/phase10-dashboard-starting-desktop.png', fullPage: true });
});

test('zero activity prioritizes useful work; failed refresh preserves dated prior totals', async ({ page }) => {
  const state = await openDashboard(page, { overview: { ...overview, totals: { impressions: 0, clicks: 0 }, pages: [], daily: [] } });
  await expect(page.getByRole('heading', { name: 'Start with one useful page improvement' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Weekly reported/ })).toHaveCount(0);
  await expect(page.getByText('Your work will appear here', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/phase10-dashboard-zero-desktop.png', fullPage: true });
  state.overview = overview;
  await page.getByRole('button', { name: 'Refresh search data' }).click();
  await expect(page.getByText('142', { exact: true })).toBeVisible();
  state.overviewStatus = 503;
  await page.getByRole('button', { name: 'Refresh search data' }).click();
  await expect(page.getByTestId('visual-progress-dashboard').getByRole('alert')).toContainText('Last successful observation');
  await expect(page.getByText('142', { exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('modern cycles and drafts appear together; dashboard actions are read-only links', async ({ page }) => {
  const state = await openDashboard(page, { work: workResponse([cycle(), draft()]) });
  const cards = page.locator('#page-progress article');
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole('progressbar', { name: 'Time until comparison for Homepage' })).toBeVisible();
  await expect(cards.filter({ hasText: 'Homepage' })).toContainText('Nov 1, 2026');
  await expect(cards.filter({ hasText: 'Roof repairs' }).getByRole('link', { name: 'Continue working' })).toHaveAttribute('href', '/generic-keywords?planId=draft-a');
  await expect(cards.filter({ hasText: 'Homepage' }).getByRole('link', { name: 'View progress' })).toHaveAttribute('href', `/low-ctr?page=${encodeURIComponent(property)}`);
  expect(state.requests.some(request => request.method !== 'GET')).toBe(false);
  expect(state.requests.some(request => /suggestions|follow-up|confirm/.test(request.path))).toBe(false);
  await page.screenshot({ path: '/tmp/phase10-dashboard-collecting-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('#page-progress article')).toHaveCount(2);
  expect(state.errors).toEqual([]);
});

test('saved comparisons show gains and declines honestly and link to results', async ({ page }) => {
  const state = await openDashboard(page, { work: workResponse([cycle({ confirmedAt: '2026-08-01T15:00:00Z', latestCheckpoint: checkpoint, nextReviewAt: '2026-09-29' })]) });
  await expect(page.getByRole('region', { name: 'Your next step' }).getByRole('link', { name: 'Review my results' })).toBeVisible();
  const card = page.locator('#page-progress article');
  await expect(card.getByText('+3', { exact: true })).toBeVisible();
  await expect(card.getByText('4 better', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/phase10-dashboard-results-desktop.png', fullPage: true });
  state.work = workResponse([cycle({ confirmedAt: '2026-08-01T15:00:00Z', latestCheckpoint: { ...checkpoint, post: { ...checkpoint.post, clicks: 2, impressions: 100, position: 16 } } })]);
  await page.evaluate(() => window.dispatchEvent(new Event('seo-implementation-changed')));
  await expect(card.getByText('-4', { exact: true })).toBeVisible();
  await expect(card.getByText('4 worse', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/phase10-dashboard-declining-desktop.png', fullPage: true });
  expect(state.errors).toEqual([]);
});

test('three featured cards and continuation preserve honest partial counts', async ({ page }) => {
  const items = [draft('one'), draft('two'), draft('three'), draft('four')];
  const state = await openDashboard(page, { work: workResponse(items, { nextCursor: 'next-page', coverage: { partial: true } }), nextWork: workResponse([draft('five')]) });
  await expect(page.locator('#page-progress article')).toHaveCount(3);
  await expect(page.getByText('4 saved pages loaded · this list may be incomplete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View all saved work' }).click();
  await expect(page.locator('#page-progress article')).toHaveCount(4);
  await page.getByRole('button', { name: 'Load more saved work' }).click();
  await expect(page.locator('#page-progress article')).toHaveCount(5);
  await expect(page.getByText('5 saved pages', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more saved work' })).toHaveCount(0);
  expect(state.requests.filter(request => request.path === '/api/dashboard/work' && request.query.includes('cursor=')).length).toBe(1);
  expect(state.errors).toEqual([]);
});

test('continuation retries clear a recovered source error and finish the loaded count', async ({ page }) => {
  const sources = workResponse().sources;
  sources.plans = { error: 'Query failed', scanned: 0, hasMore: true, readFailed: true };
  const recovered = workResponse([{ kind: 'plan', id: 'home-plan', pageUrl: property, taskCounts: { todo: 1 }, updatedAt: observedAt }]);
  recovered.sources.plans = { error: null, scanned: 1, hasMore: false, readFailed: false };
  const state = await openDashboard(page, { work: workResponse([draft()], { sources, nextCursor: 'retry-plans', coverage: { partial: true } }), nextWork: recovered });
  await expect(page.getByTestId('visual-progress-dashboard').getByRole('alert')).toContainText('Some saved work could not be checked');
  await page.getByRole('button', { name: 'View all saved work' }).click();
  await page.getByRole('button', { name: 'Load more saved work' }).click();
  await expect(page.locator('#page-progress article')).toHaveCount(2);
  await expect(page.getByTestId('visual-progress-dashboard').getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('2 saved pages', { exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('continuation preserves a point-read error on an unqueried completed source', async ({ page }) => {
  const sources = workResponse().sources;
  sources.plans = { error: null, scanned: 10, hasMore: true, readFailed: false };
  sources.newPages = { error: 'Publication unavailable', scanned: 1, hasMore: false, readFailed: false };
  const next = workResponse([{ kind: 'plan', id: 'home-plan', pageUrl: property, taskCounts: { todo: 1 }, updatedAt: observedAt }]);
  next.sources.plans = { error: null, scanned: 1, hasMore: false, readFailed: false };
  const state = await openDashboard(page, { work: workResponse([{ ...draft(), status: 'published', publication: null, publicationError: 'Unavailable' }], { sources, nextCursor: 'more-plans', coverage: { partial: true } }), nextWork: next });
  await page.getByRole('button', { name: 'View all saved work' }).click();
  await page.getByRole('button', { name: 'Load more saved work' }).click();
  await expect(page.locator('#page-progress article')).toHaveCount(2);
  await expect(page.getByTestId('visual-progress-dashboard').getByRole('alert')).toContainText('Some saved work could not be checked');
  await expect(page.getByText('2 saved pages loaded · this list may be incomplete', { exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('activity failure leaves saved work visible and never invents zeros', async ({ page }) => {
  const state = await openDashboard(page, { overviewStatus: 503, work: workResponse([draft()]) });
  await expect(page.getByTestId('visual-progress-dashboard').getByRole('alert')).toContainText('Search activity could not be refreshed');
  await expect(page.locator('#page-progress article')).toHaveCount(1);
  await expect(page.getByText('Appearances in Google', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/phase10-dashboard-unavailable-desktop.png', fullPage: true });
  expect(state.errors).toEqual([]);
});

test('cached activity that needs reconnection retains its numbers and offers Connect Google', async ({ page }) => {
  const state = await openDashboard(page, { overview: { ...overview, observation: { lastError: 'reconnect_required' } }, work: workResponse([draft()]) });
  await expect(page.getByText('142', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your next step' }).getByRole('button', { name: 'Connect Google', exact: true })).toBeVisible();
  await expect(page.getByTestId('visual-progress-dashboard').getByRole('alert')).toContainText('Reconnect Google');
  await expect(page.locator('#page-progress article')).toHaveCount(1);
  expect(state.errors).toEqual([]);
});

test('a failed source preserves its work without retaining replaced cycles from successful sources', async ({ page }) => {
  const state = await openDashboard(page, { work: workResponse([cycle(), draft('old-draft'), { kind: 'plan', id: 'about-plan', pageUrl: `${property}about`, taskCounts: { todo: 1 }, updatedAt: observedAt }]) });
  const replacement = cycle({ id: 'new-cycle', confirmedAt: '2026-10-05T15:00:00Z', nextReviewAt: '2026-11-05' });
  const sources = workResponse().sources;
  sources.plans = { error: 'Query failed', scanned: 0, readFailed: true };
  sources.cycles = { error: null, scanned: 1, readFailed: false };
  sources.newPages = { error: null, scanned: 1, readFailed: false };
  state.work = workResponse([replacement], { sources, coverage: { partial: true } });
  await page.evaluate(() => window.dispatchEvent(new Event('seo-implementation-changed')));
  await expect(page.getByTestId('visual-progress-dashboard').getByRole('alert')).toContainText('Some saved work could not be checked');
  await expect(page.locator('#page-progress article')).toHaveCount(2);
  await expect(page.locator('#page-progress')).not.toContainText('old-draft');
  await expect(page.locator('#page-progress')).not.toContainText('More than one active record');
  await expect(page.locator('#page-progress article').filter({ hasText: 'Homepage' })).toContainText('Nov 5, 2026');
  await expect(page.locator('#page-progress article').filter({ hasText: '/about' })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('an elapsed comparison date remains collecting until saved evidence arrives', async ({ page }) => {
  const state = await openDashboard(page, { work: workResponse([cycle({ confirmedAt: '2026-08-01T15:00:00Z', nextReviewAt: '2026-09-01' })]) });
  const card = page.locator('#page-progress article');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(card.getByText('Waiting for the latest search data', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review my results', exact: true })).toHaveCount(0);
  state.workStatus = 503;
  await page.evaluate(() => window.dispatchEvent(new Event('seo-implementation-changed')));
  await expect(page.getByTestId('visual-progress-dashboard').getByRole('alert')).toContainText('saved work could not be loaded');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  expect(state.errors).toEqual([]);
});

test('an incomplete checkpoint retains known numbers without inviting a results review', async ({ page }) => {
  const state = await openDashboard(page, { work: workResponse([cycle({ confirmedAt: '2026-08-01T15:00:00Z', nextReviewAt: '2026-09-29', latestCheckpoint: {
    ...checkpoint, state: 'incomplete', post: { status: 'unavailable', clicks: 99, impressions: 999, position: 1 },
  } })]) });
  await expect(page.getByRole('region', { name: 'Your next step' })).toContainText('More evidence is needed');
  await expect(page.getByRole('link', { name: 'Review my results', exact: true })).toHaveCount(0);
  const card = page.locator('#page-progress article');
  await expect(card.getByText('Comparison unavailable', { exact: true })).toHaveCount(3);
  await expect(card.getByText('99', { exact: true })).toHaveCount(0);
  await card.getByText('Comparison dates and previous numbers', { exact: true }).click();
  await expect(card).toContainText('Clicks: 6 → —');
  await expect(card).toContainText('Appearances in search: 142 → —');
  expect(state.errors).toEqual([]);
});

test('published page keeps publication, indexing and dated activity independent', async ({ page }) => {
  await openDashboard(page, { work: workResponse([{ ...draft('published'), status: 'published', publication: {
    pageUrl: `${property}roof-repairs`, verifiedAt: '2026-10-01T15:00:00Z',
    indexing: { status: 'available', coverageState: 'Discovered - currently not indexed', fetchedAt: observedAt },
    activity: { rolling: { status: 'has_data', clicks: 2, impressions: 20, position: 11, startDate: '2026-09-10', endDate: '2026-10-07', fetchedAt: observedAt },
      sinceVerified: { status: 'no_data', clicks: 0, impressions: 0, position: null, startDate: '2026-10-02', endDate: '2026-10-07', fetchedAt: observedAt } },
    preexistingActivity: { status: 'has_data', clicks: 1, impressions: 10 },
    publicPage: { status: 'available', warnings: ['This page declares a different canonical URL.'] },
  } }]) });
  const card = page.locator('#page-progress article');
  await expect(card.getByText('Your page is published', { exact: true })).toBeVisible();
  await expect(card).toContainText('Discovered - currently not indexed');
  await expect(card).toContainText('2 clicks · 20 appearances');
  await card.getByText('Publication and activity details', { exact: true }).click();
  await expect(card).toContainText('Since publication verification: 0 clicks · 0 appearances');
  await expect(card).toContainText('This URL had search activity before verification');
  await expect(card).toContainText('This page declares a different canonical URL');
});

test('mobile light and dark layouts have no overflow with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await openDashboard(page, { work: workResponse([cycle({ confirmedAt: '2026-08-01T15:00:00Z', latestCheckpoint: checkpoint }), draft()]) });
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: 'Account', exact: true }).click();
      await page.getByRole('menuitem', { name: `Switch to ${theme} mode` }).click();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark).*$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Appearances', exact: true })).toBeVisible();
      await page.screenshot({ path: `/tmp/phase10-dashboard-results-mobile-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
      const contrast = await page.locator('#page-progress article a').first().evaluate(element => ({ link: getComputedStyle(element).color, card: getComputedStyle(element.closest('article')).color }));
      expect(contrast.link).toBe(contrast.card);
    }
  }
  expect(state.errors).toEqual([]);
});
