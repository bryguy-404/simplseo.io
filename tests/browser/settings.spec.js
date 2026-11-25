const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');

// Real local authentication, profile and notification APIs. Only OAuth/provider
// responses are fixtures; this suite never contacts customer accounts.
const uid = 'settings-ui-pilot', property = 'https://example.test/';
const password = 'Test-only-pass123!';
const profile = { businessName: 'Example Plumbing', businessType: 'Plumber', services: ['Drain repairs'],
  baseLocation: { city: 'South Bend', region: 'Indiana', country: 'United States' }, serviceAreas: ['South Bend'], goal: 'quotes', cmsPlatform: 'Custom' };
const protectedPaths = [`focusKeywords/${uid}`, `siteCrawls/${uid}`, `pageContentCache/${uid}/pages/home`,
  `pageReviewPlans/settings-plan`, `pageProgressCycles/settings-cycle`, `newPagePlans/settings-draft`, `conversations/settings-history`];
let app;
const capture = paths => Promise.all(paths.map(async path => ({ path, data: (await app.firestore().doc(path).get()).data() })));

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'settings-ui');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, emailVerified: true, password }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
});
test.afterAll(async () => app?.delete());

test.beforeEach(async ({ request }) => {
  await app.firestore().recursiveDelete(app.firestore().doc(`users/${uid}`));
  await app.firestore().doc(`notificationPreferences/${uid}`).delete();
  await app.firestore().doc(`users/${uid}`).set({ email: `${uid}@example.test`, gscSiteUrl: property });
  await app.firestore().doc(`onboarding/${uid}`).set({ ...profile, businessLocation: 'South Bend, Indiana', websiteUrl: property,
    gscProperty: property, hasGSC: true, isComplete: true, postOnboardingStep: 'complete', revampRunId: 'settings-run', revampStatus: 'complete' });
  for (const path of protectedPaths) await app.firestore().doc(path).set({ userId: uid, pageUrl: property, websiteRunId: 'settings-run',
    savedAt: '2026-10-11T12:00:00Z', ownerText: 'Keep this saved work.', keywords: [{ keyword: 'saved phrase', pageUrl: property }] });
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',
    { data: { email: `${uid}@example.test`, password, returnSecureToken: true } });
  const token = (await login.json()).idToken;
  const post = data => request.post('/api/onboarding/workspace', { headers: { Authorization: `Bearer ${token}` }, data: { ...data, requestId: randomUUID() } });
  const begun = await post({ action: 'begin', expectedRevision: 0 });
  expect(begun.status(), await begun.text()).toBe(200);
  const confirmed = await post({ action: 'confirmProfile', expectedRevision: (await begun.json()).session.revision, profileDraft: profile, confirmed: true });
  expect(confirmed.status(), await confirmed.text()).toBe(200);
});

