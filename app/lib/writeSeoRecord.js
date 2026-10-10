import { setDoc, getDoc } from 'firebase/firestore';
import { authenticatedFetch } from './authenticatedFetch';

export async function writeSeoRecord(ref, values, options) {
  // Credentials and trusted assessments are never implementation payloads.
  values = Object.fromEntries(Object.entries(values).filter(([key]) =>
    !['gscToken', 'accessToken', 'refreshToken', 'gscAccessToken', 'gscRefreshToken', 'progressAssessment'].includes(key)));
  if (['implementedSeoTips', 'contentAuditResults', 'aiSuggestions'].includes(ref.parent.id)) {
    const response = await authenticatedFetch('/api/revamp/prepare-write', { method: 'POST' });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error); }
    const existing = await getDoc(ref);
    const existingData = existing.data();
    if (existingData?.preRevampArchived) {
      // History is already complete: start a fresh current record, not a merge of old outcomes.
      values = { userId: existingData.userId, pageUrl: existingData.pageUrl, ...values,
        // This protected field can only be changed by the server. Keep its exact
        // prior value; the progress reader rejects it for a new implementation.
        ...(Object.prototype.hasOwnProperty.call(existingData, 'progressAssessment') ? { progressAssessment: existingData.progressAssessment } : {}),
      };
      options = undefined;
    }
    values = { ...values, preRevampArchived: false };
  }
  return setDoc(ref, values, options);
}
