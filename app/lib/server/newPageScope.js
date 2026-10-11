import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { RequestError } from './requestAuth';

const identity = scope => [scope.userId, scope.property, scope.websiteRunId || null, scope.websiteUrl];
export const newPageScopeKey = scope => createHash('sha256').update(JSON.stringify(identity(scope))).digest('hex');
export function assertSameNewPageScope(expected, actual) {
  if (JSON.stringify(identity(expected)) !== JSON.stringify(identity(actual))) {
    throw new RequestError('Your website connection changed. Reload New page ideas before continuing.', 409);
  }
}

// Stored reads only: opening saved work never refreshes credentials or providers.
export async function readNewPageScope(userId, { write = false, tx } = {}) {
  if (typeof userId !== 'string' || !userId || userId.includes('/')) throw new RequestError('Sign in to continue.', 401);
  const refs = ['users', 'onboarding', 'gscTokens'].map(name => db.collection(name).doc(userId));
  const [userDoc, setupDoc, legacyDoc] = await Promise.all(refs.map(ref => tx ? tx.get(ref) : ref.get()));
  if (!userDoc.exists || userDoc.data()?.deletionInProgress || !setupDoc.exists) throw new RequestError('Complete your website setup before planning a page.', 409);
  const user = userDoc.data(), setup = setupDoc.data(), legacy = legacyDoc.data() || {};
  if (write && (!setup.isComplete || setup.revampArchivePending || setup.revampStatus === 'in-progress')) {
    throw new RequestError('Your website setup is being updated. Finish it before changing page plans.', 409);
  }
  const property = setup.gscProperty || user.gscSiteUrl || legacy.siteUrl;
  const connected = (user.gscSiteUrl === property && (user.gscAccessToken || user.gscRefreshToken))
    || (legacy.siteUrl === property && (legacy.accessToken || legacy.refreshToken));
  if (!property || !connected || (user.gscSiteUrl && user.gscSiteUrl !== property)) {
    throw new RequestError('Reconnect Search Console before planning a page.', 409);
  }
  const raw = setup.websiteUrl || user.websiteUrl || (!property.startsWith('sc-domain:') ? property : null);
  let website;
  try { website = new URL(/^https?:\/\//i.test(raw || '') ? raw : `https://${raw}`); } catch { /* handled below */ }
  if (!raw || !website || !['http:', 'https:'].includes(website.protocol) || website.username || website.password
    || website.hash || (website.port && !['80', '443'].includes(website.port)) || !propertyContainsUrl(property, website.href)) {
    throw new RequestError('Choose a valid website within your connected Search Console property.', 409);
  }
  website.search = '';
  return { userId, property, websiteRunId: setup.revampRunId || null, websiteUrl: website.href,
    businessName: setup.businessName || user.businessName || '',
    businessLocation: setup.businessLocation || user.businessLocation || setup.location || '' };
}
