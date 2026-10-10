import { db } from '../firebaseAdmin';
import { seoImplementationId, usableSuggestion } from '../pageTaskFlow';
import { propertyContainsUrl } from '../revampState';
import { RequestError } from './requestAuth';
import { readCurrentPageForReview } from './manualPageReview';
import { ensureCurrentHistory, historyRef } from './revampHistory';

function confirmationText(value, name, maxLength) {
  if (!usableSuggestion(value) || value.trim().length > maxLength || /[\r\n]|<[^>]*>|\[[^\]]*\]/.test(value)) {
    throw new RequestError(`Enter a usable ${name} before confirming your change.`);
  }
  return value.trim();
}

function contentChangeSummary(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 600
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|<[^>]*>/.test(value)) {
    throw new RequestError('Describe the change you published on this page in 600 characters or fewer.');
  }
  return value.trim();
}

// This is a user confirmation, not proof that the described edits are published.
// Only observation provenance and the confirmation time come from our server.
export async function confirmPageReview(userId, input) {
  const { pageUrl, provenance } = input;
  const changeType = input.changeType === undefined ? 'metadata' : input.changeType;
  if (!['metadata', 'page_content'].includes(changeType)) throw new RequestError('Confirm a published page edit, not a review or diagnostic check.');
  if (changeType === 'page_content' && input.published !== true) throw new RequestError('Publish your change on this page before confirming it here.');
  const pageChangeSummary = changeType === 'page_content' ? contentChangeSummary(input.changeSummary) : null;
  const draft = changeType === 'metadata' ? {
    title: confirmationText(input.title, 'title', 500),
    description: confirmationText(input.description, 'description', 1000),
  } : null;
  if (!provenance || typeof provenance.property !== 'string'
    || !Object.prototype.hasOwnProperty.call(provenance, 'websiteRunId')
    || (provenance.websiteRunId !== null && (typeof provenance.websiteRunId !== 'string' || !/^[\w-]{1,160}$/.test(provenance.websiteRunId)))
    || provenance.pageUrl !== pageUrl || provenance.finalUrl !== pageUrl) {
    throw new RequestError('Review this exact page again before confirming the change.', 409);
  }
  if (input.focusKeyword !== undefined && (typeof input.focusKeyword !== 'string' || input.focusKeyword.length > 120)) throw new RequestError('Use a short focus keyword.');
  const focusKeyword = input.focusKeyword?.trim() || '';
  await ensureCurrentHistory(userId);
  const review = await readCurrentPageForReview(userId, pageUrl);
  if (review.provenance.property !== provenance.property || review.provenance.websiteRunId !== provenance.websiteRunId) {
    throw new RequestError('Your website setup changed since this draft was created. Reload and review the current page.', 409);
  }
  if (review.currentPage.finalUrl !== pageUrl) throw new RequestError('This page now redirects to another URL. Review the destination page before confirming a change.', 409);
  // Content edits retain current observed tags only for legacy readers. The
  // explicit change type and owner-entered summary describe what was changed;
  // these tags are not a requested or confirmed metadata replacement.
  const { title, description } = draft || {
    title: review.currentPage.htmlTitle || '', description: review.currentPage.seoMetaDescription || '',
  };

  const id = seoImplementationId(userId, pageUrl);
  const recordRef = db.collection('implementedSeoTips').doc(id);
  const onboardingRef = db.collection('onboarding').doc(userId);
  const currentHistoryRef = provenance.websiteRunId ? historyRef(userId, provenance.websiteRunId) : null;
  return db.runTransaction(async tx => {
    const [setup, user, legacy, existing, history, archivedRecord] = await Promise.all([
      tx.get(onboardingRef), tx.get(db.collection('users').doc(userId)), tx.get(db.collection('gscTokens').doc(userId)), tx.get(recordRef),
      currentHistoryRef ? tx.get(currentHistoryRef) : null,
      currentHistoryRef ? tx.get(currentHistoryRef.collection('records').doc(`implementedSeoTips_${id}`)) : null,
    ]);
    const onboarding = setup.data();
    const primary = user.data() || {}, fallback = legacy.data() || {};
    const property = onboarding?.gscProperty || primary.gscSiteUrl || fallback.siteUrl;
    const hasConnection = (primary.gscSiteUrl === property && (primary.gscRefreshToken || primary.gscAccessToken))
      || (fallback.siteUrl === property && (fallback.refreshToken || fallback.accessToken));
    if (!onboarding?.isComplete || onboarding.revampArchivePending || onboarding.revampStatus === 'in-progress'
      || (onboarding.revampRunId || null) !== provenance.websiteRunId || property !== provenance.property
      || (primary.gscSiteUrl && primary.gscSiteUrl !== property) || !hasConnection || !propertyContainsUrl(property, pageUrl)) {
      throw new RequestError('Your website setup or connection changed. Reload and review the current page before confirming.', 409);
    }
    if (currentHistoryRef && !history.data()?.complete) throw new RequestError('Previous website work is still being preserved. Try again shortly.', 409);

    const previous = existing.data();
    // The legacy hash is retained for compatibility; a collision must never
    // overwrite a different page or account, even if the caller owns both.
    if (previous && (previous.userId !== userId || previous.pageUrl !== pageUrl)) throw new RequestError('This page record conflicts with another record. Please contact support before continuing.', 409);
    if (previous && !previous.preRevampArchived && previous.status === 'implemented') {
      const sameChange = (previous.changeType || 'metadata') === changeType
        && (changeType === 'page_content'
          ? previous.pageChangeSummary === pageChangeSummary
          : previous.title === title && previous.description === description);
      if (!sameChange || (previous.websiteRunId || null) !== provenance.websiteRunId) {
        throw new RequestError('This page already has a confirmed change being tracked. Review its progress before starting another change.', 409);
      }
      return { record: { ...previous, id }, alreadyConfirmed: true };
    }
    if (previous?.preRevampArchived) {
      const preserved = archivedRecord?.data();
      if (!currentHistoryRef || !preserved || preserved.collection !== 'implementedSeoTips' || preserved.sourceId !== id
        || preserved.data?.userId !== userId || preserved.data?.pageUrl !== pageUrl) {
        throw new RequestError('The previous record has not been safely preserved. Reload before confirming this page.', 409);
      }
    }
    const implementedAt = new Date().toISOString();
    const record = {
      userId, pageUrl, title, description, status: 'implemented', implementedAt,
      websiteRunId: provenance.websiteRunId, gscProperty: property, preRevampArchived: false,
      source: 'manual-page-review', confirmationMethod: 'user-confirmed',
      ...(changeType === 'page_content' ? { changeType, pageChangeSummary } : {}),
      ...(focusKeyword ? { focusKeyword, keywordSource: 'user-selected' } : {}),
      // This is what our server could read at confirmation time, not an old
      // baseline or a claim that the user's edits match those HTML tags.
      confirmedPageObservation: {
        htmlTitle: review.currentPage.htmlTitle, seoMetaDescription: review.currentPage.seoMetaDescription,
        fetchedAt: review.currentPage.fetchedAt, source: review.currentPage.source,
        pageUrl, finalUrl: review.currentPage.finalUrl, contentFingerprint: review.provenance.contentFingerprint,
      },
    };
    tx.set(recordRef, record);
    return { record: { ...record, id }, alreadyConfirmed: false };
  });
}
