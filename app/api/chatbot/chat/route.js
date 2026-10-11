import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';

// Never leave an unmetered alternative model path available to stale clients.
export const POST = authenticatedRoute(async () => Response.json({ error: 'The SEO Mentor has been upgraded. Reload to continue; your saved conversations are preserved.' }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } }));
