import { newPageRoute } from '../../../lib/server/newPageRoute';
import { refreshNewPageTracking, readNewPageTracking } from '../../../lib/server/newPageTracking';
export const runtime = 'nodejs';
export const maxDuration = 120;
export const POST = newPageRoute((userId, body) => refreshNewPageTracking(userId, body.planId, { deadline: Date.now() + 110000 }));
export const GET = newPageRoute((userId, body) => readNewPageTracking(userId, body.planId));
