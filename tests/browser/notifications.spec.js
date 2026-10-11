const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const uid = 'notification-ui-pilot';
const property = 'https://example.test/';
let app;
const event = (id, overrides = {}) => ({ id, type: 'results_ready', title: 'Results ready', message: 'Both reporting periods are available. Review what changed and your next useful step.', pageName: id === 'notice-1' ? 'Homepage' : `Service page ${id}`, pageUrl: property, occurredAt: '2026-10-10T15:00:00Z', createdAt: '2026-10-10T15:00:00Z', status: 'active', readAt: null, ...overrides });

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'notification-ui');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, emailVerified: true, password: 'Test-only-pass123!' }); } catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
});
test.afterAll(async () => app?.delete());

async function setup(page, options = {}) {
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
  await app.firestore().doc(`onboarding/${uid}`).set({ isComplete: true, postOnboardingStep: 'complete', businessName: 'Example Studio', websiteUrl: property, gscProperty: property, revampRunId: 'notifications-ui', revampStatus: 'complete' });
  const state = { requests: [], errors: [], browserDiagnostics: [], blockedResources: [], failPreferences: false, failList: false, items: options.items ?? Array.from({ length: 6 }, (_, index) => event(`notice-${index + 1}`)), preferences: { enabled: true, revision: 0, emailEnabled: false, chosenAt: null, recipient: `${uid}@example.test`, recipientVerified: true, emailState: 'off', sendingEnabled: false } };
  page.on('pageerror', error => state.errors.push(error.stack || error.message));
  await page.exposeBinding('__reportNotificationTestError', (_source, detail) => state.browserDiagnostics.push(detail));
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenChatAssistant', 'true');
    // Record unhandled Event rejections with their originating resource. Do not
    // suppress the browser error or weaken the no-page-errors assertion below.
    const describe = value => ({ type: value?.type, name: value?.name, message: value?.message, stack: value?.stack,
      target: value?.target?.tagName, src: value?.target?.src, href: value?.target?.href, text: String(value) });
    window.addEventListener('unhandledrejection', event => window.__reportNotificationTestError({ kind: 'unhandledrejection', reason: describe(event.reason), url: location.href }));
    window.addEventListener('error', event => window.__reportNotificationTestError({ kind: 'error', ...describe(event), error: describe(event.error), filename: event.filename, url: location.href }), true);
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { state.blockedResources.push({ url: request.url(), type: request.resourceType() }); return request.resourceType() === 'script' ? route.fulfill({ contentType: 'application/javascript', body: '' }) : route.abort(); }
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    state.requests.push({ path: url.pathname, method: request.method(), body: request.postData() });
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (url.pathname === '/api/notifications') return state.failList ? json({ error: 'Saved updates temporarily unavailable.' }, 503) : json({ enabled: true, items: url.searchParams.has('cursor') ? [event('older', { status: 'resolved' })] : state.items, nextCursor: !url.searchParams.has('cursor') && options.pagination ? 'next-page' : null, unreadCount: state.items.filter(item => item.status === 'active' && !item.readAt).length });
    if (url.pathname === '/api/notifications/preferences') {
      if (request.method() === 'PATCH') {
        if (state.failPreferences) return json({ error: 'Preference save unavailable.' }, 503);
        const body = request.postDataJSON();
        if (body.expectedRevision !== state.preferences.revision) return json({ error: 'Reload your saved choice.' }, 409);
        state.preferences = { ...state.preferences, revision: state.preferences.revision + 1, emailEnabled: body.emailEnabled, emailState: body.emailEnabled ? 'enabled' : 'off', chosenAt: new Date().toISOString() };
      }
      return json(state.preferences);
    }
    if (url.pathname === '/api/notifications/unsubscribe') return request.method() === 'POST' ? json({ unsubscribed: true }) : json({ valid: true, emailEnabled: true });
    if (/\/api\/notifications\/[^/]+\/read$/.test(url.pathname)) { const id = url.pathname.split('/').at(-2); const item = state.items.find(item => item.id === id); if (item) item.readAt = new Date().toISOString(); return json({ event: item }); }
    if (/\/api\/notifications\/[^/]+$/.test(url.pathname)) { const item = state.items.find(item => item.id === url.pathname.split('/').at(-1)); return item ? json({ event: item, destination: options.historical ? { href: null, historical: true, message: 'This update belongs to an earlier website version.' } : { href: `/low-ctr?page=${encodeURIComponent(property)}&cycleId=original-cycle`, historical: false } }) : json({ error: 'This update is unavailable in this account.' }, 404); }
    if (url.pathname === '/api/dashboard/config') return json({ enabled: true });
    if (url.pathname === '/api/dashboard/work') return json({ enabled: true, items: [], sources: {}, nextCursor: null, coverage: { partial: false } });
    if (url.pathname === '/api/dashboard/overview') return json({ source: 'google_search_console', schemaVersion: 1, property, totals: { clicks: 0, impressions: 0 }, pages: [], daily: [], window: { startDate: '2026-09-10', endDate: '2026-10-07' }, fetchedAt: '2026-10-10T15:00:00Z', coverage: {} });
    if (url.pathname === '/api/onboarding/workspace') return json({ eligible: false });
    if (url.pathname === '/api/mentor/context') return json({ enabled: false });
    if (url.pathname === '/api/progress') return json({ records: [], history: [], ongoing: { enabled: true, records: [], history: [] } });
    return json({ success: true, keywords: [], pages: [], conversations: [], data: [] });
  });
  return state;
}
async function login(page, path = '/auth') {
  await page.goto(path);
  await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 20000 });
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
}

