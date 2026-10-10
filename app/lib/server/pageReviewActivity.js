import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { getGscConnection } from './gscConnection';
import { collectPageReviewEvidence } from './pageReviewEvidence';
import { RequestError } from './requestAuth';

async function activityScope(userId) {
  const [snapshot, connection] = await Promise.all([
    db.collection('onboarding').doc(userId).get(), getGscConnection(userId),
  ]);
  if (!snapshot.exists) throw new RequestError('Complete your website setup before reviewing a page.', 409);
  const setup = snapshot.data();
  const property = setup.gscProperty || connection.siteUrl;
  if (property !== connection.siteUrl) throw new RequestError('Your website connection changed. Reconnect Search Console and try again.', 409);
  return { property, websiteRunId: setup.revampRunId || null };
}

// Loading a page's activity never scrapes a website or requests an AI review.
export async function readPageReviewActivity(userId, pageUrl) {
  let parsed;
  try { parsed = new URL(pageUrl); } catch { throw new RequestError('Enter a valid page URL.'); }
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || parsed.username || parsed.password || parsed.hash) {
    throw new RequestError('Use the full public page URL without a fragment or login details.');
  }
  const scope = await activityScope(userId);
  if (!propertyContainsUrl(scope.property, pageUrl)) throw new RequestError('Page must belong to your connected Search Console property.', 403);
  const evidence = await collectPageReviewEvidence(userId, { pageUrl, property: scope.property });
  const latest = await activityScope(userId);
  if (latest.property !== scope.property || latest.websiteRunId !== scope.websiteRunId) {
    throw new RequestError('Your website setup changed while this page was being reviewed. Reload the page and try again.', 409);
  }
  return { success: true, evidence, provenance: { ...scope, pageUrl } };
}
