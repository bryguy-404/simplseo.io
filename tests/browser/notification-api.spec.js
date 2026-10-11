const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

// Isolated demo Firebase only. Real compiled APIs and real transactions; no
// Google, OpenAI, Resend or production account requests are made by this suite.
const uid = 'notification-api-alice', property = 'https://example.test/', websiteRunId = 'notification-api-run';
const scope = { userId: uid, property, websiteUrl: property, websiteRunId };
const hash = value => createHash('sha256').update(value).digest('hex');
const eventId = hash(`${uid}-event`), cycleId = hash(`${uid}-cycle`), otherId = hash(`${uid}-foreign`);
const confirmedAt = '2026-08-01T12:00:00.000Z', at = '2026-10-11T10:00:00.000Z';
let app, token;
const event = () => ({ id: eventId, ...scope, pageUrl: property, pageName: 'Homepage', type: 'results_ready',
  title: 'Your page results are ready', message: 'Isolated example: both reporting periods are available.',
  occurredAt: at, observedAt: at, createdAt: at, updatedAt: at, status: 'active', readAt: null, emailDeliveryId: null,
  source: { collection: 'pageProgressCycles', id: cycleId, checkpointId: 'day-28' }, destination: { kind: 'existing_page', pageUrl: property, cycleId } });
const cycle = () => ({ id: cycleId, ...scope, pageUrl: property, lifecycle: 'active', confirmedAt, revision: 3,
  latestCheckpointId: 'day-28', latestCheckpoint: { id: 'day-28', day: 28, evidenceRevision: 1, source: 'google_search_console', state: 'available', observedAt: at,
    baseline: { startDate: '2026-07-04', endDate: '2026-07-31', status: 'no_data', clicks: 0, impressions: 0 },
    post: { startDate: '2026-08-02', endDate: '2026-08-29', status: 'no_data', clicks: 0, impressions: 0 } } });
async function call(request, path, body, method = body === undefined ? 'GET' : 'POST', bearer = token) {
  const response = await request.fetch(path, { method, headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, ...(body === undefined ? {} : { data: body }) });
  return { status: response.status(), data: await response.json(), cacheControl: response.headers()['cache-control'] };
}

test.beforeAll(async ({ request }) => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'notification-api-test');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, emailVerified: true, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  await app.auth().updateUser(uid, { email: `${uid}@example.test`, emailVerified: true });
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true },
  }); token = (await login.json()).idToken; expect(token).toBeTruthy();
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async ({ request }) => {
  for (const name of ['notificationPreferences', 'notificationEvents', 'notificationDeliveries', 'notificationIssueEpisodes', 'pageProgressCycles']) {
    for (const document of (await app.firestore().collection(name).where('userId', '==', uid).get()).docs) await app.firestore().recursiveDelete(document.ref);
  }
  await app.firestore().doc(`accountDeletionGuards/${hash(uid)}`).delete();
  await app.auth().updateUser(uid, { email: `${uid}@example.test`, emailVerified: true });
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true } });
  token = (await login.json()).idToken;
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
  await app.firestore().doc(`onboarding/${uid}`).set({ isComplete: true, postOnboardingStep: 'complete', gscProperty: property, websiteUrl: property, revampRunId: websiteRunId });
  await app.firestore().doc(`pageProgressCycles/${cycleId}`).set(cycle());
  await app.firestore().doc(`notificationEvents/${eventId}`).set(event());
});

