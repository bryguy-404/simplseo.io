const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');

// Isolated UI fixtures: real demo authentication, mocked workspace/provider actions.
// The companion API tests cover the authenticated persistence and commit boundary.
const uid = 'onboarding-ui-alice';
const website = 'https://example.test/';
let app;
const profile = () => ({ businessName: 'Example Plumbing', businessType: 'Plumber', services: ['Drain repairs', 'Heating, cooling and ventilation'],
  baseLocation: { city: 'Riverton', region: 'Wyoming', country: 'United States' }, serviceAreas: ['Riverton, Wyoming'], goal: 'quotes', cmsPlatform: 'Custom' });
const session = (overrides = {}) => ({ id: 'current', revision: 1, mode: 'new', state: 'draft', websiteUrl: website, currentStep: 'business',
  profileDraft: profile(), profileConfirmed: false, privacyPolicyAccepted: false, google: { status: 'not_connected', property: null }, ...overrides });
const inventory = () => ({ revision: 1, status: 'ready', canContinue: false, coverage: { fetched: 2, failed: 1, partial: true }, pages: [
  { url: website, status: 'fetched' }, { url: `${website}services`, status: 'fetched' }, { url: `${website}old`, status: 'failed', httpStatus: 404 },
] });
const extraction = () => ({ status: 'ready', businessName: { value: 'Website Observed Name', evidence: [{ url: website, quote: 'Website Observed Name' }] },
  businessType: { value: 'Plumber', evidence: [{ url: website, quote: 'Plumber' }] }, services: [{ value: 'Drain repairs', evidence: [{ url: website, quote: 'Drain repairs' }] }],
  locations: [], questions: [], extractedAt: '2026-10-11T12:00:00.000Z' });
const workspace = (overrides = {}) => ({ eligible: true, enabled: true, pinned: false, legacyCompleted: false, session: null, profile: null, inventory: null, extraction: null, readiness: null, ...overrides });

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'onboarding-v2-ui');
  try { await app.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); }
  catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
});
test.afterAll(async () => { await app?.delete(); });

