import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => ({ ...(await import('./fakeFirestore')).fakeFirestore(), auth: {} }));
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
vi.mock('../app/lib/server/scrapeContent', () => ({ fetchCurrentPageContent: vi.fn() }));
vi.mock('../app/lib/server/stagedGsc', () => ({ readPendingGscSelection: vi.fn() }));
vi.mock('../app/lib/server/onboardingFirecrawl', () => ({ supplementOnboardingPage: vi.fn(async (_uid, _session, _scope, native) => native) }));
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { publicFetch } from '../app/lib/server/publicFetch';
import { fetchCurrentPageContent } from '../app/lib/server/scrapeContent';
import { readPendingGscSelection } from '../app/lib/server/stagedGsc';
import { readOnboardingInventory, continueOnboardingInventory, promoteOnboardingInventory } from '../app/lib/server/onboardingInventory';
import { readWorkSession, reserveOnboardingWork, finishOnboardingWork } from '../app/lib/server/onboardingWork';
const ref = () => db.collection('users').doc('u1').collection('onboardingSessions').doc('current');
const session = (changes = {}) => ({ id: 'current', createdAt: '2026-10-11T00:00:00.000Z', revision: 1, state: 'draft', mode: 'new',
  originalScope: { property: null, websiteUrl: null, websiteRunId: null }, websiteUrl: 'https://example.test/', google: { status: 'not_connected' }, ...changes });
const response = (text, status = 200) => new Response(text, { status, headers: { 'content-type': 'text/xml' } });
const options = (extra = {}) => ({ expectedRevision: 1, requestId: 'request-0001', ...extra });
const content = url => ({ url, finalUrl: url, fetchedAt: new Date().toISOString(), htmlTitle: 'Example plumbing', mainContent: 'Example plumbing offers drain repair in South Bend.',
  internalLinks: [], technical: { httpStatus: 200 }, structuredData: { items: [] } });