test('saved inbox/detail reads expose real zero-activity comparison and perform no writes', async ({ request }) => {
  const before = (await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data();
  const list = await call(request, '/api/notifications?limit=5');
  expect(list.status, JSON.stringify(list.data)).toBe(200); expect(list.data.enabled).toBe(true);
  expect(list.data.unreadCount).toBe(1); expect(list.data.items[0]).toMatchObject({ id: eventId, active: true, readAt: null });
  expect(list.cacheControl).toContain('no-store');
  const detail = await call(request, `/api/notifications/${eventId}`);
  expect(detail.status, JSON.stringify(detail.data)).toBe(200); expect(detail.data.destination.href).toBe(`/low-ctr?page=${encodeURIComponent(property)}&cycleId=${cycleId}`);
  expect((await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data()).toEqual(before);
  expect((await app.firestore().doc(`notificationEvents/${eventId}`).get()).data()).toEqual(event());
  expect((await app.firestore().collection('notificationDeliveries').where('userId', '==', uid).get()).empty).toBe(true);
});

test('real idempotent mark-read changes only the notification, never publication or task dates', async ({ request }) => {
  const before = (await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data();
  const first = await call(request, `/api/notifications/${eventId}/read`, {});
  const second = await call(request, '/api/notifications/read', { id: eventId });
  expect(first.status, JSON.stringify(first.data)).toBe(200); expect(second.data.event.readAt).toBe(first.data.event.readAt);
  expect((await call(request, '/api/notifications')).data.unreadCount).toBe(0);
  expect((await app.firestore().doc(`pageProgressCycles/${cycleId}`).get()).data()).toEqual(before);
});

test('preference defaults, concurrent revision checks and verified-recipient changes use actual Firebase state', async ({ request }) => {
  const initial = await call(request, '/api/notifications/preferences');
  expect(initial.data).toMatchObject({ revision: 0, emailEnabled: false, chosenAt: null, recipient: `${uid}@example.test`, recipientVerified: true, sendingEnabled: false });
  const responses = await Promise.all([
    call(request, '/api/notifications/preferences', { expectedRevision: 0, emailEnabled: true, idempotencyKey: 'optin-a' }, 'PATCH'),
    call(request, '/api/notifications/preferences', { expectedRevision: 0, emailEnabled: false, idempotencyKey: 'optin-b' }, 'PATCH'),
  ]);
  expect(responses.map(value => value.status).sort()).toEqual([200, 409]);
  const saved = (await call(request, '/api/notifications/preferences')).data;
  await app.auth().updateUser(uid, { email: `${uid}-changed@example.test`, emailVerified: false });
  const relogin = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    data: { email: `${uid}-changed@example.test`, password: 'Test-only-pass123!', returnSecureToken: true } });
  token = (await relogin.json()).idToken;
  const changed = await call(request, '/api/notifications/preferences');
  expect(changed.status, JSON.stringify(changed.data)).toBe(200); expect(changed.data.emailEnabled).toBe(false); expect(changed.data.emailState).toBe('verify_email');
  expect((await call(request, '/api/notifications/preferences', { expectedRevision: saved.revision, emailEnabled: true }, 'PATCH')).status).toBe(409);
  await app.auth().updateUser(uid, { emailVerified: true });
  expect((await call(request, '/api/notifications/preferences')).data.emailState).toBe('confirm_new_email');
});

test('old scope links show history and completed decisions immediately stop the badge', async ({ request }) => {
  await app.firestore().doc(`pageProgressCycles/${cycleId}`).update({ latestDecision: { checkpointId: 'day-28', checkpointRevision: 1 } });
  expect((await call(request, '/api/notifications')).data.unreadCount).toBe(0);
  await app.firestore().doc(`onboarding/${uid}`).update({ revampRunId: 'rebuild-version' });
  const detail = await call(request, `/api/notifications/${eventId}`);
  expect(detail.status).toBe(200); expect(detail.data.destination).toMatchObject({ href: null, historical: true });
});

test('API auth, foreign IDs, deletion guards and disabled test sending fail closed', async ({ request }) => {
  expect((await call(request, '/api/notifications', undefined, 'GET', '')).status).toBe(401);
  expect((await call(request, '/api/notifications?userId=foreign')).status).toBe(403);
  await app.firestore().doc(`notificationEvents/${otherId}`).set({ ...event(), id: otherId, userId: 'foreign' });
  expect((await call(request, `/api/notifications/${otherId}`)).status).toBe(404);
  expect((await call(request, `/api/notifications/${otherId}/read`, {})).status).toBe(404);
  const email = await call(request, '/api/notifications/test-email', { idempotencyKey: 'test-disabled' });
  expect(email.status).toBe(409);
  expect((await app.firestore().collection('notificationDeliveries').where('userId', '==', uid).get()).empty).toBe(true);
  await app.firestore().doc(`accountDeletionGuards/${hash(uid)}`).set({ blocked: true });
  expect((await call(request, '/api/notifications')).status).toBe(409);
  expect((await call(request, `/api/notifications/${eventId}/read`, {})).status).toBe(409);
});

test('Firestore denies direct owner writes and reads for all authoritative notification records', async ({ request }) => {
  const base = 'http://127.0.0.1:8080/v1/projects/demo-simpleseo/databases/(default)/documents';
  for (const collection of ['notificationEvents', 'notificationPreferences', 'notificationDeliveries', 'notificationIssueEpisodes', 'notificationConnectionObservations', 'notificationJobs', 'notificationBudgets', 'notificationTestLimits']) {
    const path = `${collection}/${uid}`;
    await app.firestore().doc(path).set({ userId: uid, status: 'fixture' });
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.get(`${base}/${path}`, { headers })).status(), `${collection} private read`).toBe(403);
    expect((await request.patch(`${base}/${path}`, { headers, data: { fields: { userId: { stringValue: uid }, emailEnabled: { booleanValue: true } } } })).status(), `${collection} owner write`).toBe(403);
    expect((await request.delete(`${base}/${path}`, { headers })).status(), `${collection} owner delete`).toBe(403);
  }
});
