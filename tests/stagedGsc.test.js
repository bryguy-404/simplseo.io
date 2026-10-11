import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { verifyIdToken: vi.fn(async token => { if (!['alice', 'bob'].includes(token)) throw Error(); return { uid: token }; }) } };
});
import { records, reset, db } from '../app/lib/firebaseAdmin';
import { beginGscConnection, exchangeStagedGsc, selectStagedGsc, readPendingGscSelection, validatePendingGscCommit, refreshPendingGscSelection, listStagedGscProperties } from '../app/lib/server/stagedGsc';
import { GET as startRoute } from '../app/api/gsc/connect/route';
import { POST as exchangeRoute } from '../app/api/gsc/exchange-code/route';
import { POST as selectRoute } from '../app/api/gsc/select/route';
import { POST as propertiesRoute } from '../app/api/gsc/properties/route';
import { POST as storeRoute, DELETE as disconnect } from '../app/api/gsc/store-tokens/route';

const property = 'sc-domain:example.test', websiteUrl = 'https://www.example.test/';
const path = 'users/alice/onboardingSessions/current';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const request = (body = {}, token = 'alice', method = 'POST') => new Request('http://localhost/api/gsc/test', { method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
const properties = [{ siteUrl: property, permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.test/', permissionLevel: 'siteFullUser' }, { siteUrl: 'https://restricted.test/', permissionLevel: 'siteRestrictedUser' }];
beforeEach(() => {
  reset();
  records.set('users/alice', { createdAt: 'before', profile: 'keep' });
  records.set('users/bob', { createdAt: 'before' });
  records.set('onboarding/alice', { isComplete: false });
  records.set(path, { userId: 'alice', state: 'draft', mode: 'new', revision: 1, websiteUrl,
    originalScope: { property: null, websiteUrl: null, websiteRunId: null }, google: { status: 'not_connected' }, createdAt: 'session-one', requests: [{ private: 'signature' }], readinessJob: { id: 'private-lease' } });
});
function provider({ sites = properties, refresh = 'offline-private', onRequest } = {}) {
  fetch.mockImplementation(async (url, options) => {
    await onRequest?.(url, options);
    if (url.endsWith('/token')) return json({ access_token: 'access-private', ...(refresh ? { refresh_token: refresh } : {}), expires_in: 3600 });
    if (url.endsWith('/sites')) return json({ siteEntry: sites });
    throw Error('unexpected endpoint');
  });
}
async function stage() {
  const setup = await beginGscConnection('alice', { origin: 'https://app.test', sessionRevision: 1 });
  return exchangeStagedGsc('alice', { state: setup.state, code: 'code' });
}
async function selected() {
  provider(); const result = await stage();
  return selectStagedGsc('alice', { pendingId: result.pendingId, property, sessionRevision: result.session.revision });
}
function existing() {
  records.set('users/alice', { gscAccessToken: 'old-access', gscRefreshToken: 'old-refresh', gscSiteUrl: property, gscConnectedAt: 'old-date', profile: 'keep' });
  records.set('onboarding/alice', { isComplete: true, websiteUrl, gscProperty: property, revampRunId: 'existing-run', revampStatus: 'in-progress' });
}

it('binds readonly OAuth state to the signed-in setup revision without touching active credentials', async () => {
  const result = await beginGscConnection('alice', { origin: 'https://app.test', sessionRevision: 1 });
  const url = new URL(result.url);
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(records.get(`gscOAuthStates/${result.state}`)).toMatchObject({ uid: 'alice', mode: 'onboarding', sessionRevision: 1, consumed: false });
  expect(records.get('users/alice')).toEqual({ createdAt: 'before', profile: 'keep' });
  expect(fetch).not.toHaveBeenCalled();
});
it('stages durable tokens privately and returns only property choices and an opaque pending ID', async () => {
  provider(); const result = await stage();
  expect(result.pendingId).toMatch(/^[a-f0-9]{64}$/);
  expect(result.session).toMatchObject({ revision: 2, google: { status: 'pending', pendingId: result.pendingId } });
  expect(result.properties).toEqual([{ ...properties[0], matchesWebsite: true }, { ...properties[1], matchesWebsite: false }]);
  expect(result.propertyIssues).toEqual([{ ...properties[2], reason: 'insufficient_permission', matchesWebsite: false }]);
  expect(result.session.google.propertyIssues).toEqual(result.propertyIssues);
  expect(JSON.stringify(result)).not.toMatch(/access-private|offline-private|signature|private-lease/);
  expect(records.get(`users/alice/pendingGscConnections/${result.pendingId}`)).toMatchObject({ accessToken: 'access-private', refreshToken: 'offline-private' });
  expect(records.get('users/alice').gscAccessToken).toBeUndefined();
});
it('selection checks live access and URL coverage then increments revision without committing credentials', async () => {
  provider(); const staged = await stage();
  await expect(selectStagedGsc('alice', { pendingId: staged.pendingId, property: 'https://other.test/', sessionRevision: 2 })).rejects.toMatchObject({ status: 409 });
  const result = await selectStagedGsc('alice', { pendingId: staged.pendingId, property, sessionRevision: 2 });
  expect(result.session).toMatchObject({ revision: 3, google: { status: 'connected', property, pendingId: staged.pendingId } });
  expect(records.get('users/alice').gscAccessToken).toBeUndefined();
});
it('profile-only revision changes preserve selected credentials while website changes invalidate them', async () => {
  const result = await selected(); records.get(path).revision += 1;
  expect((await readPendingGscSelection('alice', { pendingId: result.pendingId })).property).toBe(property);
  records.get(path).websiteUrl = 'https://another.test/';
  await expect(readPendingGscSelection('alice', { pendingId: result.pendingId })).rejects.toMatchObject({ status: 409 });
});
it('completion validation supplies private connection fields inside a transaction and requires recent proof', async () => {
  const result = await selected();
  const value = await db.runTransaction(tx => validatePendingGscCommit('alice', { pendingId: result.pendingId, tx }));
  expect(value.connectionFields).toMatchObject({ gscSiteUrl: property, gscRefreshToken: 'offline-private' });
  records.get(value.pendingRef.path).providerAccessValidatedAt = Date.now() - 6 * 60000;
  await expect(validatePendingGscCommit('alice', { pendingId: result.pendingId })).rejects.toMatchObject({ status: 409 });
  await refreshPendingGscSelection('alice', { pendingId: result.pendingId, sessionRevision: 3 });
  expect((await validatePendingGscCommit('alice', { pendingId: result.pendingId })).property).toBe(property);
});
it('refreshing choices can recover from an initially empty property list', async () => {
  provider({ sites: [] }); const result = await stage(); expect(result.properties).toEqual([]);
  expect(result.propertyIssues).toEqual([]);
  provider(); const refreshed = await listStagedGscProperties('alice', result.pendingId);
  expect(refreshed.properties[0].matchesWebsite).toBe(true);
  expect(refreshed.session.revision).toBe(3);
  expect(records.get(path).google.properties).toEqual(refreshed.properties);
  expect(records.get(path).google.propertyIssues).toEqual(refreshed.propertyIssues);
  expect(JSON.stringify(refreshed)).not.toMatch(/access-private|offline-private|signature|private-lease/);
});
it('distinguishes insufficient property permissions from no properties without permitting restricted selection', async () => {
  provider({ sites: [{ siteUrl: property, permissionLevel: 'siteRestrictedUser' }] });
  const result = await stage();
  expect(result.properties).toEqual([]);
  expect(result.propertyIssues).toEqual([{ siteUrl: property, permissionLevel: 'siteRestrictedUser', reason: 'insufficient_permission', matchesWebsite: true }]);
  await expect(selectStagedGsc('alice', { pendingId: result.pendingId, property, sessionRevision: 2 })).rejects.toMatchObject({ status: 403 });
  expect(records.get('users/alice').gscAccessToken).toBeUndefined();
  expect(records.get(path).google.status).toBe('pending');
});
it('does not overwrite a concurrent profile save while refreshing property choices', async () => {
  provider(); const result = await stage();
  provider({ onRequest: url => { if (url.endsWith('/sites')) records.get(path).revision += 1; } });
  await expect(listStagedGscProperties('alice', result.pendingId)).rejects.toMatchObject({ status: 409 });
  expect(records.get(path).revision).toBe(3);
  expect(records.get('users/alice').gscAccessToken).toBeUndefined();
});
it.each(['missing_offline', 'missing_scope', 'provider_failure'])('leaves active credentials and saved setup unchanged on %s', async failure => {
  const setup = await beginGscConnection('alice', { origin: 'https://app.test', sessionRevision: 1 });
  const before = structuredClone(records.get(path));
  if (failure === 'missing_offline') provider({ refresh: null });
  if (failure === 'missing_scope') fetch.mockResolvedValue(json({ access_token: 'access', refresh_token: 'refresh', scope: 'openid email' }));
  if (failure === 'provider_failure') fetch.mockResolvedValue(json({ error: 'private diagnostics' }, 503));
  await expect(exchangeStagedGsc('alice', { state: setup.state, code: 'code' })).rejects.toBeInstanceOf(Error);
  expect(records.get(path)).toEqual(before); expect(records.get('users/alice').gscAccessToken).toBeUndefined();
  expect([...records.keys()].some(key => key.includes('pendingGscConnections'))).toBe(false);
});
it('rejects replayed, expired, foreign and stale-revision OAuth state before calling Google', async () => {
  const started = await beginGscConnection('alice', { origin: 'https://app.test', sessionRevision: 1 });
  await expect(exchangeStagedGsc('bob', { state: started.state, code: 'code' })).rejects.toMatchObject({ status: 409 });
  records.get(`gscOAuthStates/${started.state}`).expiresAt = 0;
  await expect(exchangeStagedGsc('alice', { state: started.state, code: 'code' })).rejects.toMatchObject({ status: 409 });
  records.get(`gscOAuthStates/${started.state}`).expiresAt = Date.now() + 60000;
  records.get(path).revision = 4;
  await expect(exchangeStagedGsc('alice', { state: started.state, code: 'code' })).rejects.toMatchObject({ status: 409 });
  expect(fetch).not.toHaveBeenCalled(); records.get(path).revision = 1; provider();
  await exchangeStagedGsc('alice', { state: started.state, code: 'code' }); fetch.mockClear();
  await expect(exchangeStagedGsc('alice', { state: started.state, code: 'code' })).rejects.toMatchObject({ status: 409 });
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['deleted', 'deleting', 'website_changed', 'new_session'])('does not save an in-flight OAuth result after account/session %s', async change => {
  const started = await beginGscConnection('alice', { origin: 'https://app.test', sessionRevision: 1 });
  provider({ onRequest: url => {
    if (!url.endsWith('/sites')) return;
    if (change === 'deleted') records.delete('users/alice');
    if (change === 'deleting') records.get('users/alice').deletionInProgress = true;
    if (change === 'website_changed') records.get('onboarding/alice').revampRunId = 'new-run';
    if (change === 'new_session') records.get(path).createdAt = 'new-session';
  } });
  await expect(exchangeStagedGsc('alice', { state: started.state, code: 'code' })).rejects.toMatchObject({ status: 409 });
  expect([...records.keys()].some(key => key.includes('pendingGscConnections'))).toBe(false);
  if (change === 'deleted') expect(records.has('users/alice')).toBe(false);
});
it('same-property reconnect supports recovery accounts, proves offline access and keeps the website/run/history unchanged', async () => {
  existing(); provider(); const before = structuredClone(records.get('onboarding/alice'));
  const setup = await beginGscConnection('alice', { origin: 'https://app.test', property });
  const result = await exchangeStagedGsc('alice', { state: setup.state, code: 'code' });
  expect(result).toEqual({ success: true, connected: true, property });
  expect(records.get('users/alice')).toMatchObject({ profile: 'keep', gscAccessToken: 'access-private', gscRefreshToken: 'offline-private', gscSiteUrl: property });
  expect(records.get('onboarding/alice')).toEqual(before);
});
it('reconnect cannot change properties or replace credentials with an account lacking selected access', async () => {
  existing();
  await expect(beginGscConnection('alice', { origin: 'https://app.test', property: 'sc-domain:other.test' })).rejects.toMatchObject({ status: 409 });
  const started = await beginGscConnection('alice', { origin: 'https://app.test', property }); provider({ sites: [] });
  await expect(exchangeStagedGsc('alice', { state: started.state, code: 'code' })).rejects.toMatchObject({ status: 403 });
  expect(records.get('users/alice').gscRefreshToken).toBe('old-refresh');
});
it('a concurrent disconnect or successful connection prevents older callbacks overwriting it', async () => {
  existing(); const started = await beginGscConnection('alice', { origin: 'https://app.test', property });
  provider({ onRequest: async url => { if (url.endsWith('/sites')) await disconnect(request({}, 'alice', 'DELETE')); } });
  await expect(exchangeStagedGsc('alice', { state: started.state, code: 'code' })).rejects.toMatchObject({ status: 409 });
  expect(records.get('users/alice').gscRefreshToken).toBeNull();
});
it('routes authenticate and reject foreign identity or direct browser tokens without provider calls', async () => {
  for (const handler of [exchangeRoute, selectRoute, propertiesRoute]) {
    expect((await handler(request({}, null))).status).toBe(401);
    expect((await handler(request({ userId: 'bob' }))).status).toBe(403);
  }
  expect((await startRoute(request({}, null, 'GET'))).status).toBe(401);
  expect((await exchangeRoute(request({ accessToken: 'forged', refreshToken: 'forged', property }))).status).toBe(400);
  expect((await propertiesRoute(request({ accessToken: 'forged' }))).status).toBe(400);
  expect((await storeRoute(request({ accessToken: 'forged' }))).status).toBe(410);
  expect(fetch).not.toHaveBeenCalled();
});
it('pending access is owner-bound and expires without affecting active credentials', async () => {
  const result = await selected();
  await expect(readPendingGscSelection('bob', { pendingId: result.pendingId })).rejects.toBeInstanceOf(Error);
  records.get(`users/alice/pendingGscConnections/${result.pendingId}`).expiresAt = Date.now() - 1;
  await expect(readPendingGscSelection('alice', { pendingId: result.pendingId })).rejects.toMatchObject({ status: 409 });
  expect(records.get('users/alice').gscAccessToken).toBeUndefined();
});
it('stale selection revisions fail before any provider request', async () => {
  provider(); const value = await stage(); fetch.mockClear();
  await expect(selectStagedGsc('alice', { pendingId: value.pendingId, property, sessionRevision: 1 })).rejects.toMatchObject({ status: 409 });
  expect(fetch).not.toHaveBeenCalled();
});
it('revalidates revoked property access immediately before completion', async () => {
  const value = await selected(); provider({ sites: [] });
  await expect(refreshPendingGscSelection('alice', { pendingId: value.pendingId, sessionRevision: 3 })).rejects.toMatchObject({ status: 403 });
  expect(records.get('users/alice').gscAccessToken).toBeUndefined();
});
it.each(['http://www.example.test/', 'https://example.test/', 'https://www.example.test/Other/'])('URL-prefix selection rejects a property not covering website %s', async url => {
  records.get(path).websiteUrl = url;
  provider({ sites: [{ siteUrl: 'https://www.example.test/Services/', permissionLevel: 'siteOwner' }] });
  const value = await stage();
  await expect(selectStagedGsc('alice', { pendingId: value.pendingId, property: 'https://www.example.test/Services/', sessionRevision: 2 })).rejects.toMatchObject({ status: 409 });
});
it('session changes during selection preserve prior selection and credentials', async () => {
  provider(); const value = await stage();
  provider({ onRequest: url => { if (url.endsWith('/sites')) records.get(path).revision += 1; } });
  await expect(selectStagedGsc('alice', { pendingId: value.pendingId, property, sessionRevision: 2 })).rejects.toMatchObject({ status: 409 });
  expect(records.get(path).google.status).toBe('pending');
  expect(records.get('users/alice').gscAccessToken).toBeUndefined();
});
it('does not recreate a deleted account on disconnect', async () => {
  records.delete('users/alice');
  expect((await disconnect(request({}, 'alice', 'DELETE'))).status).toBe(409);
  expect(records.has('users/alice')).toBe(false);
});
