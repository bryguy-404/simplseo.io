import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { getUser: vi.fn(async uid => ({ uid, disabled: false })), verifyIdToken: vi.fn(async token => { if (!['alice', 'bob'].includes(token)) throw Error(); return { uid: token }; }) } };
});
vi.mock('../app/lib/server/onboardingInventory', () => ({ readOnboardingInventory: vi.fn(async () => null), promoteOnboardingInventory: vi.fn(async () => ({ promoted: false })) }));
vi.mock('../app/lib/server/onboardingExtraction', () => ({ readOnboardingExtraction: vi.fn(async () => null) }));
vi.mock('../app/lib/server/gscConnection', async importOriginal => ({ ...await importOriginal(), getGscConnection: vi.fn() }));
import { records, reset, auth, db } from '../app/lib/firebaseAdmin';
import { accountHash, deleteAccountFirestore } from '../app/lib/server/accountDeletion';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { readOnboardingInventory, promoteOnboardingInventory } from '../app/lib/server/onboardingInventory';
import { businessProfileRef, accountWebsiteScope, readBusinessContext, profileEvidence } from '../app/lib/server/businessProfile';
import { beginOnboarding, saveOnboardingDraft, confirmOnboardingProfile, completeOnboarding, readOnboardingWorkspace, checkOnboardingReadiness } from '../app/lib/server/onboardingWorkspace';
import { GET, POST } from '../app/api/onboarding/workspace/route';
import { beginGscConnection, exchangeStagedGsc, selectStagedGsc } from '../app/lib/server/stagedGsc';

