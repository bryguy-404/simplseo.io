import { db } from '../../../lib/firebaseAdmin';
import { requireCron, errorResponse } from '../../../lib/server/requestAuth';
import { monitorRevamp } from '../../../lib/server/revampMonitor';
export async function GET(request) {
  try {
    requireCron(request);
    const users = await db.collection('onboarding').where('revampMonitoringEnabled', '==', true).get();
    const results = [];
    for (const user of users.docs) {
      try { const result = await monitorRevamp(user.id); results.push({ userId: user.id, connectionStatus: result.connectionStatus }); }
      catch { results.push({ userId: user.id, error: 'Check failed; prior observations retained.' }); }
    }
    return Response.json({ success: true, results });
  } catch (error) { return errorResponse(error); }
}
