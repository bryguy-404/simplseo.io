import { createHash } from 'node:crypto';
import { auth, db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { accountWebsiteScope, sameBusinessScope, cleanBusinessProfile, legacyBusinessProfile, businessProfileRef, profileCompatibilityFields, readBusinessContext } from './businessProfile';
import { propertyContainsUrl } from '../revampState';
import { getGscConnection } from './gscConnection';
import { recentObservationWindow } from '../progressAssessment';
import { accountHash } from './accountDeletion';

export const setupSessionRef = uid => db.collection('users').doc(uid).collection('onboardingSessions').doc('current');
export function onboardingV2Eligible(uid, user = {}) {
  if (process.env.ONBOARDING_V2_ENABLED !== 'true') return false;
  const allowed = (process.env.ONBOARDING_V2_PILOT_UIDS || '').split(',').map(value => value.trim());
  return user.earlyAccessSetupVersion === 2 || allowed.includes('*') || allowed.includes(uid);
}
const cleanUrl = raw => {
  try {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) throw Error();
    const url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search
      || (url.port && !['80', '443'].includes(url.port)) || !url.hostname.includes('.') || url.hostname.endsWith('.localhost')) throw Error();
    return url.href;
  } catch { throw new RequestError('Enter a public website address without a sign-in, query or page fragment.'); }
};
function requestKey(input) {
  if (typeof input?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)) throw new RequestError('Reload this form before saving.');
  return input.requestId;
}
const signature = (action, value) => createHash('sha256').update(JSON.stringify({ action, value })).digest('hex');
function savedRequest(session, input, action) {
  const item = session?.requests?.find(entry => entry.id === requestKey(input));
  if (!item) return false;
  if (item.signature !== signature(action, input)) throw new RequestError('This save identifier was already used. Reload before trying again.', 409);
  return true;
}
function withRequest(session, input, action) {
  return [...(session.requests || []).slice(-19), { id: requestKey(input), signature: signature(action, input) }];
}
export function publicSetupSession(session) {
  if (!session) return null;
  const { requests: _requests, readinessJob: _job, ...result } = session;
  return result;
}
async function roots(uid, tx) {
  const docs = await Promise.all(['users', 'onboarding', 'gscTokens'].map(name => {
    const ref = db.collection(name).doc(uid); return tx ? tx.get(ref) : ref.get();
  }));
  return { userDoc: docs[0], setupDoc: docs[1], user: docs[0].data() || {}, setup: docs[1].data() || {}, legacy: docs[2].data() || {} };
}
function assertCurrent(value, session, expectedRevision) {
  if (!value.userDoc.exists || value.user.deletionInProgress || !session) throw new RequestError('Your account changed. Sign in again to continue.', 409);
  if (session.revision !== expectedRevision) throw new RequestError('Your setup changed in another window. Reload to see the latest saved details.', 409);
  if (!sameBusinessScope(session.originalScope, accountWebsiteScope(value.setup, value.user, value.legacy))) throw new RequestError('Your website connection changed. Reload before continuing setup.', 409);
  if (value.setup.revampArchivePending || value.setup.revampStatus === 'in-progress') throw new RequestError('Finish your website update before changing these details.', 409);
}
export async function readOnboardingWorkspace(uid) {
  const value = await roots(uid);
  if (value.user.deletionInProgress) throw new RequestError('Your account is being deleted.', 409);
  const raw = (await setupSessionRef(uid).get()).data() || null;
  const currentScope = accountWebsiteScope(value.setup, value.user, value.legacy);
  const current = raw && sameBusinessScope(raw.originalScope, currentScope) ? raw : null;
  const profile = value.userDoc.exists ? await readBusinessContext(uid) : null;
  const { readOnboardingInventory } = await import('./onboardingInventory');
  const { readOnboardingExtraction } = await import('./onboardingExtraction');
  const inventory = current ? await readOnboardingInventory(uid, current) : null;
  const extraction = current ? await readOnboardingExtraction(uid, current) : null;
  return { extractionEnabled: process.env.ONBOARDING_EXTRACTION_ENABLED !== 'false', eligible: onboardingV2Eligible(uid, value.user), enabled: onboardingV2Eligible(uid, value.user) || !!current,
    pinned: !!current || value.setup.setupVersion === 2, legacyCompleted: value.setup.isComplete === true,
    session: publicSetupSession(current), profile, inventory, extraction, readiness: current?.readiness || null };
}
export async function beginOnboarding(uid, input = {}) {
  requestKey(input);
  const account = await auth.getUser(uid); // Never create a Firestore account for an absent Firebase identity.
  if (account.disabled) throw new RequestError('Sign in to continue.', 403);
  await db.runTransaction(async tx => {
    const value = await roots(uid, tx), sessionDoc = await tx.get(setupSessionRef(uid));
    const deletionGuard = await tx.get(db.collection('accountDeletionGuards').doc(accountHash(uid)));
    if (value.user.deletionInProgress || deletionGuard.data()?.blocked) throw new RequestError('Your account is being deleted.', 409);
    const scope = accountWebsiteScope(value.setup, value.user, value.legacy), old = sessionDoc.data();
    if (old && sameBusinessScope(old.originalScope, scope)) return;
    if (!onboardingV2Eligible(uid, value.user)) throw new RequestError('The new setup is not enabled for this account yet.', 403);
    if (value.setup.revampArchivePending || value.setup.revampStatus === 'in-progress') throw new RequestError('Finish your website update before changing these details.', 409);
    const completed = value.setup.isComplete === true;
    const existingProfile = (await tx.get(businessProfileRef(uid, scope))).data();
    const imported = cleanBusinessProfile(input.legacyDraft || {});
    const base = existingProfile?.profile || legacyBusinessProfile(value.setup, value.user);
    // Import only editable values when the server has no saved value. Never import scope/Google/completion.
    const profile = existingProfile?.profile || cleanBusinessProfile(Object.fromEntries(Object.keys(base).map(key => [key,
      key === 'baseLocation' ? Object.fromEntries(Object.keys(base.baseLocation).map(part => [part, base.baseLocation[part] || imported.baseLocation[part]]))
        : (Array.isArray(base[key]) ? (base[key].length ? base[key] : imported[key]) : base[key] || imported[key])])));
    const durable = scope.property && ((value.user.gscSiteUrl === scope.property && value.user.gscRefreshToken) || (value.legacy.siteUrl === scope.property && value.legacy.refreshToken));
    const now = new Date().toISOString();
    const session = { schemaVersion: 2, id: 'current', userId: uid, setupVersion: 2, revision: 1, mode: completed ? 'existing' : 'new', state: 'draft',
      originalScope: scope, websiteUrl: scope.websiteUrl || '', profileDraft: profile, profileConfirmed: !!existingProfile,
      privacyPolicyAccepted: value.setup.privacyPolicyAccepted === true, currentStep: completed ? 'business' : 'website',
      google: durable ? { status: 'connected', property: scope.property, pendingId: null, validatedAt: null } : { status: 'not_connected', property: null, pendingId: null },
      createdAt: now, updatedAt: now, requests: withRequest({}, input, 'begin') };
    if (!value.userDoc.exists) tx.create(db.collection('users').doc(uid), { createdAt: now });
    // Existence is also required by the shared quota/usage ledger. Keep completion false.
    if (!value.setupDoc.exists) tx.create(db.collection('onboarding').doc(uid), { isComplete: false, setupVersion: 2 });
    else tx.update(db.collection('onboarding').doc(uid), { setupVersion: 2 });
    if (old) tx.set(setupSessionRef(uid).collection('history').doc(signature('scope', { scope: old.originalScope, createdAt: old.createdAt })), old);
    tx.set(setupSessionRef(uid), session);
  });
  return readOnboardingWorkspace(uid);
}
export async function saveOnboardingDraft(uid, input) {
  await db.runTransaction(async tx => {
    const value = await roots(uid, tx), session = (await tx.get(setupSessionRef(uid))).data();
    if (session && savedRequest(session, input, 'save')) return;
    assertCurrent(value, session, input.expectedRevision);
    const patch = input.patch || input;
    let websiteUrl = session.websiteUrl;
    if (Object.hasOwn(patch, 'websiteUrl')) {
      const normalized = cleanUrl(patch.websiteUrl);
      if (value.setup.isComplete || session.mode === 'existing') {
        if (normalized !== cleanUrl(session.websiteUrl)) throw new RequestError('Use website setup to change the connected website. Business edits keep your current website and history.', 409);
      } else websiteUrl = normalized;
    }
    const profileDraft = Object.hasOwn(patch, 'profileDraft') ? cleanBusinessProfile(patch.profileDraft, { strict: true }) : session.profileDraft;
    const changed = JSON.stringify(profileDraft) !== JSON.stringify(session.profileDraft);
    const websiteChanged = websiteUrl !== session.websiteUrl;
    const next = { ...session, websiteUrl, profileDraft, profileConfirmed: changed ? false : session.profileConfirmed,
      privacyPolicyAccepted: Object.hasOwn(patch, 'privacyPolicyAccepted') ? patch.privacyPolicyAccepted === true : session.privacyPolicyAccepted,
      currentStep: ['website', 'google', 'business', 'ready'].includes(patch.currentStep) ? patch.currentStep : session.currentStep,
      google: websiteChanged ? { status: 'not_connected', property: null, pendingId: null } : session.google,
      readiness: websiteChanged ? null : session.readiness || null,
      revision: session.revision + 1, updatedAt: new Date().toISOString(), requests: withRequest(session, input, 'save') };
    tx.set(setupSessionRef(uid), next);
  });
  return readOnboardingWorkspace(uid);
}

