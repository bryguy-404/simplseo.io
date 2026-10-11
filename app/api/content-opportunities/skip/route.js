import { newPageRoute } from '../../../lib/server/newPageRoute';
import { RequestError } from '../../../lib/server/requestAuth';
import { db } from '../../../lib/firebaseAdmin';

export const POST = newPageRoute(() => { throw new RequestError('Use New page ideas to save or publish a reviewed plan.', 410); });
export const GET = newPageRoute(async userId => {
  const snapshot = await db.collection('skippedKeywords').doc(userId).collection('keywords').limit(200).get();
  return { success: true, skippedKeywords: snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, readOnly: true, unverified: true })) };
});
