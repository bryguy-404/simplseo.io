const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');

// Real routes and Firestore transactions, isolated from providers by a missing
// Google connection. This deliberately verifies durable enrollment on failure.
const uid = 'monitor-api-alice', property = 'https://example.test/', pageUrl = `${property}Service/?Area=A`;
let app, token;
async function call(request, body, bearer = token) {
  const response = await request.post('/api/page-review/monitor', { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, data: body });
  return { status: response.status(), body: await response.json() };
}
test.beforeAll(async ({ request }) => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'monitor-api-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true } });
  expect(response.ok()).toBeTruthy(); token = (await response.json()).idToken;
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  for (const name of ['pageProgressCycles', 'pageTrackingStates', 'pageReviewPlans', 'requestLimits', 'aiUsageEvents', 'implementedSeoTips']) {
    for (const doc of (await app.firestore().collection(name).where('userId', '==', uid).get()).docs) await app.firestore().recursiveDelete(doc.ref);
  }
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
  await app.firestore().doc(`onboarding/${uid}`).set({ isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete',
    gscProperty: property, websiteUrl: property, revampRunId: 'monitor-api-run' });
});

test('real start persists despite review failure, concurrent retries reuse it, and stop/restart preserves history', async ({ request }) => {
  const first = await call(request, { action: 'start', pageUrl });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body.cycle).toMatchObject({ mode: 'monitoring', lifecycle: 'active', initialReviewStatus: 'failed' });
  expect(first.body.cycle.confirmedAt).toBeUndefined(); expect(first.body.cycle.confirmation).toBeUndefined();
  const retries = await Promise.all([call(request, { action: 'start', pageUrl }), call(request, { action: 'start', pageUrl })]);
  expect(retries.every(result => result.status === 200 && result.body.cycle.id === first.body.cycle.id)).toBe(true);
  const ref = app.firestore().doc(`pageProgressCycles/${first.body.cycle.id}`), saved = (await ref.get()).data();
  const stopped = await call(request, { action: 'stop', cycleId: saved.id, expectedRevision: saved.revision });
  expect(stopped.status).toBe(200); expect(stopped.body.cycle.lifecycle).toBe('stopped');
  const restarted = await call(request, { action: 'start', pageUrl });
  expect(restarted.status).toBe(200); expect(restarted.body.cycle.id).not.toBe(saved.id);
  const cycles = await app.firestore().collection('pageProgressCycles').where('userId', '==', uid).get();
  expect(cycles.size).toBe(2); expect(cycles.docs.filter(doc => doc.data().lifecycle === 'active')).toHaveLength(1);
  expect((await ref.get()).data().startedAt).toBe(saved.startedAt);
  expect((await app.firestore().collection('implementedSeoTips').where('userId', '==', uid).get()).empty).toBe(true);
  expect((await app.firestore().collection('aiUsageEvents').where('userId', '==', uid).get()).empty).toBe(true);
});

test('real monitor route rejects anonymous, forged owners and foreign properties', async ({ request }) => {
  expect((await call(request, { action: 'start', pageUrl }, '')).status).toBe(401);
  expect((await call(request, { action: 'start', pageUrl, userId: 'foreign' })).status).toBe(403);
  expect((await call(request, { action: 'start', pageUrl: 'https://other.test/' })).status).toBe(403);
  expect((await app.firestore().collection('pageProgressCycles').where('userId', '==', uid).get()).empty).toBe(true);
});
