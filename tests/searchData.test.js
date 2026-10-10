import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { verifyIdToken: vi.fn(async token => { if (token !== 'alice') throw Error(); return { uid: token }; }) } };
});
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { POST as pageKeywords } from '../app/api/gsc/page-keywords/route';
import { POST as keywords } from '../app/api/gsc/fetch-keywords/route';
import { POST as refresh } from '../app/api/gsc/refresh-token/route';
import { POST as properties } from '../app/api/gsc/properties/route';
import { searchWindow, keywordRows } from '../app/lib/searchWindow';
const req = (body, token = 'alice') => new Request('http://localhost/api/gsc/test', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(async () => {
  reset();
  await db.collection('users').doc('alice').set({ gscAccessToken: 'own-access', gscRefreshToken: 'own-refresh', gscSiteUrl: 'https://example.test/', gscExpiresAt: Date.now() + 3600000 });
  await db.collection('onboarding').doc('alice').set({ gscProperty: 'https://example.test/' });
});
it('uses inclusive finalized Pacific periods, including a timezone boundary', () => {
  expect(searchWindow('28', new Date('2026-03-09T02:00:00Z'))).toEqual({ startDate: '2026-02-06', endDate: '2026-03-05' });
  expect(() => searchWindow('nonsense')).toThrow();
  expect(() => searchWindow('-2')).toThrow();
  const range = searchWindow('all');
  expect((Date.parse(range.endDate) - Date.parse(range.startDate)) / 86400000).toBe(364);
});
it('preserves exact query strings and reported positions rather than collapsing to best rank', () => {
  expect(keywordRows([{ keys: ['[Service]', '/Case'], clicks: 1, impressions: 10, position: 20.5 }, { keys: ['[service]', '/Case'], clicks: 0, impressions: 1, position: 2 }])).toMatchObject([{ keyword: '[Service]', position: 20.5, ctrRaw: 10 }, { keyword: '[service]', position: 2 }]);
});
it('all GSC compatibility APIs require Firebase authentication and reject another UID', async () => {
  for (const handler of [pageKeywords, keywords, refresh, properties]) {
    expect((await handler(req({}, null))).status).toBe(401);
    expect((await handler(req({ userId: 'bob' }))).status).toBe(403);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('page keywords ignore supplied credentials/property and use the exact owned page filter', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({ rows: [{ keys: ['Service'], impressions: 3, clicks: 0, ctr: 0, position: 24.5 }] })));
  const response = await pageKeywords(req({ pageUrl: 'https://example.test/Case?x=1', token: 'other-token', siteUrl: 'https://other.test/' }));
  expect(response.status).toBe(200);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain(encodeURIComponent('https://example.test/'));
  expect(options.headers.Authorization).toBe('Bearer own-access');
  expect(JSON.parse(options.body)).toMatchObject({ dataState: 'final', dimensionFilterGroups: [{ filters: [{ expression: 'https://example.test/Case?x=1', operator: 'equals' }] }] });
  expect(await response.json()).toMatchObject({ mayBeIncomplete: true, coverage: 'reported_queries', keywords: { otherKeywords: [{ keyword: 'Service', position: 24.5 }] } });
});
it('rejects a page outside the connected property before querying Google', async () => {
  expect((await pageKeywords(req({ pageUrl: 'https://other.test/' }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it('distinguishes successful missing rows from a Google service failure', async () => {
  fetch.mockResolvedValueOnce(new Response('{}'));
  expect(await (await pageKeywords(req({ pageUrl: 'https://example.test/' }))).json()).toMatchObject({ success: true, keywords: { topPerformers: [], otherKeywords: [] } });
  fetch.mockResolvedValueOnce(new Response('{}', { status: 503 }));
  expect((await pageKeywords(req({ pageUrl: 'https://example.test/' }))).status).toBe(503);
});
it('refresh selects stored refresh credentials, never a request token', async () => {
  records.get('users/alice').gscExpiresAt = 1;
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-own-access', expires_in: 3600 })));
  const response = await refresh(req({ refreshToken: 'attacker-controlled' }));
  expect(response.status).toBe(200);
  expect(fetch.mock.calls[0][1].body.get('refresh_token')).toBe('own-refresh');
  expect(await response.json()).toMatchObject({ access_token: 'new-own-access', siteUrl: 'https://example.test/' });
  expect(records.get('users/alice').gscRefreshToken).toBe('own-refresh');
});
