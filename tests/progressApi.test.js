import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  const fake = fakeFirestore();
  const collection = fake.db.collection;
  function orderedQuery(original, after = null, limit = Infinity) {
    return { ...original, orderBy: () => orderedQuery(original, after, limit), startAfter: id => orderedQuery(original, id, limit), limit: count => orderedQuery(original, after, count),
      get: async () => { const result = await original.get(); const docs = result.docs.sort((a,b) => a.id.localeCompare(b.id)).filter(doc => !after || doc.id > after).slice(0, limit); return { docs, empty: !docs.length, size: docs.length }; },
    };
  }
  fake.db.collection = name => orderedQuery(collection(name));
  return { ...fake, auth: { verifyIdToken: vi.fn(async token => { if (!['alice','bob','admin'].includes(token)) throw Error(); return { uid: token }; }), getUser: vi.fn(async uid => ({ customClaims: { admin: uid === 'admin' } })) } };
});
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn() }));
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { collectProgressRecord, readProgress, refreshUserProgress, runProgressCollection } from '../app/lib/server/progressMonitor';
import { fetchPageObservation } from '../app/lib/server/pageObservation';
import { POST as metrics } from '../app/api/gsc/page-metrics/route';
import { GET as progressGet, POST as progressPost } from '../app/api/progress/route';
import { GET as cron } from '../app/api/cron/check-success-stories/route';
import { POST as detect } from '../app/api/playbook/detect-success/route';
import { POST as config } from '../app/api/playbook/config/route';

