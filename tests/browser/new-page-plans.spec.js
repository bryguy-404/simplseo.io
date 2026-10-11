const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');

// Demo-only UI fixtures. No production writes, model requests or publication.
const uid = 'new-page-alice';
const property = 'https://example.test/';
const now = '2026-10-11T01:00:00.000Z';
const area = { name: 'South Bend', region: 'Indiana', country: 'United States' };
const otherArea = { name: 'Mishawaka', region: 'Indiana', country: 'United States' };
const context = { area, services: ['Drain cleaning'], facts: 'We provide drain cleaning in South Bend.', confirmed: true };
const idea = { id: 'drain-page', outcome: 'new_page', topic: 'Drain cleaning in South Bend', service: 'Drain cleaning',
  purpose: 'Help customers understand the drain service and how to request a quote.', reason: 'The website lists this service but has no page explaining the process.',
  distinctValue: 'Explain the confirmed service process and booking information.', existingPageUrl: null,
  searchFocus: { phrase: 'drain cleaning south bend', source: 'proposed' }, requiredFacts: ['What happens when a customer requests drain cleaning?'], evidenceIds: ['P1'] };
const draft = { title: 'Drain Cleaning in South Bend | Example', description: 'Learn about drain cleaning in South Bend and request a quote.',
  h1: 'Drain cleaning in South Bend', slug: '/drain-cleaning', sections: [{ id: 'process', heading: 'How to get help', body: 'Tell us about the drainage issue. We discuss the next step with you.' }],
  links: [{ url: property, text: 'Our plumbing services', placement: 'Link from the homepage service summary.' }], optionalPrompts: ['Add a real local project example if you have one.'] };
const inventory = { revision: 1, status: 'ready', coverage: { discovered: 2, fetched: 2, limitations: ['A bounded review, not a complete website census.'] }, canContinue: false, updatedAt: now,
  pages: [{ url: property, title: 'Example Plumbing', status: 'fetched' }, { url: `${property}services`, status: 'fetched' }] };
const summarizePlan = plan => ({ id: plan.id, revision: plan.revision, status: plan.status, context: { area: plan.context.area, services: plan.context.services }, idea: { id: plan.idea.id, topic: plan.idea.topic, service: plan.idea.service, searchFocus: plan.idea.searchFocus }, hasDraft: Boolean(plan.draft), createdAt: plan.createdAt, updatedAt: plan.updatedAt, readOnly: Boolean(plan.readOnly), historyType: plan.historyType });
const makeAssessment = (overrides = {}) => ({ id: 'assessment-south-bend', context, outcome: 'new_page', summary: 'One useful service gap was found.', ideas: [idea],
  research: { status: 'available', sources: [{ url: 'https://example.org/research', title: 'Public context' }] }, updatedAt: now, ...overrides });
const makePlan = (overrides = {}) => ({ id: 'plan-drain', revision: 1, status: 'draft', context, idea, draft: structuredClone(draft), requiredFacts: idea.requiredFacts,
  ownerFacts: 'We discuss the drainage issue with the customer and arrange the next step.', createdAt: now, updatedAt: now, ...overrides });
let app;

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'new-page-ui-tests');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
});
test.afterAll(async () => { await app?.delete(); });
test.beforeEach(async () => {
  await app.firestore().doc(`onboarding/${uid}`).set({ name: 'New page test', websiteUrl: property, gscProperty: property,
    isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', revampRunId: 'new-page-ui-run', progressReviewRequired: false, revampPages: [] });
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: property });
});

