import { newPageRoute } from '../../../lib/server/newPageRoute';
import { suggestNearbyAreas } from '../../../lib/server/newPagePlanning';
export const runtime = 'nodejs';
export const maxDuration = 240;
export const POST = newPageRoute(suggestNearbyAreas);
