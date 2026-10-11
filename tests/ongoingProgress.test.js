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
vi.mock('../app/lib/server/manualPageReview', () => ({ readCurrentPageForReview: vi.fn() }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { fetchCurrentPageContent } from '../app/lib/server/scrapeContent';
import { readCurrentPageForReview } from '../app/lib/server/manualPageReview';
import { latestEligibleCheckpointDay, ongoingCheckpointWindows } from '../app/lib/progressAssessment';
import { acknowledgeOngoingCycle, migrateOngoingRecord, newOngoingCycle, ongoingCycleRef, prepareOngoingConfirmation, readOngoingCycle, readOngoingProgress, refreshOngoingProgress, runOngoingProgressCollection } from '../app/lib/server/ongoingProgress';
import { confirmPageReview } from '../app/lib/server/confirmPageReview';
import { seoImplementationId } from '../app/lib/pageTaskFlow';
import { POST as legacyReset } from '../app/api/reset-page-implementation/route';
import { reviewPageCycle } from '../app/lib/server/pageReviewCycle';

const property = 'https://example.test/', pageUrl = `${property}services/Case?Key=Value`, websiteRunId = 'version-one';
const confirmedAt = '2026-08-01T16:00:00.000Z';
let query, inspect;
const setNow = date => { const now = new Date(date); vi.setSystemTime(now); return now; };
const record = (patch = {}) => ({ userId: 'alice', pageUrl, gscProperty: property, websiteRunId, implementedAt: confirmedAt,
  source: 'manual-page-review', confirmationMethod: 'user-confirmed', status: 'implemented', changeType: 'page_content',
  pageChangeSummary: 'Clarified the service heading.', confirmedTaskIds: [], confirmedTaskLabels: [], ...patch });
const seed = async patch => { const cycle = { ...newOngoingCycle(record(), null), ...patch }; await ongoingCycleRef(cycle.id).set(cycle); return cycle; };
const scope = { property, websiteRunId, pageUrl, finalUrl: pageUrl };

beforeEach(async () => {
  vi.useFakeTimers(); setNow('2026-09-01T16:00:00.000Z'); reset();
  process.env.ONGOING_PAGE_REVIEWS_ENABLED = 'true'; process.env.ONGOING_PAGE_REVIEW_PILOT_UIDS = 'alice';
  await db.collection('users').doc('alice').set({ gscSiteUrl: property, gscAccessToken: 'fixture-only' });
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: property, revampRunId: websiteRunId, revampStatus: 'complete' });
  await db.collection('users').doc('alice').collection('revampHistory').doc(websiteRunId).set({ complete: true });
  query = vi.fn(async input => ({ rows: [{ ...(input.dimensions ? { keys: ['useful service'] } : {}), clicks: 10, impressions: 100, ctr: .1, position: 8 }] }));
  inspect = vi.fn(async () => ({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-08-20T16:00:00Z', googleCanonical: pageUrl } } }));
  getGscConnection.mockReset().mockResolvedValue({ siteUrl: property, query, inspect });
  fetchCurrentPageContent.mockReset().mockResolvedValue({ url: pageUrl, finalUrl: pageUrl, htmlTitle: 'Useful service', seoMetaDescription: 'Details about the service.', h1: 'Useful service', technical: { httpStatus: 200, noindex: { generic: false, googlebot: false }, robotsMeta: [], xRobotsTag: '' } });
  readCurrentPageForReview.mockReset().mockResolvedValue({ provenance: scope, currentPage: { url: pageUrl, finalUrl: pageUrl, htmlTitle: 'Useful service', seoMetaDescription: 'Details about the service.' } });
});
afterEach(() => { vi.useRealTimers(); delete process.env.ONGOING_PAGE_REVIEWS_ENABLED; delete process.env.ONGOING_PAGE_REVIEW_PILOT_UIDS; });

describe('ongoing measurement windows', () => {
  it('opens 28/56/84-day checkpoints after the reporting buffer across a Pacific DST boundary', () => {
    expect(latestEligibleCheckpointDay('2026-02-08T22:00:00Z', new Date('2026-03-11T06:59:59Z'))).toBe(0);
    expect(latestEligibleCheckpointDay('2026-02-08T22:00:00Z', new Date('2026-03-11T07:00:00Z'))).toBe(28);
    expect(ongoingCheckpointWindows(confirmedAt, 56)).toMatchObject({ originalBaseline: { startDate: '2026-07-04', endDate: '2026-07-31' }, baseline: { startDate: '2026-08-02', endDate: '2026-08-29' }, post: { startDate: '2026-08-30', endDate: '2026-09-26' } });
    expect(ongoingCheckpointWindows(confirmedAt, 84).post).toEqual({ startDate: '2026-09-27', endDate: '2026-10-24' });
    expect(ongoingCheckpointWindows(confirmedAt, 45)).toBeNull();
  });

  it('stores original and later equal-window evidence, preserving the original comparison and dates', async () => {
    const cycle = await seed();
    const first = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(first.cycle.latestCheckpoint).toMatchObject({ day: 28, lowVolume: false, state: 'available', comparison: { clicksDelta: 0 } });
    const original = structuredClone(first.cycle.originalComparison);
    expect(query.mock.calls.every(([input]) => input.dimensionFilterGroups[0].filters[0].expression === pageUrl && input.dataState === 'final')).toBe(true);
    setNow('2026-09-29T16:00:00Z');
    query.mockImplementation(async input => ({ rows: [{ ...(input.dimensions ? { keys: ['useful service'] } : {}), clicks: 20, impressions: 200, ctr: .1, position: 6 }] }));
    const second = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(second.cycle.latestCheckpoint).toMatchObject({ day: 56, baseline: { clicks: 10 }, post: { clicks: 20 }, comparison: { clicksDelta: 10 } });
    expect(second.cycle.originalComparison).toEqual(original);
    expect(second.cycle.confirmedAt).toBe(confirmedAt);
    expect(records.has(`pageProgressCycles/${cycle.id}/checkpoints/day-28`)).toBe(true);
    expect(records.has(`pageProgressCycles/${cycle.id}/checkpoints/day-56`)).toBe(true);
  });

  it('keeps a zero-traffic checkpoint reviewable without inventing percentages or requiring a rewrite', async () => {
    query.mockResolvedValue({ rows: [] }); const cycle = await seed();
    const result = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(result.cycle).toMatchObject({ state: 'review_due', latestCheckpoint: { lowVolume: true, baseline: { position: null }, post: { position: null }, comparison: { clicksPercent: null, impressionsPercent: null } } });
    const continued = await acknowledgeOngoingCycle('alice', { cycleId: cycle.id, revision: result.cycle.revision, action: 'keep_monitoring' });
    expect(continued.cycle).toMatchObject({ lifecycle: 'active', state: 'reviewed', confirmedAt, nextReviewAt: '2026-09-29' });
  });

  it('does technical checks before the first checkpoint and shares a six-hour manual cache', async () => {
    setNow('2026-08-08T16:00:00Z'); const cycle = await seed();
    fetchCurrentPageContent.mockResolvedValue({ url: pageUrl, finalUrl: pageUrl, technical: { httpStatus: 200, noindex: { googlebot: true }, robotsMeta: [] } });
    const result = await refreshOngoingProgress('alice', { cycleId: cycle.id, technicalOnly: true, expectedRevision: 1 });
    expect(result.cycle.latestCheckpoint).toBeNull(); expect(query).not.toHaveBeenCalled();
    expect(result.cycle.technical.issues).toContainEqual(expect.objectContaining({ code: 'noindex' }));
    expect(result.cycle.state).toBe('needs_attention');
    expect((await refreshOngoingProgress('alice', { cycleId: cycle.id, technicalOnly: true })).state).toBe('skipped');
    expect(inspect).toHaveBeenCalledTimes(1);
    await expect(refreshOngoingProgress('alice', { cycleId: cycle.id, technicalOnly: true, expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
  });

  it('keeps successful observations when a later checkpoint fails and separates query-report failure from page totals', async () => {
    const cycle = await seed(); const first = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    setNow('2026-09-29T16:00:00Z'); query.mockRejectedValue(new Error('provider secret must not be saved'));
    const failed = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(failed.cycle.latestCheckpoint).toEqual(first.cycle.latestCheckpoint);
    expect(failed.cycle.lastError).toMatchObject({ checkpoint56: 'temporarily_unavailable' });
    expect(JSON.stringify(failed)).not.toContain('provider secret');
    setNow('2026-09-30T16:00:00Z'); query.mockImplementation(async input => { if (input.dimensions) throw Error('query unavailable'); return { rows: [{ clicks: 0, impressions: 200, ctr: 0, position: 8 }] }; });
    const recovered = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(recovered.cycle.latestCheckpoint).toMatchObject({ day: 56, post: { clicks: 0, queriesStatus: 'unavailable' } });
  });

  it('checks latest checkpoint first and backfills at most one earlier checkpoint after an absence', async () => {
    setNow('2026-10-27T16:00:00Z'); const cycle = await seed();
    const result = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(result.cycle.latestCheckpoint.day).toBe(84);
    const keys = [...records.keys()].filter(key => key.includes('/checkpoints/'));
    expect(keys).toHaveLength(2); expect(keys.some(key => key.endsWith('/day-28'))).toBe(true);
    expect(result.cycle.originalComparison.post.endDate).toBe('2026-08-29');
  });

  it('recovers a missing query report with dated revisions while keeping page totals and previous checkpoint evidence', async () => {
    const cycle = await seed();
    query.mockImplementation(async input => { if (input.dimensions) throw Error('unavailable'); return { rows: [{ clicks: 10, impressions: 100, ctr: .1, position: 8 }] }; });
    const first = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(first.cycle.latestCheckpoint.post.queriesStatus).toBe('unavailable');
    query.mockClear().mockResolvedValue({ rows: [{ keys: ['local service'], clicks: 5, impressions: 40, ctr: .125, position: 7 }] });
    setNow('2026-09-02T16:00:00Z');
    const next = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(query.mock.calls.every(([input]) => input.dimensions?.[0] === 'query')).toBe(true);
    expect(next.cycle.latestCheckpoint).toMatchObject({ evidenceRevision: 2, post: { clicks: 10, impressions: 100, queriesStatus: 'available', queryRevision: 2 } });
    expect(records.get(`pageProgressCycles/${cycle.id}/checkpoints/day-28/versions/1`).post.queriesStatus).toBe('unavailable');
    expect(next.cycle.originalComparison).toEqual(first.cycle.originalComparison);
  });

  it('does not create a fresh checkpoint when missing query reports remain unavailable', async () => {
    const cycle = await seed();
    query.mockImplementation(async input => { if (input.dimensions) throw Error('unavailable'); return { rows: [] }; });
    const first = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    await acknowledgeOngoingCycle('alice', { cycleId: cycle.id, revision: first.cycle.revision, action: 'keep_monitoring' });
    setNow('2026-09-02T16:00:00Z');
    const next = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    expect(next.cycle.latestCheckpoint).toEqual(first.cycle.latestCheckpoint);
    expect(next.cycle.reviewStatus).toBe('reviewed');
    expect(next.cycle.lastError).toMatchObject({ queries: 'temporarily_unavailable' });
  });
});

describe('cycle ownership, concurrency and publication', () => {
  it('reads saved data without crawling or Google work and preserves historical reads during rollout rollback', async () => {
    const cycle = await seed();
    expect((await readOngoingProgress('alice')).records[0].cycleId).toBe(cycle.id);
    delete process.env.ONGOING_PAGE_REVIEWS_ENABLED;
    expect((await readOngoingProgress('alice')).enabled).toBe(false);
    expect((await readOngoingCycle('alice', cycle.id)).readOnly).toBe(true);
    expect(query).not.toHaveBeenCalled(); expect(fetchCurrentPageContent).not.toHaveBeenCalled();
    await expect(refreshOngoingProgress('alice', { cycleId: cycle.id })).rejects.toMatchObject({ status: 409 });
  });

  it('keeps an active selected page visible even with more than forty historical cycles', async () => {
    for (let index = 0; index < 45; index++) await seed({ id: index.toString(16).padStart(64, '0'), lifecycle: 'superseded' });
    const active = await seed();
    const workspace = await readOngoingProgress('alice', { pageUrl });
    expect(workspace.records.map(cycle => cycle.id)).toEqual([active.id]);
    expect(workspace.history).toHaveLength(40); expect(workspace.nextCursor).toBeTruthy();
    expect((await readOngoingProgress('alice', { pageUrl, cursor: workspace.nextCursor })).history.length).toBe(5);
  });

  it('keeps workspace responses compact while single-cycle reads retain the recorded query evidence', async () => {
    const cycle = await seed(); await refreshOngoingProgress('alice', { cycleId: cycle.id });
    const full = await readOngoingCycle('alice', cycle.id), compact = (await readOngoingProgress('alice')).records[0];
    expect(full.latestCheckpoint.post.queries).toHaveLength(1);
    expect(compact.latestCheckpoint.post.queries).toBeUndefined();
    expect(compact.latestCheckpoint.post.clicks).toBe(full.latestCheckpoint.post.clicks);
    expect(compact.confirmation.tasks).toBeUndefined(); expect(compact.originalComparison.windows).toEqual(full.originalComparison.windows);
  });

  it('rejects cross-account, deletion and rebuilt-scope writes while keeping old-version history', async () => {
    const cycle = await seed();
    await db.collection('users').doc('bob').set({ gscSiteUrl: property });
    await db.collection('onboarding').doc('bob').set({ gscProperty: property });
    await expect(readOngoingCycle('bob', cycle.id)).rejects.toMatchObject({ status: 404 });
    await db.collection('onboarding').doc('alice').update({ revampRunId: 'new-version' });
    expect((await readOngoingProgress('alice')).records).toEqual([]);
    expect((await readOngoingProgress('alice')).history[0].readOnly).toBe(true);
    await expect(refreshOngoingProgress('alice', { cycleId: cycle.id })).rejects.toMatchObject({ status: 409 });
    await db.collection('users').doc('alice').update({ deletionInProgress: true });
    await expect(readOngoingCycle('alice', cycle.id)).rejects.toMatchObject({ status: 409 });
  });

  it('shares a lease between simultaneous refreshes and passes the absolute deadline to Google', async () => {
    const cycle = await seed(), deadline = Date.now() + 90000;
    const results = await Promise.all([refreshOngoingProgress('alice', { cycleId: cycle.id, deadline }), refreshOngoingProgress('alice', { cycleId: cycle.id, deadline })]);
    expect(results.map(result => result.state)).toContain('skipped');
    expect(getGscConnection).toHaveBeenCalledTimes(1);
    expect(getGscConnection).toHaveBeenCalledWith('alice', expect.objectContaining({ deadline }));
    expect((await refreshOngoingProgress('alice', { cycleId: cycle.id })).state).toBe('skipped');
  });

  it('defers collection while a user-requested follow-up review holds the same cycle', async () => {
    const cycle = await seed({ followUpLease: { id: 'review-attempt', expiresAt: new Date(Date.now() + 60000).toISOString() } });
    expect((await refreshOngoingProgress('alice', { cycleId: cycle.id })).state).toBe('skipped');
    expect(getGscConnection).not.toHaveBeenCalled();
    expect((await readOngoingCycle('alice', cycle.id)).followUpLease).toBeUndefined();
  });

  it('does not recreate a cycle or account deleted while Google is responding', async () => {
    const cycle = await seed();
    query.mockImplementationOnce(async () => { records.delete(`pageProgressCycles/${cycle.id}`); records.delete('users/alice'); records.delete('onboarding/alice'); return { rows: [] }; });
    await expect(refreshOngoingProgress('alice', { cycleId: cycle.id })).rejects.toMatchObject({ status: 409 });
    expect(records.has(`pageProgressCycles/${cycle.id}`)).toBe(false);
    expect([...records.keys()].some(key => key.includes('/observations/'))).toBe(false);
  });

  it('supersedes only an explicitly confirmed new edit, preserving its predecessor and selected scope', async () => {
    const cycle = await seed();
    const source = record({ ongoingCycleId: cycle.id });
    await db.collection('implementedSeoTips').doc(seoImplementationId('alice', pageUrl)).set(source);
    const input = { pageUrl, provenance: scope, changeType: 'page_content', published: true,
      changeSummary: 'Published actual revised service details.', previousCycleId: cycle.id, previousCycleRevision: cycle.revision, interveningChange: true };
    const result = await confirmPageReview('alice', input);
    expect(result.alreadyConfirmed).toBe(false); expect(result.cycleId).not.toBe(cycle.id);
    expect((await readOngoingCycle('alice', cycle.id))).toMatchObject({ lifecycle: 'superseded', supersededByCycleId: result.cycleId, confirmedAt });
    expect((await readOngoingCycle('alice', result.cycleId))).toMatchObject({ lifecycle: 'active', confirmation: { summary: 'Published actual revised service details.', interveningChange: true } });
    expect([...records.keys()].some(key => key.includes('/cycles/'))).toBe(true);
    const after = structuredClone([...records]);
    expect((await confirmPageReview('alice', input)).alreadyConfirmed).toBe(true);
    expect([...records]).toEqual(after);
  });

  it('rejects stale publication pins and does not end collection merely because a review was acknowledged', async () => {
    const cycle = await seed();
    await expect(db.runTransaction(tx => prepareOngoingConfirmation(tx, record({ implementedAt: new Date().toISOString() }), null,
      { previousCycleId: cycle.id, previousCycleRevision: 999, interveningChange: true }))).rejects.toMatchObject({ status: 409 });
    const result = await refreshOngoingProgress('alice', { cycleId: cycle.id });
    const acknowledged = await acknowledgeOngoingCycle('alice', { cycleId: cycle.id, revision: result.cycle.revision, action: 'review_changes' });
    expect(acknowledged.cycle.lifecycle).toBe('active'); expect(acknowledged.cycle.reviewChangesAllowed).toBe(true);
    expect(acknowledged.cycle.confirmedAt).toBe(confirmedAt);
  });

  it('migrates only explicit server-confirmed current work, without inventing a new publication time', async () => {
    const ref = db.collection('implementedSeoTips').doc('old'); await ref.set(record());
    const migrated = await migrateOngoingRecord(await ref.get());
    expect(migrated.confirmedAt).toBe(confirmedAt); expect(migrated.confirmation.source).toBe('migrated_owner_reported');
    expect((await migrateOngoingRecord(await ref.get())).id).toBe(migrated.id);
    await ref.update({ confirmationMethod: 'legacy' }); expect(await migrateOngoingRecord(await ref.get())).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('restores confirmed task details from a matching server-owned source plan during migration', async () => {
    const sourcePlanId = 'a'.repeat(64), taskId = 'b'.repeat(64);
    await db.collection('pageReviewPlans').doc(sourcePlanId).set({ id: sourcePlanId, userId: 'alice', property, websiteRunId, pageUrl, revision: 8,
      review: { analysis: { searchFocus: { phrase: 'useful service', source: 'proposed' } } }, tasks: [{ id: taskId, recommendation: { label: 'Clarify heading', type: 'heading' }, draft: 'Useful service', publication: { implementedAt: confirmedAt } }] });
    const ref = db.collection('implementedSeoTips').doc('old'); await ref.set(record({ sourcePlanId, sourcePlanRevision: 7, confirmedTaskIds: [taskId] }));
    const migrated = await migrateOngoingRecord(await ref.get());
    expect(migrated.confirmation).toMatchObject({ sourcePlanRevision: 7, searchFocus: { phrase: 'useful service' }, tasks: [{ id: taskId, draft: 'Useful service' }] });
  });

  it('cannot use legacy resets or cycle closure to erase an ongoing measurement during rollback', async () => {
    const cycle = await seed();
    await db.collection('implementedSeoTips').doc(seoImplementationId('alice', pageUrl)).set(record({ ongoingCycleId: cycle.id }));
    delete process.env.ONGOING_PAGE_REVIEWS_ENABLED;
    const before = structuredClone([...records]);
    const response = await legacyReset(new Request('http://localhost/api/reset-page-implementation', { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'alice', pageUrl }) }));
    expect(response.status).toBe(410);
    await expect(reviewPageCycle('alice', { pageUrl, implementedAt: confirmedAt })).rejects.toMatchObject({ status: 409 });
    expect([...records]).toEqual(before);
  });

  it('bounds due work and refuses provider work once the deadline is exhausted', async () => {
    await seed(); const result = await runOngoingProgressCollection({ deadline: Date.now() - 1 });
    expect(result).toMatchObject({ checked: 0, moreRecords: true }); expect(query).not.toHaveBeenCalled();
  });

  it('does not let paused pilot accounts monopolize the due queue and caps current work', async () => {
    for (let index = 0; index < 42; index++) await seed({ id: index.toString(16).padStart(64, '0'), userId: 'disabled-account', nextCheckAt: '2026-01-01T00:00:00Z' });
    await seed();
    const result = await runOngoingProgressCollection({ maxRecords: 1 });
    expect(result.checked).toBe(1); expect(getGscConnection).toHaveBeenCalledTimes(1);
    expect(getGscConnection.mock.calls[0][0]).toBe('alice');
  });

  it('retains dated technical evidence but marks its issues stale when fresh checks fail', async () => {
    const cycle = await seed();
    fetchCurrentPageContent.mockResolvedValueOnce({ finalUrl: pageUrl, technical: { noindex: { generic: true } } });
    await refreshOngoingProgress('alice', { cycleId: cycle.id, technicalOnly: true });
    setNow('2026-09-02T16:00:00Z'); fetchCurrentPageContent.mockRejectedValueOnce(Error('offline')); inspect.mockRejectedValueOnce(Error('offline'));
    const result = await refreshOngoingProgress('alice', { cycleId: cycle.id, technicalOnly: true });
    expect(result.cycle.technical.publicPage.checkedAt).toBe('2026-09-01T16:00:00.000Z');
    expect(result.cycle.technical.issues).toContainEqual(expect.objectContaining({ code: 'noindex', stale: true }));
    expect(result.cycle.state).toBe('error');
  });

  it('processes at most forty cycles with four concurrent Google query calls and reports backlog', async () => {
    for (let index = 0; index < 41; index++) await seed({ id: index.toString(16).padStart(64, '0') });
    let active = 0, maximum = 0;
    query.mockImplementation(async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return { rows: [] }; });
    const result = await runOngoingProgressCollection({ maxRecords: 200 });
    expect(result.checked).toBe(40); expect(result.moreRecords).toBe(true); expect(maximum).toBeLessThanOrEqual(4);
    expect(getGscConnection).toHaveBeenCalledTimes(40);
  });
});
