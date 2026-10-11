import { newPageRoute } from '../../../lib/server/newPageRoute';
import { confirmNewPagePublication } from '../../../lib/server/newPageTracking';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = newPageRoute(confirmNewPagePublication);
