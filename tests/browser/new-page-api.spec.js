const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

// Actual Next APIs and Firestore transactions, confined to demo emulators.
// Run the test server with NEW_PAGE_GENERATION_ENABLED=false. A cache miss then
// fails locally before any model request; no publication or crawling is tested here.
const uid = 'new-page-api-alice';
const property = 'https://example.test/';
const websiteRunId = 'new-page-api-run';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope = { userId: uid, property, websiteUrl: property, websiteRunId, businessName: 'Fixture Plumbing', businessLocation: 'Mishawaka, Indiana' };
const scopeId = hash([uid, property, websiteRunId, property]);
const initialContext = { area: { name: 'Mishawaka', region: 'Indiana', country: 'United States' }, services: ['plumbing repairs'],
  facts: 'We repair plumbing in older Mishawaka homes and explain access arrangements.', confirmed: true };
const pageContent = { htmlTitle: 'Plumbing repair services', seoMetaDescription: 'Discuss plumbing repairs with Fixture Plumbing.', h1: 'Plumbing repairs',
  textContent: 'We provide general plumbing repairs. Tell us about the issue to discuss a repair and the access arrangements for your property.', fetchedAt: '2026-10-10T12:00:00.000Z' };
const idea = { id: 'fixture-idea', outcome: 'new_page', topic: 'Older-home plumbing repair decisions', service: 'plumbing repairs',
  intendedCustomer: 'Older-home owners', purpose: 'Explain repair access decisions', reason: 'The owner confirms real access arrangements.',
  distinctValue: 'Explain first-party repair and access arrangements for older Mishawaka homes.', existingPageUrl: null,
  searchFocus: { phrase: 'older home plumbing repair mishawaka', source: 'proposed' }, requiredFacts: [],
  checkedPageUrls: [`${property}services/plumbing`], uncertainPageUrls: [], evidenceIds: ['O1', 'P1'] };
const draft = { title: 'Owner-reviewed plumbing page', description: 'A factual description the owner reviewed.', h1: 'Older-home plumbing repairs', slug: '/older-home-plumbing',
  sections: [{ id: 'access', heading: 'Discuss access', body: 'Tell us about the plumbing issue and the access arrangements for your property.' }] };
