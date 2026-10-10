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
async function setup(page, { failGeneration = false, withQueries = false, redirects = {}, staleConfirmation = false } = {}) {
  const calls = { generations: [], content: [] };
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
    if (url.pathname === '/api/page-review/content') { const body = route.request().postDataJSON(); calls.content.push(body.pageUrl); return json({ success: true, data: { ...metadata(body.pageUrl), finalUrl: redirects[body.pageUrl] || body.pageUrl } }); }
    if (url.pathname === '/api/page-review/suggestions') {
      const body = route.request().postDataJSON(); calls.generations.push(body);
      return failGeneration ? json({ error: 'Draft service temporarily unavailable.' }, 503) : json({ ...suggestion, currentPage: metadata(body.pageUrl), provenance: { property, websiteRunId: 'page-task-run', pageUrl: body.pageUrl, finalUrl: body.pageUrl, contentFingerprint: 'fixture-content', generatedAt: new Date().toISOString() } });
    }
    if (url.pathname === '/api/page-review/confirm') {
      // Browser flow: a mocked HTTP boundary writes only the local demo fixture.
      // Real server fetch/transaction/ownership behavior is tested in manualPageReview.test.js.
      if (staleConfirmation) return json({ error: 'Your website setup changed. Reload and review the current page before confirming.' }, 409);
      const body = route.request().postDataJSON();
      const record = { id: idFor(body.pageUrl), userId: uid, pageUrl: body.pageUrl, title: body.title, description: body.description, implementedAt: new Date().toISOString(), status: 'implemented', preRevampArchived: false };
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

test('no-keyword task generates only on request, retries a failed save, preserves archives and freezes confirmed values', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByText('Current website title', { exact: true })).toBeVisible();
  expect(calls.generations).toHaveLength(0);
  await page.screenshot({ path: 'test-results/design-current-page.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toBeDisabled();
  await page.getByRole('button', { name: 'Generate title and description' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveValue(suggestion.title);
  expect(calls.generations).toEqual([{ pageUrl, focusKeywords: [] }]);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/design-draft-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/design-draft-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('button[title="Switch to light mode"]:visible').press('Space');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.getByRole('heading', { name: 'Review a page', exact: true })).toHaveCSS('color', await page.locator('body').evaluate(el => getComputedStyle(el).color));
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
  await expect(page.getByText('Collecting data', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Confirmed page title (SEO title)' })).toHaveValue('Reviewed title published on my website');
  await expect(page.getByRole('textbox', { name: 'Confirmed page title (SEO title)' })).toHaveAttribute('readonly', '');
  expect(calls.generations).toHaveLength(1);
  await page.screenshot({ path: 'test-results/phase3-page-task.png', fullPage: true });
});

test('redirect sources cannot generate or confirm; destination is reviewed and tracked explicitly', async ({ page }) => {
  const destination = 'https://example.test/New-page/?Campaign=A';
  await app.firestore().doc(`implementedSeoTips/${idFor(destination)}`).delete();
  const calls = await setup(page, { redirects: { [pageUrl]: destination } });
  await page.goto(`/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Review destination page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate title and description' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toBeDisabled();
  expect(calls.generations).toHaveLength(0);
  await page.getByRole('button', { name: 'Review destination page' }).click();
  await expect(page.getByLabel('Page to review')).toHaveValue(destination);
  await expect(page.getByRole('button', { name: 'Generate title and description' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate title and description' }).click();
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
  await expect(page.getByRole('button', { name: 'Generate title and description' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate title and description' }).click();
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
  await expect(page.getByText('Current website title', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate title and description' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Draft service temporarily unavailable.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toHaveCount(0);
  expect(calls.generations[0].pageUrl).toBe(pageUrl);
  expect(calls.content.every(value => value.startsWith(property))).toBe(true);
  expect((await app.firestore().doc(`implementedSeoTips/${docId}`).get()).data().preRevampArchived).toBe(true);
});

test('exact-case page links and optional observed queries remain distinct', async ({ page }) => {
  const calls = await setup(page, { withQueries: true });
  await page.goto(`/low-ctr?page=${encodeURIComponent(otherUrl)}`);
  await expect(page.getByLabel('Page to review')).toHaveValue(otherUrl);
  await expect(page.getByLabel('Search phrase to consider')).toHaveValue('');
  await expect(page.getByText('Current website title', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate title and description' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  expect(calls.generations[0]).toEqual({ pageUrl: otherUrl, focusKeywords: [] });
  await page.getByLabel('Page to review').selectOption(pageUrl);
  await expect(page.getByLabel('Search phrase to consider')).toHaveValue('local websites');
  await expect(page.getByRole('button', { name: 'Confirm change and start tracking' })).toBeDisabled();
  await expect(page.getByText('Current website title', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate title and description' }).click();
  await expect(page.getByRole('textbox', { name: 'Suggested page title (SEO title)' })).toBeVisible();
  expect(calls.generations[1]).toEqual({ pageUrl, focusKeywords: ['local websites'] });
});