async function setup(page, overrides = {}, { expandSteps = true, path = '/generic-keywords' } = {}) {
  const state = { data: { enabled: true, business: { name: 'Example Plumbing', websiteUrl: property, location: 'South Bend', services: ['Drain cleaning'] },
    context: structuredClone(context), inventory: structuredClone(inventory), assessments: [makeAssessment()], plans: [makePlan()], history: [], ...overrides },
    calls: [], errors: [], saveFails: false, redirect: false, ready: Promise.resolve(), block: '', analysis: null, nextInventory: null, nextServices: null, contextError: null, analysisError: null, inventoryError: null };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('hasSeenChatAssistant', 'true'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (url.pathname.startsWith('/api/new-page-plans')) {
      const endpoint = url.pathname.slice('/api/new-page-plans'.length);
      const method = route.request().method();
      const body = method === 'GET' ? null : route.request().postDataJSON();
      state.calls.push({ endpoint, body, method, planId: url.searchParams.get('planId') });
      if (state.block && state.block === endpoint) await state.ready;
      if (!endpoint) return json({ ...state.data, contexts: state.data.contexts || [...new Map(state.data.assessments.map(item => [item.context.area.name, item.context])).values()], assessments: state.data.assessments.filter(item => JSON.stringify(item.context) === JSON.stringify(state.data.context)), plans: state.data.plans.map(summarizePlan), history: state.data.history.map(item => item.idea ? summarizePlan(item) : item) });
      if (endpoint === '/plan' && method === 'GET') {
        const plan = [...state.data.plans, ...state.data.history].find(item => item.id === url.searchParams.get('planId'));
        return plan ? json({ plan }) : json({ error: 'Saved work not found.' }, 404);
      }
      if (endpoint === '/context') { if (state.contextError) return json({ error: state.contextError }, 400); state.data.context = body; return json({ context: body }); }
      if (endpoint === '/areas') return json({ areas: [{ ...otherArea, reason: 'Nearby community in Indiana.', sourceUrl: 'https://example.org/mishawaka' }] });
      if (endpoint === '/inventory/retire') {
        if (body.inventoryRevision !== state.data.inventory.revision) return json({ error: 'Your website review changed. Reload it before confirming this page.' }, 409);
        const restoring = body.action === 'restore';
        state.data.inventory = { ...state.data.inventory, revision: state.data.inventory.revision + 1, status: restoring ? 'running' : 'ready', canContinue: restoring,
          pages: state.data.inventory.pages.map(item => body.urls.includes(item.url) ? { ...item, status: restoring ? 'pending' : 'retired', reason: restoring ? null : 'owner_confirmed_removed' } : item) };
        state.data.inventory.coverage = { ...state.data.inventory.coverage, retired: state.data.inventory.pages.filter(item => item.status === 'retired').length };
        state.data.assessments = state.data.assessments.map(item => ({ ...item, coverageChanged: true }));
        return json({ inventory: state.data.inventory });
      }
      if (endpoint === '/inventory') { if (state.inventoryError) return json({ error: state.inventoryError }, 503); state.data.inventory = state.nextInventory || inventory; if (state.nextServices) state.data.business = { ...state.data.business, services: state.nextServices }; return json({ inventory: state.data.inventory }); }
      if (endpoint === '/analyze') {
        if (state.analysisError) return json({ error: state.analysisError }, 503);
        const assessment = state.analysis || state.data.assessments.find(item => item.context.area.name === state.data.context.area.name) || makeAssessment({ id: 'assessment-other', context: state.data.context, outcome: 'no_opportunity', ideas: [] });
        state.data.assessments = [assessment, ...state.data.assessments.filter(item => item.id !== assessment.id)];
        return json({ assessment, unchanged: !state.analysis, message: 'Your saved website evidence has not changed. This check did not recrawl your live website.' });
      }
      if (endpoint === '/select') {
        const plan = makePlan({ draft: null, ownerFacts: '', context: state.data.context });
        state.data.plans = [plan]; return json({ plan });
      }
      const plan = state.data.plans.find(item => item.id === body.planId);
      if (endpoint === '/draft') {
        if (plan.draft) plan.proposedDraft = { ...draft, title: 'Updated title to review' };
        else plan.draft = structuredClone(draft);
        plan.ownerFacts = body.ownerFacts; plan.revision++;
        return json({ plan });
      }
      if (endpoint === '/plan') {
        if (state.saveFails) return json({ error: 'Saving is temporarily unavailable. Your saved version is unchanged.' }, 503);
        if (body.revision !== plan.revision) return json({ error: 'This plan changed. Reload before saving.' }, 409);
        for (const key of ['draft', 'ownerFacts', 'status']) if (Object.hasOwn(body, key)) plan[key] = body[key];
        if (body.acceptProposed) { plan.draft = plan.proposedDraft; delete plan.proposedDraft; }
        plan.revision++; return json({ plan });
      }
      if (endpoint === '/publish') {
        if (state.redirect && !body.confirmRedirect) return json({ error: 'Confirm the destination before tracking it.', code: 'confirm_redirect', destination: `${property}drain-cleaning/` }, 409);
        const publication = { pageUrl: state.redirect ? `${property}drain-cleaning/` : body.pageUrl, verifiedAt: now, ownerDeclaredAt: now,
          publicPage: { warnings: [] }, indexing: null, activity: null };
        plan.revision++; plan.status = 'published'; plan.publication = publication;
        plan.tracking = { indexing: null, activity: null, reviewDue: null };
        return json({ plan, publication, tracking: plan.tracking });
      }
      if (endpoint === '/tracking') return json({ publication: plan.publication, tracking: plan.tracking });
      return json({ error: 'Unexpected route' }, 500);
    }
    if (url.pathname.startsWith('/api/generic-keywords/')) throw new Error('Legacy paid generator was called');
    if (url.pathname === '/api/progress') return json({ records: [], history: [] });
    if (url.pathname === '/api/dashboard/overview') return json({ source: 'google_search_console', property, window: { startDate: '2026-09-10', endDate: '2026-10-07' }, totals: { impressions: 3, clicks: 1 }, pages: [], daily: [] });
    return json({ success: true, keywords: [], pages: [], tips: [], suggestions: [], conversations: [], data: [] });
  });
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 20000 });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'New page ideas', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('main', { name: 'New page planning workspace' })).toHaveAttribute('aria-busy', 'false');
  if (expandSteps) { await openArea(page); await openWebsiteReview(page); }
  return state;
}
async function openArea(page) {
  const control = page.getByRole('button', { name: 'Edit area and services', exact: true });
  if (await control.isVisible()) await control.click();
}
async function openWebsiteReview(page) {
  const control = page.getByRole('button', { name: 'View website review details', exact: true });
  if (await control.isVisible()) await control.click();
}
async function openPlan(page) {
  await page.getByRole('button', { name: 'Open saved plan', exact: true }).click();
  return page.getByRole('region', { name: 'Selected page plan', exact: true });
}

test('opening and reloading only restores saved work, without paid generation or legacy calls', async ({ page }) => {
  const state = await setup(page);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  await expect(page.getByRole('link', { name: 'Extra Opportunities', exact: true })).toHaveCount(0);
  state.block = '/plan'; state.ready = new Promise(resolve => { state.release = resolve; });
  await openPlan(page);
  await expect(page.getByRole('status').filter({ hasText: 'Loading your saved plan…' })).toBeVisible();
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveCount(0);
  state.release();
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue(draft.title);
  await page.screenshot({ path: '/private/tmp/simpleseo-phase6-desktop.png' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open saved plan' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Page opportunity assessment' })).toContainText(idea.topic);
  await openArea(page);
  await page.getByText('Add helpful business facts (optional)', { exact: true }).click();
  await expect(page.getByLabel('What should we know about your work in this area?')).toHaveValue(context.facts);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  expect(state.errors).toEqual([]);
});

test('changed service area requires actual service confirmation and a save before research', async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel('City or service area').fill('Mishawaka');
  await expect(page.getByRole('checkbox', { name: 'My business offers these services in this area.' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Save this area', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Find useful page ideas', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find useful page ideas', exact: true })).toBeEnabled();
  expect(state.calls.filter(call => call.endpoint === '/context')[0].body.area.name).toBe('Mishawaka');
  expect(state.calls.filter(call => call.endpoint === '/analyze')).toHaveLength(0);
});

test('nearby area suggestions are explicit, sourced and never silently confirm service coverage', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Suggest nearby areas', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Source', exact: true })).toHaveAttribute('href', 'https://example.org/mishawaka');
  await page.getByRole('button', { name: 'Choose this area', exact: true }).click();
  await expect(page.getByLabel('City or service area')).toHaveValue('Mishawaka');
  await expect(page.getByRole('checkbox', { name: 'My business offers these services in this area.' })).not.toBeChecked();
  expect(state.calls.filter(call => call.endpoint === '/areas')).toHaveLength(1);
  expect(state.calls.filter(call => call.endpoint === '/context')).toHaveLength(0);
});

