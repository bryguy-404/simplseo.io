import { newPageRoute } from '../../../lib/server/newPageRoute';
import { generateNewPageDraft } from '../../../lib/server/newPagePlanning';
export const runtime = 'nodejs';
export const maxDuration = 240;
export const POST = newPageRoute(generateNewPageDraft);