async function setup(page, value = workspace(), options = {}) {
  const state = { workspace: structuredClone(value), posts: [], unknownPosts: [], propertyReads: 0, refreshedProperties: [], failAction: null, delayAction: null, verificationGate: false, gateApproved: false };
  await app.firestore().doc(`users/${uid}`).set({ gscSiteUrl: website });
  await app.firestore().doc(`onboarding/${uid}`).set({ isComplete: Boolean(options.completed), businessName: 'Legacy business', websiteUrl: website,
    gscProperty: website, postOnboardingStep: options.oldStep || (options.completed ? 'complete' : null), revampRunId: 'unchanged-version', revampStatus: 'idle' });
  if (options.localOnly) await app.firestore().doc(`onboarding/${uid}`).delete();
  await page.addInitScript(() => { localStorage.setItem('hasSeenChatAssistant', 'true'); });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/onboarding/workspace') {
      if (req.method() === 'GET') {
        if (state.verificationGate && !(await app.auth().getUser(uid)).emailVerified) return send({ error: 'Verify your email before continuing.' }, 403);
        if (state.verificationGate && !state.gateApproved) return send({ error: 'Your account is awaiting access approval.' }, 403);
        return send(state.workspace);
      }
      const body = req.postDataJSON(); state.posts.push(body);
      if (state.delayAction === body.action) await new Promise(resolve => setTimeout(resolve, 400));
      if (state.failAction?.action === body.action) return send({ error: state.failAction.message }, state.failAction.status || 503);
      const saved = state.workspace;
      if (body.action === 'begin') { saved.pinned = true; saved.session ||= session({ mode: options.completed ? 'existing' : 'new', currentStep: options.completed ? 'business' : 'website', websiteUrl: options.completed ? website : '', profileDraft: options.completed ? profile() : { businessName: '', businessType: '', services: [], baseLocation: {}, serviceAreas: [], goal: 'inquiries', cmsPlatform: '', ...(options.localOnly ? body.legacyDraft : {}) } }); }
      else {
        if (body.expectedRevision !== saved.session.revision) return send({ error: 'Your setup changed in another window. Reload to see the latest saved details.' }, 409);
        if (body.action === 'save' || body.action === 'confirmProfile') {
          if (body.websiteUrl) saved.session.websiteUrl = new URL(/^https?:/.test(body.websiteUrl) ? body.websiteUrl : `https://${body.websiteUrl}`).href;
          saved.session.profileDraft = body.profileDraft || saved.session.profileDraft;
          if (Object.hasOwn(body, 'privacyPolicyAccepted')) saved.session.privacyPolicyAccepted = body.privacyPolicyAccepted;
          saved.session.currentStep = body.currentStep || saved.session.currentStep;
          saved.session.revision++;
          if (body.action === 'confirmProfile') { saved.session.profileConfirmed = true; saved.session.profileConfirmedAt = '2026-10-11T12:00:00Z';
            if (options.completed) saved.profile = { status: 'confirmed', profile: body.profileDraft, confirmedAt: saved.session.profileConfirmedAt };
          }
        } else if (body.action === 'review') saved.inventory = inventory();
        else if (body.action === 'extract') saved.extraction = extraction();
        else if (body.action === 'readiness') saved.readiness = { checkedAt: '2026-10-11T12:00:00Z', google: { status: 'connected', message: 'Your matching Google website is connected.' },
          website: { status: 'partial', message: '2 pages read. You can continue with partial coverage.' }, search: { status: 'no_data', message: 'Google has no search activity to report for this period yet. You can still finish setup.' }, inspections: [{ url: website, status: 'unavailable' }] };
        else if (body.action === 'complete') {
          if (!saved.session.privacyPolicyAccepted) return send({ error: 'Save privacy acceptance before finishing.' }, 409);
          saved.session.state = 'complete'; saved.session.mode = 'existing'; saved.legacyCompleted = true; saved.session.revision++;
          await app.firestore().doc(`onboarding/${uid}`).update({ isComplete: true, postOnboardingStep: 'complete', setupVersion: 2 });
        }
      }
      return send(saved);
    }
    if (url.pathname === '/api/gsc/select') {
      const body = req.postDataJSON(); state.posts.push({ action: 'select', ...body });
      if (body.sessionRevision !== state.workspace.session.revision) return send({ error: 'Stale Google selection.' }, 409);
      state.workspace.session.google = { status: 'connected', pendingId: body.pendingId, property: body.property };
      state.workspace.session.revision++;
      return send({ session: state.workspace.session });
    }
    if (url.pathname === '/api/gsc/properties') {
      state.propertyReads++;
      if (url.searchParams.get('pendingId') !== state.workspace.session.google.pendingId) return send({ error: 'Wrong pending connection.' }, 409);
      state.workspace.session.revision++;
      state.workspace.session.google.properties = state.refreshedProperties;
      state.workspace.session.google.propertyIssues = [];
      return send({ properties: state.refreshedProperties, propertyIssues: [], session: state.workspace.session });
    }
    if (url.pathname === '/api/dashboard/overview') return send({ source: 'google_search_console', property: website, pages: [], totals: { clicks: 0, impressions: 0 }, window: { startDate: '2026-09-10', endDate: '2026-10-07' }, daily: [] });
    if (url.pathname === '/api/progress') return send({ records: [], history: [], ongoing: { enabled: false, records: [], history: [] } });
    if (req.method() === 'POST') state.unknownPosts.push(url.pathname);
    return send({ keywords: [], pages: [], conversations: [], records: [], data: [], success: true });
  });
  return state;
}
async function login(page, expected = 'onboarding') {
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(expected));
}
async function business(page) { await page.getByRole('button', { name: '3. Your business' }).click(); }

