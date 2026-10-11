import { errorResponse } from '../../../lib/server/requestAuth';
import { runTrackedCron } from '../../../lib/server/cronRun';
import { runWebsiteCollections } from '../../../lib/server/websiteCollection';
export const maxDuration = 240;
export async function GET(request) {
  try {
    return Response.json({ success: true, ...(await runTrackedCron(request, 'website-monitoring', runWebsiteCollections)) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
