import { createHash, randomBytes } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { GOOGLE_CLIENT_ID, getGscConnection } from './gscConnection';
import { propertyContainsUrl } from '../revampState';
import { RequestError } from './requestAuth';

const MINUTE = 60000;
const READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const idValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const credentialValid = value => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const expired = message => new RequestError(message || 'This Google connection expired. Connect Google again.', 409);
const sessionRef = uid => db.collection('users').doc(uid).collection('onboardingSessions').doc('current');
const pendingRef = (uid, id) => db.collection('users').doc(uid).collection('pendingGscConnections').doc(id);
const sameScope = (a, b) => ['property', 'websiteUrl', 'websiteRunId'].every(key => (a?.[key] || null) === (b?.[key] || null));
const expiry = seconds => Date.now() + Math.min(7200, Math.max(60, Number(seconds) || 3600)) * 1000;
const publicSession = ({ requests: _requests, readinessJob: _job, ...session }) => session;

async function context(uid, tx) {
  const read = ref => tx ? tx.get(ref) : ref.get();
  const refs = ['users', 'onboarding', 'gscTokens'].map(name => db.collection(name).doc(uid));
  const [user, setup, legacy, session] = await Promise.all([...refs, sessionRef(uid)].map(read));
  if (!user.exists || user.data()?.deletionInProgress) throw expired('Your account changed. Sign in again before connecting Google.');
  const u = user.data(), o = setup.data() || {}, l = legacy.data() || {};
  if (o.revampArchivePending) throw expired('Wait for your website history to finish saving before connecting Google.');
  return { user: u, setup: o, session: session.data(), connectionVersion: u.gscConnectionVersion || createHash('sha256').update(u.gscRefreshToken || l.refreshToken || '').digest('hex'), scope: {
    property: o.gscProperty || u.gscSiteUrl || l.siteUrl || null,
    websiteUrl: o.websiteUrl || u.websiteUrl || null,
    websiteRunId: o.revampRunId || null,
  } };
}
function assertSession(ctx, revision) {
  const session = ctx.session;
  if (!session || session.state !== 'draft' || (session.expiresAt && Number(session.expiresAt) <= Date.now())
    || !sameScope(session.originalScope, ctx.scope)) throw expired('Your website setup changed. Reload it before connecting Google.');
  if (revision !== undefined && (!Number.isInteger(revision) || session.revision !== revision)) throw expired('Your setup changed in another tab. Reload before continuing.');
  return session;
}
function websiteValid(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash && (!url.port || ['80', '443'].includes(url.port)); }
  catch { return false; }
}
async function googleJson(url, options = {}) {
  let response, body;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) }); }
  catch { throw new RequestError('Google is temporarily unavailable. Your saved connection is unchanged.', 503); }
  try { body = await response.json(); } catch { throw new RequestError('Google returned an unreadable response. Please try again.', 503); }
  if (!response.ok) {
    if ([400, 401, 403].includes(response.status)) throw expired('Google could not verify this connection. Connect again and allow Search Console access.');
    throw new RequestError('Google is temporarily unavailable. Please try again.', 503);
  }
  return body;
}
async function tokenRequest(values) {
  const body = await googleJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || '', ...values }) });
  if (!credentialValid(body.access_token)) throw expired('Google did not return a usable connection. Connect again.');
  if (typeof body.scope === 'string' && !body.scope.split(/\s+/).includes(READONLY_SCOPE)) throw expired('Allow read-only Search Console access when connecting Google.');
  return body;
}
async function durableTokens(tokens) {
  if (!credentialValid(tokens.refresh_token)) throw expired('Google did not grant offline access. Connect again and allow Search Console access.');
  // Prove the refresh grant works before replacing any durable connection.
  const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  return { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token || tokens.refresh_token, accessExpiresAt: expiry(refreshed.expires_in) };
}
async function googlePropertyAccess(accessToken) {
  if (!credentialValid(accessToken)) throw expired();
  const result = await googleJson('https://searchconsole.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!Array.isArray(result.siteEntry || [])) throw new RequestError('Google returned an unreadable property list. Please try again.', 503);
  const sites = (result.siteEntry || []).filter(site => typeof site?.siteUrl === 'string' && site.siteUrl.length <= 2048);
  const permitted = site => ['siteOwner', 'siteFullUser'].includes(site.permissionLevel);
  return { properties: sites.filter(permitted).map(({ siteUrl, permissionLevel }) => ({ siteUrl, permissionLevel })),
    propertyIssues: sites.filter(site => !permitted(site)).map(({ siteUrl, permissionLevel }) => ({ siteUrl,
      permissionLevel: typeof permissionLevel === 'string' ? permissionLevel : 'unknown', reason: 'insufficient_permission' })) };
}
export async function listGoogleProperties(accessToken) { return (await googlePropertyAccess(accessToken)).properties; }
const publicProperties = (properties, websiteUrl) => properties.map(property => ({ ...property, matchesWebsite: propertyContainsUrl(property.siteUrl, websiteUrl) }));
function assertProperty(properties, property, websiteUrl) {
  if (typeof property !== 'string' || !properties.some(item => item.siteUrl === property)) throw new RequestError('Choose a property available to this Google account.', 403);
  if (websiteUrl && !propertyContainsUrl(property, websiteUrl)) throw new RequestError('This Search Console property does not cover your website address.', 409);
}

export async function beginGscConnection(uid, { sessionRevision, property, origin }) {
  const state = randomBytes(32).toString('hex');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/gsc-callback`;
  await db.runTransaction(async tx => {
    const ctx = await context(uid, tx);
    const mode = property ? 'reconnect' : 'onboarding';
    let session;
    if (mode === 'reconnect') {
      if (property !== ctx.scope.property) throw expired('Reconnect the property already selected for this account.');
    } else {
      if (!Number.isInteger(sessionRevision)) throw new RequestError('Open website setup before connecting Google.');
      session = assertSession(ctx, sessionRevision);
      if (!websiteValid(session.websiteUrl)) throw new RequestError('Save a valid website address before connecting Google.');
    }
    tx.create(db.collection('gscOAuthStates').doc(state), { uid, mode, property: property || null, originalScope: ctx.scope,
      websiteUrl: session?.websiteUrl || ctx.scope.websiteUrl, sessionRevision: session?.revision ?? null,
      sessionCreatedAt: session?.createdAt || null, originalConnectionVersion: ctx.connectionVersion,
      expiresAt: Date.now() + 10 * MINUTE, deleteAfterAt: new Date(Date.now() + 10 * MINUTE), redirectUri, consumed: false });
  });
  const query = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: READONLY_SCOPE,
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state });
  return { state, url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` };
}

