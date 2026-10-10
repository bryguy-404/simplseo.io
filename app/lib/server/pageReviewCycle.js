import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { seoImplementationId } from '../pageTaskFlow';
import { propertyContainsUrl } from '../revampState';
import { cycleTimestamp, progressCycleIsReviewable, progressIsPaused } from '../progressAssessment';
import { RequestError } from './requestAuth';

export function reviewCycleArchiveRef(recordRef, implementedAt) {
  const key = createHash('sha256').update(String(cycleTimestamp(implementedAt))).digest('hex');
  return recordRef.collection('cycles').doc(key);
}

export async function reviewPageCycle(userId, { pageUrl, implementedAt }, now = new Date()) {
  let url;
  try { url = new URL(pageUrl); } catch { throw new RequestError('Choose a valid page before reviewing its comparison.'); }
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash
    || typeof implementedAt !== 'string' || !Number.isFinite(Date.parse(implementedAt))) throw new RequestError('Choose the current dated page comparison.');
  const id = seoImplementationId(userId, pageUrl), ref = db.collection('implementedSeoTips').doc(id);
  return db.runTransaction(async tx => {
    const archiveRef = reviewCycleArchiveRef(ref, implementedAt);
    const [setupDoc, userDoc, legacyDoc, recordDoc, archivedDoc] = await Promise.all([
      tx.get(db.collection('onboarding').doc(userId)), tx.get(db.collection('users').doc(userId)), tx.get(db.collection('gscTokens').doc(userId)),
      tx.get(ref), tx.get(archiveRef),
    ]);
    const setup = setupDoc.data(), user = userDoc.data() || {}, legacy = legacyDoc.data() || {}, record = recordDoc.data();
    const property = setup?.gscProperty || user.gscSiteUrl || legacy.siteUrl;
    const connected = (user.gscSiteUrl === property && (user.gscAccessToken || user.gscRefreshToken)) ||
      (legacy.siteUrl === property && (legacy.accessToken || legacy.refreshToken));
    if (!setup?.isComplete || progressIsPaused(setup) || setup.revampArchivePending || !connected || (user.gscSiteUrl && user.gscSiteUrl !== property)
      || !propertyContainsUrl(property, pageUrl)) throw new RequestError('Your website setup or connection changed. Reload before reviewing this comparison.', 409);
    if (!record || record.userId !== userId || record.pageUrl !== pageUrl || cycleTimestamp(record.implementedAt) !== implementedAt
      || record.preRevampArchived || (record.websiteRunId || null) !== (setup.revampRunId || null) || (record.gscProperty && record.gscProperty !== property)) {
      throw new RequestError('This is no longer the current page comparison. Reload its progress before continuing.', 409);
    }
    const archived = archivedDoc.data();
    if (record.status === 'reviewed') {
      if (!archived || archived.data?.userId !== userId || archived.data?.pageUrl !== pageUrl || cycleTimestamp(archived.data?.implementedAt) !== implementedAt) {
        throw new RequestError('The earlier comparison could not be verified. Reload and try again.', 409);
      }
      return { success: true, pageUrl, implementedAt, record: { ...record, id }, alreadyReviewed: true };
    }
    if (!progressCycleIsReviewable(record, property, setup.revampRunId, now)) {
      throw new RequestError('Check progress after the full comparison period, then review its dated results before starting another change.', 409);
    }
    if (archived) throw new RequestError('A saved comparison already occupies this cycle. Reload before continuing.', 409);
    const reviewedAt = now.toISOString();
    tx.set(archiveRef, { userId, pageUrl, implementedAt, property, websiteRunId: setup.revampRunId || null, reviewedAt, data: record });
    tx.update(ref, { status: 'reviewed', reviewedAt });
    return { success: true, pageUrl, implementedAt, record: { ...record, id, status: 'reviewed', reviewedAt }, alreadyReviewed: false };
  });
}
