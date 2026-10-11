import { errorResponse } from '../../../lib/server/requestAuth';
import { runProgressCollection } from '../../../lib/server/progressMonitor';
import { runTrackedCron } from '../../../lib/server/cronRun';

export const maxDuration = 240;
// Retain the deployed cron URL; its only job is now evidence collection.
// It never promotes success, changes card type, or sends a notification.
export async function GET(request) {
  try {
    return Response.json({ success: true, ...(await runTrackedCron(request, 'progress', runProgressCollection)) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