test('resumable website review shows loading and needs an explicit continuation', async ({ page }) => {
  const state = await setup(page, { inventory: { ...inventory, status: 'running', coverage: 'partial', canContinue: true }, assessments: [], plans: [] });
  state.block = '/inventory'; state.ready = new Promise(resolve => { state.release = resolve; });
  await page.getByRole('button', { name: 'Continue website review' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reviewing your website…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find useful page ideas' })).toBeDisabled();
  state.release();
  await expect(page.getByRole('button', { name: 'Find useful page ideas' })).toBeEnabled();
  expect(state.calls.filter(call => call.endpoint === '/inventory')).toHaveLength(1);
  expect(state.calls.filter(call => call.endpoint === '/analyze')).toHaveLength(0);
});

test('no opportunity is a useful result with no forced generation action', async ({ page }) => {
  const state = await setup(page, { assessments: [], plans: [] });
  state.analysis = makeAssessment({ outcome: 'no_opportunity', ideas: [], summary: 'Existing service pages already cover this area.' });
  await page.getByRole('button', { name: 'Find useful page ideas' }).click();
  await expect(page.getByRole('heading', { name: 'No new page needed right now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan this page' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Improve an existing page', exact: true })).toHaveAttribute('href', '/low-ctr');
  expect(state.calls.filter(call => call.endpoint === '/draft')).toHaveLength(0);
});

test('existing coverage leads to the exact page and insufficient evidence offers no draft', async ({ page }) => {
  const existing = { ...idea, id: 'covered', outcome: 'improve_existing', existingPageUrl: `${property}services/drains`, requiredFacts: [] };
  const unknown = { ...idea, id: 'unknown', topic: 'Additional plumbing services', outcome: 'needs_information' };
  await setup(page, { assessments: [makeAssessment({ outcome: 'needs_information', ideas: [existing, unknown] })], plans: [] });
  await expect(page.getByRole('link', { name: 'Improve this existing page' })).toHaveAttribute('href', `/low-ctr?page=${encodeURIComponent(existing.existingPageUrl)}`);
  await expect(page.getByRole('button', { name: 'Plan this page' })).toHaveCount(0);
  await expect(page.getByText('What happens when a customer requests drain cleaning?', { exact: true })).toBeVisible();
});

test('draft generation waits for selected idea and required owner facts', async ({ page }) => {
  const state = await setup(page, { plans: [] });
  await page.getByRole('button', { name: 'Plan this page' }).click();
  await expect(page.getByRole('button', { name: 'Prepare my draft' })).toBeDisabled();
  expect(state.calls.filter(call => call.endpoint === '/draft')).toHaveLength(0);
  await page.getByLabel('Facts for this page').fill('We discuss the drainage issue and arrange a visit.');
  await page.getByRole('button', { name: 'Prepare my draft' }).click();
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue(draft.title);
  expect(state.calls.filter(call => call.endpoint === '/draft')).toHaveLength(1);
});

test('owner draft edits persist after save and refresh without generating a replacement', async ({ page }) => {
  const state = await setup(page);
  await openPlan(page);
  await page.getByLabel('Main heading (H1)', { exact: true }).fill('Get help with a blocked drain in South Bend');
  await expect(page.getByRole('button', { name: 'I published this page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save my edits', exact: true }).click();
  await expect(page.getByText('Your draft is saved.', { exact: true })).toBeVisible();
  await page.reload(); await openPlan(page);
  await expect(page.getByLabel('Main heading (H1)', { exact: true })).toHaveValue('Get help with a blocked drain in South Bend');
  expect(state.calls.filter(call => call.endpoint === '/draft')).toHaveLength(0);
  expect(state.data.plans[0].revision).toBe(2);
});

test('a failed save keeps the owner’s unsaved wording available for retry', async ({ page }) => {
  const state = await setup(page); state.saveFails = true;
  await openPlan(page);
  await page.getByLabel('SEO title', { exact: true }).fill('My carefully edited title');
  await page.getByRole('button', { name: 'Save my edits', exact: true }).click();
  await expect(page.getByRole('main', { name: 'New page planning workspace' }).getByRole('alert')).toContainText('Saving is temporarily unavailable');
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue('My carefully edited title');
  expect(state.data.plans[0].draft.title).toBe(draft.title);
  state.saveFails = false;
  await page.getByRole('button', { name: 'Save my edits', exact: true }).click();
  await expect(page.getByText('Your draft is saved.', { exact: true })).toBeVisible();
});

test('unchanged checks preserve edited draft and do not call draft generation', async ({ page }) => {
  const state = await setup(page); const original = structuredClone(state.data.plans[0]);
  await openPlan(page);
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your saved website evidence has not changed. This check did not recrawl your live website.' })).toBeVisible();
  expect(state.data.plans[0]).toEqual(original);
  expect(state.calls.filter(call => call.endpoint === '/draft')).toHaveLength(0);
});

test('updated draft is reviewable and cannot silently replace owner wording', async ({ page }) => {
  const state = await setup(page);
  await openPlan(page);
  await page.getByText('Need to revise the draft?', { exact: true }).click();
  await page.getByRole('button', { name: 'Prepare updated draft' }).click();
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue(draft.title);
  await page.getByText('An updated draft is ready to review', { exact: true }).click();
  await expect(page.getByText('Updated title to review', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this reviewed draft', exact: true }).click();
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue('Updated title to review');
  expect(state.data.plans[0].draft.title).toBe('Updated title to review');
});

test('publication requires a live URL and explicit confirmation; cancellation writes nothing', async ({ page }) => {
  const state = await setup(page); await openPlan(page);
  await page.getByRole('button', { name: 'I published this page', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Verify and start tracking' })).toBeDisabled();
  await dialog.getByLabel('Published page URL').fill(`${property}drain-cleaning`);
  await expect(dialog.getByRole('button', { name: 'Verify and start tracking' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Not yet' }).click();
  expect(state.calls.filter(call => call.endpoint === '/publish')).toHaveLength(0);
  expect(state.data.plans[0].status).toBe('draft');
});

test('redirect destination needs confirmation and then shows separate tracking observations', async ({ page }) => {
  const state = await setup(page); state.redirect = true; await openPlan(page);
  await page.getByRole('button', { name: 'I published this page', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Published page URL').fill(`${property}drain-cleaning`);
  await dialog.getByRole('checkbox', { name: 'I opened this live page and checked that my content is published.' }).check();
  await dialog.getByRole('button', { name: 'Verify and start tracking' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Confirm the destination');
  await expect(dialog.getByRole('button', { name: 'Verify and start tracking' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /This URL redirects to/ }).check();
  await dialog.getByRole('button', { name: 'Verify and start tracking' }).click();
  await expect(page.getByRole('region', { name: 'New page tracking' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Google indexing', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Published · collecting data', exact: true })).toBeVisible();
  expect(state.calls.filter(call => call.endpoint === '/publish').map(call => call.body.confirmRedirect)).toEqual([false, true]);
  expect(state.calls.filter(call => call.endpoint === '/publish')[1].body.confirmedRedirectUrl).toBe(`${property}drain-cleaning/`);
});

test('retained tracking data shows failed refresh and review reminders without claiming success', async ({ page }) => {
  const observation = { status: 'has_data', startDate: '2026-09-10', endDate: '2026-10-07', clicks: 2, impressions: 30, position: 12.5 };
  const publication = { pageUrl: `${property}drain-cleaning`, verifiedAt: '2026-08-01T12:00:00Z', publicPage: { warnings: ['This page declares a different canonical URL.'] } };
  const tracking = { indexing: { status: 'available', coverageState: 'Submitted and indexed', fetchedAt: now, inspectionUrl: 'https://search.google.com/search-console/inspect' },
    activity: { rolling: observation, sinceVerified: observation }, preexistingActivity: { ...observation, clicks: 1 }, lastError: { activity: 'temporarily_unavailable' }, reviewDue: '28_day_review' };
  await setup(page, { plans: [makePlan({ status: 'published', publication, tracking })] }); await openPlan(page);
  await expect(page.getByText('The latest tracking check was incomplete.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your 4-week review is due' })).toBeVisible();
  await expect(page.getByText('12.5', { exact: true })).toHaveCount(2);
  await expect(page.getByText('This URL had earlier search activity.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'I published this page' })).toHaveCount(0);
});

test('areas keep independent plans and saved areas can be restored without paid generation', async ({ page }) => {
  const otherContext = { ...context, area: otherArea };
  const state = await setup(page, { assessments: [makeAssessment(), makeAssessment({ id: 'other-assessment', context: otherContext, outcome: 'no_opportunity', ideas: [] })] });
  await page.getByLabel('Return to a saved area').selectOption('mishawaka, indiana, united states');
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No new page needed right now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open saved plan', exact: true })).toHaveCount(0);
  await openArea(page);
  await page.getByLabel('Return to a saved area').selectOption('south bend, indiana, united states');
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Page opportunity assessment' })).toContainText(idea.topic);
  await openArea(page);
  await page.getByText('Add helpful business facts (optional)', { exact: true }).click();
  await expect(page.getByLabel('What should we know about your work in this area?')).toHaveValue(context.facts);
  await openPlan(page);
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue(draft.title);
  expect(state.calls.filter(call => ['/analyze', '/draft'].includes(call.endpoint))).toHaveLength(0);
  expect(state.calls.filter(call => call.endpoint === '' && call.method === 'GET')).toHaveLength(3);
});

test('mobile controls fit the screen and the publication dialog supports keyboard cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page); await openPlan(page);
  await page.getByLabel('Main heading (H1)', { exact: true }).focus();
  await expect(page.getByLabel('Main heading (H1)', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'I published this page', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: '/private/tmp/simpleseo-phase6-mobile.png', fullPage: true });
});

test('website review can discover services before the first owner confirmation', async ({ page }) => {
  const state = await setup(page, { context: null, inventory: null, assessments: [], plans: [], business: { name: 'Example Plumbing', websiteUrl: property, location: '', services: [] } });
  state.nextInventory = { ...inventory, pages: [{ url: `${property}services/drain-cleaning`, status: 'fetched', content: { h1: 'Drain cleaning in South Bend, IN' } }] };
  state.nextServices = ['Drain cleaning'];
  await expect(page.getByRole('button', { name: 'Review my website' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review my website' }).click();
  await expect(page.getByLabel('Services offered here')).toHaveValue('Drain cleaning');
  await expect(page.getByRole('checkbox', { name: 'My business offers these services in this area.' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Find useful page ideas' })).toBeDisabled();
  expect(state.calls.filter(call => ['/analyze', '/draft'].includes(call.endpoint))).toHaveLength(0);
  expect(state.calls.filter(call => call.endpoint === '' && call.method === 'GET')).toHaveLength(2);
});

test('generation pause keeps saved drafting edits and publication available', async ({ page }) => {
  const state = await setup(page, { enabled: false });
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
  await openPlan(page);
  await expect(page.getByLabel('SEO title', { exact: true })).toBeEnabled();
  await page.getByLabel('SEO title', { exact: true }).fill('Saved during research pause');
  await page.getByRole('button', { name: 'Save my edits' }).click();
  await expect(page.getByRole('button', { name: 'I published this page', exact: true })).toBeEnabled();
  await page.getByText('Need to revise the draft?', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prepare updated draft' })).toBeDisabled();
  expect(state.data.plans[0].draft.title).toBe('Saved during research pause');
});

test('changing services hides a stale area assessment while preserving previous saved plans', async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel('Services offered here').fill('Water heater repair');
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Page opportunity assessment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find useful page ideas' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Saved page plans' })).toContainText('Drain cleaning in South Bend');
  expect(state.data.plans).toHaveLength(1);
});

test('leaving during a slow assessment cannot paint a stale result over the next workspace', async ({ page }) => {
  const state = await setup(page);
  state.block = '/analyze'; state.ready = new Promise(resolve => { state.release = resolve; });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('main', { name: 'New page planning workspace' })).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByLabel('City or service area')).toBeDisabled();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  state.analysis = makeAssessment({ summary: 'Late obsolete assessment', ideas: [] });
  state.release();
  await expect(page.getByRole('heading', { name: 'Your SEO workspace', exact: true })).toBeVisible();
  await expect(page.getByText('Late obsolete assessment', { exact: true })).toHaveCount(0);
});

test('an edited slug never inherits another address’s availability check', async ({ page }) => {
  await setup(page, { plans: [makePlan({ slugCheck: { status: 'not_found', url: `${property}drain-cleaning`, checkedAt: now } })] });
  await openPlan(page);
  await expect(page.getByText('Suggested address was available when checked', { exact: false })).toBeVisible();
  await page.getByLabel('Suggested page address (slug)', { exact: true }).fill('/another-page');
  await expect(page.getByText('Suggested address was available when checked', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Verify this URL is available in your website editor.', { exact: true })).toBeVisible();
});

test('the first collecting days never display an inverted date range or fabricated zeros', async ({ page }) => {
  const publication = { pageUrl: `${property}drain-cleaning`, verifiedAt: now, publicPage: { warnings: [] } };
  const tracking = { activity: { sinceVerified: { status: 'collecting', startDate: '2026-10-12', endDate: '2026-10-08' } } };
  await setup(page, { plans: [makePlan({ status: 'published', publication, tracking })] }); await openPlan(page);
  await expect(page.getByText('Waiting for the first complete reporting days.', { exact: false })).toBeVisible();
  await expect(page.getByText('2026-10-12 – 2026-10-08', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'New page tracking' }).locator('dd')).toHaveCount(0);
});

test('previous website drafts remain readable history without edit or publication controls', async ({ page }) => {
  const previous = makePlan({ id: 'old-site-plan', historyType: 'previous_website', readOnly: true, idea: { ...idea, topic: 'Previous website plan' } });
  const state = await setup(page, { assessments: [], plans: [], history: [previous] });
  await page.getByText('Previous and set-aside ideas', { exact: true }).click();
  await page.getByText('Previous website plan', { exact: true }).click();
  await page.getByRole('button', { name: 'View saved draft' }).click();
  await expect(page.getByText(draft.sections[0].body, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save my edits' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'I published this page' })).toHaveCount(0);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
});


test('twelve comma-containing services remain twelve labels and duplicate lines do not grow the list', async ({ page }) => {
  const state = await setup(page);
  const labels = ['South Bend', 'Mishawaka', 'Granger', 'Goshen', 'Elkhart', 'Osceola', 'Niles', 'Bremen', 'Plymouth', 'La Porte', 'Warsaw', 'Middlebury'].map(city => `Website design in ${city}, IN`);
  await page.getByLabel('Services offered here').fill([...labels, `  ${labels[0].toUpperCase()}  `].join('\n'));
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Area saved.' })).toBeVisible();
  expect(state.calls.filter(call => call.endpoint === '/context')).toHaveLength(1);
  expect(state.calls.find(call => call.endpoint === '/context').body.services).toEqual(labels);
  await page.reload();
  await expect(page.getByLabel('Services offered here')).toHaveValue(labels.join('\n'));
  expect(state.calls.filter(call => ['/analyze', '/draft'].includes(call.endpoint))).toHaveLength(0);
});

test('reviewing the website keeps owner-typed services instead of replacing them with projected labels', async ({ page }) => {
  const state = await setup(page, { context: null, inventory: null, assessments: [], plans: [], business: { name: 'Example Plumbing', websiteUrl: property, location: '', services: [] } });
  await page.getByLabel('Services offered here').fill('Owner-defined repair service');
  state.nextServices = ['Drain cleaning'];
  state.nextInventory = { ...inventory, pages: [{ url: `${property}services/drains`, status: 'fetched', content: { h1: 'Drain cleaning in South Bend, IN' } }] };
  await page.getByRole('button', { name: 'Review my website' }).click();
  await expect(page.getByRole('button', { name: 'Refresh website review' })).toBeVisible();
  await expect(page.getByLabel('Services offered here')).toHaveValue('Owner-defined repair service');
  await expect(page.getByRole('checkbox', { name: 'My business offers these services in this area.' })).not.toBeChecked();
  expect(state.calls.filter(call => call.endpoint === '' && call.method === 'GET')).toHaveLength(2);
});

test('service validation identifies oversized lists and labels, clears on edit, and never submits empty services', async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel('Services offered here').fill('');
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  await expect(page.getByRole('button', { name: 'Save this area', exact: true })).toBeDisabled();
  await page.getByLabel('Services offered here').fill(Array.from({ length: 13 }, (_, index) => `Repair service ${index + 1}`).join('\n'));
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  const error = page.getByRole('main', { name: 'New page planning workspace' }).getByRole('alert');
  await expect(error).toContainText('Choose up to 12 services for this area.');
  expect(state.calls.filter(call => call.endpoint === '/context')).toHaveLength(0);
  await page.getByLabel('Services offered here').fill('A'.repeat(121));
  await expect(error).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(error).toContainText('Use plain service names, up to 120 characters per line.');
  expect(state.calls.filter(call => call.endpoint === '/context')).toHaveLength(0);
  await page.getByLabel('Services offered here').fill('Drain cleaning');
  await expect(error).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Area saved.' })).toBeVisible();
  expect(state.calls.filter(call => call.endpoint === '/context')).toHaveLength(1);
});

test('an actionable server validation error clears when the owner corrects the area form', async ({ page }) => {
  const state = await setup(page);
  state.contextError = 'Choose up to 12 services for this area. Keep one service per line.';
  await page.getByRole('button', { name: 'Area saved', exact: true }).click();
  const error = page.getByRole('main', { name: 'New page planning workspace' }).getByRole('alert');
  await expect(error).toContainText('Choose up to 12 services');
  await page.getByLabel('City or service area').fill('Mishawaka');
  await expect(error).toHaveCount(0);
  expect(state.calls.filter(call => call.endpoint === '/context')).toHaveLength(1);
});

test('partial website coverage names the unreadable URLs and separates this check from Google indexing', async ({ page }) => {
  const missingUrl = `${property}services/old-drain-page`;
  const unreadableUrl = `${property}services/blocked-page`;
  const partial = { ...inventory, status: 'partial', canContinue: false,
    coverage: { discovered: 3, fetched: 1, failed: 2, pending: 0, excluded: 0, limitations: [] },
    pages: [{ url: property, title: 'Example Plumbing', status: 'fetched' },
      { url: missingUrl, title: 'An older service title', status: 'failed', reason: 'http_404' },
      { url: unreadableUrl, status: 'failed', reason: 'unreadable' }] };
  const state = await setup(page, { inventory: partial, plans: [], assessments: [makeAssessment({ outcome: 'needs_information', ideas: [], summary: 'Check these existing pages before suggesting another.', questions: ['Check the unreadable or unreviewed pages in Website coverage, then refresh the inventory.'] })] });
  const checks = page.getByRole('region', { name: 'Pages to check', exact: true });
  await expect(checks.getByText('Check these links before adding a page', { exact: true })).toBeVisible();
  await expect(checks.getByText('These are SimplSEO website checks, not Google indexing results.', { exact: true })).toBeVisible();
  await checks.getByText('View 2 links to check', { exact: true }).click();
  await expect(checks.getByRole('link', { name: missingUrl, exact: true })).toHaveAttribute('href', missingUrl);
  await expect(checks.getByRole('link', { name: unreadableUrl, exact: true })).toHaveAttribute('href', unreadableUrl);
  await expect(checks.getByText('Page not found (404)', { exact: true })).toBeVisible();
  await expect(checks.getByText('Couldn’t read this page — try again', { exact: true })).toBeVisible();
  await checks.screenshot({ path: '/private/tmp/simpleseo-phase6-coverage.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await checks.screenshot({ path: '/private/tmp/simpleseo-phase6-coverage-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.getByRole('link', { name: 'See the links to check', exact: true })).toHaveAttribute('href', '#website-pages-to-check');
  await expect(page.getByText('Open the links listed in your website review above. After checking them, refresh the website review and check for updates.', { exact: true })).toBeVisible();
  await expect(page.getByText('Check the unreadable or unreviewed pages in Website coverage, then refresh the inventory.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Plan this page', exact: true })).toHaveCount(0);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  expect(state.errors).toEqual([]);
});


const missingPage = { url: `${property}services/retired-service`, status: 'failed', reason: 'http_404' };
const missingInventory = () => ({ ...structuredClone(inventory), status: 'partial', pages: [inventory.pages[0], { ...missingPage }], coverage: { fetched: 1, failed: 1, retired: 0, limitations: [] } });
async function openMissingPageResolution(page) {
  const checks = page.getByRole('region', { name: 'Pages to check', exact: true });
  await checks.getByText(/^View \d+ links to check$/).click();
  await checks.getByRole('button', { name: 'This page was removed', exact: true }).first().click();
  return page.getByRole('dialog');
}

test('only missing404 and removed410 pages offer retirement and cancellation changes nothing', async ({ page }) => {
  const candidate = missingInventory();
  candidate.pages.push({ url: `${property}services/gone`, status: 'failed', reason: 'http_410' },
    { url: `${property}services/server-error`, status: 'failed', reason: 'http_500' },
    { url: `${property}services/unknown`, status: 'failed', reason: 'unreadable' });
  const state = await setup(page, { inventory: candidate });
  const before = structuredClone(state.data);
  const checks = page.getByRole('region', { name: 'Pages to check', exact: true });
  await checks.getByText('View 4 links to check', { exact: true }).click();
  await expect(checks.getByRole('button', { name: 'This page was removed', exact: true })).toHaveCount(2);
  await expect(checks.locator('li').filter({ has: page.getByRole('link', { name: `${property}services/server-error`, exact: true }) }).getByRole('button')).toHaveCount(0);
  await checks.getByRole('button', { name: 'This page was removed', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('It does not delete, edit or publish anything on your website.');
  await expect(dialog.getByRole('button', { name: 'Mark as removed', exact: true })).toBeDisabled();
  await dialog.screenshot({ path: '/private/tmp/simpleseo-phase6-retirement-dialog.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: '/private/tmp/simpleseo-phase6-retirement-dialog-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.data).toEqual(before);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
});

test('retirement persists without AI and preserves the current saved plan and unsaved wording', async ({ page }) => {
  const state = await setup(page, { inventory: missingInventory(), assessments: [makeAssessment({ outcome: 'needs_information', summary: 'Old coverage blocker', ideas: [], questions: ['Check the missing page first.'] })] });
  const originalPlan = structuredClone(state.data.plans[0]);
  await page.getByRole('region', { name: 'Saved page plans' }).getByRole('button').click();
  await page.getByLabel('SEO title', { exact: true }).fill('Unsaved owner wording is still here');
  const dialog = await openMissingPageResolution(page);
  await dialog.getByRole('checkbox', { name: 'I intentionally removed this page and no longer need it.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Mark as removed', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pages to check' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Website review updated', exact: true })).toBeVisible();
  await expect(page.getByText('Old coverage blocker', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue('Unsaved owner wording is still here');
  await page.getByText('Removed pages (1)', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore for review', exact: true })).toBeVisible();
  await page.locator('details').filter({ has: page.getByText('Removed pages (1)', { exact: true }) }).screenshot({ path: '/private/tmp/simpleseo-phase6-retirement-saved.png' });
  expect(state.calls.find(call => call.endpoint === '/inventory/retire').body).toEqual({ urls: [missingPage.url], action: 'retire', inventoryRevision: 1, confirmed: true });
  expect(state.data.plans[0]).toEqual(originalPlan);
  await page.reload();
  await expect(page.getByText('Removed pages (1)', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Website review updated', exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Saved page plans' }).getByRole('button').click();
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue(originalPlan.draft.title);
  expect(state.calls.filter(call => ['/analyze', '/draft', '/publish'].includes(call.endpoint))).toHaveLength(0);
});

test('restoring a removed page requires confirmation and queues an explicit website recheck', async ({ page }) => {
  const restored = { ...missingPage, status: 'retired', reason: 'owner_confirmed_removed' };
  const state = await setup(page, { inventory: { ...inventory, pages: [inventory.pages[0], restored], coverage: { retired: 1 } } });
  const originalPlan = structuredClone(state.data.plans[0]);
  await page.getByText('Removed pages (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore for review', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Restore page', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Include this address in my website review again.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Restore page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue website review', exact: true })).toBeEnabled();
  await expect(page.getByText('Removed pages (1)', { exact: true })).toHaveCount(0);
  expect(state.calls.find(call => call.endpoint === '/inventory/retire').body.action).toBe('restore');
  expect(state.data.inventory.pages.find(item => item.url === missingPage.url).status).toBe('pending');
  expect(state.data.plans[0]).toEqual(originalPlan);
  expect(state.calls.filter(call => ['/inventory', '/analyze', '/draft'].includes(call.endpoint))).toHaveLength(0);
});

test('a stale retirement is blocked, shows loading, and can reload the latest saved review before retrying', async ({ page }) => {
  const state = await setup(page, { inventory: missingInventory() });
  const dialog = await openMissingPageResolution(page);
  state.data.inventory.revision = 2;
  state.block = '/inventory/retire'; state.ready = new Promise(resolve => { state.release = resolve; });
  await dialog.getByRole('checkbox', { name: 'I intentionally removed this page and no longer need it.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Mark as removed', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  state.release();
  await expect(dialog.getByRole('alert')).toContainText('Your website review changed.');
  await expect(dialog.getByRole('button', { name: 'Mark as removed', exact: true })).toBeDisabled();
  expect(state.data.inventory.pages.find(item => item.url === missingPage.url).status).toBe('failed');
  await dialog.getByRole('button', { name: 'Reload saved review', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // The list remains open after its saved record is refreshed.
  await page.getByRole('button', { name: 'This page was removed', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'I intentionally removed this page and no longer need it.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Mark as removed', exact: true }).click();
  await expect(page.getByText('Removed pages (1)', { exact: true })).toBeVisible();
  expect(state.calls.filter(call => call.endpoint === '/inventory/retire').map(call => call.body.inventoryRevision)).toEqual([1, 2]);
  expect(state.calls.filter(call => ['/inventory', '/analyze', '/draft'].includes(call.endpoint))).toHaveLength(0);
});

test('returning to saved results collapses setup, supports keyboard reopening, and preserves an unsaved draft', async ({ page }) => {
  const state = await setup(page, {}, { expandSteps: false });
  const areaToggle = page.getByRole('button', { name: 'Edit area and services', exact: true });
  const reviewToggle = page.getByRole('button', { name: 'View website review details', exact: true });
  await expect(areaToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(reviewToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Services offered here')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Page opportunity assessment' })).toContainText(idea.topic);
  await page.screenshot({ path: '/private/tmp/simpleseo-phase6-collapsed-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/simpleseo-phase6-collapsed-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await openPlan(page);
  await page.getByLabel('SEO title', { exact: true }).fill('Unsaved title survives opening setup');
  await areaToggle.focus(); await page.keyboard.press('Enter');
  const hideArea = page.getByRole('button', { name: 'Hide area and services', exact: true });
  await expect(hideArea).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Services offered here')).toHaveValue('Drain cleaning');
  await hideArea.focus(); await page.keyboard.press('Space');
  await expect(areaToggle).toHaveAttribute('aria-expanded', 'false');
  await reviewToggle.focus(); await page.keyboard.press('Enter');
  const hideReview = page.getByRole('button', { name: 'Hide website review details', exact: true });
  await expect(hideReview).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeVisible();
  await hideReview.focus(); await page.keyboard.press('Space');
  await expect(reviewToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue('Unsaved title survives opening setup');
  await page.reload();
  await expect(areaToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(reviewToggle).toHaveAttribute('aria-expanded', 'false');
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  expect(state.data.plans[0].draft.title).toBe(draft.title);
});

test('first area save collapses only area setup and a completed assessment then collapses the review', async ({ page }) => {
  const state = await setup(page, { context: null, assessments: [], plans: [] }, { expandSteps: false });
  await expect(page.getByLabel('Services offered here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeVisible();
  await page.getByLabel('State or region').fill('Indiana');
  await page.getByLabel('Country', { exact: true }).fill('United States');
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit area and services', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#website-review-heading')).toBeFocused();
  await expect(page.getByLabel('Services offered here')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeVisible();
  expect(state.calls.filter(call => ['/analyze', '/inventory', '/draft'].includes(call.endpoint))).toHaveLength(0);
  state.analysis = makeAssessment({ context: state.data.context, outcome: 'no_opportunity', ideas: [], summary: 'Existing pages cover the confirmed service.' });
  await page.getByRole('button', { name: 'Find useful page ideas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No new page needed right now' })).toBeVisible();
  await expect(page.locator('#page-ideas-heading')).toBeFocused();
  await expect(page.getByRole('button', { name: 'View website review details', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeHidden();
  expect(state.calls.filter(call => call.endpoint === '/analyze')).toHaveLength(1);
  expect(state.calls.filter(call => call.endpoint === '/draft')).toHaveLength(0);
});

test('unsaved area changes stay visible and survive opening the website review', async ({ page }) => {
  const state = await setup(page, {}, { expandSteps: false });
  await openArea(page);
  await page.getByLabel('Services offered here').fill('Drain cleaning\nWater heater repairs');
  await expect(page.getByRole('checkbox', { name: 'My business offers these services in this area.' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Hide area and services', exact: true })).toHaveCount(0);
  await openWebsiteReview(page);
  await expect(page.getByLabel('Services offered here')).toBeVisible();
  await expect(page.getByLabel('Services offered here')).toHaveValue('Drain cleaning\nWater heater repairs');
  await expect(page.getByRole('button', { name: 'Save this area', exact: true })).toBeDisabled();
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
});

test('failed area saves and update checks keep the relevant setup open without losing saved work', async ({ page }) => {
  const state = await setup(page, {}, { expandSteps: false });
  await openArea(page);
  await page.getByLabel('Services offered here').fill('Owner-reviewed drain cleaning');
  await page.getByRole('checkbox', { name: 'My business offers these services in this area.' }).check();
  state.contextError = 'Please verify these services before saving.';
  await page.getByRole('button', { name: 'Save this area', exact: true }).click();
  await expect(page.getByRole('main', { name: 'New page planning workspace' }).getByRole('alert')).toContainText(state.contextError);
  await expect(page.getByLabel('Services offered here')).toBeVisible();
  await expect(page.getByLabel('Services offered here')).toHaveValue('Owner-reviewed drain cleaning');
  expect(state.data.context.services).toEqual(context.services);
  // Restore the saved screen to exercise a failed quiet check from its summary.
  await page.reload();
  await expect(page.getByRole('button', { name: 'View website review details', exact: true })).toBeVisible();
  state.analysisError = 'The update check is temporarily unavailable. Your saved assessment is unchanged.';
  state.block = '/analyze'; state.ready = new Promise(resolve => { state.release = resolve; });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: 'New page planning workspace' })).toHaveAttribute('aria-busy', 'true');
  state.release();
  await expect(page.getByRole('main', { name: 'New page planning workspace' }).getByRole('alert')).toContainText(state.analysisError);
  await expect(page.getByRole('button', { name: 'Hide website review details', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('region', { name: 'Page opportunity assessment' })).toContainText(idea.topic);
  expect(state.data.plans[0].draft.title).toBe(draft.title);
  expect(state.calls.filter(call => call.endpoint === '/draft')).toHaveLength(0);
});

test('partial and missing-information reviews remain open on return, with business facts reachable', async ({ page }) => {
  const state = await setup(page, { inventory: missingInventory(), assessments: [makeAssessment({ outcome: 'needs_information', ideas: [], questions: ['Confirm the services you provide before continuing.'] })] }, { expandSteps: false });
  await expect(page.getByLabel('Services offered here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pages to check' })).toBeVisible();
  await page.getByText('Add helpful business facts (optional)', { exact: true }).click();
  await expect(page.getByLabel('What should we know about your work in this area?')).toHaveValue(context.facts);
  // Even readable coverage must stay open when the assessment still needs facts.
  state.data.inventory = structuredClone(inventory);
  await page.reload();
  await expect(page.getByLabel('Services offered here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide website review details', exact: true })).toHaveCount(0);
  // A new website review invalidates only the assessment; saved plans remain.
  state.data.assessments = [makeAssessment({ coverageChanged: true })];
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Website review updated', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved page plans' })).toBeVisible();
  state.data.assessments = [makeAssessment()];
  state.data.inventory = { ...structuredClone(inventory), status: 'unavailable' };
  await page.reload();
  await expect(page.getByRole('button', { name: 'Refresh website review', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
  state.data.inventory = { ...structuredClone(inventory), status: 'running', canContinue: true };
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue website review', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View website review details', exact: true })).toHaveCount(0);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
});

// Opening a plan from the dashboard is navigation, never an area change or save.
test('saved-plan deep link opens its own area and survives reload without changing the active area', async ({ page }) => {
  const otherContext = { ...context, area: otherArea, facts: 'We also serve Mishawaka.' };
  const otherPlan = makePlan({ id: 'plan-mishawaka', context: otherContext,
    idea: { ...idea, id: 'mishawaka-idea', topic: 'Drain cleaning in Mishawaka' },
    draft: { ...structuredClone(draft), title: 'Owner-edited Mishawaka title' } });
  const state = await setup(page, { plans: [makePlan(), otherPlan] }, {
    expandSteps: false, path: '/generic-keywords?planId=plan-mishawaka',
  });
  const before = structuredClone(state.data);
  const selected = page.getByRole('region', { name: 'Selected page plan', exact: true });
  await expect(selected.getByRole('heading', { name: 'Drain cleaning in Mishawaka', exact: true })).toBeVisible();
  await expect(selected).toContainText('Mishawaka, Indiana, United States');
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue('Owner-edited Mishawaka title');
  await expect(page.getByLabel('City or service area')).toHaveCount(0);
  await page.screenshot({ path: '/private/tmp/simpleseo-phase10-saved-plan.png', fullPage: true });
  await page.reload();
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue('Owner-edited Mishawaka title');
  await page.getByRole('link', { name: 'Back to New page ideas', exact: true }).click();
  await expect(page).toHaveURL(/\/generic-keywords$/);
  await expect(page.getByRole('heading', { name: 'Ideas for South Bend, Indiana, United States' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected page plan', exact: true })).toHaveCount(0);
  expect(state.data).toEqual(before);
  expect(state.calls.filter(call => call.endpoint === '/plan').every(call => call.planId === otherPlan.id)).toBe(true);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  expect(state.errors).toEqual([]);
});

for (const planId of ['foreign-account-plan', '../invalid', '']) {
  test(`unavailable saved-plan deep link stays safe (${planId || 'empty'})`, async ({ page }) => {
    const state = await setup(page, {}, { expandSteps: false,
      path: `/generic-keywords?planId=${encodeURIComponent(planId)}` });
    await expect(page.getByRole('main', { name: 'New page planning workspace' }).getByRole('alert')).toContainText('This saved page plan isn’t available.');
    await expect(page.getByRole('link', { name: 'Back to New page ideas', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Selected page plan', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('SEO title', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prepare my draft', exact: true })).toHaveCount(0);
    expect(state.data.context).toEqual(context);
    expect(state.calls.every(call => call.method === 'GET')).toBe(true);
    expect(state.errors).toEqual([]);
  });
}

test('historical saved-plan deep link uses the existing read-only history policy', async ({ page }) => {
  const previous = makePlan({ id: 'previous-site-plan', readOnly: true, historyType: 'previous_website',
    context: { ...context, area: otherArea }, idea: { ...idea, topic: 'Earlier website wording' } });
  const state = await setup(page, { history: [previous] }, {
    expandSteps: false, path: '/generic-keywords?planId=previous-site-plan',
  });
  const selected = page.getByRole('region', { name: 'Selected page plan', exact: true });
  await expect(selected).toContainText('This saved work is read-only.');
  await expect(selected).toContainText('Mishawaka, Indiana, United States');
  await expect(selected.getByText(draft.sections[0].body, { exact: true })).toBeVisible();
  for (const name of ['Save my edits', 'I published this page', 'Prepare my draft', 'Set this idea aside', 'Check tracking']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  expect(state.data.context).toEqual(context);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  expect(state.errors).toEqual([]);
});

test('changing a saved-plan link ignores an older in-flight response', async ({ page }) => {
  const otherPlan = makePlan({ id: 'next-saved-plan', context: { ...context, area: otherArea },
    idea: { ...idea, topic: 'Next saved plan' }, draft: { ...structuredClone(draft), title: 'Next saved title' } });
  const state = await setup(page, { plans: [makePlan(), otherPlan] }, { expandSteps: false });
  state.block = '/plan'; state.ready = new Promise(resolve => { state.release = resolve; });
  await page.evaluate(() => window.history.pushState(null, '', '/generic-keywords?planId=plan-drain'));
  await expect(page.getByRole('status').filter({ hasText: 'Loading your saved page ideas…' })).toBeVisible();
  state.block = '';
  await page.evaluate(() => window.history.pushState(null, '', '/generic-keywords?planId=next-saved-plan'));
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue('Next saved title');
  state.release();
  await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue('Next saved title');
  await expect(page.getByRole('region', { name: 'Selected page plan', exact: true })).toContainText('Mishawaka, Indiana, United States');
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  expect(state.data.context).toEqual(context);
  expect(state.errors).toEqual([]);
});
