import { newPageRoute } from '../../../lib/server/newPageRoute';
import { editNewPagePlan, readNewPagePlan } from '../../../lib/server/newPagePlanning';
export const runtime = 'nodejs';
export const PATCH = newPageRoute(editNewPagePlan);
export const GET = newPageRoute((userId, body) => readNewPagePlan(userId, body.planId));