test('bell is compact, has five notices, cached reads and an explicit read action', async ({ page }) => {
  const state = await setup(page);
  await login(page);
  await expect(page.getByTestId('visual-progress-dashboard')).toBeVisible({ timeout: 20000 });
  const bell = page.getByRole('button', { name: 'Page updates, 6 unread' });
  await expect(bell).toBeVisible({ timeout: 20000 });
  await bell.focus(); await page.keyboard.press('Enter');
  const popover = page.getByRole('dialog');
  await expect(popover.getByRole('link', { name: /View update/ })).toHaveCount(5);
  await expect(popover.getByRole('link', { name: 'View all updates' })).toBeVisible();
  expect(state.requests.filter(request => request.path === '/api/notifications')).toHaveLength(1);
  await popover.getByRole('link', { name: /Homepage/ }).click();
  await expect(page.getByRole('heading', { name: 'Results ready', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page updates, 5 unread' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open this page’s work' })).toHaveAttribute('href', '/low-ctr?page=https%3A%2F%2Fexample.test%2F&cycleId=original-cycle');
  expect(state.requests.filter(request => request.method !== 'GET').map(request => request.path)).toEqual(['/api/notifications/notice-1/read']);
  expect(state.errors, JSON.stringify({ diagnostics: state.browserDiagnostics, blocked: state.blockedResources })).toEqual([]);
  await page.screenshot({ path: '/tmp/phase11-notification-detail.png', fullPage: true });
});

test('mobile bell fits beside Account, inbox paginates and preserves resolved history', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const state = await setup(page, { pagination: true });
  await login(page, '/auth?returnTo=%2Fnotifications');
  await expect(page.getByRole('heading', { name: 'Your page updates' })).toBeVisible({ timeout: 20000 });
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
  await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more updates' }).click();
  await expect(page.getByRole('link', { name: /Service page older/ })).toContainText('Resolved');
  await page.screenshot({ path: '/tmp/phase11-notification-mobile.png', fullPage: true });
  expect(state.errors).toEqual([]);
});

test('signed-out link retains exact notice through sign-in and shows dated history safely', async ({ page }) => {
  await setup(page, { historical: true });
  await login(page, '/notifications/notice-1');
  await expect(page).toHaveURL(/\/notifications\/notice-1$/);
  await expect(page.getByText('This update belongs to an earlier website version.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open this page’s work' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Results ready' })).toBeVisible();
});

test('publication prompt defaults off, preserves publication on failed preference save, and declines only once', async ({ page }) => {
  const state = await setup(page, { items: [] });
  await login(page);
  await expect(page.getByTestId('visual-progress-dashboard')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Page updates', exact: true })).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => window.dispatchEvent(new Event('seo-publication-confirmed')));
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  state.failPreferences = true;
  await dialog.getByRole('button', { name: 'No thanks' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Your publication is saved.');
  state.failPreferences = false;
  await dialog.getByRole('button', { name: 'No thanks' }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('seo-publication-confirmed')));
  await page.waitForTimeout(150);
  await expect(dialog).toHaveCount(0);
  expect(state.preferences.emailEnabled).toBe(false);
  expect(state.requests.filter(request => request.method !== 'GET').every(request => request.path === '/api/notifications/preferences')).toBe(true);
});

test('empty inbox and settings show honest sending-disabled state', async ({ page }) => {
  await setup(page, { items: [] });
  await login(page, '/auth?returnTo=%2Fnotifications');
  await expect(page.getByText('Your page updates will appear here.', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: 'Email preferences', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Email progress updates' })).not.toBeChecked();
  await page.getByRole('switch', { name: 'Email progress updates' }).click();
  await expect(page.getByRole('status')).toContainText('Your email choice is saved.');
  await expect(page.getByText(/Email delivery is not enabled yet/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a labeled test email' })).toBeDisabled();
});

test('human unsubscribe GET is safe for email scanners and needs an explicit POST', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/notifications/unsubscribe?token=isolated-test-token');
  await expect(page.getByRole('button', { name: 'Turn off progress emails' })).toBeVisible();
  expect(state.requests.some(request => request.method !== 'GET')).toBe(false);
  await page.getByRole('button', { name: 'Turn off progress emails' }).click();
  await expect(page.getByRole('status')).toContainText('Progress emails are off.');
  expect(state.requests.filter(request => request.method === 'POST')).toHaveLength(1);
});