async function openSettings(page, path = '/settings', options = {}) {
  const state = { requests: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return request.resourceType() === 'script'
      ? route.fulfill({ contentType: 'application/javascript', body: '' }) : route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    state.requests.push({ path: url.pathname, method: request.method(), query: url.search });
    if (options.legacy && url.pathname === '/api/onboarding/workspace') return route.fulfill({ json: { eligible: false, pinned: false, legacyCompleted: true } });
    if (['/api/access/status', '/api/onboarding/workspace', '/api/business-profile', '/api/notifications/preferences'].includes(url.pathname)) return route.continue();
    if (url.pathname.startsWith('/api/gsc/')) return route.continue();
    return route.fulfill({ json: { enabled: false, records: [], items: [], unreadCount: 0 } });
  });
  await page.goto(path);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(`${uid}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible();
  return state;
}

test('settings navigation and cancelled dialogs preserve every saved work record', async ({ page }) => {
  const paths = [...protectedPaths, `onboarding/${uid}`, `users/${uid}`];
  const before = await capture(paths);
  const state = await openSettings(page);
  await expect(page.getByRole('tab')).toHaveText(['Business details', 'Google connection', 'Notifications', 'Account']);
  await expect(page.getByRole('button', { name: 'Edit business details' })).toBeVisible();
  await page.getByRole('tab', { name: 'Google connection' }).click();
  await expect(page.getByRole('button', { name: 'Reconnect Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review website setup' })).toHaveAttribute('href', '/revamp');
  await expect(page.getByRole('link', { name: 'Previous website work' })).toHaveAttribute('href', '/revamp/history');
  await page.getByText('Redesigned your website?', { exact: true }).click();
  await page.getByRole('button', { name: 'Start website update' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toBeDisabled();
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await dialog.getByLabel('Confirm your password').fill(password);
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(dialog.getByLabel('Type DELETE to confirm')).toBeEmpty();
  await expect(dialog.getByLabel('Confirm your password')).toBeEmpty();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('tab', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Email progress updates' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Notifications', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(state.requests.filter(item => item.method !== 'GET')).toEqual([]);
  expect(state.requests.some(item => /content-keywords|focus-keywords|crawl-site|suggest-keywords/.test(item.path))).toBe(false);
  expect(await capture(paths)).toEqual(before);
  expect(state.errors).toEqual([]);
});

test('notification deep link survives sign-in and saves only the email preference', async ({ page }) => {
  const before = await capture(protectedPaths);
  const state = await openSettings(page, '/settings?tab=notifications');
  const choice = page.getByRole('switch', { name: 'Email progress updates' });
  await expect(choice).not.toBeChecked();
  await choice.click();
  await expect(page.getByRole('status')).toContainText('Your email choice is saved.');
  await page.reload();
  await expect(choice).toBeChecked();
  expect((await app.firestore().doc(`notificationPreferences/${uid}`).get()).data().emailEnabled).toBe(true);
  expect(state.requests.filter(item => item.method !== 'GET').map(item => item.path)).toEqual(['/api/notifications/preferences']);
  expect(await capture(protectedPaths)).toEqual(before);
  expect(state.errors).toEqual([]);
});

test('business editing retains failed input then persists without resetting saved work', async ({ page }) => {
  const before = await capture(protectedPaths);
  await openSettings(page);
  await page.getByRole('button', { name: 'Edit business details' }).click();
  await page.getByLabel('Business name', { exact: true }).fill('Updated Plumbing');
  await page.getByRole('checkbox', { name: /These services/ }).check();
  let fail = true;
  await page.route('**/api/onboarding/workspace', route => fail && route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable. Please retry.' } }) : route.fallback());
  await page.getByRole('button', { name: 'Confirm business details', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Business details' }).getByRole('alert')).toContainText('Temporarily unavailable');
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Updated Plumbing');
  fail = false;
  await page.getByRole('button', { name: 'Confirm business details', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit business details' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Updated Plumbing', { exact: true })).toBeVisible();
  expect((await app.firestore().doc(`onboarding/${uid}`).get()).data()).toMatchObject({ isComplete: true, revampRunId: 'settings-run', gscProperty: property, websiteUrl: property });
  expect(await capture(protectedPaths)).toEqual(before);
});

test('Google reconnect stays in settings, recovers from failure and preserves website work', async ({ page }) => {
  const before = await capture([...protectedPaths, `onboarding/${uid}`]);
  await openSettings(page, '/settings?tab=integrations');
  let fail = true, requestedProperty;
  await page.route('**/api/gsc/connect?*', route => {
    requestedProperty = new URL(route.request().url()).searchParams.get('property');
    return fail ? route.fulfill({ status: 503, json: { error: 'Google connection was cancelled. Your saved connection is unchanged.' } })
      : route.fulfill({ json: { state: 'test-state', url: 'http://127.0.0.1:3100/test-google-popup' } });
  });
  await page.context().route('**/test-google-popup', route => route.fulfill({ contentType: 'text/html',
    body: '<script>window.opener.postMessage({type:"GSC_AUTH_SUCCESS",state:"test-state",code:"test-code"},location.origin)</script>' }));
  await page.route('**/api/gsc/exchange-code', route => route.fulfill({ json: { success: true, connected: true, property } }));
  await page.getByRole('button', { name: 'Reconnect Google' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Google connection' }).getByRole('alert')).toContainText('Your saved connection is unchanged');
  await expect(page).toHaveURL(/settings\?tab=integrations$/);
  expect(requestedProperty).toBe(property);
  fail = false;
  await page.getByRole('button', { name: 'Reconnect Google' }).click();
  await expect(page.getByRole('status')).toContainText('Google is reconnected');
  await expect(page.getByRole('tabpanel', { name: 'Google connection' }).getByRole('alert')).toHaveCount(0);
  expect(await capture([...protectedPaths, `onboarding/${uid}`])).toEqual(before);
});

test('mobile keyboard tabs fit and old keyword links fall back to saved business details', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const state = await openSettings(page, '/settings?tab=integrations', { legacy: true });
  await page.getByRole('tab', { name: 'Google connection' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Notifications', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['Business details', 'Google connection', 'Notifications', 'Account']) {
    await page.getByRole('tab', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto('/settings?tab=content-keywords');
  await expect(page.getByRole('tab', { name: 'Business details' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Example Plumbing', { exact: true })).toBeVisible();
  await expect(page.getByText('Content & Keywords', { exact: true })).toHaveCount(0);
  expect(state.requests.some(item => /content-keywords|focus-keywords|crawl-site/.test(item.path))).toBe(false);
  expect(state.errors).toEqual([]);
});
