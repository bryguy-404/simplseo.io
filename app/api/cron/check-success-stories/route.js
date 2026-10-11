import { errorResponse } from '../../../lib/server/requestAuth';
import { runProgressCollection } from '../../../lib/server/progressMonitor';
import { runTrackedCron } from '../../../lib/server/cronRun';
import { runNotificationAwareCollection } from '../../../lib/server/notificationCron';

export const maxDuration = 240;
// Retain the deployed schedule. Notifications use only successfully saved evidence.
export async function GET(request) {
  try {
    return Response.json({ success: true, ...(await runTrackedCron(request, 'progress', () => runNotificationAwareCollection('progress', runProgressCollection))) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
