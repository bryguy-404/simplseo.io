import { authenticatedFetch } from './authenticatedFetch';
async function request(operation, userId, pageUrl, keyword, data) {
  const response = await authenticatedFetch('/api/page-content/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, userId, pageUrl, keyword, data }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to load page data.');
  return result;
}
export const getCachedPageContent = (userId, pageUrl) => request('page-read', userId, pageUrl);
export const cachePageContent = (userId, pageUrl, data) => request('page-write', userId, pageUrl, undefined, data);
export const getIntentMismatch = (userId, keyword, pageUrl) => request('intent-read', userId, pageUrl, keyword);
export const saveIntentMismatch = (userId, keyword, pageUrl, data) => request('intent-write', userId, pageUrl, keyword, data);