test('first visit performs stored reads only and explicitly begins a saved website step', async ({ page }) => {
  const state = await setup(page); await login(page);
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(0); expect(state.unknownPosts).toHaveLength(0);
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByLabel('Website address').fill('example.test');
  await page.getByRole('button', { name: 'Save website and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Google', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Connect Google Search Console', exact: true })).toBeEnabled();
  expect(state.workspace.session.websiteUrl).toBe(website); expect(state.posts.map(x => x.action)).toEqual(['begin', 'save']);
});

test('manual profile draft saves before Google and restores after refresh and logout', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session() })); await login(page);
  await page.getByLabel('Business name', { exact: true }).fill('Owner confirmed name');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your draft is saved');
  await page.reload(); await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Owner confirmed name');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await login(page);
  await expect(page.getByLabel('What services do you offer?')).toHaveValue('Drain repairs\nHeating, cooling and ventilation');
  expect(state.workspace.session.profileConfirmed).toBe(false); expect(state.posts.map(x => x.action)).toEqual(['save']);
});

test('failed save preserves owner input and does not advance or claim success', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session({ currentStep: 'website' }) })); state.failAction = { action: 'save', message: 'The save could not finish. Try again.' }; await login(page);
  await page.getByLabel('Website address').fill('https://changed.example.test'); await page.getByRole('button', { name: 'Save website and continue' }).click();
  await expect(page.locator('p[role=alert]')).toHaveText('The save could not finish. Try again.');
  await expect(page.getByLabel('Website address')).toHaveValue('https://changed.example.test');
  await expect(page.getByRole('heading', { name: 'Your website', exact: true })).toBeVisible();
});

test('stale revision explains reload and keeps unsaved profile until owner chooses', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session() })); await login(page);
  await page.getByLabel('Business name', { exact: true }).fill('Unsaved owner name'); state.workspace.session.revision++;
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.locator('p[role=alert]')).toContainText('another window');
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Unsaved owner name');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Reload saved setup' }).click();
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Unsaved owner name');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Reload saved setup' }).click();
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Example Plumbing');
});

test('website review and sourced extraction are explicit and never replace owner text', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session({ google: { status: 'connected', property: website }, profileDraft: { ...profile(), services: [] } }) })); await login(page);
  await page.getByLabel('Business name', { exact: true }).fill('My real business');
  await page.getByRole('button', { name: 'Review website', exact: true }).click();
  await expect(page.getByText(/These are SimplSEO website checks, not Google indexing results/)).toBeVisible();
  await page.getByRole('button', { name: 'Find business details' }).click();
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('My real business');
  await expect(page.getByLabel('What services do you offer?')).toHaveValue('');
  await page.getByRole('button', { name: 'Fill empty fields from website' }).click();
  await expect(page.getByLabel('What services do you offer?')).toHaveValue('Drain repairs');
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('My real business');
  await expect(page.getByRole('checkbox', { name: /These services/ })).not.toBeChecked();
  await page.getByText('What we found and where', { exact: true }).click(); await expect(page.getByRole('link', { name: 'Source 1' }).first()).toHaveAttribute('href', website);
  expect(state.posts.map(x => x.action)).toEqual(['review', 'extract']);
});

test('saved pending Google property selection resumes with matching session revision', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session({ currentStep: 'google', google: { status: 'pending', pendingId: 'fixture-pending', properties: [{ siteUrl: website, matchesWebsite: true }] } }) })); await login(page);
  await page.getByLabel('Choose your website in Google').selectOption(website);
  await page.getByRole('button', { name: 'Use this website', exact: true }).click();
  await expect(page.getByLabel('Business name', { exact: true })).toBeVisible();
  expect(state.posts[0]).toEqual({ action: 'select', pendingId: 'fixture-pending', property: website, sessionRevision: 1 });
});