export async function exchangeStagedGsc(uid, { code, state }) {
  if (!credentialValid(code) || !idValid(state)) throw new RequestError('Restart the Google connection.');
  const ref = db.collection('gscOAuthStates').doc(state);
  const saved = await db.runTransaction(async tx => {
    const [snapshot, ctx] = await Promise.all([tx.get(ref), context(uid, tx)]);
    const value = snapshot.data();
    if (!value || value.uid !== uid || value.consumed || value.expiresAt <= Date.now()) throw expired();
    if (!sameScope(value.originalScope, ctx.scope) || value.originalConnectionVersion !== ctx.connectionVersion) throw expired('Your website connection changed. Restart the Google connection.');
    if (value.mode === 'onboarding') {
      const session = assertSession(ctx, value.sessionRevision);
      if (session.websiteUrl !== value.websiteUrl || (session.createdAt || null) !== value.sessionCreatedAt) throw expired();
    }
    tx.update(ref, { consumed: true });
    return value;
  });
  const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: saved.redirectUri });
  const credentials = await durableTokens(tokens);
  const { properties, propertyIssues } = await googlePropertyAccess(credentials.accessToken);
  const pendingId = randomBytes(32).toString('hex');
  return db.runTransaction(async tx => {
    const [ctx, stateSnapshot] = await Promise.all([context(uid, tx), tx.get(ref)]);
    if (!stateSnapshot.exists || !sameScope(saved.originalScope, ctx.scope) || saved.originalConnectionVersion !== ctx.connectionVersion) throw expired('Your account or website changed. Connect Google again.');
    if (saved.mode === 'reconnect') {
      assertProperty(properties, saved.property);
      tx.update(db.collection('users').doc(uid), { gscAccessToken: credentials.accessToken, gscRefreshToken: credentials.refreshToken,
        gscExpiresAt: credentials.accessExpiresAt, gscConnectedAt: new Date().toISOString(), gscSiteUrl: saved.property,
        gscConnectionVersion: randomBytes(16).toString('hex') });
      tx.delete(ref);
      return { success: true, connected: true, property: saved.property };
    }
    const session = assertSession(ctx, saved.sessionRevision);
    if (session.websiteUrl !== saved.websiteUrl || (session.createdAt || null) !== saved.sessionCreatedAt) throw expired();
    const revision = session.revision + 1;
    const items = publicProperties(properties, session.websiteUrl);
    const issues = publicProperties(propertyIssues, session.websiteUrl);
    const google = { status: 'pending', pendingId, properties: items, propertyIssues: issues };
    const updatedAt = new Date().toISOString();
    tx.create(pendingRef(uid, pendingId), { userId: uid, ...credentials, properties, propertyIssues, websiteUrl: session.websiteUrl,
      originalScope: saved.originalScope, sessionRevision: revision, selectedProperty: null,
      sessionCreatedAt: saved.sessionCreatedAt, originalConnectionVersion: saved.originalConnectionVersion,
      expiresAt: Date.now() + 30 * MINUTE, deleteAfterAt: new Date(Date.now() + 30 * MINUTE), createdAt: Date.now(), providerAccessValidatedAt: Date.now() });
    tx.update(sessionRef(uid), { google, revision, updatedAt });
    tx.delete(ref);
    return { pendingId, properties: items, propertyIssues: issues, session: publicSession({ ...session, google, revision, updatedAt }) };
  });
}

