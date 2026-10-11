const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');

// Real routes and Firestore projections against the isolated demo emulators.
// This account has no provider credentials; these requests only read saved work.
const uid = 'dashboard-work-api-alice';
const property = 'https://example.test/';
const websiteRunId = 'dashboard-work-api-run';
const scope = { userId: uid, property, websiteUrl: property, websiteRunId };
const at = '2026-10-11T12:00:00.000Z';
const collections = ['pageReviewPlans', 'pageProgressCycles', 'implementedSeoTips', 'newPagePlans', 'newPagePublications'];
let app, token;
const id = suffix => `${uid}-${suffix}`;
const metrics = clicks => ({ status: 'has_data', startDate: '2026-09-01', endDate: '2026-09-28', fetchedAt: at,
  clicks, impressions: 200, position: 12.25, queries: [{ query: 'PRIVATE SEARCH QUERY' }], property, pageUrl: property });
const plan = () => ({ ...scope, pageUrl: property, revision: 4, updatedAt: at, createdAt: at,
  tasks: [
    { id: 'edit', status: 'todo', priority: 'first', recommendation: { type: 'content', label: 'Explain the service', instruction: 'PRIVATE LONG TASK' }, draft: 'PRIVATE OWNER COPY' },
    { id: 'check', status: 'done', recommendation: { type: 'check', label: 'Inspect the page' } },
    { id: 'published', status: 'done', recommendation: { type: 'heading', label: 'Clarify the heading' }, publication: { implementedAt: '2026-09-01T12:00:00Z' } },
  ], review: { input: 'PRIVATE FULL PAGE' } });
const cycle = pageUrl => ({ ...scope, pageUrl, lifecycle: 'active', reviewStatus: 'review_due', revision: 3,
  confirmedAt: '2026-09-01T12:00:00Z', nextReviewAt: '2026-10-30', latestCheckpointId: 'day-28',
  latestCheckpoint: { id: 'day-28', day: 28, evidenceRevision: 2, state: 'available', observedAt: at,
    baseline: metrics(5), post: metrics(6), lowVolume: false, privateContent: 'PRIVATE CHECKPOINT' },
  latestDecision: { id: 'decision', outcome: 'keep_monitoring', summary: 'Keep monitoring this page.', nextStep: 'Review the next period.',
    checkpointId: 'day-28', checkpointRevision: 1, proposedTasks: [{ instruction: 'PRIVATE PROPOSED TASK' }] },
  technical: { checkedAt: at, issues: [{ code: 'noindex', message: 'A previous check found noindex.', checkedAt: '2026-10-01T12:00:00Z', stale: true }], errors: { publicPage: 'temporarily_unavailable' } },
});
const newPlan = () => ({ ...scope, status: 'draft', revision: 1, createdAt: at, updatedAt: at,
  idea: { topic: 'Drain repair', purpose: 'PRIVATE PURPOSE' }, context: { area: { name: 'South Bend', region: 'Indiana', country: 'United States' }, facts: 'PRIVATE FACTS' },
  draft: { h1: 'Drain repair', copy: 'PRIVATE DRAFT' } });