test('confirmation and completion save consent first and accept partial inventory with no Google traffic', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, inventory: inventory(), session: session({ google: { status: 'connected', property: website } }) })); await login(page);
  await expect(page.getByRole('button', { name: 'Confirm business details', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /These services/ }).check();
  await page.getByRole('button', { name: 'Confirm business details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check setup', exact: true }).click();
  await expect(page.getByText(/Google has no search activity to report/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open my SEO workspace' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
  await page.getByRole('button', { name: 'Open my SEO workspace' }).click();
  await expect(page).toHaveURL(/dashboard/); await expect(page.getByRole('heading', { name: 'Your SEO workspace' })).toBeVisible();
  expect(state.posts.slice(-2).map(x => x.action)).toEqual(['save', 'complete']);
  expect(state.posts.at(-2).privacyPolicyAccepted).toBe(true); expect(state.unknownPosts).toHaveLength(0);
});

test('editing a confirmed draft disables completion until it is confirmed again', async ({ page }) => {
  await setup(page, workspace({ pinned: true, session: session({ profileConfirmed: true, privacyPolicyAccepted: true, currentStep: 'ready', google: { status: 'connected', property: website } }) })); await login(page);
  await expect(page.getByRole('button', { name: 'Open my SEO workspace' })).toBeEnabled();
  await business(page); await page.getByLabel('What services do you offer?').fill('Different work');
  await page.getByRole('button', { name: '4. Get started' }).click();
  await expect(page.getByRole('button', { name: 'Open my SEO workspace' })).toBeDisabled();
});

test('enrollment rollback preserves a pinned draft while unpinned users see a saved-account message', async ({ page }) => {
  const state = await setup(page, workspace({ eligible: false, enabled: true, pinned: true, session: session() })); await login(page);
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Example Plumbing');
  state.workspace = workspace({ eligible: false, enabled: false }); await page.reload();
  await expect(page.getByRole('heading', { name: 'Your account is saved' })).toBeVisible();
  await expect(page.getByText(/currently available to pilot accounts/)).toBeVisible(); expect(state.posts).toHaveLength(0);
});

test('legacy keyword-step account reaches dashboard with usable navigation and no legacy generation', async ({ page }) => {
  const state = await setup(page, workspace({ eligible: false, legacyCompleted: true }), { completed: true, oldStep: 'keywords' }); await login(page, 'dashboard');
  await expect(page.getByRole('heading', { name: 'Your SEO workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click(); await expect(page).toHaveURL(/settings/);
  expect(state.posts).toHaveLength(0); expect(state.unknownPosts).toHaveLength(0);
});

test('existing profile review is optional and updates business details without completing or resetting setup', async ({ page }) => {
  const state = await setup(page, workspace({ legacyCompleted: true }), { completed: true }); await login(page, 'dashboard');
  await expect(page.getByRole('complementary', { name: 'Business details reminder' })).toBeVisible();
  expect(state.posts).toHaveLength(0); await page.getByRole('link', { name: 'Review business details', exact: true }).click();
  await page.getByRole('button', { name: 'Review business details', exact: true }).click();
  await page.getByLabel('Business name', { exact: true }).fill('Updated real name');
  await page.getByRole('checkbox', { name: /These services/ }).check(); await page.getByRole('button', { name: 'Confirm business details', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit business details' })).toBeVisible();
  await page.reload(); await expect(page.getByText('Updated real name', { exact: true })).toBeVisible();
  expect(state.posts.map(x => x.action)).toEqual(['begin', 'confirmProfile']);
  const stored = (await app.firestore().doc(`onboarding/${uid}`).get()).data(); expect(stored.revampRunId).toBe('unchanged-version'); expect(stored.isComplete).toBe(true);
});

test('long service list gives a useful error and commas stay within one service', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session() })); await login(page);
  await page.getByLabel('What services do you offer?').fill(Array.from({ length: 13 }, (_, index) => `Service ${index}, regional offering`).join('\n'));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.locator('p[role=alert]')).toContainText('up to 12 services'); expect(state.posts).toHaveLength(0);
  await page.getByLabel('What services do you offer?').fill('Heating, cooling and ventilation\nDrain repairs');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); expect(state.posts[0].profileDraft.services).toEqual(['Heating, cooling and ventilation', 'Drain repairs']);
});

test('mobile keyboard navigation keeps input and moves focus after saving a step', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page, workspace({ pinned: true, session: session({ currentStep: 'website' }) })); await login(page);
  await page.getByLabel('Website address').fill(website); await page.getByRole('button', { name: 'Save website and continue' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Connect Google', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '3. Your business' }).focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Business name', { exact: true }).fill('Mobile owner draft');
  await page.getByRole('button', { name: '2. Connect Google' }).click(); await business(page);
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Mobile owner draft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/simpleseo-phase8-profile-mobile.png', fullPage: true });
});

