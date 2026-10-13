const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { createHmac, randomBytes } = require('node:crypto');
const secret = 'local-test-only-invitation-secret-123456789';
let app;
const ids = ['invite-alice', 'invite-bob', 'invite-admin', 'legacy-member'];
const password = 'Local-only-test123!';
const login = async (request, uid) => {
  const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: `${uid}@example.test`, password, returnSecureToken: true } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).idToken;
};
const seedInvite = async () => {
  const id = randomBytes(24).toString('hex');
  const token = `${id}.${createHmac('sha256', secret).update(`simplseo-early-access-v1:${id}`).digest('base64url')}`;
  await app.firestore().doc(`earlyAccessInvitations/${id}`).set({ email: 'different-invitation-inbox@example.test', requestId: id, status: 'pending', expiresAt: new Date(Date.now() + 86400000).toISOString(), userId: null });
  await app.firestore().doc(`accessRequests/${id}`).set({ email: 'different-invitation-inbox@example.test', status: 'invited', invitationId: id, requestedAt: new Date().toISOString() });
  await app.firestore().doc(`earlyAccessMail/${id}`).set({ requestId: id, kind: 'invitation', status: 'accepted', attempts: 1 });
  return { id, token };
};
const signInBrowser = async (page, uid) => {
  await page.goto('/auth'); await page.getByLabel('Email', { exact: true }).fill(`${uid}@example.test`); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Log In', exact: true }).click();
};
test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'early-access-browser');
  for (const uid of ids) {
    try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password, emailVerified: true }); } catch (error) { if (error.code !== 'auth/uid-already-exists') throw error; }
  }
  await app.firestore().doc('approvedUsers/legacy-member@example.test').set({ approvedAt: '2020-01-01' });
  await app.firestore().doc('onboarding/legacy-member').set({ isComplete: true, websiteUrl: 'https://example.test', gscProperty: 'sc-domain:example.test', postOnboardingStep: 'complete' });
  await app.firestore().doc('users/legacy-member').set({ websiteUrl: 'https://example.test' });
});
test.beforeEach(async () => {
  for (const collection of ['earlyAccessGrants', 'earlyAccessInvitations', 'earlyAccessMail', 'accessRequests', 'requestLimits']) {
    const snapshot = await app.firestore().collection(collection).get(); await Promise.all(snapshot.docs.map(d => d.ref.delete()));
  }
  for (const uid of ['invite-alice', 'invite-bob']) { await app.firestore().recursiveDelete(app.firestore().doc(`users/${uid}`)); await app.firestore().doc(`onboarding/${uid}`).delete(); }
});
test.afterAll(async () => { await app.delete(); });
test('public request entry, regular sign-in and request success fit desktop and mobile', async ({ page }) => {
  await page.goto('/home'); await page.getByRole('button', { name: 'Get started', exact: true }).first().click(); await expect(page).toHaveURL(/request-access/);
  await page.getByLabel('Your name').fill('Isolated tester'); await page.getByLabel('Where should we send your invitation?').fill('browser-request@example.test'); await page.getByRole('button', { name: 'Request invitation', exact: true }).click(); await expect(page.getByText('Your request is saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto('/home'); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
test('one link binds the chosen account, resumes onboarding and survives refresh', async ({ page }) => {
  const { id, token } = await seedInvite();
  await signInBrowser(page, 'invite-alice'); await expect(page.getByText('This account hasn’t joined early access yet.', { exact: false })).toBeVisible();
  await page.goto(`/accept-invite#token=${token}`); await expect(page.getByText('Joining as', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Accept invitation and continue', exact: true }).click(); await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
  expect((await app.firestore().doc(`earlyAccessInvitations/${id}`).get()).data().userId).toBe('invite-alice');
  await page.reload(); await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Get started', exact: true }).click(); await expect(page.getByLabel('Website address', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL(/auth/);
  await signInBrowser(page, 'invite-alice'); await expect(page).toHaveURL(/onboarding/); await expect(page.getByLabel('Website address', { exact: true })).toBeVisible();
});
test('concurrent verified accounts cannot both redeem one invitation; scans do not consume it', async ({ request }) => {
  const { id, token } = await seedInvite(), alice = await login(request, 'invite-alice'), bob = await login(request, 'invite-bob');
  expect((await request.post('/api/access/invitation', { data: { action: 'inspect', token } })).status()).toBe(200);
  expect((await app.firestore().doc(`earlyAccessInvitations/${id}`).get()).data().status).toBe('pending');
  const responses = await Promise.all([alice, bob].map(auth => request.post('/api/access/invitation', { headers: { Authorization: `Bearer ${auth}` }, data: { action: 'accept', token } })));
  expect(responses.map(r => r.status()).sort()).toEqual([200, 410]);
  const winner = (await app.firestore().doc(`earlyAccessInvitations/${id}`).get()).data().userId;
  const retry = await request.post('/api/access/invitation', { headers: { Authorization: `Bearer ${winner === 'invite-alice' ? alice : bob}` }, data: { action: 'accept', token } }); expect(retry.status()).toBe(200);
});
test('unapproved APIs and direct writes stay denied; an approved returning user goes to the dashboard', async ({ request, page }) => {
  const token = await login(request, 'invite-alice');
  expect((await request.get('/api/onboarding/workspace', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  for (const collection of ['earlyAccessGrants', 'earlyAccessInvitations', 'earlyAccessMail', 'earlyAccessLimits']) {
    expect((await request.patch(`http://127.0.0.1:8080/v1/projects/demo-simpleseo/databases/(default)/documents/${collection}/invite-alice`, { headers: { Authorization: `Bearer ${token}` }, data: { fields: { userId: { stringValue: 'invite-alice' } } } })).status()).toBe(403);
  }
  await signInBrowser(page, 'legacy-member'); await expect(page).toHaveURL(/dashboard/); await page.reload(); await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole('button', { name: 'Connect Google', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Account/ }).click(); await page.getByRole('menuitem', { name: /Log out/ }).click(); await expect(page).toHaveURL(/auth/);
  await signInBrowser(page, 'legacy-member'); await expect(page).toHaveURL(/dashboard/);
});
test('admin link restores after sign-in and non-admin cannot send invitations', async ({ page, request }) => {
  const token = await login(request, 'invite-alice');
  expect((await request.post('/api/admin/approve', { headers: { Authorization: `Bearer ${token}` }, data: { action: 'invite', email: 'someone@example.test' } })).status()).toBe(403);
  await page.goto('/admin/access-requests'); await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('invite-admin@example.test'); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/admin\/access-requests/); await expect(page.getByRole('button', { name: 'Send invitation', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an interrupted access check during setup offers a retry and preserves access', async ({ page }) => {
  const { token } = await seedInvite();
  await signInBrowser(page, 'invite-alice');
  await page.goto(`/accept-invite#token=${token}`);
  await page.getByRole('button', { name: 'Accept invitation and continue', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.route('**/api/access/status', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Access check temporarily unavailable.' }) }));
  await page.reload(); await expect(page.getByRole('button', { name: 'Retry access check', exact: true })).toBeVisible();
  await page.unroute('**/api/access/status');
  await page.getByRole('button', { name: 'Retry access check', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
});
