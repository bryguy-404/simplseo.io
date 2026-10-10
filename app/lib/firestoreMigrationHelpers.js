// Internal server helpers. Browser callers use /api/page-content/cache.
import { db } from './firebaseAdmin';

async function readOwned(currentRef, legacyRef, userId) {
  const current = await currentRef.get();
  if (current.exists && (!current.data().userId || current.data().userId === userId)) return { success: true, data: current.data(), cached: true, structure: 'new' };
  const legacy = await legacyRef.get();
  // Never claim shared or ownerless legacy cache entries for a signed-in user.
  if (legacy.exists && legacy.data().userId === userId) return { success: true, data: legacy.data(), cached: true, structure: 'old' };
  return { success: false, cached: false };
}
function pageRefs(userId, pageUrl) {
  return [db.collection('pageContentCache').doc(userId).collection('pages').doc(encodeURIComponent(pageUrl)), db.collection('pageContentCache').doc(`${userId}_${encodeURIComponent(pageUrl)}`)];
}
export async function getCachedPageContent(userId, pageUrl) { return readOwned(...pageRefs(userId, pageUrl), userId); }
export async function cachePageContent(userId, pageUrl, contentData) {
  const data = { ...contentData, userId, pageUrl, cachedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
  const batch = db.batch();
  for (const ref of pageRefs(userId, pageUrl)) batch.set(ref, data, { merge: true });
  await batch.commit();
  return { success: true };
}
export async function getCachedSitePages(userId, options = {}) {
  const { source = 'site-crawl', limit = 50 } = options;
  const [current, legacy] = await Promise.all([
    db.collection('pageContentCache').doc(userId).collection('pages').where('source', '==', source).limit(limit).get(),
    db.collection('pageContentCache').where('userId', '==', userId).where('source', '==', source).limit(limit).get(),
  ]);
  const pages = new Map();
  for (const doc of [...legacy.docs, ...current.docs]) {
    const data = doc.data();
    if (data.userId && data.userId !== userId) continue;
    if (data.pageUrl) pages.set(data.pageUrl, data);
  }
  return [...pages.values()].slice(0, limit);
}
function intentRefs(userId, keyword, pageUrl) {
  const key = `${userId}_${encodeURIComponent(keyword)}_${encodeURIComponent(pageUrl)}`;
  return [db.collection('intentMismatches').doc(userId).collection('analyses').doc(key), db.collection('intentMismatches').doc(key)];
}
export async function getIntentMismatch(userId, keyword, pageUrl) { return readOwned(...intentRefs(userId, keyword, pageUrl), userId); }
export async function saveIntentMismatch(userId, keyword, pageUrl, analysisData) {
  const data = { ...analysisData, userId, keyword, pageUrl, createdAt: new Date().toISOString() };
  const batch = db.batch();
  for (const ref of intentRefs(userId, keyword, pageUrl)) batch.set(ref, data, { merge: true });
  await batch.commit();
  return { success: true };
}
function metaRefs(collection, nested, userId, cacheKey) {
  return [db.collection(collection).doc(userId).collection(nested).doc(encodeURIComponent(cacheKey)), db.collection(collection).doc(encodeURIComponent(cacheKey))];
}
export async function getCachedMetaTitle(userId, cacheKey) { return readOwned(...metaRefs('seoMetaTitles', 'titles', userId, cacheKey), userId); }
export async function getCachedMetaDescription(userId, cacheKey) { return readOwned(...metaRefs('seoMetaDescriptions', 'descriptions', userId, cacheKey), userId); }
async function saveMeta(collection, nested, userId, cacheKey, content) {
  const data = { ...content, userId, createdAt: new Date().toISOString() };
  const [current, legacy] = metaRefs(collection, nested, userId, cacheKey);
  // New keys are user-scoped. A legacy key must never overwrite another owner.
  await db.runTransaction(async tx => {
    const previous = await tx.get(legacy);
    tx.set(current, data);
    if (!previous.exists || previous.data().userId === userId) tx.set(legacy, data);
  });
  return { success: true };
}
export async function saveMetaTitle(userId, cacheKey, content) { return saveMeta('seoMetaTitles', 'titles', userId, cacheKey, content); }
export async function saveMetaDescription(userId, cacheKey, content) { return saveMeta('seoMetaDescriptions', 'descriptions', userId, cacheKey, content); }
