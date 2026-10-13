import { publicRoute } from '../../lib/server/publicRequest';
import { requestEarlyAccess } from '../../lib/server/earlyAccess';
export const POST = publicRoute(async request => Response.json(await requestEarlyAccess(await request.json())), { limit: 5, windowMs: 3600000 });