function queueProfile(tx, ref, previous, uid, scope, profile, now) {
  if (previous && JSON.stringify(previous.profile) === JSON.stringify(profile)) return previous;
  if (previous) tx.set(ref.collection('history').doc(String(previous.revision)), previous);
  const saved = { schemaVersion: 1, userId: uid, scope, revision: (previous?.revision || 0) + 1, profile,
    confirmedAt: now, provenance: 'owner_confirmation' };
  tx.set(ref, saved);
  return saved;
}
export async function confirmOnboardingProfile(uid, input) {
  await db.runTransaction(async tx => {
    const value = await roots(uid, tx), session = (await tx.get(setupSessionRef(uid))).data();
    if (session && savedRequest(session, input, 'confirmProfile')) return;
    assertCurrent(value, session, input.expectedRevision);
    if (input.confirmed !== true) throw new RequestError('Confirm that these are the services and areas your business actually serves.');
    const profile = cleanBusinessProfile(input.profileDraft || session.profileDraft, { required: true, strict: true });
    const scope = accountWebsiteScope(value.setup, value.user, value.legacy);
    const ref = businessProfileRef(uid, scope), previous = (await tx.get(ref)).data();
    const now = new Date().toISOString();
    if (value.setup.isComplete || session.mode === 'existing') {
      queueProfile(tx, ref, previous, uid, scope, profile, now);
      tx.update(db.collection('onboarding').doc(uid), { ...profileCompatibilityFields(profile), businessProfileVersion: 1 });
    }
    tx.set(setupSessionRef(uid), { ...session, profileDraft: profile, profileConfirmed: true, profileConfirmedAt: now,
      currentStep: ['website', 'google', 'business', 'ready'].includes(input.currentStep) ? input.currentStep : session.currentStep,
      revision: session.revision + 1, updatedAt: now, requests: withRequest(session, input, 'confirmProfile') });
  });
  return readOnboardingWorkspace(uid);
}

