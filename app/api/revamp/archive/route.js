import { randomUUID } from 'node:crypto';
import { db } from '../../../lib/firebaseAdmin';
import { requireUser, errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { archiveCurrentWork } from '../../../lib/server/revampHistory';
export async function POST(request) {
  try {
    const body = await request.json();
    const uid = await requireUser(request, body.userId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.revampDate || '')) throw new RequestError('Choose the website launch date.');
    const ref = db.collection('onboarding').doc(uid);
    const runId = await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!current?.isComplete) throw new RequestError('Complete initial onboarding first.', 409);
      if (current.revampArchivePending) return current.revampArchivePending;
      const id = randomUUID();
      tx.update(ref, { revampArchivePending: id, progressReviewRequired: true });
      return id;
    });
    await archiveCurrentWork(uid, runId);
    const patch = { revampRunId: runId, revampSchemaVersion: 2, revampArchivePending: null, revampStatus: 'in-progress', revampStep: 'crawl', revampDate: body.revampDate, revampInitiatedAt: new Date().toISOString(), revampPages: [], revampMonitoringEnabled: true, progressReviewRequired: true };
    await ref.update(patch);
    return Response.json({ success: true, onboarding: patch });
  } catch (error) { return errorResponse(error); }
}
