import { requireCron, errorResponse } from '../../../lib/server/requestAuth';
import { runProgressCollection } from '../../../lib/server/progressMonitor';

export const maxDuration = 240;
// Retain the deployed cron URL; its only job is now evidence collection.
// It never promotes success, changes card type, or sends a notification.
export async function GET(request) {
  try {
    requireCron(request);
    return Response.json({ success: true, ...(await runProgressCollection()) });
  } catch (error) { return errorResponse(error); }
}
