import { newPageRoute } from '../../../lib/server/newPageRoute';
import { RequestError } from '../../../lib/server/requestAuth';

// Legacy AI generation is retired. Historical records remain read-only.
export const POST = newPageRoute(() => { throw new RequestError('Use New page ideas to review evidence and prepare a saved plan.', 410); });
