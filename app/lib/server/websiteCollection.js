import { runRevampCollection } from './revampCollection';
import { runNewPageCollection } from './newPageTracking';

// Separate leases and queues, one scheduled invocation. Starting both collectors
// together means a slow or failed legacy sweep cannot starve newly published URLs.
export async function runWebsiteCollections(now = new Date()) {
  const deadline = Date.now() + 220000;
  const runs = await Promise.allSettled([
    runRevampCollection(now, { deadline }),
    runNewPageCollection({ now, deadline }),
  ]);
  const counts = {}, collectors = {};
  let checked = 0, pagesChecked = 0, moreRecords = false;
  runs.forEach((run, index) => {
    const key = index === 0 ? 'existingPages' : 'newPages';
    if (run.status === 'fulfilled') {
      const result = run.value;
      checked += result.checked || 0; pagesChecked += result.pagesChecked || 0;
      moreRecords ||= result.moreRecords === true;
      for (const [state, count] of Object.entries(result.counts || {})) counts[state] = (counts[state] || 0) + count;
      collectors[key] = { checked: result.checked || 0, pagesChecked: result.pagesChecked || 0, counts: result.counts || {}, moreRecords: result.moreRecords === true };
    } else {
      const state = run.reason?.status === 429 ? 'deferred' : 'error';
      counts[state] = (counts[state] || 0) + 1; moreRecords = true;
      collectors[key] = { checked: 0, pagesChecked: 0, counts: { [state]: 1 }, moreRecords: true };
    }
  });
  return { checked, pagesChecked, counts, moreRecords, collectors,
    results: runs[0].status === 'fulfilled' ? runs[0].value.results || [] : [], notificationsSent: 0 };
}
