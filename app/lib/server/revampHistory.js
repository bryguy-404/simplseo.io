import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';

const collections = ['implementedSeoTips', 'contentAuditResults', 'aiSuggestions', 'focusKeywords'];
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object' || value.toDate) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|password|credential/i.test(key)).map(([key, val]) => [key, clean(val)]));
}
export const historyRef = (uid, runId) => db.collection('users').doc(uid).collection('revampHistory').doc(runId);
export async function ensureHistory(uid, runId) {
  const ref = historyRef(uid, runId);
  if ((await ref.get()).data()?.complete) return;
  await ref.set({ runId, complete: false, historicalMetrics: 'unverified' }, { merge: true });
  for (const name of collections) {
    const source = name === 'focusKeywords' ? [(await db.collection(name).doc(uid).get())].filter(s => s.exists) : (await db.collection(name).where('userId', '==', uid).get()).docs;
    for (const item of source) {
      // Create once, never update an existing historical record on a retry.
      const target = ref.collection('records').doc(`${name}_${item.id}`);
      await db.runTransaction(async tx => {
        if (!(await tx.get(target)).exists) tx.create(target, { collection: name, sourceId: item.id, data: clean(item.data()) });
      });
    }
  }
  await ref.set({ complete: true, completedAt: new Date().toISOString() }, { merge: true });
}
export async function archiveCurrentWork(uid, runId) {
  await ensureHistory(uid, runId);
  const records = await historyRef(uid, runId).collection('records').get();
  for (let offset = 0; offset < records.size; offset += 400) {
    const batch = db.batch();
    for (const record of records.docs.slice(offset, offset + 400)) {
      const { collection, sourceId } = record.data();
      batch.set(db.collection(collection).doc(sourceId), { preRevampArchived: true, preRevampRunId: runId, preRevampDate: new Date().toISOString() }, { merge: true });
    }
    await batch.commit();
  }
}
export async function ensureCurrentHistory(uid) {
  const onboarding = (await db.collection('onboarding').doc(uid).get()).data();
  if (onboarding?.revampArchivePending) throw new RequestError('Previous website work is being preserved. Try again shortly.', 409);
  if (!onboarding?.revampRunId) return;
  const history = await historyRef(uid, onboarding.revampRunId).get();
  if (!history.data()?.complete) throw new RequestError('Previous website work is still being preserved. Try again shortly.', 409);
}
