const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const fs = require('node:fs/promises');
const uid = 'dashboard-current';
const property = 'sc-domain:example.test';
const pageUrl = 'https://example.test/Service/?City=A';
let app;
test.use({ timezoneId: 'America/Indiana/Indianapolis' });

const overview = {
  schemaVersion: 1, source: 'google_search_console', property,
  window: { startDate: '2026-09-10', endDate: '2026-10-07' }, fetchedAt: '2026-10-10T16:00:00Z',
  totals: { impressions: 700, clicks: 21, ctr: 0.03, position: 8 },
  pages: [{ pageUrl, impressions: 300, clicks: 7, ctr: 7/300, position: 9 }, { pageUrl: 'https://example.test/', impressions: 142, clicks: 6, ctr: 6/142, position: 8 }],
  daily: [{ date: '2026-09-10', impressions: 12, clicks: 1 }, { date: '2026-09-11', impressions: 14, clicks: 0 }],
  coverage: { pages: { limit: 100, complete: false } },
};
test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'current-dashboard-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
  await app.firestore().doc(`onboarding/${uid}`).set({ name: 'Dashboard pilot', businessName: 'Current website test', websiteUrl: 'https://example.test', gscProperty: property, isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', revampRunId: 'current-run', progressReviewRequired: false,
    revampPages: [{ url: pageUrl, searchDataStatus: 'no_data', observationWindow: overview.window }] });
  await app.firestore().doc(`users/${uid}/revampHistory/current-run`).set({ complete: true });
});
test.afterAll(async () => { await app?.delete(); });

async function openDashboard(page, response = overview) {
  const requests = [];
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.port === '3100' && url.pathname.startsWith('/api/')) {
      requests.push(url.pathname);
      if (url.pathname === '/api/dashboard/overview') return route.fulfill({ status: 200, json: response });
      if (url.pathname === '/api/progress') return route.continue();
      return route.fulfill({ status: 200, json: { success: true, keywords: [], conversations: [], data: [] } });
    }
    return route.continue();
  });
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your SEO workspace' })).toBeVisible();
  await expect(page.getByText('Ready for your first change', { exact: true })).toBeVisible();
  return requests;
}

test('fresh current-site dashboard offers an exact-page task with no old focus keywords or paid calls', async ({ page }) => {
  const requests = await openDashboard(page);
  await expect(page.getByRole('link', { name: 'Review this page' })).toHaveAttribute('href', `/low-ctr?page=${encodeURIComponent(pageUrl)}`);
  await expect(page.getByRole('button', { name: 'Check progress', exact: true })).toBeDisabled();
  await expect(page.getByText('700', { exact: true })).toBeVisible();
  await expect(page.getByText('21', { exact: true })).toBeVisible();
  expect(requests.some(path => path.includes('seo-assistant') || path.includes('/suggestions'))).toBe(false);
  await expect(page.getByRole('link', { name: /^Homepage https:/ })).toHaveAttribute('href', 'https://example.test/');
  await page.screenshot({ path: 'test-results/phase3-dashboard.png', fullPage: true });
});

test('calendar dates remain exact in Indiana and daily data has an accessible table', async ({ page }) => {
  await openDashboard(page);
  await page.getByText('Show daily search activity', { exact: true }).click();
  await page.getByText('View daily numbers', { exact: true }).click();
  const table = page.getByRole('table', { name: 'Daily Google Search Console activity, Pacific dates' });
  await expect(table.getByRole('rowheader', { name: '2026-09-10', exact: true })).toBeVisible();
  await expect(table).not.toContainText('2026-09-09');
});

test('empty and failed observations never claim great performance or turn into new zeros', async ({ page }) => {
  await openDashboard(page, { ...overview, pages: [], daily: [], totals: { clicks: 0, impressions: 0, ctr: null, position: null } });
  await expect(page.getByText(/No page activity was returned for this period/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Choose a page', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Great performance');
  await page.route('**/api/dashboard/overview', route => route.fulfill({ status: 200, json: overview }));
  await page.getByRole('button', { name: 'Refresh search data' }).click();
  await expect(page.getByText('700', { exact: true })).toBeVisible();
  await page.route('**/api/dashboard/overview', route => route.fulfill({ status: 503, json: { error: 'Provider unavailable' } }));
  await page.getByRole('button', { name: 'Refresh search data' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Search activity could not be refreshed' })).toContainText('last successful observation');
  await expect(page.getByText('700', { exact: true })).toBeVisible();
});

test('rebuild URL export preserves exact paths and opening setup leaves progress enabled', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('link', { name: 'Website setup', exact: true }).click();
  await page.getByText('Rebuilding your website? Keep a URL plan', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download tracked URL list (1)' }).click();
  const download = await downloadPromise;
  const content = await fs.readFile(await download.path(), 'utf8');
  expect(content).toContain(pageUrl);
  expect(content).toContain('/Service/?City=A');
  expect(content).toContain('Planned replacement URL');
  expect((await app.firestore().doc(`onboarding/${uid}`).get()).data().progressReviewRequired).toBe(false);
});
