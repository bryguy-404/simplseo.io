import { beforeEach, describe, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore'); const fake = fakeFirestore();
  return { ...fake, auth: { verifyIdToken: vi.fn(async token => { if (!['alice','bob'].includes(token)) throw Error(); return { uid: token }; }) } };
});
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { POST as complete } from '../app/api/revamp/complete/route';
import { POST as archive } from '../app/api/revamp/archive/route';
import { GET as history } from '../app/api/revamp/history/route';
import { monitorRevamp } from '../app/lib/server/revampMonitor';
import { getGscConnection } from '../app/lib/server/gscConnection';
const request = (body, uid = 'alice', path = 'complete') => new Request(`http://localhost/api/revamp/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const json = value => new Response(JSON.stringify(value), { status: 200 });
beforeEach(async () => {
  reset();
  for (const uid of ['alice','bob']) {
    await db.collection('onboarding').doc(uid).set({ isComplete: true, revampStatus: 'in-progress', revampRunId: 'run-one', revampDate: '2025-01-01', revampPages: [{ url: 'https://example.test/Case?x=1' }], gscProperty: 'sc-domain:example.test' });
    await db.collection('focusKeywords').doc(uid).set({ userId: uid, preRevampArchived: true, keywords: [{ keyword: 'old', pageUrl: 'https://example.test/old' }] });
    await db.collection('implementedSeoTips').doc(`${uid}_tip`).set({ userId: uid, title: 'Original', gscToken: 'secret', preRevampArchived: true });
  }
});
describe('recovery API and history', () => {
  it('completes with no tokens or keywords, preserves archived selections, and is repeatable', async () => {
    expect((await complete(request({ keywords: [] }))).status).toBe(200);
    expect((await complete(request({ keywords: [] }))).status).toBe(200);
    expect(records.get('onboarding/alice')).toMatchObject({ revampStatus: 'complete', revampMonitoringEnabled: true, progressReviewRequired: true });
    expect(records.get('focusKeywords/alice')).toMatchObject({ preRevampArchived: true, keywords: [{ keyword: 'old', pageUrl: 'https://example.test/old' }] });
    expect(records.get('users/alice/revampHistory/run-one/records/implementedSeoTips_alice_tip').data).not.toHaveProperty('gscToken');
    expect(records.get('onboarding/bob').revampStatus).toBe('in-progress');
  });
  it('rejects cross-user writes and incomplete onboarding', async () => {
    expect((await complete(request({ userId: 'bob' }))).status).toBe(403);
    await db.collection('onboarding').doc('alice').update({ isComplete: false });
    expect((await complete(request({}))).status).toBe(409);
  });
  it('keeps sourced collection enabled when saving an already reviewed website setup', async () => {
    await complete(request({}));
    await db.collection('onboarding').doc('alice').update({ progressReviewRequired: false });
    const response = await complete(request({ keywords: [{ keyword: 'current page', pageUrl: 'https://example.test/new' }] }));
    expect(response.status).toBe(200);
    expect(records.get('onboarding/alice').progressReviewRequired).toBe(false);
    await archive(request({ revampDate: '2026-01-01' }));
    expect(records.get('onboarding/alice').progressReviewRequired).toBe(true);
  });
  it('preserves immutable history before replacing current keywords', async () => {
    await complete(request({ keywords: [{ keyword: 'new', pageUrl: 'https://example.test/new' }] }));
    expect(records.get('focusKeywords/alice').preRevampArchived).toBe(false);
    expect(records.get('users/alice/revampHistory/run-one/records/focusKeywords_alice').data.keywords[0].keyword).toBe('old');
    records.set('implementedSeoTips/alice_tip', { userId: 'alice', title: 'Changed' });
    await complete(request({}));
    expect(records.get('users/alice/revampHistory/run-one/records/implementedSeoTips_alice_tip').data.title).toBe('Original');
  });
  it('new website updates reset the run and retain prior history', async () => {
    await complete(request({}));
    const response = await archive(request({ revampDate: '2026-01-01' }));
    expect(response.status).toBe(200);
    expect(records.get('onboarding/alice').revampRunId).not.toBe('run-one');
    expect(records.get('onboarding/alice').revampPages).toEqual([]);
    expect(records.get('users/alice/revampHistory/run-one').complete).toBe(true);
  });
  it('history cannot be read with another user ID', async () => {
    const r = await history(new Request('http://localhost/api/revamp/history?userId=bob', { headers: { Authorization: 'Bearer alice' } }));
    expect(r.status).toBe(403);
  });
  it('failed persistence does not report completion', async () => {
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('offline'));
    expect((await complete(request({}))).status).toBe(500);
    expect(records.get('onboarding/alice').revampStatus).toBe('in-progress');
  });
});
it('resumes an interrupted snapshot without changing records already preserved', async () => {
  const transaction = db.runTransaction;
  let calls = 0;
  const spy = vi.spyOn(db, 'runTransaction').mockImplementation(async fn => {
    if (++calls === 2) throw new Error('Interrupted snapshot');
    return transaction(fn);
  });
  expect((await complete(request({}))).status).toBe(500);
  expect(records.get('users/alice/revampHistory/run-one').complete).toBe(false);
  spy.mockRestore();
  await db.collection('implementedSeoTips').doc('alice_tip').update({ title: 'Later change' });
  expect((await complete(request({}))).status).toBe(200);
  expect(records.get('users/alice/revampHistory/run-one/records/implementedSeoTips_alice_tip').data.title).toBe('Original');
  expect(records.get('users/alice/revampHistory/run-one').complete).toBe(true);
});
describe('Google monitoring', () => {
  beforeEach(async () => { await db.collection('users').doc('alice').set({ gscAccessToken: 'access', gscRefreshToken: 'refresh', gscSiteUrl: 'sc-domain:example.test', gscExpiresAt: Date.now() + 3600000 }); });
  it('queries the exact page, accepts one impression and works after setup completion', async () => {
    await db.collection('onboarding').doc('alice').update({ revampStatus: 'complete' });
    fetch.mockResolvedValue(json({ rows: [{ impressions: 1, clicks: 0 }] }));
    const result = await monitorRevamp('alice');
    expect(result.pages[0].searchDataStatus).toBe('has_data');
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.dimensionFilterGroups[0].filters[0].expression).toBe('https://example.test/Case?x=1');
  });
  it('preserves successful data when Google fails, rather than recording zero', async () => {
    await db.collection('onboarding').doc('alice').update({ revampPages: [{ url: 'https://example.test/a', searchDataStatus: 'has_data', impressions: 9, lastSuccessAt: 'earlier' }] });
    fetch.mockResolvedValue(new Response('{}', { status: 503 }));
    const result = await monitorRevamp('alice');
    expect(result.pages[0]).toMatchObject({ impressions: 9, lastSuccessAt: 'earlier', lastError: 'temporarily_unavailable' });
  });
  it('records a successful empty response as no_data', async () => {
    fetch.mockResolvedValue(json({}));
    expect((await monitorRevamp('alice')).pages[0].searchDataStatus).toBe('no_data');
  });
  it('does not overwrite another run', async () => {
    fetch.mockImplementation(async () => { await db.collection('onboarding').doc('alice').update({ revampRunId: 'new-run', revampPages: [] }); return json({ rows: [] }); });
    await expect(monitorRevamp('alice')).rejects.toMatchObject({ status: 409 });
    expect(records.get('onboarding/alice').revampPages).toEqual([]);
  });
  it('refreshes expired tokens while preserving an omitted refresh token', async () => {
    await db.collection('users').doc('alice').update({ gscExpiresAt: 1 });
    fetch.mockResolvedValueOnce(json({ access_token: 'new-access', expires_in: 3600 })).mockResolvedValueOnce(json({ rows: [] }));
    await monitorRevamp('alice');
    expect(records.get('users/alice').gscRefreshToken).toBe('refresh');
    expect(records.get('users/alice').gscAccessToken).toBe('new-access');
  });
  it('retains credentials on refresh failure and identifies revoked grants', async () => {
    await db.collection('users').doc('alice').update({ gscExpiresAt: 1 });
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    expect((await monitorRevamp('alice')).connectionStatus).toBe('reconnect_required');
    expect(records.get('users/alice').gscRefreshToken).toBe('refresh');
  });
  it('rejects a mismatched primary property instead of combining token stores', async () => {
    await db.collection('users').doc('alice').update({ gscSiteUrl: 'sc-domain:other.test' });
    await expect(getGscConnection('alice')).rejects.toMatchObject({ status: 409 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a matching legacy refresh credential when the primary connection is incomplete', async () => {
    await db.collection('users').doc('alice').update({ gscRefreshToken: null, gscExpiresAt: 1 });
    await db.collection('gscTokens').doc('alice').set({ refreshToken: 'legacy-refresh', siteUrl: 'sc-domain:example.test' });
    fetch.mockResolvedValueOnce(json({ access_token: 'renewed' })).mockResolvedValueOnce(json({ rows: [] }));
    await monitorRevamp('alice');
    expect(records.get('users/alice').gscRefreshToken).toBe('legacy-refresh');
  });
  it('retries an authorization failure once', async () => {
    fetch.mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(json({ access_token: 'renewed' })).mockResolvedValueOnce(json({ rows: [{ impressions: 9 }] }));
    expect((await monitorRevamp('alice')).pages[0].impressions).toBe(9);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('isolates a failed page and bounds concurrency to four', async () => {
    await db.collection('onboarding').doc('alice').update({ revampPages: Array.from({length: 12}, (_, i) => ({ url: `https://example.test/${i}` })) });
    let active = 0, peak = 0;
    fetch.mockImplementation(async (_url, options) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 3)); active--;
      const page = JSON.parse(options.body).dimensionFilterGroups[0].filters[0].expression;
      return page.endsWith('/0') ? new Response('{}', { status: 503 }) : json({ rows: [{ impressions: 2 }] });
    });
    const result = await monitorRevamp('alice');
    expect(peak).toBe(4);
    expect(result.pages.filter(p => p.searchDataStatus === 'has_data')).toHaveLength(11);
    expect(result.pages[0].lastError).toBe('temporarily_unavailable');
  });

});
