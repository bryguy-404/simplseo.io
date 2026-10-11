import { newPageRoute } from '../../../../lib/server/newPageRoute';
import { updateNewPageRetirements } from '../../../../lib/server/newPageInventory';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = newPageRoute(async (userId, body, request) => {
  const inventory = await updateNewPageRetirements(userId, { urls: body.urls, inventoryRevision: body.inventoryRevision,
    confirmed: body.confirmed, action: body.action, signal: request.signal });
  return { inventory: { ...inventory, pages: inventory.pages.map(page => ({ url: page.url, status: page.status,
    reason: page.reason || null, title: page.content?.htmlTitle || '', sources: page.sources || [],
    observedAt: page.observedAt || page.content?.fetchedAt || null, retirementProof: page.retirementProof || null })) } };
});