async function call(request, query = '', bearer = token) {
  const response = await request.get(`/api/dashboard/work${query}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
  return { status: response.status(), data: await response.json(), cacheControl: response.headers()['cache-control'] };
}
test.beforeAll(async ({ request }) => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'dashboard-saved-work-api');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, emailVerified: true, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true },
  });
  expect(response.ok()).toBe(true); token = (await response.json()).idToken;
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  for (const name of collections) {
    const docs = (await app.firestore().collection(name).where('userId', '==', uid).get()).docs;
    if (docs.length) { const batch = app.firestore().batch(); docs.forEach(doc => batch.delete(doc.ref)); await batch.commit(); }
  }
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
  await app.firestore().doc(`onboarding/${uid}`).set({ isComplete: true, postOnboardingStep: 'complete', gscProperty: property, websiteUrl: property, revampRunId: websiteRunId });
});

test('real projected saved work keeps exact dates, counts and independent observations without writes', async ({ request }) => {
  const values = {
    [`pageReviewPlans/${id('plan')}`]: plan(),
    [`pageProgressCycles/${id('cycle')}`]: cycle(property),
    [`implementedSeoTips/${id('legacy')}`]: { userId: uid, gscProperty: property, websiteRunId, pageUrl: property, status: 'implemented', implementedAt: '2026-09-01T12:00:00Z' },
    [`newPagePlans/${id('draft')}`]: { ...newPlan(), status: 'published', publicationId: id('publication') },
    [`newPagePublications/${id('publication')}`]: { ...scope, planId: id('draft'), pageUrl: `${property}drains`,
      ownerDeclaredAt: '2026-10-01T12:00:00Z', verifiedAt: '2026-10-01T12:01:00Z', publicPage: { status: 'available', warnings: ['Different canonical'], content: 'PRIVATE CONTENT' },
      activity: { rolling: metrics(4), sinceVerified: { status: 'collecting' } }, preexistingActivity: metrics(2),
      indexing: { status: 'available', verdict: 'NEUTRAL', fetchedAt: at }, lastError: { indexing: 'temporarily_unavailable' } },
  };
  const batch = app.firestore().batch(); Object.entries(values).forEach(([path, data]) => batch.set(app.firestore().doc(path), data)); await batch.commit();
  const result = await call(request);
  expect(result.status, JSON.stringify(result.data)).toBe(200); expect(result.cacheControl).toContain('no-store');
  expect(result.data.items).toHaveLength(4); expect(result.data.coverage.partial).toBe(false);
  expect(result.data.items.find(item => item.kind === 'plan').taskCounts).toEqual({ todo: 1, done: 2, published: 1, needs_review: 0, dismissed: 0 });
  const savedCycle = result.data.items.find(item => item.kind === 'cycle');
  expect(savedCycle.nextReviewAt).toBe('2026-10-30'); expect(savedCycle.confirmedAt).toBe('2026-09-01T12:00:00Z');
  expect(savedCycle.latestCheckpoint).toMatchObject({ evidenceRevision: 2, observedAt: at, baseline: { clicks: 5, startDate: '2026-09-01', endDate: '2026-09-28' }, post: { clicks: 6, position: 12.25 } });
  expect(savedCycle.latestDecision.checkpointRevision).toBe(1);
  expect(savedCycle.technical.issues[0].stale).toBe(true);
  expect(result.data.items.find(item => item.kind === 'legacy').activeCycle.id).toBe(id('cycle'));
  expect(result.data.items.find(item => item.kind === 'new_page')).toMatchObject({ hasDraft: true, publication: {
    ownerDeclaredAt: '2026-10-01T12:00:00Z', verifiedAt: '2026-10-01T12:01:00Z', indexing: { verdict: 'NEUTRAL' },
    activity: { rolling: { clicks: 4 }, sinceVerified: { status: 'collecting', clicks: null } }, preexistingActivity: { clicks: 2 },
  } });
  expect(JSON.stringify(result.data)).not.toContain('PRIVATE');
  for (const [path, data] of Object.entries(values)) expect((await app.firestore().doc(path).get()).data()).toEqual(data);
  for (const name of ['aiUsageEvents', 'requestLimits']) expect((await app.firestore().collection(name).where('userId', '==', uid).get()).empty).toBe(true);
});

test('real scoped pagination excludes old websites before limiting and advances filtered legacy pages', async ({ request }) => {
  const batch = app.firestore().batch();
  for (let index = 0; index < 22; index++) {
    batch.set(app.firestore().doc(`pageReviewPlans/${id(`p${String(index).padStart(2, '0')}`)}`), plan());
    batch.set(app.firestore().doc(`newPagePlans/${id(`n${String(index).padStart(2, '0')}`)}`), newPlan());
    batch.set(app.firestore().doc(`pageReviewPlans/${id(`a-old-${index}`)}`), { ...plan(), websiteRunId: 'old' });
  }
  for (let index = 0; index < 12; index++) batch.set(app.firestore().doc(`implementedSeoTips/${id(`a-old-${index}`)}`), {
    userId: uid, gscProperty: property, websiteRunId: 'old', pageUrl: property, status: 'implemented', implementedAt: at,
  });
  batch.set(app.firestore().doc(`implementedSeoTips/${id('z-current')}`), { userId: uid, gscProperty: property, websiteRunId, pageUrl: property, status: 'implemented', implementedAt: at });
  await batch.commit();
  const first = await call(request); expect(first.status, JSON.stringify(first.data)).toBe(200);
  expect(first.data.items.filter(item => item.kind === 'plan')).toHaveLength(10);
  expect(first.data.items.filter(item => item.kind === 'new_page')).toHaveLength(10);
  expect(first.data.items.filter(item => item.kind === 'legacy')).toHaveLength(0);
  expect(first.data.coverage).toMatchObject({ partial: true, countsAreComplete: false });
  const second = await call(request, `?cursor=${encodeURIComponent(first.data.nextCursor)}`);
  expect(second.data.items.filter(item => item.kind === 'legacy')).toHaveLength(1);
  const third = await call(request, `?cursor=${encodeURIComponent(second.data.nextCursor)}`);
  expect(third.data.nextCursor).toBeNull();
  const all = [...first.data.items, ...second.data.items, ...third.data.items];
  expect(all).toHaveLength(45); expect(new Set(all.map(item => `${item.kind}:${item.id}`)).size).toBe(45);
  expect(all.some(item => item.id.includes('a-old'))).toBe(false);
});

test('real authentication and scope guards reject forged inputs and old continuation', async ({ request }) => {
  expect((await call(request, '', '')).status).toBe(401);
  expect((await call(request, '?userId=other')).status).toBe(403);
  expect((await call(request, '?property=https://other.test/')).status).toBe(400);
  const batch = app.firestore().batch();
  for (let index = 0; index < 11; index++) batch.set(app.firestore().doc(`pageReviewPlans/${id(`p${index}`)}`), plan());
  await batch.commit(); const first = await call(request);
  await app.firestore().doc(`onboarding/${uid}`).update({ revampRunId: 'rebuild' });
  expect((await call(request, `?cursor=${encodeURIComponent(first.data.nextCursor)}`)).status).toBe(400);
  expect((await call(request)).data.items).toEqual([]);
  await app.firestore().doc(`users/${uid}`).update({ deletionInProgress: true });
  expect((await call(request)).status).toBe(409);
});
