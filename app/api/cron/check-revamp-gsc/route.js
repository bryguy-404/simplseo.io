import { errorResponse } from '../../../lib/server/requestAuth';
import { runTrackedCron } from '../../../lib/server/cronRun';
import { runRevampCollection } from '../../../lib/server/revampCollection';
export const maxDuration = 240;
export async function GET(request) {
  try {
    return Response.json({ success: true, ...(await runTrackedCron(request, 'website-monitoring', runRevampCollection)) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
