import { readMentorAccountScope } from './mentorAccountScope';
import { mentorPageInScope } from './mentorContext';
import { refreshSavedMentorActivity } from './mentorActivitySnapshots';
import { RequestError } from './requestAuth';

// Loading a page's activity never scrapes a website or requests an AI review.
export async function readPageReviewActivity(userId, pageUrl, options = {}) {
  let parsed;
  try { parsed = new URL(pageUrl); } catch { throw new RequestError('Enter a valid page URL.'); }
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || parsed.username || parsed.password || parsed.hash) {
    throw new RequestError('Use the full public page URL without a fragment or login details.');
  }
  const scope = await readMentorAccountScope(userId);
  if (!scope.websiteUrl || !scope.property) throw new RequestError('Complete your website setup before reviewing a page.', 409);
  if (!mentorPageInScope(scope, pageUrl)) throw new RequestError('Page must belong to your connected website.', 403);
  const observation = await refreshSavedMentorActivity(userId, scope, { ...options, pageUrl, includeHistory: true });
  if (!observation.value) throw new RequestError(observation.pending ? 'This page’s activity is already loading. Try again shortly.' : observation.lastError || 'Page activity is unavailable.', observation.errorStatus || 503);
  const { property, websiteRunId } = scope;
  return { success: true, evidence: observation.value, provenance: { property, websiteRunId, pageUrl },
    observation: { ...observation, value: undefined } };
}
