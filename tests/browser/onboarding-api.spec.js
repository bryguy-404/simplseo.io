const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');
const uid = 'onboarding-api-alice', foreign = 'onboarding-api-bob';
let app, token;
const profile = { businessName: 'Example Roofing', businessType: 'Roofer', services: ['Roof repair'], baseLocation: { city: 'South Bend', region: 'Indiana', country: 'United States' }, serviceAreas: ['South Bend'], goal: 'quotes', cmsPlatform: 'Custom' };
const base = `http://127.0.0.1:8080/v1/projects/demo-simpleseo/databases/(default)/documents`;
async function api(request, body, bearer = token, route = '/api/onboarding/workspace') {
  return body ? request.post(route, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, data: body }) : request.get(route, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
}
const input = (action, expectedRevision = 0, values = {}) => ({ action, expectedRevision, requestId: randomUUID(), ...values });
test.beforeAll(async ({ request }) => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'onboarding-api');
  for (const id of [uid, foreign]) {
    try { await app.auth().createUser({ uid: id, email: `${id}@example.test`, password: 'Test-only-pass123!' }); }
    catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  }
  const logged = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true } });
  token = (await logged.json()).idToken; expect(token).toBeTruthy();
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  await app.firestore().recursiveDelete(app.firestore().doc(`users/${uid}`));
  await app.firestore().doc(`onboarding/${uid}`).delete();
  await app.firestore().doc(`gscTokens/${uid}`).delete();
  await app.firestore().doc(`users/${uid}`).set({ createdAt: 'isolated' });
});
test('real API saves/restores incomplete setup without website, Google or paid work', async ({ request }) => {
  expect((await api(request, null, '')).status()).toBe(401);
  const started = await api(request, input('begin', 0, { legacyDraft: profile })); expect(started.status(), await started.text()).toBe(200);
  const saved = await api(request, input('save', 1, { websiteUrl: 'https://example.test/', currentStep: 'business', profileDraft: profile }));
  expect(saved.status(), await saved.text()).toBe(200);
  const restored = await api(request);
  const data = await restored.json(); expect(data.session).toMatchObject({ revision: 2, currentStep: 'business', profileDraft: profile });
  expect(data.session.google.status).toBe('not_connected'); expect(restored.headers()['cache-control']).toContain('no-store');
  expect((await app.firestore().doc(`onboarding/${uid}`).get()).data().isComplete).toBe(false);
  for (const collection of ['aiUsageEvents', 'onboardingUsageEvents', 'requestLimits']) expect((await app.firestore().collection(collection).where('userId', '==', uid).get()).empty).toBe(true);
});
test('real transactions reject stale edits and accept duplicate submissions only once', async ({ request }) => {
  await api(request, input('begin'));
  const payload = input('save', 1, { profileDraft: profile });
  const results = await Promise.all([api(request, payload), api(request, payload)]);
  expect(results.map(r => r.status())).toEqual([200, 200]);
  expect((await (await api(request)).json()).session.revision).toBe(2);
  const stale = await api(request, input('save', 1, { profileDraft: { ...profile, businessName: 'Stale edit' } })); expect(stale.status()).toBe(409);
  expect((await (await api(request)).json()).session.profileDraft.businessName).toBe(profile.businessName);
});
test('owner confirmation before Google is saved but cannot complete setup', async ({ request }) => {
  await api(request, input('begin'));
  const confirmed = await api(request, input('confirmProfile', 1, { profileDraft: profile, confirmed: true, currentStep: 'ready' }));
  expect(confirmed.status(), await confirmed.text()).toBe(200); expect((await confirmed.json()).session.profileConfirmed).toBe(true);
  const completed = await api(request, input('complete', 2)); expect(completed.status()).toBe(400);
  expect((await app.firestore().doc(`onboarding/${uid}`).get()).data().isComplete).toBe(false);
});
test('existing account profile changes preserve plans, legacy keyword-stage access, identity and dates', async ({ request }) => {
  const old = { isComplete: true, websiteUrl: 'example.test', gscProperty: 'sc-domain:example.test', revampRunId: 'original-run', postOnboardingStep: 'keywords' };
  await app.firestore().doc(`onboarding/${uid}`).set(old);
  await app.firestore().doc(`pageProgressCycles/${uid}-keep`).set({ userId: uid, confirmedAt: '2026-10-01', revision: 3 });
  await api(request, input('begin'));
  const confirmed = await api(request, input('confirmProfile', 1, { profileDraft: profile, confirmed: true })); expect(confirmed.status(), await confirmed.text()).toBe(200);
  expect((await app.firestore().doc(`onboarding/${uid}`).get()).data()).toMatchObject(old);
  expect((await app.firestore().doc(`pageProgressCycles/${uid}-keep`).get()).data()).toEqual({ userId: uid, confirmedAt: '2026-10-01', revision: 3 });
  const read = await api(request, null, token, '/api/business-profile'); expect((await read.json()).profile.status).toBe('confirmed');
});
test('setup/profile/credentials/evidence reject direct owner writes and reads', async ({ request }) => {
  await api(request, input('begin'));
  for (const path of [`users/${uid}/onboardingSessions/current`, `users/${uid}/pendingGscConnections/fake`, `users/${uid}/businessProfiles/fake`, `users/${foreign}/onboardingSessions/current`, ...['onboardingInventories','onboardingExtractions','onboardingUsageEvents','onboardingCrawlCache'].map(name => `${name}/${uid}`)]) {
    expect((await request.get(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status(), path).toBe(403);
    expect((await request.patch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` }, data: { fields: { revision: { integerValue: '99' } } } })).status(), path).toBe(403);
  }
  expect((await request.patch(`${base}/onboarding/${uid}?updateMask.fieldPaths=isComplete`, { headers: { Authorization: `Bearer ${token}` }, data: { fields: { isComplete: { booleanValue: true } } } })).status()).toBe(403);
});
test('expired/deleted accounts cannot recreate a setup through a save', async ({ request }) => {
  await api(request, input('begin'));
  await app.firestore().doc(`users/${uid}`).update({ deletionInProgress: true });
  expect((await api(request, input('save', 1, { profileDraft: profile }))).status()).toBe(409);
  expect((await app.firestore().doc(`users/${uid}/onboardingSessions/current`).get()).data().revision).toBe(1);
});
