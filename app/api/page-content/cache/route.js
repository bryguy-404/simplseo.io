import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { RequestError } from '../../../lib/server/requestAuth';
import { getCachedPageContent, cachePageContent, getIntentMismatch, saveIntentMismatch } from '../../../lib/firestoreMigrationHelpers';

export const POST = authenticatedRoute(async request => {
  const { userId, pageUrl, keyword, operation, data } = await request.json();
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048) throw new RequestError('A valid page URL is required.');
  let parsed;
  try { parsed = new URL(pageUrl); } catch { throw new RequestError('A valid page URL is required.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new RequestError('A valid page URL is required.');
  if (operation?.startsWith('intent') && (typeof keyword !== 'string' || keyword.length > 300)) throw new RequestError('A valid keyword is required.');
  if (['page-write', 'intent-write'].includes(operation) && (!data || typeof data !== 'object' || Array.isArray(data))) throw new RequestError('Cache data is required.');
  switch (operation) {
    case 'page-read': return Response.json(await getCachedPageContent(userId, pageUrl));
    case 'page-write': return Response.json(await cachePageContent(userId, pageUrl, data));
    case 'intent-read': return Response.json(await getIntentMismatch(userId, keyword, pageUrl));
    case 'intent-write': return Response.json(await saveIntentMismatch(userId, keyword, pageUrl, data));
    default: throw new RequestError('Unknown cache operation.');
  }
});
