import { db } from '../../../lib/firebaseAdmin';
import { requireUser, errorResponse, RequestError } from '../../../lib/server/requestAuth';
import { historyRef } from '../../../lib/server/revampHistory';
export async function GET(request) {
  try {
    const query = new URL(request.url).searchParams;
    const uid = await requireUser(request, query.get('userId'));
    const runId = query.get('runId');
    if (runId && !/^[\w-]+$/.test(runId)) throw new RequestError('Invalid history selection.');
    if (runId) {
      const history = await historyRef(uid, runId).get();
      if (!history.data()?.complete) throw new RequestError('History is not ready.', 404);
      const records = await historyRef(uid, runId).collection('records').get();
      return Response.json({ records: records.docs.map(d => ({ id: d.id, ...d.data() })) });
    }
    const runs = await db.collection('users').doc(uid).collection('revampHistory').get();
    return Response.json({ runs: runs.docs.filter(d => d.data().complete).map(d => ({ id: d.id, ...d.data() })) });
  } catch (error) { return errorResponse(error); }
}
