import { newPageRoute } from '../../lib/server/newPageRoute';
import { readNewPageWorkspace } from '../../lib/server/newPagePlanning';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = newPageRoute(userId => readNewPageWorkspace(userId));
