import { describe, expect, it } from 'vitest';
import { dashboardNextAction, mergeDashboardWork, prioritizeDashboardWork } from '../app/lib/dashboardWorkPresentation';
import { visualDashboardEnabled } from '../app/lib/server/visualDashboardFeature';
const url = 'https://example.com/';
const now = new Date('2026-10-11T18:00:00Z');
const cycle = (extra = {}) => ({ kind: 'cycle', id: 'c', pageUrl: url, confirmedAt: '2026-10-01T18:00:00Z', nextReviewAt: '2026-11-01', ...extra });
const point = { id: 'p', evidenceRevision: 2, day: 28, baseline: { status: 'available', clicks: 0, impressions: 10, position: 22 }, post: { status: 'available', clicks: 0, impressions: 20, position: 19 } };

describe('dashboard work presentation', () => {
  it('includes recurring-cycle-only accounts and never calls elapsed time results', () => {
    const [item] = prioritizeDashboardWork([cycle({ nextReviewAt: '2026-10-10' })], now);
    expect(item.title).toBe('Waiting for the latest data'); expect(item.state).toBe('collecting');
    expect(item.href).toBe('/low-ctr?page=https%3A%2F%2Fexample.com%2F');
  });
  it('deduplicates legacy, current tasks, publication and active cycles by exact URL', () => {
    const result = prioritizeDashboardWork([
      { kind: 'legacy', id: 'old', pageUrl: url, assessment: { state: 'ready' }, activeCycle: cycle() }, cycle(),
      { kind: 'plan', id: 'plan', pageUrl: url, taskCounts: { done: 3, published: 3 } },
      { kind: 'new_page', id: 'np', status: 'published', publication: { pageUrl: url, verifiedAt: '2026-09-01' } },
    ], now);
    expect(result).toHaveLength(1); expect(result[0].state).toBe('collecting'); expect(result[0].publication).toBeTruthy();
  });
  it('preserves exact case, query and slash distinctions and draft IDs', () => {
    const result = prioritizeDashboardWork([cycle(), cycle({ id: 'c2', pageUrl: `${url}A?q=One` }),
      { kind: 'new_page', id: '1', status: 'draft', topic: 'Repair', slug: '/' }, { kind: 'new_page', id: '2', status: 'draft', topic: 'Repair', slug: '/' }]);
    expect(result).toHaveLength(4); expect(result.filter(r => r.state === 'draft').map(r => r.href)).toEqual(['/generic-keywords?planId=1','/generic-keywords?planId=2']);
  });
  it('prioritizes verified issues, ready comparisons then newest pending work', () => {
    const items = prioritizeDashboardWork([
      { kind: 'new_page', id: 'old', status: 'draft', updatedAt: '2026-10-02' }, { kind: 'new_page', id: 'new', status: 'draft', updatedAt: '2026-10-10' },
      cycle({ id: 'ready', pageUrl: `${url}ready`, latestCheckpoint: point }),
      cycle({ id: 'problem', pageUrl: `${url}problem`, technical: { issues: [{ message: 'Noindex observed', stale: false }] } }),
    ]);
    expect(items.map(item => item.state)).toEqual(['attention','ready','draft','draft']); expect(items[2].key).toBe('draft:new');
  });
  it('does not promote failed or stale checks into verified issues', () => {
    const [item] = prioritizeDashboardWork([cycle({ lastError: { connection: 'temporarily_unavailable' }, technical: { issues: [{ message: 'Old noindex', stale: true }] } })]);
    expect(item.state).toBe('unavailable'); expect(item.latestCheckpoint).toBeNull();
  });
  it('requires a decision for the exact checkpoint revision before marking reviewed', () => {
    const decision = { checkpointId: 'p', checkpointRevision: 1, outcome: 'keep_monitoring' };
    expect(prioritizeDashboardWork([cycle({ latestCheckpoint: point, latestDecision: decision })])[0].state).toBe('ready');
    const [item] = prioritizeDashboardWork([cycle({ latestCheckpoint: point, latestDecision: { ...decision, checkpointRevision: 2, nextStep: 'Keep the wording.' } })]);
    expect(item.state).toBe('monitoring'); expect(item.detail).toBe('Keep the wording.'); expect(item.confirmedAt).toBe(cycle().confirmedAt);
  });
  it('preserves actionable task state without pretending inspection-only completion was published', () => {
    const [item] = prioritizeDashboardWork([{ kind: 'plan', id: 'p', pageUrl: url, taskCounts: { done: 2, published: 0, todo: 1 } }]);
    expect(item.state).toBe('working'); expect(item.confirmedAt).toBeNull(); expect(item.taskCounts.published).toBe(0);
  });
  it('keeps a real checkpoint visible after a subsequent failure', () => {
    const [item] = prioritizeDashboardWork([cycle({ latestCheckpoint: point, lastError: { google: 'unavailable' } })]);
    expect(item.state).toBe('ready'); expect(item.stale).toBe(true); expect(item.latestCheckpoint).toEqual(point);
  });
  it('dates saved comparison evidence independently of later technical checks', () => {
    const observedAt = '2026-10-01T12:00:00Z';
    const [item] = prioritizeDashboardWork([cycle({ latestCheckpoint: { ...point, observedAt }, lastSuccessAt: '2026-10-10T12:00:00Z', lastError: { google: 'unavailable' } })]);
    expect(item.observedAt).toBe(observedAt);
    const [published] = prioritizeDashboardWork([{ kind: 'new_page', id: 'p', status: 'published', publication: { pageUrl: url, lastAttemptAt: '2026-10-10', lastError: 'failed' } }]);
    expect(published.observedAt).toBeNull();
  });
  it('keeps incomplete observations visible without promising ready results', () => {
    const checkpoint = { ...point, state: 'incomplete', baseline: { status: 'unavailable' } };
    const [item] = prioritizeDashboardWork([cycle({ latestCheckpoint: checkpoint })]);
    expect(item.title).toBe('More evidence is needed'); expect(item.state).toBe('unavailable');
    expect(item.latestCheckpoint.post.impressions).toBe(20); expect(item.actionLabel).toBe('View available evidence');
  });
  it('allows legacy low-volume comparisons while distinguishing missing periods', () => {
    const legacy = { kind: 'legacy', id: 'l', pageUrl: url, assessment: { ...point, state: 'insufficient_data', reason: 'not_enough_search_activity' } };
    expect(prioritizeDashboardWork([legacy])[0].state).toBe('ready');
    legacy.assessment.baseline = { status: 'unavailable' };
    expect(prioritizeDashboardWork([legacy])[0].state).toBe('unavailable');
  });
  it('does not arbitrarily choose between conflicting active cycles', () => {
    expect(prioritizeDashboardWork([cycle(), cycle({ id: 'other' })])[0].state).toBe('unavailable');
    expect(prioritizeDashboardWork([cycle({ latestCheckpoint: point }), { kind: 'legacy', id: 'l', pageUrl: url, activeCycleLookupFailed: true }])[0].state).toBe('unavailable');
  });
  it('preserves independent publication/indexing/activity states and ignores dismissed work', () => {
    const publication = { pageUrl: url, verifiedAt: '2026-08-01', indexing: null, activity: { rolling: { status: 'no_data', clicks: 0, impressions: 0 } } };
    const items = prioritizeDashboardWork([{ kind: 'new_page', id: 'p', status: 'published', publication }, { kind: 'new_page', id: 'd', status: 'dismissed' }]);
    expect(items).toHaveLength(1); expect(items[0].publication.indexing).toBeNull(); expect(items[0].latestCheckpoint).toBeNull();
  });
  it('merges continuation without duplicates and preserves publication on failed point reads', () => {
    const old = { kind: 'new_page', id: 'p', publication: { pageUrl: url } };
    const result = mergeDashboardWork([old], [{ ...old, publication: null, publicationError: 'unavailable' }]);
    expect(result).toHaveLength(1); expect(result[0].publication.pageUrl).toBe(url);
  });
  it('chooses setup/reconnect ahead of work, and unavailable ahead of an invented empty state', () => {
    const items = prioritizeDashboardWork([cycle()]);
    expect(dashboardNextAction(items, { setupRequired: true }).href).toBe('/revamp');
    expect(dashboardNextAction(items, { reconnectRequired: true }).href).toBe('/settings');
    expect(dashboardNextAction([], { hasWorkError: true }).title).toContain('could not be loaded');
    expect(dashboardNextAction([], { fallbackPage: { pageUrl: url } }).href).toContain(encodeURIComponent(url));
  });
  it('only enables the pilot from server configuration for allowed users', () => {
    const enabled = process.env.VISUAL_DASHBOARD_ENABLED, allowed = process.env.VISUAL_DASHBOARD_PILOT_UIDS;
    try { process.env.VISUAL_DASHBOARD_ENABLED = 'true'; process.env.VISUAL_DASHBOARD_PILOT_UIDS = 'pilot';
      expect(visualDashboardEnabled('pilot')).toBe(true); expect(visualDashboardEnabled('other')).toBe(false);
      process.env.VISUAL_DASHBOARD_ENABLED = 'false'; expect(visualDashboardEnabled('pilot')).toBe(false);
    } finally { if (enabled === undefined) delete process.env.VISUAL_DASHBOARD_ENABLED; else process.env.VISUAL_DASHBOARD_ENABLED = enabled;
      if (allowed === undefined) delete process.env.VISUAL_DASHBOARD_PILOT_UIDS; else process.env.VISUAL_DASHBOARD_PILOT_UIDS = allowed; }
  });
});
