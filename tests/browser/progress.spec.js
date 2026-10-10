const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const uid = 'progress-alice';
const pageUrl = 'https://example.test/Case/?City=A';
const property = 'sc-domain:example.test';
let app;
let token;

test.beforeAll(async ({ request }) => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'progress-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true } });
  token = (await login.json()).idToken;
  expect(token).toBeTruthy();
  await app.firestore().doc(`onboarding/${uid}`).set({ name: 'Progress test', websiteUrl: 'https://example.test', gscProperty: property, isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', progressReviewRequired: false });
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
});
test.afterAll(async () => { await app?.delete(); });

function record(state, reason, withMetrics = false) {
  const implementedAt = '2026-08-01';
  const baselineWindow = { startDate: '2026-07-04', endDate: '2026-07-31' };
  const postWindow = { startDate: '2026-08-02', endDate: '2026-08-29' };
  const observation = { source: 'google_search_console', property, pageUrl, fetchedAt: '2026-10-10T14:00:00.000Z', impressions: 100, clicks: 10, ctr: 0.1, position: 4, dataState: 'final', schemaVersion: 1, status: 'has_data' };
  return { userId: uid, status: 'implemented', pageUrl, implementedAt,
    progressAssessment: { schemaVersion: 1, source: 'google_search_console', property, pageUrl, implementedAt, state, reason, attemptedAt: observation.fetchedAt,
      windows: { baseline: baselineWindow, post: postWindow, completeThrough: '2026-10-07', ready: true },
      baseline: withMetrics ? { ...observation, ...baselineWindow } : null,
      post: withMetrics ? { ...observation, ...postWindow, clicks: 15, ctr: 0.15 } : null,
      comparison: state === 'ready' ? { clicksDelta: 5, clicksPercent: 50 } : null,
    },
  };
}

test('real authenticated progress endpoint reads paused, collecting, ready and error evidence from demo Firestore', async ({ request }) => {
  const ref = app.firestore().doc(`implementedSeoTips/${uid}_tip`);
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.get('/api/progress')).status()).toBe(401);
  expect((await request.get('/api/progress?userId=other-bob', { headers })).status()).toBe(403);
  for (const [state, reason] of [['collecting', 'waiting_for_complete_post_window'], ['ready', 'comparison_available'], ['error', 'search_data_unavailable']]) {
    await ref.set(record(state, reason, state !== 'collecting'));
    const response = await request.get('/api/progress', { headers });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.records[0].assessment.state).toBe(state);
    expect(body.records[0].assessment.pageUrl).toBe(pageUrl);
    expect(body.notificationsEnabled).toBe(false);
  }
  await app.firestore().doc(`onboarding/${uid}`).update({ progressReviewRequired: true });
  const paused = await request.post('/api/progress', { headers });
  expect(paused.status()).toBe(200);
  const result = await paused.json();
  expect(result).toMatchObject({ paused: true, checked: 0 });
  expect(result.records[0].assessment.state).toBe('paused');
  await app.firestore().doc(`onboarding/${uid}`).update({ progressReviewRequired: false });
});

test('dashboard renders real dated progress and preserves the last successful observation on a check error', async ({ page }) => {
  await app.firestore().doc(`implementedSeoTips/${uid}_tip`).set(record('ready', 'comparison_available', true));
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.port === '3100' && url.pathname.startsWith('/api/') && url.pathname !== '/api/progress') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ keywords: [], pages: [], tips: [], suggestions: [], conversations: [], data: [], success: true }) });
    return route.continue();
  });
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByText('Comparison available', { exact: true })).toBeVisible();
  await expect(page.getByText('Click change: +5 (+50.0%)', { exact: true })).toBeVisible();
  await expect(page.getByText(/Before: Jul 4, 2026/)).toBeVisible();
  await app.firestore().doc(`implementedSeoTips/${uid}_tip`).set(record('error', 'search_data_unavailable', true));
  await page.reload();
  await expect(page.getByText('Check unavailable', { exact: true })).toBeVisible();
  await page.getByText('View dated observations', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Reported search activity · last successful observations' })).toBeVisible();
  await expect(page.getByText(/Click change:/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/progress-evidence.png', fullPage: true });
});
