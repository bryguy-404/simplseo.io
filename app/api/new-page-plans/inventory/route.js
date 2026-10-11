import { newPageRoute } from '../../../lib/server/newPageRoute';
import { continueNewPageInventory } from '../../../lib/server/newPageInventory';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = newPageRoute(async (userId, body, request) => {
  const inventory = await continueNewPageInventory(userId, { restart: body.restart === true, signal: request.signal });
  // Rich HTML evidence stays server-side. The coverage screen only needs a
  // bounded URL/status list; sending every full page can exceed response limits.
  return { inventory: { ...inventory, pages: inventory.pages.map(page => ({ url: page.url, status: page.status,
    reason: page.reason || null, title: page.content?.htmlTitle || '', sources: page.sources || [],
    observedAt: page.observedAt || page.content?.fetchedAt || null })) } };
});
