import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { verifyIdToken: vi.fn(async token => { if (token !== 'alice') throw Error('invalid'); return { uid: token }; }) } };
});
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn(async () => ({ siteUrl: 'https://example.test/' })) }));
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
vi.mock('openai', () => ({ default: class { constructor() { throw Error('Cycles must never call AI'); } } }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { seoImplementationId } from '../app/lib/pageTaskFlow';
import { comparisonWindows, PROGRESS_SCHEMA_VERSION, PROGRESS_SOURCE } from '../app/lib/progressAssessment';
import { reviewPageCycle, reviewCycleArchiveRef } from '../app/lib/server/pageReviewCycle';
import { readProgress, collectProgressRecord } from '../app/lib/server/progressMonitor';
import { POST as cycle } from '../app/api/page-review/cycle/route';
import { POST as confirm } from '../app/api/page-review/confirm/route';
import { publicFetch } from '../app/lib/server/publicFetch';

const now = new Date('2026-10-10T16:00:00Z'), property = 'https://example.test/', pageUrl = `${property}Services?Topic=Design`;
const implementedAt = '2026-08-01T16:00:00.000Z', websiteRunId = 'current-website';
const id = seoImplementationId('alice', pageUrl), recordPath = `implementedSeoTips/${id}`;
const ref = () => db.collection('implementedSeoTips').doc(id);
const assessment = (overrides = {}) => ({ schemaVersion: PROGRESS_SCHEMA_VERSION, source: PROGRESS_SOURCE, property, pageUrl, websiteRunId, implementedAt, windows: comparisonWindows(implementedAt, now), attemptedAt: now.toISOString(), state: 'ready', reason: 'comparison_available', baseline: { clicks: 10, impressions: 100 }, post: { clicks: 15, impressions: 150 }, comparison: { clicksDelta: 5 }, ...overrides });
const seed = (overrides = {}) => ref().set({ userId: 'alice', pageUrl, implementedAt, gscProperty: property, websiteRunId, status: 'implemented', confirmationMethod: 'user-confirmed', changeType: 'page_content', pageChangeSummary: 'Clarified the service heading.', confirmedTaskIds: ['a'.repeat(64)], confirmedTaskLabels: ['Clarify the heading'], progressAssessment: assessment(), ...overrides });
const request = (body = {}, uid = 'alice') => new Request('https://app.test/api/page-review/cycle', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid}` } : {}) }, body: JSON.stringify({ pageUrl, implementedAt, ...body }) });

beforeEach(async () => {
  reset(); publicFetch.mockReset(); delete process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST;
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: property, revampRunId: websiteRunId, revampStatus: 'complete' });
  await db.collection('users').doc('alice').set({ gscSiteUrl: property, gscAccessToken: 'test-only' });
  await db.collection('users').doc('alice').collection('revampHistory').doc(websiteRunId).set({ complete: true });
  await seed();
});

describe('reviewing a completed comparison cycle', () => {
  it('archives the exact comparison and publication before unlocking another cycle, idempotently', async () => {
    const original = structuredClone(records.get(recordPath));
    const result = await reviewPageCycle('alice', { pageUrl, implementedAt }, now);
    expect(result).toMatchObject({ success: true, pageUrl, implementedAt, alreadyReviewed: false, record: { status: 'reviewed', reviewedAt: now.toISOString() } });
    const archivedPath = reviewCycleArchiveRef(ref(), implementedAt).path;
    expect(records.get(archivedPath).data).toEqual(original);
    const progress = await readProgress('alice', now);
    expect(progress.records).toEqual([]);
    expect(progress.history).toHaveLength(1);
    expect(progress.history[0]).toMatchObject({ id, pageUrl, implementedAt, reviewedAt: now.toISOString(), canStartNextCycle: false,
      confirmedTaskLabels: ['Clarify the heading'], pageChangeSummary: 'Clarified the service heading.', assessment: { state: 'ready' } });
    const retry = await reviewPageCycle('alice', { pageUrl, implementedAt }, new Date('2026-10-11T16:00:00Z'));
    expect(retry).toEqual({ ...result, alreadyReviewed: true });
    expect(records.get(archivedPath).data).toEqual(original);
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('allows an honest low-data comparison after collection but never elapsed time alone', async () => {
    await seed({ progressAssessment: undefined });
    await expect(reviewPageCycle('alice', { pageUrl, implementedAt }, now)).rejects.toMatchObject({ status: 409 });
    await seed({ progressAssessment: assessment({ state: 'insufficient_data', reason: 'not_enough_search_activity', comparison: null }) });
    expect((await reviewPageCycle('alice', { pageUrl, implementedAt }, now)).success).toBe(true);
  });

  it.each([
    { state: 'collecting' }, { state: 'paused' }, { state: 'error' },
    { implementedAt: '2026-07-01' }, { pageUrl: `${property}other` }, { property: 'https://other.test/' }, { websiteRunId: 'old-website' },
    { state: 'insufficient_data', reason: 'implementation_date_or_page_missing' },
    { windows: { ...comparisonWindows(implementedAt, now), post: { startDate: '2000-01-01', endDate: '2000-01-28' } } },
  ])('rejects unavailable, stale or mismatched assessments: %j', async patch => {
    await seed({ progressAssessment: assessment(patch) }); const before = [...records.entries()];
    await expect(reviewPageCycle('alice', { pageUrl, implementedAt }, now)).rejects.toMatchObject({ status: 409 });
    expect([...records.entries()]).toEqual(before);
  });

  it('requires full 28 days plus reporting delay even if a forged assessment claims readiness', async () => {
    const recent = '2026-10-01T16:00:00.000Z';
    await seed({ implementedAt: recent, progressAssessment: assessment({ implementedAt: recent, windows: { ...comparisonWindows(recent, now), ready: true } }) });
    await expect(reviewPageCycle('alice', { pageUrl, implementedAt: recent }, now)).rejects.toMatchObject({ status: 409 });
  });

  it('authenticates and rejects cross-account, stale-cycle and changed-run requests without mutations', async () => {
    const before = [...records.entries()];
    expect((await cycle(request({}, null))).status).toBe(401);
    expect((await cycle(request({ userId: 'bob' }))).status).toBe(403);
    expect((await cycle(request({ implementedAt: '2026-07-01' }))).status).toBe(409);
    expect((await cycle(request({ pageUrl: `${property}Other` }))).status).toBe(409);
    expect([...records.entries()]).toEqual(before);
    await db.collection('onboarding').doc('alice').update({ revampRunId: 'new-run' });
    expect((await cycle(request())).status).toBe(409);
    expect((await readProgress('alice', now)).records).toEqual([]);
  });

  it('returns source task labels and current scope in progress, excluding wrong-run/property and reviewed records', async () => {
    await db.collection('implementedSeoTips').doc('wrong-run').set({ ...records.get(recordPath), websiteRunId: 'old' });
    await db.collection('implementedSeoTips').doc('wrong-property').set({ ...records.get(recordPath), gscProperty: 'https://elsewhere.test/' });
    await db.collection('implementedSeoTips').doc('reviewed').set({ ...records.get(recordPath), status: 'reviewed' });
    const progress = await readProgress('alice', now);
    expect(progress.records).toHaveLength(1);
    expect(progress.records[0]).toMatchObject({ websiteRunId, property, confirmedTaskIds: ['a'.repeat(64)], confirmedTaskLabels: ['Clarify the heading'], canStartNextCycle: true });
    expect(await collectProgressRecord(await db.collection('implementedSeoTips').doc('wrong-run').get(), { now })).toBe('skipped');
    expect(await collectProgressRecord(await db.collection('implementedSeoTips').doc('wrong-property').get(), { now })).toBe('skipped');
  });

  it('keeps the active record and archive unchanged when the atomic transaction fails', async () => {
    const before = [...records.entries()], original = db.runTransaction;
    const spy = vi.spyOn(db, 'runTransaction').mockImplementation(callback => original(async tx => { await callback(tx); throw new Error('simulated commit failure'); }));
    try { await expect(reviewPageCycle('alice', { pageUrl, implementedAt }, now)).rejects.toThrow('simulated commit failure'); }
    finally { spy.mockRestore(); }
    expect([...records.entries()]).toEqual(before);
  });

  it('preserves the archived comparison when a new publication begins and rejects stale close retries', async () => {
    const original = structuredClone(records.get(recordPath));
    await reviewPageCycle('alice', { pageUrl, implementedAt }, now);
    publicFetch.mockImplementation(async () => {
      const response = new Response('<html><head><title>Published heading</title></head><body><main><h1>Published heading</h1></main></body></html>', { headers: { 'Content-Type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: pageUrl }); return response;
    });
    const response = await confirm(new Request('https://app.test/api/page-review/confirm', { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl, provenance: { property, websiteRunId, pageUrl, finalUrl: pageUrl }, changeType: 'page_content', published: true, changeSummary: 'Added an explanation of service options.' }) }));
    expect(response.status).toBe(200); const result = await response.json();
    expect(result.record.status).toBe('implemented'); expect(result.record.implementedAt).not.toBe(implementedAt); expect(result.record).not.toHaveProperty('progressAssessment');
    expect(records.get(reviewCycleArchiveRef(ref(), implementedAt).path).data).toEqual(original);
    await expect(reviewPageCycle('alice', { pageUrl, implementedAt }, now)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to overwrite reviewed work whose immutable archive is missing', async () => {
    await ref().update({ status: 'reviewed' });
    await expect(reviewPageCycle('alice', { pageUrl, implementedAt }, now)).rejects.toMatchObject({ status: 409 });
  });

  it('allows another publication after reviewing a legacy Date-valued implementation timestamp', async () => {
    await seed({ implementedAt: new Date(implementedAt) });
    await reviewPageCycle('alice', { pageUrl, implementedAt }, now);
    publicFetch.mockImplementation(async () => {
      const response = new Response('<html><head><title>Current page title</title></head><body><p>Published content.</p></body></html>', { headers: { 'Content-Type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: pageUrl }); return response;
    });
    const response = await confirm(new Request('https://app.test/api/page-review/confirm', { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl, provenance: { property, websiteRunId, pageUrl, finalUrl: pageUrl }, changeType: 'page_content', published: true, changeSummary: 'Published a second useful change.' }) }));
    expect(response.status).toBe(200); expect((await response.json()).record.status).toBe('implemented');
    expect(records.get(reviewCycleArchiveRef(ref(), implementedAt).path).data.implementedAt).toEqual(new Date(implementedAt));
  });

  it('returns only five previous comparisons per current page and never exposes old website scope', async () => {
    for (let index = 1; index <= 7; index += 1) {
      const date = `2026-0${index}-01T16:00:00.000Z`;
      await reviewCycleArchiveRef(ref(), date).set({ userId: 'alice', pageUrl, property, websiteRunId, implementedAt: date,
        reviewedAt: `2026-0${index + 1}-10T16:00:00.000Z`, data: { ...records.get(recordPath), implementedAt: date, progressAssessment: assessment({ implementedAt: date, windows: comparisonWindows(date, now) }) } });
    }
    const progress = await readProgress('alice', now);
    expect(progress.history).toHaveLength(5); expect(progress.history[0].implementedAt).toBe('2026-07-01T16:00:00.000Z');
    expect(progress.history.every(item => item.websiteRunId === websiteRunId && item.canStartNextCycle === false)).toBe(true);
    await db.collection('onboarding').doc('alice').update({ revampRunId: 'replacement-website' });
    const rebuilt = await readProgress('alice', now); expect(rebuilt.records).toEqual([]); expect(rebuilt.history).toEqual([]);
  });

  it('keeps actual legacy metadata visible in both current and previous comparisons', async () => {
    await seed({ changeType: 'metadata', title: 'Confirmed title', description: 'Confirmed description' });
    expect((await readProgress('alice', now)).records[0]).toMatchObject({ changeType: 'metadata', title: 'Confirmed title', description: 'Confirmed description' });
    await reviewPageCycle('alice', { pageUrl, implementedAt }, now);
    expect((await readProgress('alice', now)).history[0]).toMatchObject({ changeType: 'metadata', title: 'Confirmed title', description: 'Confirmed description' });
  });
});