let app, token;
const collections = ['newPageWorkspaces', 'newPageInventories', 'newPageAssessments', 'newPagePlans', 'newPagePublications', 'newPageJobs', 'requestLimits', 'aiUsageEvents'];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['fetchedAt', 'observedAt', 'checkedAt', 'lastAttemptAt', 'lastSuccessAt', 'updatedAt', 'createdAt', 'discoveredAt'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
}
async function call(page, endpoint, body, method = body === undefined ? 'GET' : 'POST', bearer = token) {
  return page.evaluate(async ({ endpoint, body, method, bearer }) => {
    const response = await fetch(`/api/new-page-plans${endpoint}`, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
  }, { endpoint, body, method, bearer });
}
async function seedAssessment(page, overrides = {}) {
  const workspace = await call(page, '');
  expect(workspace.status).toBe(200);
  // The disabled-generation setting makes a mismatched fingerprint fail closed.
  expect(workspace.body.enabled).toBe(false);
  const context = workspace.body.context;
  const inventory = workspace.body.inventory;
  const inventoryFingerprint = hash(stable({ pages: [[`${property}services/plumbing`, 'fetched', null, pageContent]], coverage: inventory.coverage }));
  const contextSignature = hash([context.area, context.services, context.facts]);
  const contextKey = hash([context.area.name, context.area.region, context.area.country, ...context.services.slice().sort()].map(value => value.toLowerCase().replace(/\s+/g, ' ').trim()));
  const id = hash([scopeId, contextKey]);
  const at = new Date().toISOString();
  const record = { ...scope, id, schemaVersion: 1, policyVersion: 1, context, outcome: 'new_page', summary: 'One evidence-backed fixture idea.', questions: [], ideas: [idea],
    inventoryFingerprint, fingerprint: hash({ version: 1, context: contextSignature, inventory: inventoryFingerprint, plans: [] }),
    research: { status: 'available', sources: [{ id: 'W1', url: 'https://www.mishawaka.in.gov/', title: 'City context' }], checkedAt: at },
    evidence: [{ id: 'O1', source: 'owner_confirmation', text: context.facts, observedAt: at }, { id: 'P1', source: 'website', url: `${property}services/plumbing`, text: pageContent.textContent, observedAt: at }],
    coverage: inventory.coverage, provenance: { inventoryId: scopeId, inventoryRevision: 1, generatedAt: at, searchStatus: 'available', model: 'fixture' },
    revision: 1, createdAt: at, updatedAt: at, ...overrides };
  await app.firestore().doc(`newPageAssessments/${id}`).set(record); return record;
}
async function setup(page) {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/auth');
  expect((await call(page, '/context', initialContext)).status).toBe(200);
}
test.beforeAll(async ({ request }) => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'new-page-actual-api-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
  const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: `${uid}@example.test`, password: 'Test-only-pass123!', returnSecureToken: true } });
  expect(response.ok()).toBeTruthy(); token = (await response.json()).idToken;
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  for (const name of collections) for (const doc of (await app.firestore().collection(name).where('userId', '==', uid).get()).docs) await app.firestore().recursiveDelete(doc.ref);
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property, gscAccessToken: 'non-provider-fixture-token', gscExpiresAt: Date.now() + 3600000 });
  await app.firestore().doc(`onboarding/${uid}`).set({ isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', gscProperty: property,
    websiteUrl: property, revampRunId: websiteRunId, businessName: scope.businessName, businessLocation: scope.businessLocation });
  await app.firestore().doc(`newPageInventories/${scopeId}`).set({ scope, userId: uid, generation: 'fixture-generation', revision: 1, initialized: true,
    robotsStatus: 'available', googleStatus: 'available', sitemaps: [{ url: `${property}sitemap.xml`, status: 'fetched' }],
    limitations: [], truncated: false, leaseUntil: null, updatedAt: new Date().toISOString() });
  await app.firestore().doc(`newPageInventories/${scopeId}/pages/fixture`).set({ url: `${property}services/plumbing`, status: 'fetched', reason: null, generation: 'fixture-generation', content: pageContent, sources: ['sitemap'], observedAt: pageContent.fetchedAt });
});