async function pendingContext(uid, id, tx, { selected = false, sessionRevision } = {}) {
  if (!idValid(id)) throw new RequestError('Connect Google before selecting a property.');
  const ref = pendingRef(uid, id);
  const [snapshot, ctx] = await Promise.all([tx ? tx.get(ref) : ref.get(), context(uid, tx)]);
  const session = assertSession(ctx, sessionRevision), pending = snapshot.data();
  if (!pending || pending.userId !== uid || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now()
    || !credentialValid(pending.refreshToken) || !credentialValid(pending.accessToken)
    || session.google?.pendingId !== id || pending.websiteUrl !== session.websiteUrl || !sameScope(pending.originalScope, ctx.scope)
    || pending.originalConnectionVersion !== ctx.connectionVersion || (session.createdAt || null) !== pending.sessionCreatedAt) throw expired();
  if (selected && (session.google.status !== 'connected' || !pending.selectedProperty || session.google.property !== pending.selectedProperty)) throw expired('Select your Search Console property before continuing.');
  return { ctx, session, pending, pendingRef: ref };
}
export async function listStagedGscProperties(uid, pendingId) {
  const { pending, session } = await pendingContext(uid, pendingId);
  const refreshed = await durableTokens({ refresh_token: pending.refreshToken });
  const { properties, propertyIssues } = await googlePropertyAccess(refreshed.accessToken);
  return db.runTransaction(async tx => {
    const current = await pendingContext(uid, pendingId, tx, { sessionRevision: session.revision });
    if (current.pending.refreshToken !== pending.refreshToken || current.session.websiteUrl !== session.websiteUrl) throw expired();
    const items = publicProperties(properties, session.websiteUrl), issues = publicProperties(propertyIssues, session.websiteUrl);
    const google = { ...current.session.google, properties: items, propertyIssues: issues };
    const revision = current.session.revision + 1, updatedAt = new Date().toISOString();
    tx.update(current.pendingRef, { ...refreshed, properties, propertyIssues, sessionRevision: revision, providerAccessValidatedAt: Date.now() });
    tx.update(sessionRef(uid), { google, revision, updatedAt });
    return { success: true, pendingId, properties: items, propertyIssues: issues,
      session: publicSession({ ...current.session, google, revision, updatedAt }) };
  });
}
export async function selectStagedGsc(uid, { pendingId, property, sessionRevision }) {
  if (!Number.isInteger(sessionRevision)) throw new RequestError('Reload setup before selecting a property.');
  const initial = await pendingContext(uid, pendingId, undefined, { sessionRevision });
  const refreshed = await durableTokens({ refresh_token: initial.pending.refreshToken });
  const { properties, propertyIssues } = await googlePropertyAccess(refreshed.accessToken);
  assertProperty(properties, property, initial.session.websiteUrl);
  return db.runTransaction(async tx => {
    const current = await pendingContext(uid, pendingId, tx, { sessionRevision });
    if (current.pending.refreshToken !== initial.pending.refreshToken) throw expired();
    if (current.session.mode === 'existing' && property !== current.ctx.scope.property) throw expired('Changing websites requires the website update flow.');
    const validatedAt = Date.now(), revision = current.session.revision + 1;
    const google = { status: 'connected', pendingId, property, validatedAt };
    const updatedAt = new Date(validatedAt).toISOString();
    tx.update(current.pendingRef, { ...refreshed, properties, propertyIssues, selectedProperty: property, providerAccessValidatedAt: validatedAt });
    tx.update(sessionRef(uid), { google, revision, updatedAt });
    return { pendingId, property, session: publicSession({ ...current.session, google, revision, updatedAt }) };
  });
}
export async function readPendingGscSelection(uid, { pendingId, tx } = {}) {
  const value = await pendingContext(uid, pendingId, tx, { selected: true });
  const p = value.pending;
  assertProperty(p.properties, p.selectedProperty, value.session.websiteUrl);
  return { ...value, property: p.selectedProperty, connectionFields: { gscAccessToken: p.accessToken,
    gscRefreshToken: p.refreshToken, gscExpiresAt: p.accessExpiresAt, gscSiteUrl: p.selectedProperty,
    gscConnectedAt: new Date().toISOString(), gscConnectionVersion: pendingId } };
}
export async function validatePendingGscCommit(uid, options) {
  const value = await readPendingGscSelection(uid, options);
  if (!Number.isFinite(value.pending.providerAccessValidatedAt) || value.pending.providerAccessValidatedAt < Date.now() - 5 * MINUTE
    || value.pending.accessExpiresAt <= Date.now() + MINUTE) throw expired('Refresh your Google connection check before finishing setup.');
  return value;
}
export async function refreshPendingGscSelection(uid, { pendingId, sessionRevision }) {
  const original = await pendingContext(uid, pendingId, undefined, { selected: true, sessionRevision });
  const credentials = await durableTokens({ refresh_token: original.pending.refreshToken });
  const { properties, propertyIssues } = await googlePropertyAccess(credentials.accessToken);
  assertProperty(properties, original.pending.selectedProperty, original.session.websiteUrl);
  await db.runTransaction(async tx => {
    const latest = await pendingContext(uid, pendingId, tx, { selected: true, sessionRevision });
    if (latest.pending.refreshToken !== original.pending.refreshToken || latest.pending.selectedProperty !== original.pending.selectedProperty) throw expired();
    tx.update(latest.pendingRef, { ...credentials, properties, propertyIssues, providerAccessValidatedAt: Date.now() });
  });
  return { pendingId, property: original.pending.selectedProperty };
}
export async function listCurrentGscProperties(uid) {
  const connection = await getGscConnection(uid);
  return { success: true, ...await googlePropertyAccess((await connection.browserCredentials()).access_token) };
}
