import { newPageRoute } from '../../../lib/server/newPageRoute';
import { selectNewPageIdea } from '../../../lib/server/newPagePlanning';
export const runtime = 'nodejs';
export const POST = newPageRoute(selectNewPageIdea);
