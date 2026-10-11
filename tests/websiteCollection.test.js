import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/server/revampCollection', () => ({ runRevampCollection: vi.fn() }));
vi.mock('../app/lib/server/newPageTracking', () => ({ runNewPageCollection: vi.fn() }));
import { runRevampCollection } from '../app/lib/server/revampCollection';
import { runNewPageCollection } from '../app/lib/server/newPageTracking';
import { runWebsiteCollections } from '../app/lib/server/websiteCollection';
beforeEach(() => {
  runRevampCollection.mockReset().mockResolvedValue({ checked: 1, pagesChecked: 29, counts: { usable: 1 }, moreRecords: false, results: [] });
  runNewPageCollection.mockReset().mockResolvedValue({ checked: 4, pagesChecked: 4, counts: { usable: 3, temporarily_unavailable: 1 }, moreRecords: false });
});
it('starts both collectors independently under one220second deadline and reports each result', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const now = new Date('2026-10-10T03:00:00Z');
  const result = await runWebsiteCollections(now);
  expect(runRevampCollection).toHaveBeenCalledWith(now, { deadline: 221000 });
  expect(runNewPageCollection).toHaveBeenCalledWith({ now, deadline: 221000 });
  expect(result).toMatchObject({ checked: 5, pagesChecked: 33, counts: { usable: 4, temporarily_unavailable: 1 }, notificationsSent: 0,
    collectors: { existingPages: { pagesChecked: 29 }, newPages: { pagesChecked: 4 } } });
  clock.mockRestore();
});
it.each([429, 503])('preserves new-page progress when the othercollector returns%s', async status => {
  runRevampCollection.mockRejectedValue(Object.assign(new Error('private provider payload'), { status }));
  const result = await runWebsiteCollections();
  expect(result.checked).toBe(4);
  expect(result.moreRecords).toBe(true);
  expect(result.counts[status === 429 ? 'deferred' : 'error']).toBe(1);
  expect(JSON.stringify(result)).not.toContain('private provider payload');
});
