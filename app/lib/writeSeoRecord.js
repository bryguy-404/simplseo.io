import { setDoc, getDoc } from 'firebase/firestore';
import { authenticatedFetch } from './authenticatedFetch';

export async function writeSeoRecord(ref, values, options) {
  if (['implementedSeoTips', 'contentAuditResults', 'aiSuggestions'].includes(ref.parent.id)) {
    const response = await authenticatedFetch('/api/revamp/prepare-write', { method: 'POST' });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error); }
    const existing = await getDoc(ref);
    if (existing.data()?.preRevampArchived) {
      // History is already complete: start a fresh current record, not a merge of old outcomes.
      values = { userId: existing.data().userId, pageUrl: existing.data().pageUrl, ...values };
      options = undefined;
    }
    values = { ...values, preRevampArchived: false };
  }
  return setDoc(ref, values, options);
}
