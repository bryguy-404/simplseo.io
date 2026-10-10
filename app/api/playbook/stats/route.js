import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { getPlaybookStats } from '../../../lib/playbookConfig';

export const GET = authenticatedRoute(async () => {
  const history = await getPlaybookStats();
  const stats = history.map(row => ({ ...row, ready: false, unverifiedHistoricalData: true }));
  return Response.json({ success: true, automaticPromotionEnabled: false, stats,
    summary: { totalBusinessTypes: stats.length, readyBusinessTypes: 0, totalStrategies: stats.reduce((sum, row) => sum + row.totalStrategies, 0) },
  });
}, { admin: true });
