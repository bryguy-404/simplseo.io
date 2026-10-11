import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), siteUrl: 'https://example.test/', scrape: vi.fn(), paid: vi.fn() }));
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { verifyIdToken: vi.fn(async token => {
    if (!['alice', 'bob'].includes(token)) throw new Error('invalid');
    return { uid: token };
  }) } };
});
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn(async () => ({ siteUrl: mocks.siteUrl, query: mocks.query })) }));
vi.mock('../app/lib/server/scrapeContent', () => ({ fetchCurrentPageContent: mocks.scrape }));
vi.mock('openai', () => ({ default: mocks.paid }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { POST } from '../app/api/page-review/activity/route';

const property = 'https://example.test/';
const pageUrl = `${property}Services/?Topic=Web&Area=SouthBend`;
const request = (body = {}, uid = 'alice') => new Request('https://app.test/api/page-review/activity', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid}` } : {}) },
  body: JSON.stringify({ pageUrl, ...body }),
});

beforeEach(async () => {
  reset(); mocks.siteUrl = property; mocks.query.mockReset().mockResolvedValue({ rows: [] }); mocks.scrape.mockReset(); mocks.paid.mockReset();
  getGscConnection.mockReset().mockImplementation(async () => ({ siteUrl: mocks.siteUrl, query: mocks.query }));
  delete process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST;
  await db.collection('users').doc('alice').set({ gscSiteUrl: property });
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: property, websiteUrl: property, revampRunId: 'current-site' });
});

describe('read-only page activity', () => {
  it('rejects anonymous, invalid and cross-account identity before Google access', async () => {
    expect((await POST(request({}, null))).status).toBe(401);
    expect((await POST(request({}, 'invalid'))).status).toBe(401);
    expect((await POST(request({ userId: 'bob' }))).status).toBe(403);
    expect(getGscConnection).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns and caches six dated windows without scraping, AI spending or changing business records', async () => {
    const before = [...records.entries()];
    const response = await POST(request({ currentPage: { htmlTitle: 'Forged metadata' }, property: 'https://untrusted.test/', websiteRunId: 'forged-run', includeResearch: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const result = await response.json();
    expect(result).toMatchObject({ success: true, provenance: { property, pageUrl, websiteRunId: 'current-site' }, evidence: { source: 'google_search_console', property, pageUrl, status: 'available' } });
    expect(result.evidence.history).toHaveLength(6);
    expect(result.evidence.facts.every(fact => fact.kind === 'search')).toBe(true);
    expect(result.evidence.history.every(period => period.totals === null && period.totalsStatus === 'no_data')).toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(8);
    expect(mocks.query.mock.calls.every(([body]) => body.dimensionFilterGroups[0].filters[0].expression === pageUrl)).toBe(true);
    expect(getGscConnection.mock.calls.every(([uid]) => uid === 'alice')).toBe(true);
    expect(mocks.scrape).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
    expect([...records.entries()].filter(([key]) => !key.startsWith('mentorActivitySnapshots/'))).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('Forged metadata');
  });

  it.each([
    ['https://outside.test/page', 403], ['https://name:secret@example.test/page', 400],
    [`${pageUrl}#part`, 400], ['invalid-url', 400], ['javascript:alert(1)', 403],
  ])('rejects invalid page scope %s before provider reads', async (url, status) => {
    expect((await POST(request({ pageUrl: url }))).status).toBe(status);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects a saved property that differs from the connection', async () => {
    mocks.siteUrl = 'https://another.test/';
    expect((await POST(request())).status).toBe(409);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects a missing website setup without returning unowned evidence', async () => {
    await db.collection('onboarding').doc('alice').delete();
    expect((await POST(request())).status).toBe(409);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects a run change during collection instead of returning stale history', async () => {
    mocks.query.mockImplementation(async () => {
      await db.collection('onboarding').doc('alice').update({ revampRunId: 'newer-site' });
      return { rows: [] };
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('details changed');
  });

  it('rejects a property change during collection', async () => {
    mocks.query.mockImplementation(async () => {
      mocks.siteUrl = 'https://new-property.test/';
      await db.collection('onboarding').doc('alice').update({ gscProperty: mocks.siteUrl });
      return { rows: [] };
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('details changed');
  });

  it('keeps failed Google reads distinct from empty data while preserving the read-only route', async () => {
    mocks.query.mockRejectedValue(new Error('private-provider-failure'));
    const result = await (await POST(request())).json();
    expect(result.success).toBe(true);
    expect(result.evidence.status).toBe('unavailable');
    expect(result.evidence.history.every(period => period.totalsStatus === 'unavailable' && period.totals === null)).toBe(true);
    expect(result.evidence.facts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('private-provider-failure');
    expect([...records.keys()].filter(key => !key.startsWith('mentorActivitySnapshots/'))).toEqual(['users/alice', 'onboarding/alice']);
  });
});