async function connect() {
  await ref().set(session({ revision: 2, google: { status: 'connected', pendingId: 'pending-1', property: 'https://example.test/' } }));
}
beforeEach(async () => {
  reset(); await db.collection('users').doc('u1').set({}); await db.collection('onboarding').doc('u1').set({ isComplete: false }); await ref().set(session());
  publicFetch.mockReset().mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404) : response('<urlset/>'));
  fetchCurrentPageContent.mockReset().mockImplementation(async url => content(url));
  readPendingGscSelection.mockReset().mockResolvedValue({ property: 'https://example.test/' });
});
describe('onboarding inventory isolation and bounded discovery', () => {
  it('allows saved GET before a URL exists without crawling', async () => {
    await ref().set(session({ websiteUrl: '' }));
    expect(await readOnboardingInventory('u1')).toBeNull(); expect(publicFetch).not.toHaveBeenCalled();
  });
  it('limits pre-Google review to five native pages while preserving unreviewed URLs', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404)
      : response(`<urlset>${Array.from({ length: 12 }, (_, index) => `<url><loc>https://example.test/page-${index}</loc></url>`).join('')}</urlset>`));
    const result = await continueOnboardingInventory('u1', options());
    expect(result.inventory.coverage).toMatchObject({ fetched: 5, pending: 8, truncated: true });
    expect(result.inventory.canContinue).toBe(false); expect(fetchCurrentPageContent).toHaveBeenCalledTimes(5);
    expect((await ref().get()).data().revision).toBe(1);
    const before = fetchCurrentPageContent.mock.calls.length; await readOnboardingInventory('u1'); expect(fetchCurrentPageContent).toHaveBeenCalledTimes(before);
  });
  it('requires private pending proof for full review, not a browser supplied connected flag', async () => {
    await connect(); readPendingGscSelection.mockRejectedValue(Object.assign(Error('Expired'), { status: 409 }));
    await expect(continueOnboardingInventory('u1', options({ expectedRevision: 2 }))).rejects.toMatchObject({ status: 409 });
    expect(publicFetch).not.toHaveBeenCalled();
  });
  it('reuses fresh preview HTML after Google selection while reviewing remaining pages', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404)
      : response('<urlset><url><loc>https://example.test/services</loc></url></urlset>'));
    await continueOnboardingInventory('u1', options()); expect(fetchCurrentPageContent).toHaveBeenCalledTimes(2);
    await connect();
    const result = await continueOnboardingInventory('u1', options({ expectedRevision: 2, requestId: 'request-0002' }));
    expect(result.inventory.coverage.fetched).toBe(2); expect(fetchCurrentPageContent).toHaveBeenCalledTimes(2);
    expect(result.inventory.pages[0].technical.httpStatus).toBe(200);
  });
  it('keeps failed and robot-blocked pages uncertain without provider fallback', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('User-agent: *\nDisallow: /private')
      : response('<urlset><url><loc>https://example.test/private</loc></url><url><loc>https://example.test/missing</loc></url></urlset>'));
    fetchCurrentPageContent.mockImplementation(async url => { if (url.endsWith('/missing')) throw Object.assign(Error('404'), { httpStatus: 404 }); return content(url); });
    const result = await continueOnboardingInventory('u1', options());
    expect(result.inventory.coverage).toMatchObject({ fetched: 1, failed: 1, excluded: 1 });
    expect(fetchCurrentPageContent.mock.calls.some(([url]) => url.endsWith('/private'))).toBe(false);
  });
  it.each(['delete', 'revision', 'property'])('rejects %s races and never recreates a deleted account', async action => {
    fetchCurrentPageContent.mockImplementation(async url => {
      if (action === 'delete') await db.collection('users').doc('u1').delete();
      if (action === 'revision') await ref().update({ revision: 2 });
      if (action === 'property') await db.collection('onboarding').doc('u1').update({ gscProperty: 'sc-domain:other.test' });
      return content(url);
    });
    await expect(continueOnboardingInventory('u1', options())).rejects.toMatchObject({ status: 409 });
    expect([...records.values()].some(value => value.status === 'fetched')).toBe(false);
  });
  it('keeps inventory readable across Google promotion and preserves an existing canonical inventory', async () => {
    await connect(); const result = await continueOnboardingInventory('u1', options({ expectedRevision: 2 }));
    await db.collection('users').doc('u1').set({ gscSiteUrl: 'https://example.test/', gscRefreshToken: 'test-token' });
    await db.collection('onboarding').doc('u1').set({ isComplete: true, gscProperty: 'https://example.test/', websiteUrl: 'https://example.test/' });
    await ref().set(session({ revision: 3, state: 'complete', mode: 'existing', originalScope: { property: 'https://example.test/', websiteUrl: 'https://example.test/', websiteRunId: null },
      google: { status: 'connected', property: 'https://example.test/' } }));
    expect((await readOnboardingInventory('u1')).id).toBe(result.inventory.id);
    expect(await promoteOnboardingInventory('u1')).toMatchObject({ promoted: true });
    expect(await promoteOnboardingInventory('u1')).toMatchObject({ promoted: false, reason: 'existing_inventory_preserved' });
    await expect(continueOnboardingInventory('u1', options({ expectedRevision: 3, requestId: 'request-0004', restart: true }))).resolves.toHaveProperty('inventory');
  });
});
describe('setup work reservations', () => {
  it('charges at most three starts daily and keeps continuations free', async () => {
    const current = await readWorkSession('u1');
    for (let index = 0; index < 3; index++) {
      const reservation = await reserveOnboardingWork('u1', current, { kind: 'inventory', requestId: `start-000${index}`, fingerprint: `f${index}` });
      await finishOnboardingWork('u1', current, reservation, { saved: true });
    }
    await expect(reserveOnboardingWork('u1', current, { kind: 'inventory', requestId: 'start-0004', fingerprint: 'f4' })).rejects.toMatchObject({ status: 429 });
    const free = await reserveOnboardingWork('u1', current, { kind: 'inventory', requestId: 'continue-004', fingerprint: 'f4', charge: false });
    await finishOnboardingWork('u1', current, free, { saved: true });
    expect([...records.values()].find(value => value.feature === 'onboarding' && value.kind === 'inventory').count).toBe(3);
  });
  it('deduplicates completed attempts, refuses conflicting IDs and reserves before side effects', async () => {
    const current = await readWorkSession('u1');
    const request = { kind: 'extraction', requestId: 'extract-0001', fingerprint: 'same' };
    const reservation = await reserveOnboardingWork('u1', current, request);
    await expect(reserveOnboardingWork('u1', current, { ...request, requestId: 'extract-0002' })).rejects.toMatchObject({ status: 429 });
    await finishOnboardingWork('u1', current, reservation, { saved: true });
    expect(await reserveOnboardingWork('u1', current, request)).toMatchObject({ duplicate: true });
    await expect(reserveOnboardingWork('u1', current, { ...request, fingerprint: 'different' })).rejects.toMatchObject({ status: 409 });
  });
});
