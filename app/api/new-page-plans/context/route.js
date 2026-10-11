import { newPageRoute } from '../../../lib/server/newPageRoute';
import { saveNewPageContext } from '../../../lib/server/newPagePlanning';
export const runtime = 'nodejs';
export const POST = newPageRoute(saveNewPageContext);
