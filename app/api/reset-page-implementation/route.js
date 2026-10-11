import { authenticatedRoute } from '../../lib/server/authenticatedRoute';

// Keyword pivots must not erase server-owned publication dates or interrupt an
// active observation cycle, including during a feature-flag rollback.
export const POST = authenticatedRoute(async () => Response.json({
  error: 'This legacy reset is retired. Review the page’s progress and confirm a new published edit to start another measurement.',
}, { status: 410, headers: { 'Cache-Control': 'private, no-store' } }));
