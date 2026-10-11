const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const projectId = 'demo-simpleseo';
const base = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const uid = 'rules-alice';
let app;
let token;

function field(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  return { mapValue: { fields: fields(value) } };
}
const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, field(item)]));
async function patch(request, path, values, mask = true) {
  const suffix = mask ? `?${Object.keys(values).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&')}` : '';
  return request.patch(`${base}/${path}${suffix}`, { headers: { Authorization: `Bearer ${token}` }, data: { fields: fields(values) } });
}
const read = (request, path) => request.get(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });

test.beforeAll(async ({ request }) => {
  // Explicit demo project + loopback endpoints: this spec cannot seed production.
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId }, 'phase2-rules-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error; }
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true } });
  token = (await login.json()).idToken;
  expect(token).toBeTruthy();
  const seed = {
    [`onboarding/${uid}`]: { isComplete: true, revampRunId: 'rules-run', progressReviewRequired: true, revampMonitoringEnabled: true, revampPages: [{ url: 'https://example.test/page', impressions: 2 }] },
    [`users/${uid}`]: { gscRefreshToken: 'fake-owner-only-fixture' },
    [`gscTokens/${uid}`]: { refreshToken: 'fake-owner-only-fixture' },
    [`users/${uid}/revampHistory/rules-run`]: { complete: true },
    [`implementedSeoTips/${uid}_protected`]: { userId: uid, pageUrl: 'https://example.test/page', progressAssessment: { status: 'insufficient_data' }, gscToken: 'legacy-fixture-token' },
    [`contentAuditResults/${uid}_audit`]: { userId: uid, audit: 'saved' },
    [`internalLinkSuggestions/${uid}_link`]: { userId: uid },
    'seoMetaTitles/ownerless-meta': { title: 'Unattributable legacy record' },
    'seoMetaDescriptions/ownerless-meta': { description: 'Unattributable legacy record' },
    'seoMetaTitles/bob-owned-meta': { userId: 'rules-bob', title: 'Private' },
    'pageContentCache/rules-bob/pages/private': { userId: 'rules-bob' },
    'intentMismatches/rules-bob/analyses/private': { userId: 'rules-bob' },
  };
  for (const [path, data] of Object.entries(seed)) await app.firestore().doc(path).set(data);
});
test.afterAll(async () => { await app?.delete(); });

