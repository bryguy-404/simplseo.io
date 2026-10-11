import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => ({ ...(await import('./fakeFirestore')).fakeFirestore(), auth: {} }));
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { firecrawlEnabled, supplementOnboardingPage } from '../app/lib/server/onboardingFirecrawl';
import { onboardingHash } from '../app/lib/server/onboardingWork';
const session = { id: 'current', revision: 1, state: 'draft', mode: 'new', originalScope: { property: null, websiteUrl: null, websiteRunId: null },
  websiteUrl: 'https://example.test/', google: { status: 'connected', property: 'https://example.test/', pendingId: 'pending' } };
const scope = { userId: 'u1', sessionKey: 'current', websiteUrl: 'https://example.test/', property: 'https://example.test/', websiteRunId: null, preview: false };
const native = { url: scope.websiteUrl, finalUrl: scope.websiteUrl, htmlTitle: 'Example', mainContent: '', h1: '', technical: { httpStatus: 200, noindex: false }, source: 'website-html' };
const options = () => ({ inventoryId: 'inventory1', generation: 'g1', robotsStatus: 'reviewed', deadline: Date.now() + 40000 });
const body = (extra = {}) => ({ success: true, data: { html: '<main><h1>Example Plumbing</h1><p>Example Plumbing provides drain cleaning and pipe repair in South Bend, Indiana. We help homeowners maintain working plumbing and respond to service enquiries.</p></main>', metadata: { statusCode: 200, sourceURL: scope.websiteUrl }, ...extra } });
const renderedResponse = payload => new Response(JSON.stringify(payload), { status: 200 });
const render = (page = native, opts = options()) => supplementOnboardingPage('u1', session, scope, page, opts);
beforeEach(async () => {
  reset(); await db.collection('users').doc('u1').set({}); await db.collection('onboarding').doc('u1').set({ isComplete: false });
  await db.collection('users').doc('u1').collection('onboardingSessions').doc('current').set(session);
  vi.stubEnv('ONBOARDING_FIRECRAWL_ENABLED', 'true'); vi.stubEnv('ONBOARDING_FIRECRAWL_EVALUATION_PASSED', 'true'); vi.stubEnv('FIRECRAWL_API_KEY', 'private-test-key');
  vi.stubGlobal('fetch', vi.fn(async () => renderedResponse(body())));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('rendered onboarding fallback boundaries', () => {
  it.each(['ONBOARDING_FIRECRAWL_ENABLED', 'ONBOARDING_FIRECRAWL_EVALUATION_PASSED', 'FIRECRAWL_API_KEY'])('requires %s before making any provider request', async key => {
    vi.stubEnv(key, ''); expect(firecrawlEnabled()).toBe(false); expect(await render()).toEqual(native); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 410, 500])('never renders native HTTP %s failures', async status => {
    await render({ ...native, technical: { httpStatus: status } }); expect(fetch).not.toHaveBeenCalled();
  });
  it('never renders when robots review is unavailable, a preview is running or native HTML is sufficient', async () => {
    await render(native, { ...options(), robotsStatus: 'unavailable' });
    await supplementOnboardingPage('u1', session, { ...scope, preview: true }, native, options());
    await render({ ...native, mainContent: 'Useful business content '.repeat(20) }); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps rendered content separately sourced and never replaces native technical evidence', async () => {
    const result = await render();
    expect(result.technical).toEqual(native.technical); expect(result.mainContent).toBe('');
    expect(result.renderedSupplement).toMatchObject({ status: 'available', source: 'provider_rendered_html', cache: 'fresh' });
    const [url, request] = fetch.mock.calls[0], settings = JSON.parse(request.body);
    expect(url).toBe('https://api.firecrawl.dev/v2/scrape');
    expect(settings).toMatchObject({ formats: ['html'], parsers: [], proxy: 'basic', maxAge: 0, storeInCache: false, skipTlsVerification: false });
    expect(settings).not.toHaveProperty('actions'); expect(settings).not.toHaveProperty('headers');
    const ledger = [...records.entries()].find(([path]) => path.startsWith('onboardingUsageEvents/'))[1];
    expect(ledger).toMatchObject({ outcome: 'completed', usageStatus: 'unknown', creditsUsed: null });
    expect(JSON.stringify(ledger)).not.toContain('private-test-key'); expect(JSON.stringify(ledger)).not.toContain('Example Plumbing');
  });
  it('reuses seven-day cache without another provider attempt or allowance and refreshes after expiry', async () => {
    await render(); const reused = await render(); expect(reused.renderedSupplement.cache).toBe('reused'); expect(fetch).toHaveBeenCalledTimes(1);
    const [path] = [...records.entries()].find(([path]) => path.startsWith('onboardingCrawlCache/'));
    records.get(path).expiresAt = '2000-01-01T00:00:00Z'; await render(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['http://127.0.0.1/private', 'https://other.test/', 'https://example.test/other'])('rejects provider redirects to %s', async url => {
    fetch.mockResolvedValue(renderedResponse(body({ metadata: { statusCode: 200, sourceURL: url } })));
    expect((await render()).renderedSupplement.status).toBe('unavailable');
    expect([...records.keys()].some(path => path.startsWith('onboardingCrawlCache/'))).toBe(false);
  });
  it.each(['inventory', 'daily', 'monthly', 'concurrency'])('reserves %s allowance before calling the provider', async kind => {
    const id = kind === 'inventory' ? onboardingHash(['render_inventory', 'inventory1', 'g1'])
      : kind === 'daily' ? onboardingHash(['render_day', 'u1', Math.floor(Date.now() / 86400000)])
      : kind === 'monthly' ? onboardingHash(['render_month', new Date().toISOString().slice(0, 7)]) : 'onboarding-render-concurrency';
    await db.collection('requestLimits').doc(id).set(kind === 'concurrency' ? { leases: [{ attempt: 'a', until: new Date(Date.now() + 30000).toISOString() }, { attempt: 'b', until: new Date(Date.now() + 30000).toISOString() }] }
      : { count: kind === 'inventory' ? 10 : kind === 'daily' ? 20 : 500 });
    expect((await render()).renderedSupplement.reason).toBe('allowance_or_concurrency'); expect(fetch).not.toHaveBeenCalled();
  });
  it('cannot persist provider output or recreate records after account deletion', async () => {
    fetch.mockImplementation(async () => {
      await db.collection('users').doc('u1').delete();
      for (const path of [...records.keys()]) if (path.startsWith('onboardingUsageEvents/')) records.delete(path);
      return renderedResponse(body());
    });
    expect((await render()).renderedSupplement.status).toBe('unavailable');
    expect([...records.keys()].some(path => path.startsWith('onboardingCrawlCache/') || path.startsWith('onboardingUsageEvents/'))).toBe(false);
  });
});