test('in-flight website review shows feedback and prevents duplicate work', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session({ google: { status: 'connected', property: website } }) })); state.delayAction = 'review'; await login(page);
  await page.getByRole('button', { name: 'Review website', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Reviewing your website…');
  await expect(page.getByRole('button', { name: 'Review website', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Find business details' })).toBeEnabled();
  expect(state.posts.filter(x => x.action === 'review')).toHaveLength(1);
});

test('restricted Google access explains the next step and refresh uses the updated revision', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session({ currentStep: 'google', google: { status: 'pending', pendingId: 'refresh-pending', properties: [], propertyIssues: [{ siteUrl: website, matchesWebsite: true, permissionLevel: 'siteRestrictedUser', reason: 'insufficient_permission' }] } }) }));
  state.refreshedProperties = [{ siteUrl: website, matchesWebsite: true, permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.test/', matchesWebsite: false, permissionLevel: 'siteOwner' }];
  await login(page);
  await expect(page.getByText('Your website needs more Google access')).toBeVisible();
  await expect(page.getByText(/give your Google account full-user or owner access/)).toBeVisible();
  expect(state.propertyReads).toBe(0);
  await page.getByRole('button', { name: 'Refresh websites', exact: true }).click();
  await expect(page.getByText(/Suggested match:/)).toContainText(website);
  await expect(page.getByText('Your website needs more Google access')).not.toBeVisible();
  await expect(page.locator('option[value="https://other.test/"]')).toBeDisabled();
  await page.getByLabel('Choose your website in Google').selectOption(website);
  await page.getByRole('button', { name: 'Use this website' }).click();
  await expect(page.getByLabel('Business name', { exact: true })).toBeVisible();
  expect(state.propertyReads).toBe(1); expect(state.posts[0].sessionRevision).toBe(2);
});

test('automatic extraction waits for Google while manual profile work remains available', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, inventory: inventory(), session: session() })); await login(page);
  await expect(page.getByRole('button', { name: 'Find business details' })).toBeDisabled();
  await expect(page.getByText(/Connect Google to fill business details automatically/)).toBeVisible();
  await page.getByLabel('Business name', { exact: true }).fill('Manual owner details');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your draft is saved');
  expect(state.posts.map(item => item.action)).toEqual(['save']);
});

test('readiness shows dated Google observations separately and excludes unsafe inspection links', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session({ currentStep: 'ready', profileConfirmed: true, google: { status: 'connected', property: website } }), inventory: inventory(), readiness: {
    checkedAt: '2026-10-11T12:00:00Z', google: { status: 'connected', message: 'Your matching Google website is connected.' }, website: { status: 'partial', message: 'Partial website review' }, search: { status: 'no_data', message: 'No reported traffic yet.' },
    inspections: [{ url: website, status: 'available', checkedAt: '2026-10-10T12:00:00Z', result: { coverageState: 'Submitted and indexed' }, inspectionUrl: 'https://search.google.com/search-console/inspect?resource_id=sc-domain%3Aexample.test' },
      { url: `${website}service`, status: 'unavailable', checkedAt: '2026-10-11T12:00:00Z', inspectionUrl: 'javascript:alert(1)' }],
  } })); await login(page);
  await expect(page.getByText('Submitted and indexed', { exact: true })).not.toBeVisible();
  await page.getByText('Google’s stored page checks', { exact: true }).click();
  await expect(page.getByText('Submitted and indexed', { exact: true })).toBeVisible();
  await expect(page.getByText('Google’s status could not be checked. Try again later.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Google’s page inspection' })).toHaveCount(1);
  await expect(page.getByText('Checked 10/10/2026', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy');
  expect(state.posts).toHaveLength(0);
});

test('retrying an unchanged failed save preserves its idempotency key', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session() })); state.failAction = { action: 'save', message: 'Temporary save failure' }; await login(page);
  await page.getByLabel('Business name', { exact: true }).fill('Retry safely');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toHaveText('Temporary save failure');
  state.failAction = null; await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your draft is saved');
  expect(state.posts[0].requestId).toBe(state.posts[1].requestId);
});

