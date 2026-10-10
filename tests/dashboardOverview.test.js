import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', () => ({
  auth: { verifyIdToken: vi.fn(async token => { if (token !== 'alice') throw new Error('invalid'); return { uid: 'alice' }; }) },
}));
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn() }));

import { getGscConnection } from '../app/lib/server/gscConnection';
import { RequestError } from '../app/lib/server/requestAuth';
import { buildDashboardOverview, dashboardQueryPlans } from '../app/lib/dashboardOverview';
import { GET } from '../app/api/dashboard/overview/route';

const property = 'https://example.test/';
const pageUrl = `${property}Case/?Key=A`;
const window = { startDate: '2026-09-10', endDate: '2026-10-07' };
const fetchedAt = '2026-10-10T16:00:00.000Z';
const metrics = { clicks: 2, impressions: 20, ctr: 0.1, position: 8.25 };
const input = () => ({
  property, window, fetchedAt,
  totalsResult: { rows: [{ clicks: 30, impressions: 500, ctr: 0.06, position: 6.9 }] },
  dailyResult: { rows: [{ keys: ['2026-09-10'], ...metrics }] },
  pagesResult: { rows: [{ keys: [pageUrl], ...metrics }] },
});
const request = (query = '', token = 'alice') => new Request(`https://app.test/api/dashboard/overview${query}`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
let query;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(fetchedAt));
  const values = input();
  query = vi.fn(async body => body.dimensions?.[0] === 'page' ? values.pagesResult : body.dimensions?.[0] === 'date' ? values.dailyResult : values.totalsResult);
  getGscConnection.mockReset().mockResolvedValue({ siteUrl: property, query });
});
afterEach(() => { vi.useRealTimers(); });

describe('dashboard overview access and provenance', () => {
  it('rejects absent, invalid and cross-account identity before obtaining a connection', async () => {
    expect((await GET(request('', null))).status).toBe(401);
    expect((await GET(request('', 'invalid'))).status).toBe(401);
    expect((await GET(request('?userId=bob'))).status).toBe(403);
    expect(getGscConnection).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the verified account property and rejects a different supplied property before Google work', async () => {
    expect((await GET(request('?property=https://other.test/'))).status).toBe(403);
    expect((await GET(request('?siteUrl=https://other.test/'))).status).toBe(403);
    expect(getGscConnection).toHaveBeenCalledWith('alice');
    expect(query).not.toHaveBeenCalled();
  });

  it('makes only three bounded final-data requests for one server-selected period', async () => {
    const response = await GET(request('?startDate=2000-01-01&endDate=2099-01-01&token=client-secret'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(query.mock.calls.map(call => call[0])).toEqual(dashboardQueryPlans(window));
    expect(query).toHaveBeenCalledTimes(3);
    const result = await response.json();
    expect(result).toMatchObject({ source: 'google_search_console', property, window, fetchedAt, dataState: 'final', searchType: 'web' });
    expect(JSON.stringify(result)).not.toContain('client-secret');
    expect(result.totals).toEqual(input().totalsResult.rows[0]);
    expect(result.pages).toEqual([{ pageUrl, ...metrics }]);
    expect(result.totals.clicks).not.toBe(result.pages.reduce((sum, page) => sum + page.clicks, 0));
    expect(query.mock.calls.some(([body]) => body.dimensions?.includes('query'))).toBe(false);
    expect(result.coverage).toMatchObject({ pages: { limit: 100, returned: 1, complete: false }, isIndexingReport: false });
  });

  it('preserves exact Google calendar dates and URL case/query strings', async () => {
    const result = await (await GET(request())).json();
    expect(result.daily[0].date).toBe('2026-09-10');
    expect(result.pages[0].pageUrl).toBe(pageUrl);
    expect(result.pages[0].position).toBe(8.25);
  });

  it('returns the connection failure rather than a successful empty chart', async () => {
    getGscConnection.mockRejectedValue(new RequestError('reconnect_required', 409));
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'reconnect_required' });
    expect(query).not.toHaveBeenCalled();
  });

  it('fails the whole overview if one provider request fails', async () => {
    query.mockImplementation(async body => {
      if (body.dimensions?.[0] === 'date') throw new RequestError('temporarily_unavailable', 503);
      return { rows: [] };
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'temporarily_unavailable' });
  });

  it('does not turn invalid provider totals into a success response', async () => {
    query.mockResolvedValue({ rows: [{ clicks: '20', impressions: 25, ctr: 0.8, position: 3 }] });
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty('totals');
  });
});

describe('pure overview validation', () => {
  it('treats genuine empty Google rows as zero counts with unknown rates and preserves absent dates', () => {
    const result = buildDashboardOverview({ ...input(), totalsResult: {}, dailyResult: {}, pagesResult: { rows: [] } });
    expect(result.totals).toEqual({ clicks: 0, impressions: 0, ctr: null, position: null });
    expect(result.daily).toEqual([]);
    expect(result.pages).toEqual([]);
    expect(result.coverage.daily.omitsDaysWithoutData).toBe(true);
  });

  it.each([null, [], { rows: null }, { error: { code: 500 } }, { rows: [metrics, metrics] }, { rows: [{ ...metrics, position: Infinity }] }, { rows: [{ ...metrics, clicks: 21 }] }])('rejects malformed aggregate data %#', totalsResult => {
    expect(() => buildDashboardOverview({ ...input(), totalsResult })).toThrow('Invalid Search Console');
  });

  it.each(['2026-09-09', '2026-10-08', '2026-09-31', '9/10/2026'])('rejects invalid/out-of-window provider date %s', date => {
    expect(() => buildDashboardOverview({ ...input(), dailyResult: { rows: [{ keys: [date], ...metrics }] } })).toThrow('Invalid Search Console');
  });

  it('rejects duplicate dates and pages instead of adding them together', () => {
    const values = input();
    expect(() => buildDashboardOverview({ ...values, dailyResult: { rows: [...values.dailyResult.rows, ...values.dailyResult.rows] } })).toThrow();
    expect(() => buildDashboardOverview({ ...values, pagesResult: { rows: [...values.pagesResult.rows, ...values.pagesResult.rows] } })).toThrow();
  });

  it('rejects malformed rows, excessive result counts and pages outside the stored property', () => {
    for (const row of [{ ...metrics }, { keys: ['https://other.test/'], ...metrics }, { keys: [pageUrl, 'extra'], ...metrics }, { keys: [pageUrl], ...metrics, ctr: -0.1 }]) {
      expect(() => buildDashboardOverview({ ...input(), pagesResult: { rows: [row] } })).toThrow();
    }
    expect(() => buildDashboardOverview({ ...input(), pagesResult: { rows: Array(101).fill({ keys: [pageUrl], ...metrics }) } })).toThrow();
  });

  it('keeps provider totals separate from incomplete page and date samples', () => {
    const result = buildDashboardOverview(input());
    expect(result.totals).toEqual(input().totalsResult.rows[0]);
    expect(result.coverage.pages.complete).toBe(false);
    expect(result.daily).toHaveLength(1);
  });
});