export async function completeOnboarding(uid, input) {
  const before = (await setupSessionRef(uid).get()).data();
  if (before && savedRequest(before, input, 'complete')) return readOnboardingWorkspace(uid);
  if (!before || before.revision !== input.expectedRevision) throw new RequestError('Reload your saved setup before completing it.', 409);
  assertCurrent(await roots(uid), before, input.expectedRevision);
  if (!before.profileConfirmed || !before.privacyPolicyAccepted) throw new RequestError('Confirm your business details and privacy acceptance before finishing.');
  const staged = await import('./stagedGsc');
  if (before.google?.pendingId) await staged.refreshPendingGscSelection(uid, { pendingId: before.google.pendingId, sessionRevision: before.revision });
  else {
    const connection = await getGscConnection(uid);
    if (connection.siteUrl !== before.google?.property) throw new RequestError('Connect the matching Google website before continuing.', 409);
    // A successful empty query is valid. This verifies access, not traffic.
    await connection.query({ ...recentObservationWindow(), type: 'web', dataState: 'final', rowLimit: 1 });
    const accessible = await staged.listCurrentGscProperties(uid);
    if (!accessible.properties.some(item => item.siteUrl === before.google.property)) throw new RequestError('Ask the Search Console owner for full access, then reconnect Google.', 403);
  }
  await db.runTransaction(async tx => {
    const value = await roots(uid, tx), session = (await tx.get(setupSessionRef(uid))).data();
    if (session && savedRequest(session, input, 'complete')) return;
    assertCurrent(value, session, input.expectedRevision);
    if (!session.profileConfirmed || !session.privacyPolicyAccepted) throw new RequestError('Confirm your business details and privacy acceptance before finishing.');
    const profile = cleanBusinessProfile(session.profileDraft, { required: true });
    const property = session.google?.property;
    const websiteUrl = session.mode === 'existing' ? session.originalScope.websiteUrl : cleanUrl(session.websiteUrl);
    if (!property || !propertyContainsUrl(property, cleanUrl(websiteUrl))) throw new RequestError('Select the Google website that matches your website.', 409);
    const pending = session.google.pendingId ? await staged.validatePendingGscCommit(uid, { pendingId: session.google.pendingId, tx }) : null;
    if (!pending && !((value.user.gscSiteUrl === property && value.user.gscRefreshToken) || (value.legacy.siteUrl === property && value.legacy.refreshToken))) throw new RequestError('Reconnect Google to enable ongoing tracking.', 409);
    const scope = { property, websiteUrl, websiteRunId: session.originalScope.websiteRunId };
    if (session.mode === 'existing' && !sameBusinessScope(scope, session.originalScope)) throw new RequestError('Your connected website cannot change during profile review.', 409);
    const ref = businessProfileRef(uid, scope), previous = (await tx.get(ref)).data();
    const now = new Date().toISOString();
    queueProfile(tx, ref, previous, uid, scope, profile, now);
    if (pending) { tx.update(db.collection('users').doc(uid), pending.connectionFields); tx.delete(pending.pendingRef); }
    tx.update(db.collection('onboarding').doc(uid), { ...profileCompatibilityFields(profile), websiteUrl, gscProperty: property, hasGSC: true,
      setupVersion: 2, businessProfileVersion: 1, isComplete: true, postOnboardingStep: 'complete', pagesStepCompleted: true, privacyPolicyAccepted: true });
    tx.set(setupSessionRef(uid), { ...session, state: 'complete', mode: 'existing', originalScope: scope, google: { status: 'connected', property, pendingId: null, validatedAt: Date.now() },
      currentStep: 'ready', revision: session.revision + 1, completedAt: now, updatedAt: now, requests: withRequest(session, input, 'complete') });
  });
  // Reuse reviewed content without making successful setup depend on a cache copy.
  const { promoteOnboardingInventory } = await import('./onboardingInventory');
  await promoteOnboardingInventory(uid).catch(() => {});
  return readOnboardingWorkspace(uid);
}

