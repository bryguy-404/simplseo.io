import { newPageRoute } from '../../../lib/server/newPageRoute';
import { assessNewPageIdeas } from '../../../lib/server/newPagePlanning';
export const runtime = 'nodejs';
export const maxDuration = 240;
export const POST = newPageRoute(assessNewPageIdeas);