const uid = 'alice', sessionPath = 'users/alice/onboardingSessions/current';
const profile = { businessName: 'Example Plumbing', businessType: 'Plumber', services: ['Drain repair'], baseLocation: { city: 'South Bend', region: 'Indiana', country: 'United States' }, serviceAreas: ['South Bend'], goal: 'quotes', cmsPlatform: 'I do not know', customerTypes: [], differentiators: '' };
const request = (action, expectedRevision = 1, extra = {}) => ({ action, expectedRevision, requestId: `${action}-request-${expectedRevision}`, ...extra });
const property = 'sc-domain:example.test';
const session = () => records.get(sessionPath);
beforeEach(() => {
  reset(); vi.clearAllMocks();
  process.env.ONBOARDING_V2_ENABLED = 'true'; process.env.ONBOARDING_V2_PILOT_UIDS = 'alice';
  records.set('users/alice', { createdAt: 'old' });
  fetch.mockResolvedValue(new Response(JSON.stringify({ siteEntry: [{ siteUrl: property, permissionLevel: 'siteOwner' }] })));
  readOnboardingInventory.mockResolvedValue(null); promoteOnboardingInventory.mockResolvedValue({ promoted: false });
  getGscConnection.mockResolvedValue({ siteUrl: property, query: vi.fn(async () => ({ rows: [] })), browserCredentials: vi.fn(async () => ({ access_token: 'private' })), inspect: vi.fn(async () => ({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } })) });
});
const begin = () => beginOnboarding(uid, request('begin'));
function existing() {
  records.set('users/alice', { gscSiteUrl: property, gscRefreshToken: 'private-refresh', gscAccessToken: 'private-access', createdAt: 'old' });
  records.set('onboarding/alice', { isComplete: true, websiteUrl: 'example.test', gscProperty: property, revampRunId: 'run-old', businessName: 'Original name', businessType: 'Plumber', postOnboardingStep: 'keywords' });
  records.set('pageReviewPlans/saved', { userId: uid, revision: 4, ownerEdits: 'do not change' });
  records.set('pageProgressCycles/real', { userId: uid, confirmedAt: '2026-10-01T10:00:00Z', id: 'preserved' });
}
async function confirmedNew() {
  await begin();
  await saveOnboardingDraft(uid, request('save', 1, { websiteUrl: 'https://example.test/', privacyPolicyAccepted: true }));
  await confirmOnboardingProfile(uid, request('confirmProfile', 2, { profileDraft: profile, confirmed: true, currentStep: 'ready' }));
}
function stagedGoogleProvider({ beforeQuery } = {}) {
  let grantCount = 0;
  fetch.mockImplementation(async url => {
    let result;
    if (url.endsWith('/token')) result = { access_token: `private-access-${++grantCount}`, refresh_token: 'private-offline-refresh',
      scope: 'https://www.googleapis.com/auth/webmasters.readonly', expires_in: 3600 };
    else if (url.endsWith('/sites')) result = { siteEntry: [{ siteUrl: property, permissionLevel: 'siteOwner' }] };
    else if (url.endsWith('/searchAnalytics/query')) { await beforeQuery?.(); result = { rows: [] }; }
    else if (url.endsWith('/urlInspection/index:inspect')) result = { inspectionResult: { indexStatusResult: { verdict: 'PASS' } } };
    else throw Error('Unexpected Google endpoint');
    return new Response(JSON.stringify(result));
  });
}
async function stagedNewWebsite() {
  const started = await begin();
  const saved = await saveOnboardingDraft(uid, request('save', 1, { websiteUrl: 'https://www.example.test/', currentStep: 'google' }));
  const oauth = await beginGscConnection(uid, { origin: 'https://app.test', sessionRevision: saved.session.revision });
  const exchanged = await exchangeStagedGsc(uid, { code: 'test-code', state: oauth.state });
  const selected = await selectStagedGsc(uid, { pendingId: exchanged.pendingId, property, sessionRevision: exchanged.session.revision });
  return { started, saved, exchanged, selected };
}
it('returns saved-only empty workspace without creating data or calling providers', async () => {
  const result = await readOnboardingWorkspace(uid);
  expect(result).toMatchObject({ eligible: true, session: null, legacyCompleted: false });
  expect([...records.keys()]).toEqual(['users/alice']); expect(fetch).not.toHaveBeenCalled(); expect(getGscConnection).not.toHaveBeenCalled();
});
it('imports only business fields from local legacy drafts and pins server setup without completion', async () => {
  const result = await beginOnboarding(uid, request('begin', 1, { legacyDraft: { ...profile, websiteUrl: 'https://evil.test', isComplete: true, gscProperty: property, gscRefreshToken: 'injected', google: { status: 'connected' } } }));
  expect(result.session).toMatchObject({ revision: 1, state: 'draft', websiteUrl: '', profileDraft: profile, google: { status: 'not_connected' } });
  expect(records.get('onboarding/alice')).toEqual({ isComplete: false, setupVersion: 2 });
  expect(JSON.stringify(result)).not.toMatch(/injected|evil.test|requests/);
});
it('resumes the same session across calls and flag rollback without clearing fields', async () => {
  await begin(); await saveOnboardingDraft(uid, request('save', 1, { profileDraft: profile, currentStep: 'business' }));
  process.env.ONBOARDING_V2_ENABLED = 'false';
  const result = await beginOnboarding(uid, request('begin', 2));
  expect(result).toMatchObject({ pinned: true, eligible: false, session: { revision: 2, profileDraft: profile, currentStep: 'business' } });
});
it('does not enroll nonallowlisted or absent/disabled auth identities', async () => {
  await expect(beginOnboarding('bob', request('begin'))).rejects.toMatchObject({ status: 403 });
  auth.getUser.mockRejectedValueOnce(Error('deleted auth'));
  await expect(begin()).rejects.toThrow('deleted auth');
  expect(records.has('onboarding/alice')).toBe(false);
});
it('cannot recreate setup after deletion removes the roots while Firebase Auth still accepts the account', async () => {
  await begin();
  // This fixture has no prefixed legacy records. Account-deletion tests cover
  // their range queries; here exercise the real deletion/start interleaving.
  const originalCollection = db.collection;
  vi.spyOn(db, 'collection').mockImplementation(name => ({ ...originalCollection(name),
    orderBy: () => ({ startAt: () => ({ endBefore: () => ({ get: async () => ({ docs: [], empty: true }) }) }) }),
  }));
  let attempted = false;
  db.recursiveDelete = vi.fn(async ref => {
    for (const path of records.keys()) if (path === ref.path || path.startsWith(`${ref.path}/`)) records.delete(path);
    if (ref.path === 'users/alice') {
      attempted = true;
      await expect(beginOnboarding(uid, request('begin', 1, { requestId: 'concurrent-begin-after-delete' }))).rejects.toMatchObject({ status: 409 });
      expect(records.has('users/alice')).toBe(false);
    }
  });
  await deleteAccountFirestore(db, uid);
  expect(attempted).toBe(true);
  expect(auth.getUser).toHaveReturned();
  expect(records.has('onboarding/alice')).toBe(false);
  expect(records.has(sessionPath)).toBe(false);
  expect([...records]).toEqual([[`accountDeletionGuards/${accountHash(uid)}`, { blocked: true, deletedAt: expect.any(String) }]]);
});
it('saves before Google, handles idempotence, and rejects stale or reused request IDs', async () => {
  await begin(); const input = request('save', 1, { profileDraft: profile, currentStep: 'business' });
  await saveOnboardingDraft(uid, input); await saveOnboardingDraft(uid, input);
  expect(session().revision).toBe(2); expect(session().google.status).toBe('not_connected');
  await expect(saveOnboardingDraft(uid, { ...input, currentStep: 'ready' })).rejects.toMatchObject({ status: 409 });
  await expect(saveOnboardingDraft(uid, { ...input, requestId: 'a-different-request' })).rejects.toMatchObject({ status: 409 });
});
it('rejects extra service lines and missing confirmation without saving a truncated owner profile', async () => {
  await begin();
  await expect(saveOnboardingDraft(uid, request('save', 1, { profileDraft: { ...profile, services: Array.from({ length: 13 }, (_, i) => `Service ${i}`) } }))).rejects.toThrow('12 services');
  await expect(confirmOnboardingProfile(uid, request('confirmProfile', 1, { profileDraft: profile }))).rejects.toThrow('Confirm');
  expect(session().revision).toBe(1);
});
it('requires privacy and Google but not an inventory, inspection or search activity to complete', async () => {
  await confirmedNew();
  await expect(completeOnboarding(uid, request('complete', 3))).rejects.toMatchObject({ status: 409 });
  // Represent a previously validated durable connection on an unfinished legacy account.
  const initial = { gscProperty: property, websiteUrl: 'https://example.test/', isComplete: false, setupVersion: 2 };
  records.set('onboarding/alice', initial);
  records.set('users/alice', { gscSiteUrl: property, gscRefreshToken: 'durable', gscAccessToken: 'private' });
  records.set(sessionPath, { ...session(), originalScope: accountWebsiteScope(initial), google: { status: 'connected', property } });
  const input = request('complete', 3);
  const result = await completeOnboarding(uid, input); await completeOnboarding(uid, input);
  expect(result.session).toMatchObject({ state: 'complete', mode: 'existing', revision: 4 });
  expect(records.get('onboarding/alice')).toMatchObject({ isComplete: true, pagesStepCompleted: true, postOnboardingStep: 'complete' });
  expect(result.profile).toMatchObject({ status: 'confirmed', revision: 1, profile });
  expect(promoteOnboardingInventory).toHaveBeenCalledTimes(1);
  expect((await getGscConnection()).query).toHaveBeenCalledTimes(1);
});
it('completes a real staged Google setup exactly once with private credentials and a single scoped profile', async () => {
  stagedGoogleProvider();
  const flow = await stagedNewWebsite();
  const pendingPath = `users/${uid}/pendingGscConnections/${flow.exchanged.pendingId}`;
  expect(records.has(pendingPath)).toBe(true);
  expect(records.get(`users/${uid}`).gscRefreshToken).toBeUndefined();
  expect(flow.selected.session.revision).toBe(4);
  const confirmed = await confirmOnboardingProfile(uid, request('confirmProfile', 4, { profileDraft: profile, confirmed: true, currentStep: 'ready' }));
  // A later profile/privacy save must not invalidate the selected staged grant.
  const privacy = await saveOnboardingDraft(uid, request('save', 5, { privacyPolicyAccepted: true, currentStep: 'ready' }));
  expect([...records.keys()].filter(path => path.startsWith(`users/${uid}/businessProfiles/`))).toEqual([]);
  const completeInput = request('complete', 6);
  const completed = await completeOnboarding(uid, completeInput);
  const exactScope = { property, websiteUrl: 'https://www.example.test/', websiteRunId: null };
  const savedProfile = businessProfileRef(uid, exactScope);
  expect(completed.session).toMatchObject({ state: 'complete', mode: 'existing', revision: 7, originalScope: exactScope,
    google: { status: 'connected', property, pendingId: null }, profileConfirmed: true });
  expect(completed.profile).toMatchObject({ status: 'confirmed', revision: 1, scope: exactScope, profile });
  expect(records.get(`onboarding/${uid}`)).toMatchObject({ isComplete: true, websiteUrl: exactScope.websiteUrl, gscProperty: property });
  expect(records.get(`users/${uid}`)).toMatchObject({ gscSiteUrl: property, gscRefreshToken: 'private-offline-refresh',
    gscConnectionVersion: flow.exchanged.pendingId });
  expect(records.has(pendingPath)).toBe(false);
  expect([...records.keys()].filter(path => path.startsWith(`users/${uid}/businessProfiles/`))).toEqual([savedProfile.path]);
  expect([...records.keys()].filter(path => path.startsWith('gscOAuthStates/'))).toEqual([]);
  const beforeDuplicate = structuredClone([...records]);
  fetch.mockClear();
  const duplicate = await completeOnboarding(uid, completeInput);
  expect(duplicate.session).toEqual(completed.session);
  expect([...records]).toEqual(beforeDuplicate);
  expect(promoteOnboardingInventory).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  expect(getGscConnection).not.toHaveBeenCalled();
  expect(JSON.stringify([flow.started, flow.saved, flow.exchanged, flow.selected, confirmed, privacy, completed, duplicate]))
    .not.toMatch(/private-access-|private-offline-refresh|gscAccessToken|gscRefreshToken|"accessToken"|"refreshToken"/);
});
it('does not complete or call Google when privacy was not saved', async () => {
  await begin(); await confirmOnboardingProfile(uid, request('confirmProfile', 1, { profileDraft: profile, confirmed: true }));
  await expect(completeOnboarding(uid, request('complete', 2))).rejects.toThrow('privacy');
  expect(getGscConnection).not.toHaveBeenCalled(); expect(session().state).toBe('draft');
});
it('existing optional confirmation preserves exact website/property/version and all plans/dates', async () => {
  existing(); const oldSetup = structuredClone(records.get('onboarding/alice'));
  const plan = structuredClone(records.get('pageReviewPlans/saved')), cycle = structuredClone(records.get('pageProgressCycles/real'));
  await begin(); await confirmOnboardingProfile(uid, request('confirmProfile', 1, { profileDraft: profile, confirmed: true }));
  const current = records.get('onboarding/alice');
  for (const key of ['websiteUrl', 'gscProperty', 'revampRunId', 'isComplete', 'postOnboardingStep']) expect(current[key]).toEqual(oldSetup[key]);
  expect(records.get('pageReviewPlans/saved')).toEqual(plan); expect(records.get('pageProgressCycles/real')).toEqual(cycle);
  expect((await readBusinessContext(uid)).profile).toEqual(profile);
  expect(getGscConnection).not.toHaveBeenCalled();
});
it('preserves raw existing identity even when form supplies its normalized URL', async () => {
  existing(); await begin(); await saveOnboardingDraft(uid, request('save', 1, { websiteUrl: 'https://example.test/' }));
  expect(session().websiteUrl).toBe('example.test');
  await expect(saveOnboardingDraft(uid, request('save', 2, { websiteUrl: 'https://other.test/' }))).rejects.toMatchObject({ status: 409 });
});
it('stores profile history only for changed confirmed facts and keeps legacy data labeled', async () => {
  existing(); expect(profileEvidence(await readBusinessContext(uid))).toBeNull(); await begin();
  await confirmOnboardingProfile(uid, request('confirmProfile', 1, { profileDraft: profile, confirmed: true }));
  await confirmOnboardingProfile(uid, request('confirmProfile', 2, { profileDraft: profile, confirmed: true }));
  expect((await readBusinessContext(uid)).revision).toBe(1);
  await confirmOnboardingProfile(uid, request('confirmProfile', 3, { profileDraft: { ...profile, services: ['Leak repair'] }, confirmed: true }));
  const ref = businessProfileRef(uid, session().originalScope);
  expect(records.get(`${ref.path}/history/1`).profile).toEqual(profile);
  expect((await readBusinessContext(uid)).revision).toBe(2);
});
it.each(['delete', 'property', 'rebuild'])('refuses %s during completion and preserves prior data', async kind => {
  existing(); await begin(); await confirmOnboardingProfile(uid, request('confirmProfile', 1, { profileDraft: profile, confirmed: true }));
  await saveOnboardingDraft(uid, request('save', 2, { privacyPolicyAccepted: true }));
  const query = vi.fn(async () => { if (kind === 'delete') records.delete('users/alice');
    else records.set('onboarding/alice', { ...records.get('onboarding/alice'), [kind === 'property' ? 'gscProperty' : 'revampRunId']: 'changed' }); return { rows: [] }; });
  getGscConnection.mockResolvedValue({ siteUrl: property, query, browserCredentials: async () => ({ access_token: 'private' }) });
  await expect(completeOnboarding(uid, request('complete', 3))).rejects.toMatchObject({ status: 409 });
  expect(session().revision).toBe(3); expect(records.get('pageProgressCycles/real').confirmedAt).toBe('2026-10-01T10:00:00Z');
  if (kind === 'delete') expect(records.has('users/alice')).toBe(false);
});
it('checks readiness once per request and preserves dated successful Google observations on failure', async () => {
  existing(); await begin(); const input = request('readiness', 1);
  await checkOnboardingReadiness(uid, input); await checkOnboardingReadiness(uid, input);
  expect(session().readiness.search.status).toBe('no_data'); expect(session().revision).toBe(1);
  expect((await getGscConnection()).query).toHaveBeenCalledTimes(1);
  getGscConnection.mockRejectedValue(Error('Google unavailable'));
  await checkOnboardingReadiness(uid, { ...input, requestId: 'readiness-retry-new' });
  expect(session().readiness.search).toMatchObject({ status: 'unavailable', previous: { status: 'no_data' } });
  expect(session().readiness.inspections[0]).toMatchObject({ status: 'unavailable', previous: { status: 'available' } });
});
it.each(['delete', 'delete-session', 'deleting', 'property', 'website', 'run', 'revision'])('does not publish stale readiness observations after an in-flight %s', async kind => {
  stagedGoogleProvider();
  const { selected } = await stagedNewWebsite();
  const revision = selected.session.revision;
  await checkOnboardingReadiness(uid, request('readiness', revision));
  const prior = structuredClone(session().readiness), priorRequests = structuredClone(session().requests);
  expect(prior.search.status).toBe('no_data');
  expect(prior.inspections[0].status).toBe('available');
  let changed = false;
  stagedGoogleProvider({ beforeQuery: () => {
    changed = true;
    if (kind === 'delete' || kind === 'delete-session') records.delete(`users/${uid}`);
    if (kind === 'delete-session') records.delete(sessionPath);
    if (kind === 'deleting') records.get(`users/${uid}`).deletionInProgress = true;
    if (kind === 'property') records.get(`onboarding/${uid}`).gscProperty = 'sc-domain:other.test';
    if (kind === 'website') records.get(`onboarding/${uid}`).websiteUrl = 'https://other.test/';
    if (kind === 'run') records.get(`onboarding/${uid}`).revampRunId = 'new-website-run';
    if (kind === 'revision') {
      session().revision += 1;
      session().profileDraft.businessName = 'Saved in another window';
    }
  } });
  await expect(checkOnboardingReadiness(uid, request('readiness', revision, { requestId: `readiness-in-flight-${kind}` })))
    .rejects.toMatchObject({ status: 409 });
  expect(changed).toBe(true);
  if (kind === 'delete-session') expect(records.has(sessionPath)).toBe(false);
  else {
    expect(session().readiness).toEqual(prior);
    expect(session().requests).toEqual(priorRequests);
    expect(session().readinessJob).toBeNull();
    expect(session().revision).toBe(revision + (kind === 'revision' ? 1 : 0));
    if (kind === 'revision') expect(session().profileDraft.businessName).toBe('Saved in another window');
  }
  if (kind === 'delete' || kind === 'delete-session') expect(records.has(`users/${uid}`)).toBe(false);
  expect(getGscConnection).not.toHaveBeenCalled();
});
it('API refuses anonymous reads and binds operations to authenticated identity, ignoring supplied userId', async () => {
  expect((await GET(new Request('http://localhost/api/onboarding/workspace'))).status).toBe(401);
  const result = await POST(new Request('http://localhost/api/onboarding/workspace', { method: 'POST', headers: { Authorization: 'Bearer alice' }, body: JSON.stringify({ ...request('begin'), userId: 'bob' }) }));
  expect(result.status).toBe(200); expect(records.has('users/bob/onboardingSessions/current')).toBe(false);
  expect(JSON.stringify(await result.json())).not.toContain('private-access');
});