test('paused extraction keeps manual confirmation and existing observations available', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, enabled: false, extractionEnabled: false, inventory: inventory(), session: session({ google: { status: 'connected', property: website } }), readiness: { website: { observations: {
    homepage: { url: website, status: 'fetched', observedAt: '2026-10-11T12:00:00Z', technical: { noindex: { generic: false, googlebot: true }, canonicalUrl: website } }, robotsStatus: 'reviewed', sitemaps: [{ url: `${website}sitemap.xml`, status: 'failed', observedAt: '2026-10-11T12:00:00Z' }],
  } } } })); await login(page);
  await expect(page.getByRole('button', { name: 'Find business details' })).toBeDisabled();
  await expect(page.getByText(/Automatic business suggestions are paused/)).toBeVisible();
  await page.getByRole('checkbox', { name: /These services/ }).check();
  await page.getByRole('button', { name: 'Confirm business details', exact: true }).click();
  await page.getByText('Website review details', { exact: true }).click();
  await expect(page.getByText('This page asks search engines not to index it.')).toBeVisible();
  await expect(page.getByText('Sitemap could not be read', { exact: true })).toBeVisible();
  await expect(page.getByText(/These checks do not tell us whether Google has indexed/)).toBeVisible();
  expect(state.posts.map(item => item.action)).toEqual(['confirmProfile']);
});

test('isolated visual examples cover the four setup steps without provider work', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const state = await setup(page, workspace({ pinned: true, session: session({ currentStep: 'website', profileConfirmed: true, google: { status: 'pending', pendingId: 'preview-pending', properties: [{ siteUrl: website, matchesWebsite: true }] } }), inventory: inventory(), readiness: {
    checkedAt: '2026-10-11T12:00:00Z', google: { status: 'connected', message: 'Your matching Google website is connected.' }, website: { status: 'partial', message: '2 pages read. You can continue with partial coverage.' }, search: { status: 'no_data', message: 'Google has no search activity to report for this period yet. You can still finish setup.' },
  } })); await login(page);
  await page.evaluate(() => { const banner = document.createElement('div'); banner.textContent = 'Isolated example — no live account data'; banner.setAttribute('data-preview-label', 'true'); banner.style.cssText = 'padding:12px 16px;background:#fff7d6;color:#594400;text-align:center;font:600 14px system-ui'; document.body.prepend(banner); });
  for (const [index, name] of ['Your website', 'Connect Google', 'Your business', 'Get started'].entries()) {
    if (index === 2) {
      state.workspace.session.google = { status: 'connected', property: website };
      state.workspace.session.currentStep = 'business';
      await page.reload(); await expect(page.getByLabel('Business name', { exact: true })).toBeVisible();
      await page.evaluate(() => { const banner = document.createElement('div'); banner.textContent = 'Isolated example — no live account data'; banner.style.cssText = 'padding:12px 16px;background:#fff7d6;color:#594400;text-align:center;font:600 14px system-ui'; document.body.prepend(banner); });
    }
    await page.getByRole('button', { name: `${index + 1}. ${name}`, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.screenshot({ path: `/private/tmp/simpleseo-phase8-preview-${index + 1}.png`, fullPage: true });
  }
  expect(state.posts).toHaveLength(0); expect(state.propertyReads).toBe(0); expect(state.unknownPosts).toHaveLength(0);
});

test('email verification sends only on request, refreshes identity, and still requires access approval', async ({ page, request }) => {
  await app.auth().updateUser(uid, { emailVerified: false });
  const state = await setup(page); state.verificationGate = true;
  const codes = async () => (await (await request.get('http://127.0.0.1:9099/emulator/v1/projects/demo-simpleseo/oobCodes')).json()).oobCodes.filter(item => item.email === `${uid}@example.test`);
  const before = (await codes()).length;
  await login(page); await expect(page.getByRole('heading', { name: 'Verify your email', exact: true })).toBeVisible();
  expect((await codes()).length).toBe(before);
  await page.getByRole('button', { name: 'I’ve verified my email' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Your email is not verified yet');
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Verification email sent');
  expect((await codes()).length).toBe(before + 1);
  await app.auth().updateUser(uid, { emailVerified: true });
  await page.getByRole('button', { name: 'I’ve verified my email' }).click();
  await expect(page.locator('p[role=alert]')).toHaveText('Your account is awaiting access approval.');
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).not.toBeVisible();
  state.gateApproved = true; await page.getByRole('button', { name: 'Retry loading setup' }).click();
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(0);
});

test('verification email rate limits remain retryable without advancing setup', async ({ page }) => {
  await app.auth().updateUser(uid, { emailVerified: false });
  const state = await setup(page); state.verificationGate = true; await login(page);
  await page.route('**/accounts:sendOobCode?*', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }) }));
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toHaveText('Please wait a little before requesting another verification email.');
  await expect(page.getByRole('button', { name: 'Send verification email', exact: true })).toBeEnabled();
  expect(state.posts).toHaveLength(0);
});

