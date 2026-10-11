import { db } from '../../../lib/firebaseAdmin';
import { randomUUID } from 'node:crypto';
import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
export async function POST(request) {
  try {
    await requireUser(request);
    return Response.json({ error: 'Direct Google token saves are retired. Connect Google through website setup.' }, { status: 410 });
  } catch (e) { return errorResponse(e); }
}
export async function DELETE(request) {
  try {
    const uid = await requireUser(request);
    await db.runTransaction(async tx => {
      const ref = db.collection('users').doc(uid), snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data()?.deletionInProgress) throw new RequestError('Your account changed. Sign in again.', 409);
      tx.update(ref, { gscAccessToken: null, gscRefreshToken: null, gscSiteUrl: null, gscExpiresAt: null, gscConnectedAt: null, gscLastSync: null, gscConnectionVersion: randomUUID() });
      tx.delete(db.collection('gscTokens').doc(uid));
    });
    return Response.json({ success: true });
  } catch (e) { return errorResponse(e); }
}
