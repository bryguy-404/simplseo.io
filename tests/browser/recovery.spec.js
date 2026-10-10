const { test, expect } = require('@playwright/test');
const allowedApis = ['/api/revamp/', '/api/focus-keywords', '/api/account/delete'];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.port === '3100' && url.pathname.startsWith('/api/') && !allowedApis.some(p => url.pathname.startsWith(p))) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ keywords: [], pages: [], tips: [], suggestions: [], conversations: [], data: [], success: true }) });
    }
    return route.continue();
  });
});
async function login(page) {
  await page.goto('/auth');
  await page.locator('input[type=email]').fill('recovery-alice@example.test');
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
}
test('stuck account can navigate, finish without keywords, reload, and read preserved history', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Website update monitoring' })).toBeVisible();
  await page.goto('/settings');
  await expect(page).toHaveURL(/settings/);
  await page.goto('/revamp');
  await expect(page.getByText('Not checked yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check search data' }).click();
  await expect(page.getByText('Reconnect Google to resume checks. You can keep using the dashboard.')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue to dashboard' }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Website update monitoring' })).toBeVisible();
  await page.getByRole('button', { name: 'Logout', exact: true }).first().click();
  await expect(page).toHaveURL(/auth/);
  await login(page);
  await page.goto('/revamp/history');
  await page.getByRole('button', { name: /Website update/ }).click();
  await expect(page.getByText(/SEO changes/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('must-not-appear-in-history');
  await page.screenshot({ path: 'test-results/history.png', fullPage: true });
});
test('failed completion stays on setup and displays the error', async ({ page }) => {
  await login(page);
  await page.goto('/revamp');
  await page.route('**/api/revamp/complete', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary save failure' }) }));
  await page.getByRole('button', { name: 'Save and continue to dashboard' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Temporary save failure' })).toHaveText('Temporary save failure');
  await expect(page).toHaveURL(/revamp$/);
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page).toHaveURL(/dashboard/);
});
test('unauthenticated requests cannot change or expose account records', async ({ request }) => {
  for (const path of ['revamp/complete', 'revamp/archive', 'revamp/check-gsc', 'revamp/crawl', 'account/delete', 'focus-keywords', 'focus-keywords/restore', 'crawl-site/review', 'crawl-site/save', 'crawl-site']) {
    const response = await request.post(`/api/${path}`, { data: { userId: 'other-bob' } });
    expect(response.status(), path).toBe(401);
  }
});

test('a signed-in user cannot target another account', async ({ request }) => {
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: 'recovery-alice@example.test', password: 'Test-only-pass123!', returnSecureToken: true } });
  const { idToken } = await login.json();
  expect(idToken).toBeTruthy();
  for (const path of ['revamp/complete', 'revamp/archive', 'revamp/check-gsc', 'revamp/crawl', 'account/delete', 'focus-keywords', 'focus-keywords/restore', 'crawl-site/review', 'crawl-site/save', 'crawl-site']) {
    const response = await request.post(`/api/${path}`, { headers: { Authorization: `Bearer ${idToken}` }, data: { userId: 'other-bob' } });
    expect(response.status(), path).toBe(403);
  }
  const history = await request.get('/api/revamp/history?userId=other-bob', { headers: { Authorization: `Bearer ${idToken}` } });
  expect(history.status()).toBe(403);
});

test('history cannot be edited directly through Firestore', async ({ request }) => {
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: 'recovery-alice@example.test', password: 'Test-only-pass123!', returnSecureToken: true } });
  const { idToken } = await login.json();
  const response = await request.patch('http://127.0.0.1:8080/v1/projects/demo-simpleseo/databases/(default)/documents/users/recovery-alice/revampHistory/fixture-run', { headers: { Authorization: `Bearer ${idToken}` }, data: { fields: { complete: { booleanValue: false } } } });
  expect(response.status()).toBe(403);
});
test('recovery safety flags cannot be cleared by an ordinary client write', async ({ request }) => {
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: 'recovery-alice@example.test', password: 'Test-only-pass123!', returnSecureToken: true } });
  const { idToken } = await login.json();
  const response = await request.patch('http://127.0.0.1:8080/v1/projects/demo-simpleseo/databases/(default)/documents/onboarding/recovery-alice?updateMask.fieldPaths=progressReviewRequired', { headers: { Authorization: `Bearer ${idToken}` }, data: { fields: { progressReviewRequired: { booleanValue: false } } } });
  expect(response.status()).toBe(403);
});