test('leaving during verification cannot write a stale result into the next auth screen', async ({ page }) => {
  await app.auth().updateUser(uid, { emailVerified: false });
  const state = await setup(page); state.verificationGate = true; await login(page);
  let release;
  await page.route('**/accounts:sendOobCode?*', async route => { await new Promise(resolve => { release = resolve; }); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: `${uid}@example.test` }) }); });
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Sending verification email');
  await expect.poll(() => typeof release).toBe('function');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/auth/); release();
  await expect(page.getByText(/Verification email sent/)).not.toBeVisible(); expect(state.posts).toHaveLength(0);
});

test('browser drafts restore only editable business facts and cannot complete or connect an account', async ({ page }) => {
  const state = await setup(page, workspace(), { localOnly: true });
  await page.addInitScript(({ uid }) => localStorage.setItem(`onboarding_draft_${uid}`, JSON.stringify({ businessName: 'Local owner details', businessType: 'Plumber', businessLocation: 'Riverton, Wyoming', services: ['Heating, cooling and ventilation'], serviceCities: ['Riverton', 'Lakeside'], cmsPlatform: 'WordPress', goal: 'quotes', isComplete: true, hasGSC: true, gscProperty: 'sc-domain:malicious.test', websiteUrl: 'https://malicious.test', gscAccessToken: 'browser-token', privacyPolicyAccepted: true, revampRunId: 'forged' })), { uid });
  await login(page);
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await expect(page.getByLabel('Website address')).toHaveValue('');
  await business(page);
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Local owner details');
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Riverton, Wyoming');
  await expect(page.getByLabel('Which areas do you actually serve?')).toHaveValue('Riverton\nLakeside');
  await expect(page.getByLabel('What services do you offer?')).toHaveValue('Heating, cooling and ventilation');
  await expect(page.getByRole('checkbox', { name: /These services/ })).not.toBeChecked();
  expect(state.posts[0].legacyDraft).toMatchObject({ businessName: 'Local owner details', baseLocation: { city: 'Riverton, Wyoming', region: '', country: '' }, services: ['Heating, cooling and ventilation'], serviceAreas: ['Riverton', 'Lakeside'], goal: 'quotes' });
  expect(JSON.stringify(state.posts)).not.toMatch(/malicious|browser-token|forged|gscProperty|isComplete/);
});

test('a missing customer goal is an explicit choice before business confirmation', async ({ page }) => {
  const state = await setup(page, workspace({ pinned: true, session: session({ profileDraft: { ...profile(), goal: '' } }) })); await login(page);
  const goal = page.getByLabel('What would you like customers to do?');
  await expect(goal).toHaveValue('');
  await expect(goal.locator('option:checked')).toHaveText('Choose an action');
  await page.getByRole('checkbox', { name: /These services/ }).check();
  await page.getByRole('button', { name: 'Confirm business details', exact: true }).click();
  expect(await goal.evaluate(element => element.validity.valueMissing)).toBe(true); expect(state.posts).toHaveLength(0);
  await goal.selectOption('quotes');
  await page.getByRole('checkbox', { name: /These services/ }).check();
  await page.getByRole('button', { name: 'Confirm business details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible();
  expect(state.posts[0].profileDraft.goal).toBe('quotes');
});
