import { db } from '../../../lib/firebaseAdmin';
import { requireUser, errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { ensureHistory } from '../../../lib/server/revampHistory';
import { completeRevampPatch } from '../../../lib/revampState';
export async function POST(request) {
  try {
    const body = await request.json();
    const uid = await requireUser(request, body.userId);
    const ref = db.collection('onboarding').doc(uid);
    const initial = (await ref.get()).data();
    if (!initial?.isComplete) throw new RequestError('Complete initial onboarding first.', 409);
    const runId = initial.revampRunId || `legacy-${initial.revampInitiatedAt || initial.revampDate || 'recovery'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (body.runId && body.runId !== runId) throw new RequestError('Reload the current website setup.', 409);
    if (body.keywords && (!Array.isArray(body.keywords) || body.keywords.some(k => !k || typeof k.keyword !== 'string' || typeof k.pageUrl !== 'string'))) throw new RequestError('Invalid keyword selection.');
    await ensureHistory(uid, runId);
    let patch;
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current.revampRunId && current.revampRunId !== runId) throw new RequestError('Reload the current website setup.', 409);
      // Revisiting an already-complete setup must not pause a reviewed account
      // again. A genuinely new/in-progress update still requires its review.
      patch = { ...completeRevampPatch(), revampRunId: runId,
        ...(current.revampStatus === 'complete' && current.progressReviewRequired === false ? { progressReviewRequired: false } : {}) };
      const focusRef = db.collection('focusKeywords').doc(uid);
      const focus = (await tx.get(focusRef)).data();
      // Skipping is deliberately a no-op for keywords, including archive flags.
      if (body.keywords?.length) {
        const existing = focus?.preRevampArchived ? [] : (focus?.keywords || []);
        const byPage = new Map(existing.map(k => [k.pageUrl || k.keyword || k, k]));
        for (const keyword of body.keywords) byPage.set(keyword.pageUrl, keyword);
        tx.set(focusRef, { userId: uid, keywords: [...byPage.values()], preRevampArchived: false, revampRunId: runId, updatedAt: new Date().toISOString(), ...(body.snapshot ? { snapshot: body.snapshot } : {}) }, { merge: true });
      }
      tx.update(ref, patch);
    });
    return Response.json({ success: true, onboarding: patch });
  } catch (error) { return errorResponse(error); }
}