test('real authenticated GET/context switching/unchanged assessment use stored data with no AI allowance', async ({ page }) => {
  await setup(page);
  const second = { ...initialContext, area: { ...initialContext.area, name: 'South Bend' } };
  expect((await call(page, '/context', second)).status).toBe(200);
  expect((await call(page, '/context', initialContext)).status).toBe(200);
  const seeded = await seedAssessment(page);
  const checked = await call(page, '/analyze', {});
  expect(checked.status, JSON.stringify(checked.body)).toBe(200);
  expect(checked.body.unchanged).toBe(true); expect(checked.body.assessment.id).toBe(seeded.id);
  expect(checked.cacheControl).toContain('no-store');
  await page.reload();
  const loaded = await call(page, '');
  expect(loaded.body.contexts).toHaveLength(2); expect(loaded.body.context.area.name).toBe('Mishawaka');
  expect(loaded.body.assessments[0].context.facts).toBe(loaded.body.context.facts);
  expect((await app.firestore().collection('aiUsageEvents').where('userId', '==', uid).get()).size).toBe(0);
  expect((await app.firestore().collection('requestLimits').where('userId', '==', uid).get()).size).toBe(0);
});
test('real selection and owner edits survive reload while stale revisions fail', async ({ page }) => {
  await setup(page); const assessed = await seedAssessment(page);
  const selected = await call(page, '/select', { assessmentId: assessed.id, ideaId: idea.id });
  expect(selected.status, JSON.stringify(selected.body)).toBe(200);
  const saved = await call(page, '/plan', { planId: selected.body.plan.id, revision: 1, ownerFacts: 'Owner-confirmed access arrangements.', draft }, 'PATCH');
  expect(saved.status, JSON.stringify(saved.body)).toBe(200); expect(saved.body.plan.revision).toBe(2);
  expect((await call(page, '/plan', { planId: selected.body.plan.id, revision: 1, ownerFacts: 'STALE_OVERWRITE' }, 'PATCH')).status).toBe(409);
  await page.reload();
  const loaded = await call(page, '');
  expect(loaded.body.plans[0].hasDraft).toBe(true); expect(loaded.body.plans[0].draft).toBeUndefined();
  const opened = await call(page, `/plan?planId=${selected.body.plan.id}`);
  expect(opened.status).toBe(200); expect(opened.body.plan.draft).toMatchObject(draft);
  expect(opened.body.plan.ownerFacts).toBe('Owner-confirmed access arrangements.');
  const repeated = await call(page, '/select', { assessmentId: assessed.id, ideaId: idea.id });
  expect(repeated.body.plan.revision).toBe(2); expect(repeated.body.plan.draft.title).toBe(draft.title);
  const stored = (await app.firestore().doc(`newPagePlans/${selected.body.plan.id}`).get()).data();
  expect(stored.userId).toBe(uid); expect(stored.draft.title).toBe(draft.title);
});
test('real handlers reject anonymous calls, supplied other identities and foreign saved IDs', async ({ page }) => {
  await setup(page); const assessed = await seedAssessment(page);
  for (const [endpoint, method] of [['', 'GET'], ['/context', 'POST'], ['/analyze', 'POST'], ['/inventory', 'POST'], ['/inventory/retire', 'POST'], ['/areas', 'POST'], ['/select', 'POST'], ['/draft', 'POST'], ['/publish', 'POST'], ['/tracking', 'POST'], ['/plan', 'PATCH'], ['/plan?planId=foreign', 'GET']]) {
    expect((await call(page, endpoint, method === 'GET' ? undefined : {}, method, '')).status, endpoint).toBe(401);
  }
  expect((await call(page, '/context', { ...initialContext, userId: 'another-account' })).status).toBe(403);
  await app.firestore().doc(`newPageAssessments/${assessed.id}`).update({ userId: 'another-account' });
  expect((await call(page, '/select', { assessmentId: assessed.id, ideaId: idea.id })).status).toBe(404);
  expect((await app.firestore().collection('newPagePlans').where('userId', '==', uid).get()).size).toBe(0);
  await app.firestore().doc('newPagePlans/foreign-api-plan').set({ userId: 'another-account', draft });
  expect((await call(page, '/plan?planId=foreign-api-plan')).status).toBe(404);
});
test('real scope guards isolate a rebuild and preserve prior plans as read-only history', async ({ page }) => {
  await setup(page); const assessed = await seedAssessment(page);
  const selected = await call(page, '/select', { assessmentId: assessed.id, ideaId: idea.id });
  expect(selected.status).toBe(200);
  await app.firestore().doc(`onboarding/${uid}`).update({ revampRunId: 'next-website' });
  expect((await call(page, '/plan', { planId: selected.body.plan.id, revision: 1, status: 'dismissed' }, 'PATCH')).status).toBe(409);
  const loaded = await call(page, '');
  expect(loaded.status, JSON.stringify(loaded.body)).toBe(200); expect(loaded.body.plans).toEqual([]);
  expect(loaded.body.history[0]).toMatchObject({ id: selected.body.plan.id, historyType: 'previous_website', readOnly: true });
  const openedHistory = await call(page, `/plan?planId=${selected.body.plan.id}`);
  expect(openedHistory.status).toBe(200); expect(openedHistory.body.plan.readOnly).toBe(true);
  await app.firestore().doc(`onboarding/${uid}`).update({ gscProperty: 'https://changed.test/' });
  expect((await call(page, '')).status).toBe(409);
});
test('real selection rejects coverage that changed after the saved assessment', async ({ page }) => {
  await setup(page); const assessed = await seedAssessment(page);
  await app.firestore().doc(`newPageInventories/${scopeId}/pages/fixture`).update({ 'content.textContent': 'The website now provides extensive separate coverage for older-home plumbing repair decisions and access arrangements.' });
  await app.firestore().doc(`newPageInventories/${scopeId}`).update({ revision: 2 });
  const result = await call(page, '/select', { assessmentId: assessed.id, ideaId: idea.id });
  expect(result.status).toBe(409); expect(result.body.error).toContain('coverage has changed');
  expect((await app.firestore().collection('newPagePlans').where('userId', '==', uid).get()).size).toBe(0);
});

