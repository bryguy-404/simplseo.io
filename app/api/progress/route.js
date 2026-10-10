import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { readProgress, refreshUserProgress } from '../../lib/server/progressMonitor';

export const maxDuration = 240;
export const GET = authenticatedRoute(async request => Response.json(await readProgress(new URL(request.url).searchParams.get('userId'))));
export const POST = authenticatedRoute(async request => Response.json(await refreshUserProgress(new URL(request.url).searchParams.get('userId'))));
