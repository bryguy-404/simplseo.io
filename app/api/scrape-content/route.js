import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { scrapeContentResponse } from '../../lib/server/scrapeContent';
export const POST = authenticatedRoute(async request => {
  const { pageUrl } = await request.json();
  return scrapeContentResponse(pageUrl);
});