test('real inventory service suggestions remove supported location variants and survive owner confirmation and reload', async ({ page }) => {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/auth');
  await app.firestore().doc(`onboarding/${uid}`).update({ businessLocation: 'Riverton, WY' });
  await app.firestore().doc(`newPageInventories/${scopeId}/pages/fixture`).delete();
  const observedAt = new Date().toISOString();
  const pages = [
    ['web-design', 'Web design — Riverton, WY'],
    ['web-design/lakeside-wy', 'Web design in Lakeside, WY'],
    ['web-design/accessibility', 'Website accessibility audits'],
  ];
  for (const [index, [path, h1]] of pages.entries()) {
    await app.firestore().doc(`newPageInventories/${scopeId}/pages/service-${index}`).set({ url: `${property}services/${path}`, status: 'fetched', reason: null, generation: 'fixture-generation', sources: ['sitemap'], observedAt,
      content: { ...pageContent, h1, htmlTitle: h1, fetchedAt: observedAt } });
  }
  const suggested = await call(page, '');
  expect(suggested.status, JSON.stringify(suggested.body)).toBe(200);
  expect(suggested.body.context).toBe(null);
  expect(suggested.body.business.services).toEqual(expect.arrayContaining(['Web design', 'Website accessibility audits']));
  expect(suggested.body.business.services).toHaveLength(2);
  const confirmed = { area: { name: 'Riverton', region: 'Wyoming', country: 'United States' }, services: suggested.body.business.services, facts: 'We offer these services in Riverton.', confirmed: true };
  const saved = await call(page, '/context', confirmed);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  await page.reload();
  const restored = await call(page, '');
  expect(restored.body.context.services).toEqual(confirmed.services);
  expect(restored.body.context.area).toEqual(confirmed.area);
  const ownerLabels = ['Heating, cooling and ventilation', 'Custom service for Riverton, WY'];
  expect((await call(page, '/context', { ...confirmed, services: ownerLabels })).status).toBe(200);
  expect((await call(page, '')).body.context.services).toEqual(ownerLabels);
  expect((await app.firestore().collection('aiUsageEvents').where('userId', '==', uid).get()).size).toBe(0);
  expect((await app.firestore().collection('requestLimits').where('userId', '==', uid).get()).size).toBe(0);
});

test('real service validation distinguishes missing and excessive services and preserves commas within twelve labels', async ({ page }) => {
  await setup(page);
  const empty = await call(page, '/context', { ...initialContext, services: [] });
  expect(empty.status).toBe(400); expect(empty.body.error).toBe('Add at least one service you offer, with one service per line.');
  const tooMany = await call(page, '/context', { ...initialContext, services: Array.from({ length: 13 }, (_, index) => `Repair service ${index + 1}`) });
  expect(tooMany.status).toBe(400); expect(tooMany.body.error).toContain('12');
  const invalid = await call(page, '/context', { ...initialContext, services: ['A'.repeat(121)] });
  expect(invalid.status).toBe(400); expect(invalid.body.error).toContain('120');
  const labels = Array.from({ length: 12 }, (_, index) => `Specialized service ${index + 1}, including repairs`);
  const saved = await call(page, '/context', { ...initialContext, services: [...labels, `  ${labels[0].toUpperCase()}  `] });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.context.services).toEqual(labels);
  await page.reload();
  expect((await call(page, '')).body.context.services).toEqual(labels);
});