test('monitoring and recovery cannot be forged, deleted or recreated by the owner', async ({ request }) => {
  for (const values of [
    { progressReviewRequired: false }, { revampPages: [{ url: 'https://example.test/page', impressions: 999 }] },
    { revampRunId: 'fake' }, { revampMonitoringEnabled: false }, { revampStatus: 'idle' }, { revampDate: null },
  ]) expect((await patch(request, `onboarding/${uid}`, values)).status()).toBe(403);
  expect((await request.delete(`${base}/onboarding/${uid}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  expect((await patch(request, `onboarding/${uid}`, { isComplete: true }, false)).status()).toBe(403);
  expect((await read(request, `onboarding/${uid}`)).status()).toBe(200);
});

test('new onboarding allows safe defaults but denies fabricated server state on create', async ({ request }) => {
  // Admin removes only this isolated fixture between create attempts.
  await app.firestore().doc(`onboarding/${uid}`).delete();
  try {
    expect((await patch(request, `onboarding/${uid}`, { isComplete: true, progressReviewRequired: false }, false)).status()).toBe(403);
    expect((await patch(request, `onboarding/${uid}`, { isComplete: true, revampPages: [{ impressions: 999 }] }, false)).status()).toBe(403);
    expect((await patch(request, `onboarding/${uid}`, { businessName: 'Fixture', isComplete: true, revampStatus: 'idle', revampPages: [], revampDate: null, revampStep: null, lastSiteCrawlAt: null, siteCrawlStatus: 'idle' }, false)).status()).toBe(403);
    expect((await patch(request, `onboarding/${uid}`, { businessName: 'Fixture', isComplete: false, revampStatus: 'idle', revampPages: [], revampDate: null, revampStep: null, lastSiteCrawlAt: null, siteCrawlStatus: 'idle' }, false)).status()).toBe(200);
    expect((await patch(request, `onboarding/${uid}`, { businessName: 'Updated', revampReminderDate: '2026-11-01' })).status()).toBe(200);
  } finally {
    await app.firestore().doc(`onboarding/${uid}`).set({ isComplete: true, revampRunId: 'rules-run', progressReviewRequired: true });
  }
});

test('account deletion guards remain private and cannot be removed by a still-signed-in owner', async ({ request }) => {
  const hash = require('node:crypto').createHash('sha256').update(uid).digest('hex');
  const path = `accountDeletionGuards/${hash}`;
  await app.firestore().doc(path).set({ blocked: true, deletedAt: '2026-10-11T00:00:00Z' });
  expect((await read(request, path)).status()).toBe(403);
  expect((await patch(request, path, { blocked: false })).status()).toBe(403);
  expect((await request.delete(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
});

test('authoritative assessments cannot be fabricated, changed, removed or delete-recreated', async ({ request }) => {
  const path = `implementedSeoTips/${uid}_protected`;
  expect((await patch(request, path, { progressAssessment: { status: 'improved' } })).status()).toBe(403);
  expect((await patch(request, path, { userId: uid, pageUrl: 'https://example.test/page' }, false)).status()).toBe(403);
  expect((await request.delete(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  expect((await patch(request, `implementedSeoTips/${uid}_forged`, { userId: uid, progressAssessment: { status: 'improved' } }, false)).status()).toBe(403);
  expect((await patch(request, `implementedSeoTips/${uid}_credential`, { userId: uid, gscToken: 'fake-token' }, false)).status()).toBe(403);
  expect((await patch(request, path, { gscToken: 'replacement-token' })).status()).toBe(403);
  expect((await patch(request, path, { ongoingCycleId: 'forged', implementedAt: '2000-01-01', status: 'reviewed' })).status()).toBe(403);
  expect((await patch(request, path, { implementedMetaTitle: 'A real user edit', postStats: { impressions: 99 } })).status()).toBe(403);
  // Only the authenticated publication API can create/reset a tracked cycle.
  expect((await patch(request, path, { userId: uid, pageUrl: 'https://example.test/page', progressAssessment: { status: 'insufficient_data' } }, false)).status()).toBe(403);
});

test('ongoing cycles, observations and decisions are server-owned even for the account owner', async ({ request }) => {
  for (const path of [`pageProgressCycles/${uid}`, `pageProgressCycles/${uid}/observations/baseline`, `pageProgressCycles/${uid}/decisions/fake`]) {
    await app.firestore().doc(path).set({ userId: uid, revision: 1 });
    expect((await read(request, path)).status()).toBe(403);
    expect((await patch(request, path, { userId: uid, revision: 2 })).status()).toBe(403);
    expect((await request.delete(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  }
});

test('client writes retain ownership and archived history remains immutable', async ({ request }) => {
  for (const path of [`implementedSeoTips/${uid}_protected`, `contentAuditResults/${uid}_audit`, `internalLinkSuggestions/${uid}_link`]) {
    expect((await patch(request, path, { userId: 'rules-bob' })).status()).toBe(403);
  }
  expect((await patch(request, `users/${uid}/revampHistory/rules-run`, { complete: false })).status()).toBe(403);
  expect((await patch(request, `users/${uid}/revampHistory/rules-run/records/fake`, { data: 'fake' }, false)).status()).toBe(403);
  expect((await patch(request, `implementedSeoTips/${uid}_new`, { userId: uid, pageUrl: 'https://example.test/new', status: 'implemented' }, false)).status()).toBe(403);
  expect((await read(request, `implementedSeoTips/${uid}_missing`)).status()).toBe(404);
});

test('a client cannot occupy another accounts future legacy document IDs', async ({ request }) => {
  for (const collection of ['implementedSeoTips', 'contentAuditResults', 'aiSuggestions', 'pageContentCache', 'intentMismatches', 'internalLinkSuggestions']) {
    const id = `rules-bob_claimed-by-${uid}`;
    await app.firestore().doc(`${collection}/${id}`).delete();
    expect((await patch(request, `${collection}/${id}`, { userId: uid, pageUrl: 'https://example.test/page' }, false)).status(), collection).toBe(403);
  }
});

test('ownerless legacy meta caches and another users nested records stay private', async ({ request }) => {
  for (const path of ['seoMetaTitles/ownerless-meta', 'seoMetaDescriptions/ownerless-meta', 'seoMetaTitles/bob-owned-meta', 'pageContentCache/rules-bob/pages/private', 'intentMismatches/rules-bob/analyses/private']) {
    expect((await read(request, path)).status()).toBe(403);
    expect((await patch(request, path, { userId: uid, title: 'stolen' })).status()).toBe(403);
    expect((await request.delete(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  }
  expect((await patch(request, 'seoMetaTitles/new-shared-flat-key', { userId: uid, title: 'Claimed shared namespace' }, false)).status()).toBe(403);
  expect((await patch(request, `seoMetaTitles/${uid}/titles/fixture`, { userId: uid, title: 'Owned cache' }, false)).status()).toBe(200);
  expect((await read(request, `seoMetaTitles/${uid}/titles/fixture`)).status()).toBe(200);
});

test('token mutation and every server-managed collection are denied to clients', async ({ request }) => {
  for (const path of [`users/${uid}`, `gscTokens/${uid}`]) {
    expect((await read(request, path)).status()).toBe(200); // Remaining legacy Google API compatibility.
    expect((await patch(request, path, { gscRefreshToken: 'forged' })).status()).toBe(403);
    expect((await request.delete(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  }
  for (const collection of ['focusKeywords', 'siteCrawls', 'contentKeywordEdits', 'conversations', 'gscOAuthStates', 'progressJobs', 'cronRuns', 'requestLimits', 'aiUsageEvents', 'pageReviewPlans', 'genericKeywordsCache', 'skippedKeywords', 'createdContentOpportunities', 'trainingEvents', 'playbookStrategies', 'conversationSummaries', 'appConfig', 'accessRequests', 'approvedUsers', 'invitationCodes', 'contactMessages', 'deletedUsers']) {
    expect((await patch(request, `${collection}/${uid}`, { userId: uid }, false)).status(), collection).toBe(403);
  }
});

test('AI accounting is private even from its account owner and cannot be altered by clients', async ({ request }) => {
  const path = `aiUsageEvents/${uid}-research`;
  await app.firestore().doc(path).set({ userId: uid, stage: 'research', inputTokens: 2000 });
  expect((await read(request, path)).status()).toBe(403);
  expect((await patch(request, path, { inputTokens: 0 })).status()).toBe(403);
  expect((await request.delete(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
});

test('new-page evidence, saved drafts, publication observations and jobs are server-owned', async ({ request }) => {
  for (const collection of ['newPageWorkspaces', 'newPageInventories', 'newPageAssessments', 'newPagePlans', 'newPagePublications', 'newPageJobs']) {
    const path = `${collection}/${uid}-fixture`;
    await app.firestore().doc(path).set({ userId: uid, revision: 1, status: 'draft' });
    expect((await read(request, path)).status(), collection).toBe(403);
    expect((await patch(request, path, { status: 'published' })).status(), collection).toBe(403);
    expect((await request.delete(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status(), collection).toBe(403);
    expect((await patch(request, `${path}/pages/forged`, { userId: uid }, false)).status(), collection).toBe(403);
  }
  const retirement = `newPageInventories/${uid}-fixture/retirements/url-hash`;
  expect((await patch(request, retirement, { userId: uid, active: true, httpStatus: 404 }, false)).status()).toBe(403);
  await app.firestore().doc(retirement).set({ userId: uid, active: true, httpStatus: 404, ownerConfirmedAt: '2026-10-10T12:00:00Z' });
  expect((await read(request, retirement)).status()).toBe(403);
  expect((await patch(request, retirement, { httpStatus: 200, active: false })).status()).toBe(403);
  expect((await request.delete(`${base}/${retirement}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
});