export async function checkOnboardingReadiness(uid, input) {
  const value = await roots(uid), session = (await setupSessionRef(uid).get()).data();
  assertCurrent(value, session, input.expectedRevision); requestKey(input);
  const started = await db.runTransaction(async tx => {
    const latest = await roots(uid, tx), saved = (await tx.get(setupSessionRef(uid))).data();
    assertCurrent(latest, saved, input.expectedRevision);
    if (savedRequest(saved, input, 'readiness')) return false;
    if (saved.readinessJob?.expiresAt > Date.now()) throw new RequestError('Your readiness check is already running. Reload in a moment.', 409);
    tx.update(setupSessionRef(uid), { readinessJob: { id: input.requestId, expiresAt: Date.now() + 60000 } });
    return true;
  });
  if (!started) return readOnboardingWorkspace(uid);
  try {
  const { readOnboardingInventory } = await import('./onboardingInventory');
  const inventory = await readOnboardingInventory(uid, session);
  const result = { checkedAt: new Date().toISOString(), google: { status: 'not_connected', message: 'Connect the matching Google website to finish setup.' },
    website: { status: inventory?.coverage?.fetched ? 'partial' : 'not_checked', message: inventory?.coverage?.fetched ? `${inventory.coverage.fetched} pages read. You can continue with partial coverage.` : 'Website review is optional. You can enter business details yourself.' },
    search: { status: 'unavailable', message: 'Connect Google to check available search activity.' }, inspections: [] };
  if (inventory) {
    const target = cleanUrl(session.websiteUrl);
    const homepage = inventory.pages?.find(page => page.url === target);
    const technical = homepage?.technical;
    result.website.status = inventory.status === 'ready' ? 'reviewed' : inventory.coverage?.fetched ? 'partial' : 'unavailable';
    result.website.observations = {
      checkedAt: inventory.updatedAt || null,
      homepage: homepage ? { url: homepage.url, status: homepage.status, reason: homepage.reason || null,
        observedAt: homepage.observedAt || null, finalUrl: homepage.finalUrl || null, technical: technical || null } : { url: target, status: 'not_checked' },
      sitemaps: inventory.coverage?.sitemaps || [], robotsStatus: inventory.coverage?.robotsStatus || 'not_checked',
    };
  }
  let connection;
  try {
    if (session.google?.pendingId) {
      const { refreshPendingGscSelection, readPendingGscSelection } = await import('./stagedGsc');
      await refreshPendingGscSelection(uid, { pendingId: session.google.pendingId, sessionRevision: session.revision });
      const { pending, connectionFields, property } = await readPendingGscSelection(uid, { pendingId: session.google.pendingId });
      const token = connectionFields.gscAccessToken || pending.accessToken;
      const googlePost = async (url, body) => {
        const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new RequestError('Google checks are temporarily unavailable.', 503);
        return response.json();
      };
      connection = { siteUrl: property,
        query: body => googlePost(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, body),
        inspect: url => googlePost('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl: property, languageCode: 'en-US' }) };
    } else if (session.google?.property) connection = await getGscConnection(uid);
    if (connection) result.google = { status: 'connected', message: 'Your matching Google website is connected.' };
  } catch { result.google = { status: 'unavailable', message: 'Reconnect or retry the Google connection. Saved business details are safe.' }; }
  if (connection && connection.siteUrl === session.google.property) {
    const window = recentObservationWindow();
    const urls = [...new Set([cleanUrl(session.websiteUrl), ...(inventory?.pages || []).filter(page => page.status === 'fetched' && /\/services?\//i.test(page.url)).map(page => page.url)])].filter(url => propertyContainsUrl(connection.siteUrl, url)).slice(0, 3);
    await Promise.all([
      connection.query({ ...window, type: 'web', dataState: 'final', rowLimit: 1 }).then(data => {
        result.search = { status: data.rows?.length ? 'available' : 'no_data', window,
          message: data.rows?.length ? 'Google is reporting search activity. Open your dashboard for the numbers.' : 'Google has no search activity to report for this period yet. You can still finish setup.' };
      }).catch(() => { result.search = { status: 'unavailable', window, message: 'Search activity could not be checked. Retry later; this does not erase previous information.' }; }),
      ...urls.map(async url => { try { const data = await connection.inspect(url); result.inspections.push({ url, status: 'available', checkedAt: result.checkedAt, result: data.inspectionResult?.indexStatusResult || null, inspectionUrl: data.inspectionResult?.inspectionResultLink || null }); }
        catch { result.inspections.push({ url, status: 'unavailable', checkedAt: result.checkedAt }); } }),
    ]);
  }
  await db.runTransaction(async tx => {
    const latest = await roots(uid, tx), saved = (await tx.get(setupSessionRef(uid))).data();
    assertCurrent(latest, saved, input.expectedRevision);
    if (saved.readinessJob?.id !== input.requestId) throw new RequestError('A newer readiness check is already running.', 409);
    const old = saved.readiness;
    if (result.search.status === 'unavailable') {
      const prior = ['available', 'no_data'].includes(old?.search?.status) ? { ...old.search, checkedAt: old.checkedAt } : old?.search?.previous;
      if (prior) result.search.previous = { ...prior, previous: undefined };
    }
    result.inspections = result.inspections.map(item => {
      if (item.status !== 'unavailable') return item;
      const prior = old?.inspections?.find(previous => previous.url === item.url);
      return prior?.status === 'available' ? { ...item, previous: prior } : prior?.previous ? { ...item, previous: prior.previous } : item;
    });
    if (!result.inspections.length && old?.inspections?.length) result.inspections = old.inspections.map(item => ({ url: item.url, status: 'unavailable', checkedAt: result.checkedAt,
      ...(item.status === 'available' ? { previous: item } : item.previous ? { previous: item.previous } : {}) }));
    // Keep unknown values explicit; never let optional provider keys write undefined.
    tx.update(setupSessionRef(uid), { readiness: JSON.parse(JSON.stringify(result)), readinessJob: null, requests: withRequest(saved, input, 'readiness') });
  });
  return readOnboardingWorkspace(uid);
  } finally {
    await db.runTransaction(async tx => {
      const saved = (await tx.get(setupSessionRef(uid))).data();
      if (saved?.readinessJob?.id === input.requestId) tx.update(setupSessionRef(uid), { readinessJob: null });
    }).catch(() => {});
  }
}
