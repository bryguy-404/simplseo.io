import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { RequestError } from './requestAuth';
import { readScopedWebsiteInventory, continueScopedWebsiteInventory, INVENTORY_LIMITS } from './newPageInventory';
import { fetchCurrentPageContent } from './scrapeContent';
import { readPendingGscSelection } from './stagedGsc';
import { readWorkSession, onboardingHash, reserveOnboardingWork, finishOnboardingWork } from './onboardingWork';
import { supplementOnboardingPage } from './onboardingFirecrawl';
import { readNewPageScope, newPageScopeKey, assertSameNewPageScope } from './newPageScope';

const PREVIEW_LIMITS = Object.freeze({ ...INVENTORY_LIMITS, sitemaps: 3, urls: 50, htmlPages: 5 });
const scopeIdentity = scope => [scope.userId, scope.sessionKey, scope.websiteUrl, scope.property, scope.websiteRunId, scope.preview];
export const onboardingInventoryKey = scope => onboardingHash(scopeIdentity(scope));
const assertScope = (expected, actual) => {
  if (onboardingInventoryKey(expected) !== onboardingInventoryKey(actual)) throw new RequestError('Your website setup changed. Reload before continuing.', 409);
};

export async function onboardingInventoryScope(uid, session, { tx, write = false } = {}) {
  const current = await readWorkSession(uid, { expectedSession: session, tx, write });
  let website;
  try { website = new URL(/^https?:\/\//i.test(current.websiteUrl || '') ? current.websiteUrl : `https://${current.websiteUrl}`); } catch { /* validated below */ }
  if (!current.websiteUrl || !website || !['http:', 'https:'].includes(website.protocol) || website.username || website.password || website.hash
    || (website.port && !['80', '443'].includes(website.port))) throw new RequestError('Enter a public website URL before reviewing it.');
  website.search = '';
  const connected = current.google?.status === 'connected' && typeof current.google.property === 'string';
  const property = connected ? current.google.property : `${website.origin}/`;
  if (!propertyContainsUrl(property, website.href)) throw new RequestError('Select the Search Console property that contains your website.', 409);
  if (write && connected) {
    if (current.google.pendingId) {
      const pending = await readPendingGscSelection(uid, { pendingId: current.google.pendingId, tx });
      if (pending.property !== property) throw new RequestError('Your Google selection changed. Reconnect before continuing.', 409);
    } else {
      const read = ref => tx ? tx.get(ref) : ref.get();
      const [userDoc, tokenDoc, setupDoc] = await Promise.all(['users', 'gscTokens', 'onboarding'].map(name => read(db.collection(name).doc(uid))));
      const user = userDoc.data() || {}, token = tokenDoc.data() || {}, setup = setupDoc.data() || {};
      const storedProperty = setup.gscProperty || user.gscSiteUrl || token.siteUrl;
      if (current.mode !== 'existing' || storedProperty !== property || !((user.gscSiteUrl === property && (user.gscAccessToken || user.gscRefreshToken))
        || (token.siteUrl === property && (token.accessToken || token.refreshToken)))) throw new RequestError('Reconnect Google before the full website review.', 409);
    }
  }
  return { userId: uid, sessionKey: current.id || current.createdAt || 'current', property, websiteUrl: website.href,
    websiteRunId: current.originalScope?.websiteRunId || null, preview: !connected };
}

export function compactOnboardingInventory(inventory) {
  if (!inventory) return null;
  return { ...inventory, pages: inventory.pages.map(page => ({ url: page.url, status: page.status, reason: page.reason || null,
    title: page.content?.htmlTitle || '', sources: page.sources || [], observedAt: page.observedAt || null,
    finalUrl: page.content?.finalUrl || null, technical: page.content?.technical || null,
    extractionSource: page.content?.source || null, extractionLimitations: page.content?.renderedSupplement?.limitation || null })) };
}

function adapter(uid, session, scope, { render = false, cachedPages = [] } = {}) {
  const cached = new Map(cachedPages.map(page => [page.url, page.content]));
  return { collection: 'onboardingInventories', scopeKey: onboardingInventoryKey, assertScope,
    readScope: (_uid, options) => onboardingInventoryScope(uid, session, options),
    limits: scope.preview ? PREVIEW_LIMITS : INVENTORY_LIMITS, skipGoogle: true, savedSeeds: false,
    readPage: async (url, options) => {
      // HTTP failures and blocked pages throw here. Never use a provider to evade
      // 404, authentication, robots, property or private-network restrictions.
      const native = cached.get(url) || await fetchCurrentPageContent(url, options);
      return render && !scope.preview ? supplementOnboardingPage(uid, session, scope, native, options) : native;
    } };
}

export async function readOnboardingInventory(uid, session, { full = false } = {}) {
  const current = session || await readWorkSession(uid, { write: false });
  if (!current.websiteUrl) return null;
  const scope = await onboardingInventoryScope(uid, current);
  const inventory = await readScopedWebsiteInventory(uid, adapter(uid, current, scope));
  return full ? inventory : compactOnboardingInventory(inventory);
}

export async function continueOnboardingInventory(uid, { expectedRevision, restart = false, requestId, signal } = {}) {
  if (!Number.isInteger(expectedRevision)) throw new RequestError('Reload your website setup before starting a review.', 409);
  const session = await readWorkSession(uid, { expectedRevision });
  const scope = await onboardingInventoryScope(uid, session, { write: true });
  const settings = adapter(uid, session, scope, { render: true });
  const previous = await readScopedWebsiteInventory(uid, settings);
  if (!restart && previous && !previous.canContinue) return { inventory: compactOnboardingInventory(previous), sessionRevision: session.revision, unchanged: true };
  const reservation = await reserveOnboardingWork(uid, session, { kind: 'inventory', requestId,
    fingerprint: onboardingHash([onboardingInventoryKey(scope), restart, session.revision]), charge: !previous || restart });
  if (reservation.duplicate) return { inventory: await readOnboardingInventory(uid, session), sessionRevision: session.revision, unchanged: true };
  try {
    let cachedPages = [];
    if (!scope.preview && !previous && !restart) {
      const previewScope = { ...scope, preview: true, property: `${new URL(scope.websiteUrl).origin}/` };
      const previewRef = db.collection('onboardingInventories').doc(onboardingInventoryKey(previewScope));
      const preview = (await previewRef.get()).data();
      if (preview && onboardingInventoryKey(preview.scope) === onboardingInventoryKey(previewScope)) {
        const stored = await previewRef.collection('pages').where('generation', '==', preview.generation).limit(PREVIEW_LIMITS.urls).get();
        cachedPages = stored.docs.map(doc => doc.data()).filter(page => page.status === 'fetched'
          && Date.parse(page.content?.fetchedAt) > Date.now() - 7 * 86400000
          && propertyContainsUrl(scope.property, page.url) && propertyContainsUrl(scope.property, page.content.finalUrl));
      }
    }
    const inventory = await continueScopedWebsiteInventory(uid, { restart, signal }, adapter(uid, session, scope, { render: true, cachedPages }));
    await finishOnboardingWork(uid, session, reservation, { id: inventory.id, revision: inventory.revision });
    return { inventory: compactOnboardingInventory(inventory), sessionRevision: session.revision };
  } catch (error) {
    await finishOnboardingWork(uid, session, reservation, null, true).catch(() => {});
    throw error;
  }
}

// Optional cache promotion after successful setup. Never replaces an inventory
// already used by planning, and never changes setup completion or credentials.
export async function promoteOnboardingInventory(uid, suppliedSession) {
  const session = suppliedSession || await readWorkSession(uid, { write: false });
  if (session.state !== 'complete') return { promoted: false, reason: 'setup_incomplete' };
  const sourceScope = await onboardingInventoryScope(uid, session);
  if (sourceScope.preview) return { promoted: false, reason: 'preview_only' };
  const sourceRef = db.collection('onboardingInventories').doc(onboardingInventoryKey(sourceScope));
  const source = (await sourceRef.get()).data();
  if (!source || !source.generation || Date.parse(source.leaseUntil) > Date.now()) return { promoted: false, reason: 'inventory_unavailable' };
  const pages = await sourceRef.collection('pages').where('generation', '==', source.generation).limit(INVENTORY_LIMITS.urls).get();
  const scope = await readNewPageScope(uid, { write: true });
  if (scope.websiteUrl !== sourceScope.websiteUrl || scope.property !== sourceScope.property || scope.websiteRunId !== sourceScope.websiteRunId) {
    throw new RequestError('The completed website setup changed before its inventory could be reused.', 409);
  }
  const destination = db.collection('newPageInventories').doc(newPageScopeKey(scope));
  return db.runTransaction(async tx => {
    await readWorkSession(uid, { expectedSession: session, tx, write: false });
    assertSameNewPageScope(scope, await readNewPageScope(uid, { tx, write: true }));
    const [latest, existing] = await Promise.all([tx.get(sourceRef), tx.get(destination)]);
    if (existing.exists) return { promoted: false, reason: 'existing_inventory_preserved' };
    if (latest.data()?.revision !== source.revision || latest.data()?.generation !== source.generation || Date.parse(latest.data()?.leaseUntil) > Date.now()) {
      throw new RequestError('The website review changed. Its saved setup remains available.', 409);
    }
    tx.set(destination, { ...source, scope, userId: uid, property: scope.property, websiteRunId: scope.websiteRunId,
      leaseUntil: null, attempt: null, promotedFrom: sourceRef.id, promotedAt: new Date().toISOString() });
    for (const page of pages.docs) tx.set(destination.collection('pages').doc(page.id), page.data());
    return { promoted: true, inventoryId: destination.id };
  });
}