const now = new Date('2026-10-10T16:00:00Z');
const pageUrl = 'https://example.test/Case/?Key=A';
const request = (path, body, uid = 'alice', method = 'POST') => new Request(`http://localhost${path}`, { method, headers: uid ? { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' } : {}, ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}) });
let query;
async function tip(id = 'tip', patch = {}) {
  await db.collection('implementedSeoTips').doc(id).set({ userId: 'alice', status: 'implemented', pageUrl, websiteRunId: 'one', gscProperty: 'https://example.test/', implementedAt: '2026-08-01', preStats: { clicks: 10000 }, postStats: { clicks: 99999 }, ...patch });
  return db.collection('implementedSeoTips').doc(id).get();
}
beforeEach(async () => {
  reset();
  query = vi.fn(async () => ({ rows: [{ clicks: 10, impressions: 100, ctr: 0.1, position: 5 }] }));
  getGscConnection.mockReset().mockResolvedValue({ siteUrl: 'https://example.test/', query });
  await db.collection('onboarding').doc('alice').set({ gscProperty: 'https://example.test/', revampStatus: 'complete', revampRunId: 'one' });
  await db.collection('users').doc('alice').set({ gscSiteUrl: 'https://example.test/' });
});
it('requires authentication and rejects supplied cross-account/property identities before Google work', async () => {
  expect((await metrics(request('/api/gsc/page-metrics', { pageUrl }, null))).status).toBe(401);
  expect((await metrics(request('/api/gsc/page-metrics', { pageUrl, userId: 'bob' }))).status).toBe(403);
  expect((await metrics(request('/api/gsc/page-metrics', { pageUrl, siteUrl: 'https://other.test/' }))).status).toBe(403);
  expect((await progressGet(request('/api/progress?userId=bob', null, 'alice', 'GET'))).status).toBe(403);
  expect((await progressPost(request('/api/progress', { userId: 'bob' }))).status).toBe(403);
  expect(query).not.toHaveBeenCalled();
});
it('fetches the exact case/query preserving page and returns sourced dated no-data with no fake position', async () => {
  query.mockResolvedValue({ rows: [] });
  const response = await metrics(request('/api/gsc/page-metrics', { pageUrl, token: 'ignored-client-token' }));
  expect(response.status).toBe(200);
  expect(query.mock.calls[0][0]).toMatchObject({ dataState: 'final', type: 'web', rowLimit: 1, dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] }] });
  expect(query.mock.calls[0][0]).not.toHaveProperty('dimensions');
  expect(await response.json()).toMatchObject({ source: 'google_search_console', property: 'https://example.test/', pageUrl, impressions: 0, clicks: 0, ctr: null, position: null, status: 'no_data' });
});
it('rejects other-site pages and malformed provider metrics instead of turning failures into zeroes', async () => {
  const connection = await getGscConnection('alice');
  await expect(fetchPageObservation(connection, 'https://other.test/a', { startDate: '2026-08-01', endDate: '2026-08-28' })).rejects.toThrow('Page must belong');
  query.mockResolvedValue({ rows: [{ clicks: 5, impressions: 0, ctr: 0, position: 0 }] });
  expect((await metrics(request('/api/gsc/page-metrics', { pageUrl }))).status).toBe(502);
});
it('preserves archived records and pauses recovery accounts without Google requests', async () => {
  const archived = await tip('archived', { preRevampArchived: true });
  expect(await collectProgressRecord(archived, { now })).toBe('skipped');
  expect(records.get('implementedSeoTips/archived')).not.toHaveProperty('progressAssessment');
  await db.collection('onboarding').doc('alice').update({ progressReviewRequired: true });
  await tip();
  const result = await refreshUserProgress('alice', now);
  expect(result).toMatchObject({ paused: true, checked: 0 });
  expect(result.records).toHaveLength(1);
  expect(result.records[0].assessment.state).toBe('paused');
  expect(query).not.toHaveBeenCalled();
});
it('waits for a full post period without copying any legacy metrics into the assessment', async () => {
  const document = await tip('tip', { implementedAt: '2026-10-01' });
  expect(await collectProgressRecord(document, { now })).toBe('collecting');
  const result = await readProgress('alice', now);
  expect(result.records[0].assessment).toMatchObject({ state: 'collecting', reason: 'waiting_for_complete_post_window', baseline: null, post: null, comparison: null });
  expect(query).not.toHaveBeenCalled();
});
it('compares only server-fetched equal windows and leaves old snapshots untouched', async () => {
  const document = await tip();
  const result = await collectProgressRecord(document, { now });
  expect(result).toBe('ready');
  expect(query.mock.calls.map(call => [call[0].startDate, call[0].endDate])).toEqual([['2026-07-04','2026-07-31'],['2026-08-02','2026-08-29']]);
  expect(records.get('implementedSeoTips/tip')).toMatchObject({ preStats: { clicks: 10000 }, postStats: { clicks: 99999 }, progressAssessment: { state: 'ready', baseline: { clicks: 10 }, post: { clicks: 10 }, comparison: { clicksDelta: 0 }, automaticOutcome: null } });
});
it('tracks page-content edits using the same dated observations and returns their owner-entered summary', async () => {
  const pageChangeSummary = 'Added a section describing the design process and a link to contact us.';
  const document = await tip('content-edit', { changeType: 'page_content', pageChangeSummary,
    title: 'Observed title, not an edited tag', description: 'Observed description', userId: 'alice' });
  await tip('other-account', { userId: 'bob', changeType: 'page_content', pageChangeSummary: 'Private other-account edit' });
  await tip('archived-content', { preRevampArchived: true, changeType: 'page_content', pageChangeSummary: 'Old website edit' });
  expect(await collectProgressRecord(document, { now })).toBe('ready');
  const result = await readProgress('alice', now);
  expect(result.records).toHaveLength(1);
  expect(result.records[0]).toMatchObject({ id: 'content-edit', pageUrl, implementedAt: '2026-08-01', changeType: 'page_content', pageChangeSummary,
    assessment: { state: 'ready', comparison: { clicksDelta: 0 }, automaticOutcome: null } });
  expect(result.records[0]).not.toHaveProperty('title');
  expect(result.records[0]).not.toHaveProperty('description');
  expect(query.mock.calls.map(call => [call[0].startDate, call[0].endDate])).toEqual([['2026-07-04','2026-07-31'],['2026-08-02','2026-08-29']]);
});
it('retains dated successful observations but clears comparison when provider fetch fails', async () => {
  await collectProgressRecord(await tip(), { now });
  query.mockRejectedValue(new Error('temporarily_unavailable'));
  const document = await db.collection('implementedSeoTips').doc('tip').get();
  expect(await collectProgressRecord(document, { now: new Date('2026-10-11T16:00:00Z') })).toBe('error');
  expect(records.get('implementedSeoTips/tip').progressAssessment).toMatchObject({ state: 'error', reason: 'search_data_unavailable', comparison: null, baseline: { clicks: 10, fetchedAt: now.toISOString() }, post: { clicks: 10 } });
});
it('does not overwrite a newer implementation or website update during a slow request', async () => {
  const document = await tip();
  query.mockImplementationOnce(async () => {
    await db.collection('implementedSeoTips').doc('tip').update({ implementedAt: '2026-10-09' });
    return { rows: [] };
  });
  expect(await collectProgressRecord(document, { now })).toBe('superseded');
  expect(records.get('implementedSeoTips/tip')).not.toHaveProperty('progressAssessment');
});
it('reports historical expiry as unavailable, not a zero baseline', async () => {
  expect(await collectProgressRecord(await tip('tip', { implementedAt: '2024-01-01' }), { now })).toBe('insufficient_data');
  expect(records.get('implementedSeoTips/tip').progressAssessment.reason).toBe('baseline_outside_available_history');
  expect(query).not.toHaveBeenCalled();
});
it('retains earlier sourced observations when they later age outside Google history', async () => {
  await collectProgressRecord(await tip(), { now });
  const saved = records.get('implementedSeoTips/tip').progressAssessment.baseline;
  const document = await db.collection('implementedSeoTips').doc('tip').get();
  await collectProgressRecord(document, { now: new Date('2028-10-10T16:00:00Z') });
  const assessment = records.get('implementedSeoTips/tip').progressAssessment;
  expect(assessment).toMatchObject({ state: 'insufficient_data', reason: 'baseline_outside_available_history', comparison: null });
  expect(assessment.baseline).toEqual(saved);
});
it('bounds collection concurrency, deduplicates connections, and enforces manual refresh cooldown', async () => {
  for (let i = 0; i < 9; i++) await tip(`tip-${i}`);
  let active = 0, maximum = 0;
  query.mockImplementation(async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return { rows: [] }; });
  const result = await refreshUserProgress('alice', now);
  expect(result.checked).toBe(9);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(getGscConnection).toHaveBeenCalledTimes(1);
  await expect(refreshUserProgress('alice', now)).rejects.toMatchObject({ status: 429 });
});
it('never promotes legacy success data or sends notifications, and cron fails closed', async () => {
  await tip();
  const detection = await detect(request('/api/playbook/detect-success', { userId: 'alice' }));
  expect(await detection.json()).toMatchObject({ paused: true, strategiesSaved: 0 });
  delete process.env.CRON_SECRET;
  expect((await cron(request('/api/cron/check-success-stories', null, 'undefined', 'GET'))).status).toBe(401);
  const result = await runProgressCollection(now);
  expect(result).toMatchObject({ checked: 1, notificationsSent: 0, strategiesSaved: 0, automaticOutcomesEnabled: false });
});
it('makes playbook administration fail closed for ordinary users and forbids automatic promotion even to admins', async () => {
  expect((await config(request('/api/playbook/config', {}))).status).toBe(403);
  expect((await config(request('/api/playbook/config', { enabled: true }, 'admin'))).status).toBe(409);
  expect(records.has('appConfig/playbook_config')).toBe(false);
});
