import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  const fake = fakeFirestore(), original = fake.db.collection;
  function query(path, filters = [], orders = [], count = Infinity, cursor = null) {
    return { ...original(path),
      where: (key, op, value) => query(path, [...filters, [key, op, value]], orders, count, cursor),
      orderBy: (key, direction = 'asc') => query(path, filters, [...orders, [key, direction]], count, cursor),
      limit: value => query(path, filters, orders, value, cursor),
      startAfter: value => query(path, filters, orders, count, value),
      get: async () => {
        let entries = [...fake.records.entries()].filter(([key, value]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1
          && filters.every(([field, op, expected]) => op === '<=' ? value[field] <= expected : op === 'in' ? expected.includes(value[field]) : value[field] === expected));
        const fieldValue = (entry, key) => key === '__name__' ? entry[0].split('/').at(-1) : entry[1][key];
        entries.sort((a, b) => { for (const [key, direction] of orders) { const comparison = String(fieldValue(a, key) ?? '').localeCompare(String(fieldValue(b, key) ?? '')); if (comparison) return direction === 'desc' ? -comparison : comparison; } return a[0].localeCompare(b[0]); });
        if (cursor) entries = entries.filter(entry => entry[0].split('/').at(-1) > cursor);
        const docs = await Promise.all(entries.slice(0, count).map(([key]) => original(path).doc(key.split('/').at(-1)).get()));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }
  fake.db.collection = path => query(path);
  // Serialize transactions to model Firestore's optimistic conflict retry for
  // lease acquisition tests instead of accepting two simultaneous snapshots.
  const transaction = fake.db.runTransaction; let pending = Promise.resolve();
  fake.db.runTransaction = callback => { const next = pending.then(() => transaction(callback)); pending = next.catch(() => {}); return next; };
  return { ...fake, auth: { verifyIdToken: vi.fn(async token => { if (!['alice', 'bob'].includes(token)) throw Error('invalid'); return { uid: token }; }) } };
});
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn() }));
vi.mock('../app/lib/server/scrapeContent', () => ({ fetchCurrentPageContent: vi.fn() }));
vi.mock('../app/lib/server/manualPageReview', () => ({ readCurrentPageForReview: vi.fn(), generatePageReviewSuggestions: vi.fn() }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { fetchCurrentPageContent } from '../app/lib/server/scrapeContent';
import { readCurrentPageForReview, generatePageReviewSuggestions } from '../app/lib/server/manualPageReview';
import { cycleCheckpointWindows, latestCycleCheckpointDay, nextCycleReviewDay } from '../app/lib/pageMonitoring';
import { enrollPageMonitoring, newMonitoringCycle, startPageMonitoring, stopPageMonitoring } from '../app/lib/server/pageMonitoring';
import { assertMonitoringReview } from '../app/lib/server/pageTrackingIdentity';
import { ongoingCycleRef, readOngoingCycle, readOngoingProgress, refreshOngoingProgress, runOngoingProgressCollection } from '../app/lib/server/ongoingProgress';
import { confirmPageReview } from '../app/lib/server/confirmPageReview';
import { readProgress } from '../app/lib/server/progressMonitor';
import { notificationCandidates } from '../app/lib/server/notificationEvents';
import { followUpEvidence } from '../app/lib/followUpEvidence';
import { seoImplementationId } from '../app/lib/pageTaskFlow';
import { POST } from '../app/api/page-review/monitor/route';

const property = 'https://example.test/', pageUrl = `${property}services/Case?Key=Value`, websiteRunId = 'version-one';
const scope = { userId: 'alice', property, websiteRunId };
const provenance = { property, websiteRunId, pageUrl, finalUrl: pageUrl };
const setNow = date => { const now = new Date(date); vi.setSystemTime(now); return now; };
const cycles = () => [...records.entries()].filter(([key]) => /^pageProgressCycles\/[^/]+$/.test(key)).map(([, value]) => value);
let query, inspect;

beforeEach(async () => {
  vi.useFakeTimers(); setNow('2026-10-01T16:00:00.000Z'); reset();
  process.env.ONGOING_PAGE_REVIEWS_ENABLED = 'true'; process.env.ONGOING_PAGE_REVIEW_PILOT_UIDS = 'alice'; process.env.PAGE_MONITORING_ENABLED = 'true';
  await db.collection('users').doc('alice').set({ gscSiteUrl: property, gscAccessToken: 'fixture-only' });
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: property, revampRunId: websiteRunId, revampStatus: 'complete' });
  await db.collection('users').doc('alice').collection('revampHistory').doc(websiteRunId).set({ complete: true });
  query = vi.fn(async input => ({ rows: [{ ...(input.dimensions ? { keys: ['useful service'] } : {}), clicks: 10, impressions: 100, ctr: .1, position: 8 }] }));
  inspect = vi.fn(async () => ({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', googleCanonical: pageUrl } } }));
  getGscConnection.mockReset().mockResolvedValue({ siteUrl: property, query, inspect });
  fetchCurrentPageContent.mockReset().mockResolvedValue({ url: pageUrl, finalUrl: pageUrl, htmlTitle: 'Useful service', technical: { httpStatus: 200, noindex: { generic: false, googlebot: false }, robotsMeta: [], xRobotsTag: '' } });
  readCurrentPageForReview.mockReset().mockResolvedValue({ provenance, currentPage: { url: pageUrl, finalUrl: pageUrl, htmlTitle: 'Useful service', seoMetaDescription: 'Details about the service.' } });
  generatePageReviewSuggestions.mockReset().mockImplementation(async () => {
    const review = { provenance: { ...provenance, generatedAt: new Date().toISOString() }, ownerGoal: '',
      analysis: { action: 'keep_current', summary: 'Keep this clear service page.', reason: 'The wording accurately explains the service.', nextStep: 'Leave the page as it is while monitoring.', evidenceIds: ['P1'] } };
    const plan = { id: 'b'.repeat(64), userId: 'alice', ...provenance, revision: 1, review, tasks: [] };
    await db.collection('pageReviewPlans').doc(plan.id).set(plan);
    return { ...review, plan, updateCheck: { status: 'unchanged' } };
  });
});
afterEach(() => { vi.useRealTimers(); for (const key of ['ONGOING_PAGE_REVIEWS_ENABLED', 'ONGOING_PAGE_REVIEW_PILOT_UIDS', 'PAGE_MONITORING_ENABLED']) delete process.env[key]; });

describe('monitoring without a publication', () => {
  it('uses two historical complete periods and monthly windows across Pacific daylight saving', () => {
    const cycle = newMonitoringCycle(scope, pageUrl, new Date('2026-02-08T22:00:00Z'));
    expect(cycle).not.toHaveProperty('confirmedAt'); expect(cycle).not.toHaveProperty('confirmation');
    expect(cycleCheckpointWindows(cycle, 0, new Date('2026-02-08T22:00:00Z'))).toMatchObject({
      baseline: { startDate: '2025-12-12', endDate: '2026-01-08' }, post: { startDate: '2026-01-09', endDate: '2026-02-05' }, ready: true, comparisonKind: 'monitoring' });
    expect(nextCycleReviewDay(cycle)).toBe('2026-03-08');
    expect(latestCycleCheckpointDay(cycle, new Date('2026-03-08T07:59:59Z'))).toBe(0);
    expect(latestCycleCheckpointDay(cycle, new Date('2026-03-08T08:00:00Z'))).toBe(28);
    expect(cycleCheckpointWindows(cycle, 7)).toBeNull();
  });

  it('enrolls once across concurrent requests, retains history on stop and starts a distinct cycle on restart', async () => {
    const [one, two] = await Promise.all([enrollPageMonitoring('alice', pageUrl), enrollPageMonitoring('alice', pageUrl)]);
    expect(one.cycle.id).toBe(two.cycle.id); expect(cycles()).toHaveLength(1);
    expect([...records.keys()].some(key => key.startsWith('implementedSeoTips/'))).toBe(false);
    await stopPageMonitoring('alice', { cycleId: one.cycle.id, expectedRevision: one.cycle.revision });
    const restarted = await enrollPageMonitoring('alice', pageUrl);
    expect(restarted.cycle.id).not.toBe(one.cycle.id);
    const progress = await readOngoingProgress('alice', { pageUrl });
    expect(progress.records).toHaveLength(1); expect(progress.history).toHaveLength(1);
    expect(progress.history[0]).toMatchObject({ lifecycle: 'stopped', startedAt: one.cycle.startedAt });
  });

  it('checks history and technical issues immediately, then saves successive 28-day comparisons without changing the anchor', async () => {
    const { cycle } = await enrollPageMonitoring('alice', pageUrl);
    const initial = (await refreshOngoingProgress('alice', { cycleId: cycle.id })).cycle;
    expect(initial.latestCheckpoint).toMatchObject({ day: 0, windows: { comparisonKind: 'monitoring' }, baseline: { clicks: 10 }, post: { clicks: 10 } });
    expect(inspect).toHaveBeenCalledTimes(1); expect(fetchCurrentPageContent).toHaveBeenCalledTimes(1);
    expect(initial.technical.indexing.crawlAfterConfirmation).toBeNull();
    expect(notificationCandidates(scope, 'pageProgressCycles', cycle.id, { ...initial, userId: 'alice' }, new Date())).toEqual([]);
    expect(query.mock.calls.every(([input]) => input.dimensionFilterGroups[0].filters[0].expression === pageUrl)).toBe(true);
    const original = structuredClone(initial.originalComparison);
    setNow('2026-10-29T16:00:00Z');
    const next = (await refreshOngoingProgress('alice', { cycleId: cycle.id })).cycle;
    expect(next.latestCheckpoint.day).toBe(28); expect(next.nextReviewAt).toBe('2026-11-26');
    expect(next.originalComparison).toEqual(original); expect(next.startedAt).toBe(initial.startedAt);
    expect(notificationCandidates(scope, 'pageProgressCycles', cycle.id, { ...next, userId: 'alice' }, new Date())).toHaveLength(1);
    expect(followUpEvidence({ ...next, userId: 'alice' }, {}).comparisonKind).toBe('monitoring');
  });

  it('keeps zero traffic distinct from a failed data request', async () => {
    query.mockResolvedValue({ rows: [] });
    const { cycle } = await enrollPageMonitoring('alice', pageUrl);
    const initial = (await refreshOngoingProgress('alice', { cycleId: cycle.id })).cycle;
    expect(initial.latestCheckpoint).toMatchObject({ lowVolume: true, state: 'available', post: { clicks: 0 }, comparison: { clicksPercent: null } });
    setNow('2026-10-29T16:00:00Z'); query.mockRejectedValue(Error('private provider error'));
    const failed = (await refreshOngoingProgress('alice', { cycleId: cycle.id })).cycle;
    expect(failed.latestCheckpoint).toEqual(initial.latestCheckpoint); expect(failed.state).toBe('error');
    expect(JSON.stringify(failed)).not.toContain('private provider error');
  });

  it('saves the initial recommendation once and keeps monitoring active when it fails', async () => {
    generatePageReviewSuggestions.mockRejectedValueOnce(Error('private provider error'));
    const first = await startPageMonitoring('alice', { pageUrl });
    expect(first.cycle).toMatchObject({ lifecycle: 'active', initialReviewStatus: 'failed' });
    expect(first.reviewError).not.toContain('private provider error');
    const retried = await startPageMonitoring('alice', { pageUrl });
    expect(retried.cycle.id).toBe(first.cycle.id);
    expect(retried.cycle).toMatchObject({ initialReviewStatus: 'complete', latestDecision: { outcome: 'keep_monitoring', canAcceptTasks: false } });
    await startPageMonitoring('alice', { pageUrl }); expect(generatePageReviewSuggestions).toHaveBeenCalledTimes(2);
  });

  it('invalidates an in-flight initial review when the owner stops monitoring', async () => {
    generatePageReviewSuggestions.mockImplementationOnce(async (userId, url, keywords, options) => {
      const current = await readOngoingCycle(userId, options.monitoringReview.cycleId);
      await stopPageMonitoring(userId, { cycleId: current.id, expectedRevision: current.revision });
      await db.runTransaction(tx => assertMonitoringReview(tx, userId, url, options.monitoringReview));
      throw Error('A stopped review must not save');
    });
    const result = await startPageMonitoring('alice', { pageUrl });
    expect(result.cycle.lifecycle).toBe('stopped');
    expect([...records.keys()].some(key => key.includes('/decisions/'))).toBe(false);
  });

  it('invalidates in-flight collection after stop without recording new observations', async () => {
    const { cycle } = await enrollPageMonitoring('alice', pageUrl);
    query.mockImplementationOnce(async () => { await stopPageMonitoring('alice', { cycleId: cycle.id, expectedRevision: cycle.revision }); return { rows: [] }; });
    const result = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(result.cycle.lifecycle).toBe('stopped');
    expect([...records.keys()].some(key => key.includes('/observations/'))).toBe(false);
  });

  it('transitions to a real publication exactly once, including after stopping an older publication', async () => {
    const monitor = (await enrollPageMonitoring('alice', pageUrl)).cycle;
    const publish = (summary, previous) => confirmPageReview('alice', { pageUrl, provenance, changeType: 'page_content', published: true, changeSummary: summary,
      previousCycleId: previous.id, previousCycleRevision: previous.revision });
    const first = await publish('Clarified the service.', monitor);
    expect(cycles().filter(cycle => cycle.lifecycle === 'active')).toHaveLength(1);
    expect((await readOngoingCycle('alice', monitor.id)).lifecycle).toBe('superseded');
    const published = await readOngoingCycle('alice', first.cycleId);
    expect(published).toMatchObject({ mode: 'published_change', confirmedAt: new Date().toISOString(), previousCycleId: monitor.id, confirmation: { interveningChange: false } });
    expect((await publish('Clarified the service.', monitor)).alreadyConfirmed).toBe(true);
    await stopPageMonitoring('alice', { cycleId: published.id, expectedRevision: published.revision });
    expect((await readProgress('alice')).records).toHaveLength(0);
    const restarted = (await enrollPageMonitoring('alice', pageUrl)).cycle;
    expect(restarted.mode).toBe('monitoring');
    setNow('2026-10-02T16:00:00Z');
    const second = await publish('Added current service details.', restarted);
    expect(second.cycleId).not.toBe(first.cycleId);
    expect(cycles().filter(cycle => cycle.lifecycle === 'active')).toHaveLength(1);
    expect(records.get(`implementedSeoTips/${seoImplementationId('alice', pageUrl)}`).pageChangeSummary).toBe('Added current service details.');
    expect([...records.keys()].filter(key => key.startsWith('implementedSeoTips/') && key.includes('/cycles/'))).toHaveLength(1);
  });

  it('rejects other accounts, scope changes, invalid URLs and rollout-disabled writes', async () => {
    const { cycle } = await enrollPageMonitoring('alice', pageUrl);
    await expect(enrollPageMonitoring('alice', 'https://other.test/page')).rejects.toMatchObject({ status: 403 });
    await expect(enrollPageMonitoring('alice', `${pageUrl}#fragment`)).rejects.toMatchObject({ status: 400 });
    await expect(stopPageMonitoring('bob', { cycleId: cycle.id, expectedRevision: cycle.revision })).rejects.toMatchObject({ status: 409 });
    delete process.env.PAGE_MONITORING_ENABLED;
    await expect(enrollPageMonitoring('alice', pageUrl)).rejects.toMatchObject({ status: 409 });
    await expect(refreshOngoingProgress('alice', { cycleId: cycle.id })).rejects.toMatchObject({ status: 409 });
    expect((await readOngoingCycle('alice', cycle.id)).readOnly).toBe(true);
    expect((await runOngoingProgressCollection()).checked).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps enrollment authenticated and ignores a forged account ID', async () => {
    const request = (token, claimed = 'bob') => new Request('http://localhost/api/page-review/monitor', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'start', userId: claimed, pageUrl }) });
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request('alice'))).status).toBe(403); expect(cycles()).toHaveLength(0);
    const response = await POST(request('alice', 'alice')); expect(response.status).toBe(200);
    expect(cycles()[0].userId).toBe('alice');
  });
});
