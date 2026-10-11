const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

// Real compiled routes + demo Firestore. No provider calls: there is no mature
// checkpoint, and the isolated technical fixture is inside the shared cache.
// The isolated server enables the pilot only for this fixture account.
const uid = 'ongoing-api-alice';
const property = 'https://example.test/';
const pageUrl = `${property}Service/?Area=A`;
const websiteRunId = 'ongoing-api-run';
const cycleId = createHash('sha256').update('ongoing-api-cycle').digest('hex');
const foreignId = createHash('sha256').update('ongoing-api-foreign').digest('hex');
let app, token;

async function call(page, path, body, bearer = token) {
  return page.evaluate(async ({ path, body, bearer }) => {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
  }, { path, body, bearer });
}
test.beforeAll(async ({ request }) => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'ongoing-real-api-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true } });
  expect(response.ok()).toBeTruthy(); token = (await response.json()).idToken;
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async ({ page }) => {
  for (const name of ['pageProgressCycles', 'pageReviewPlans', 'requestLimits', 'aiUsageEvents']) for (const doc of (await app.firestore().collection(name).where('userId', '==', uid).get()).docs) await app.firestore().recursiveDelete(doc.ref);
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property, gscAccessToken: 'non-provider-demo-token', gscExpiresAt: Date.now() + 3600000 });
  await app.firestore().doc(`onboarding/${uid}`).set({ isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', progressReviewRequired: false,
    gscProperty: property, websiteUrl: property, revampRunId: websiteRunId });
  const now = new Date().toISOString();
  await app.firestore().doc(`pageProgressCycles/${cycleId}`).set({ id: cycleId, schemaVersion: 1, revision: 1, userId: uid, property, websiteRunId, pageUrl,
    confirmedAt: now, createdAt: now, lifecycle: 'active', reviewStatus: 'collecting', latestCheckpoint: null, latestCheckpointId: null, latestDecision: null, latestDecisionId: null,
    confirmation: { source: 'owner_reported', taskIds: [], taskLabels: [], summary: 'Isolated fixture: clarified the service introduction.' },
    technical: { checkedAt: now, publicPage: { status: 'available', finalUrl: pageUrl, noindex: false, checkedAt: now }, indexing: { status: 'unavailable', checkedAt: now }, issues: [], errors: null },
    nextCheckAt: now, nextReviewAt: now.slice(0, 10), lastAttemptAt: null, lastError: null, leaseId: null, leaseUntil: null });
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/auth');
});

test('real scoped progress and saved follow-up GET perform no writes or paid work', async ({ page }) => {
  const before = (await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data();
  const loaded = await call(page, `/api/progress?pageUrl=${encodeURIComponent(pageUrl)}`);
  expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
  expect(loaded.body.ongoing.enabled).toBe(true);
  expect(loaded.body.ongoing.records.map(cycle => cycle.id)).toEqual([cycleId]);
  const saved = await call(page, `/api/page-review/follow-up?cycleId=${cycleId}`);
  expect(saved.status).toBe(200); expect(saved.body.decision).toBeNull(); expect(saved.cacheControl).toContain('no-store');
  expect((await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data()).toEqual(before);
  expect((await app.firestore().collection('aiUsageEvents').where('userId', '==', uid).get()).empty).toBe(true);
  expect((await app.firestore().collection('requestLimits').where('userId', '==', uid).get()).empty).toBe(true);
});

test('real early review saves a collecting decision without AI, resetting publication, or losing it on reload', async ({ page }) => {
  const before = (await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data();
  const reviewed = await call(page, '/api/page-review/follow-up', { cycleId, expectedRevision: 1, action: 'review' });
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  expect(reviewed.body.decision.outcome).toBe('gather_evidence'); expect(reviewed.body.decision.canAcceptTasks).toBe(false);
  expect(reviewed.body.cycle.confirmedAt).toBe(before.confirmedAt); expect(reviewed.body.cycle.lifecycle).toBe('active');
  await page.reload();
  const restored = await call(page, `/api/page-review/follow-up?cycleId=${cycleId}`);
  expect(restored.body.decision.id).toBe(reviewed.body.decision.id);
  const currentRevision = restored.body.cycle.revision;
  const diagnostic = await call(page, '/api/page-review/follow-up', { cycleId, expectedRevision: currentRevision, action: 'troubleshoot' });
  expect(diagnostic.status).toBe(200); expect(diagnostic.body.cycle.confirmedAt).toBe(before.confirmedAt);
  expect((await call(page, '/api/page-review/follow-up', { cycleId, expectedRevision: 1, action: 'review' })).status).toBe(409);
  expect((await app.firestore().collection('aiUsageEvents').where('userId', '==', uid).get()).empty).toBe(true);
  expect((await app.firestore().collection('requestLimits').where('userId', '==', uid).get()).empty).toBe(true);
});

test('real follow-up routes reject anonymous, other-account, and changed-property writes', async ({ page }) => {
  expect((await call(page, `/api/page-review/follow-up?cycleId=${cycleId}`, undefined, '')).status).toBe(401);
  expect((await call(page, '/api/page-review/follow-up', { cycleId, expectedRevision: 1, action: 'review' }, '')).status).toBe(401);
  expect((await call(page, '/api/page-review/follow-up', { cycleId, expectedRevision: 1, action: 'review', userId: 'foreign-user' })).status).toBe(403);
  await app.firestore().doc(`pageProgressCycles/${foreignId}`).set({ ...(await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data(), id: foreignId, userId: 'foreign-user' });
  expect((await call(page, `/api/page-review/follow-up?cycleId=${foreignId}`)).status).toBe(404);
  await app.firestore().doc(`onboarding/${uid}`).update({ gscProperty: 'https://other.test/' });
  expect((await call(page, '/api/page-review/follow-up', { cycleId, expectedRevision: 1, action: 'review' })).status).toBe(409);
  expect((await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data().revision).toBe(1);
});
