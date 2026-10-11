import { beforeEach, describe, expect, it, vi } from 'vitest';

const scopeState = vi.hoisted(() => ({ current: null }));
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: {} };
});
vi.mock('../app/lib/server/newPageScope', () => ({
  readNewPageScope: vi.fn(async () => {
    if (!scopeState.current) throw Object.assign(new Error('Account deleted.'), { status: 404 });
    return structuredClone(scopeState.current);
  }),
  assertSameNewPageScope: (expected, actual) => {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw Object.assign(new Error('Scope changed.'), { status: 409 });
  },
  newPageScopeKey: scope => `${scope.userId}-${scope.websiteRunId}`,
}));
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
vi.mock('../app/lib/server/scrapeContent', () => ({ fetchCurrentPageContent: vi.fn() }));
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn() }));

import { records, db, reset } from '../app/lib/firebaseAdmin';
import { publicFetch } from '../app/lib/server/publicFetch';
import { fetchCurrentPageContent } from '../app/lib/server/scrapeContent';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { readNewPageInventory, continueNewPageInventory, parseInventorySitemap, updateNewPageRetirements } from '../app/lib/server/newPageInventory';
import { uncertainCoveragePages } from '../app/lib/newPagePolicy';

const scope = { userId: 'u1', property: 'https://example.test/', websiteRunId: 'v1', websiteUrl: 'https://example.test/', businessName: 'Example', businessLocation: 'South Bend' };
const root = 'newPageInventories/u1-v1';
const xml = urls => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url.replaceAll('&', '&amp;')}</loc></url>`).join('')}</urlset>`;
const indexXml = urls => `<sitemapindex>${urls.map(url => `<sitemap><loc>${url}</loc></sitemap>`).join('')}</sitemapindex>`;
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'application/xml', ...headers } });
const content = (url, links = []) => ({ url, finalUrl: url, fetchedAt: new Date().toISOString(), htmlTitle: `Title ${url}`, h1: 'Service', mainContent: 'Real business content', internalLinks: links.map(url => ({ url, text: 'Service' })), structureCoverage: {} });
const fail = (status = 502) => Object.assign(new Error('private provider failure'), { status });
let query;

beforeEach(() => {
  reset(); scopeState.current = structuredClone(scope);
  publicFetch.mockReset().mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404) : response(xml([])));
  fetchCurrentPageContent.mockReset().mockImplementation(async url => content(url));
  query = vi.fn().mockResolvedValue({ rows: [] });
  getGscConnection.mockReset().mockResolvedValue({ siteUrl: scope.property, query });
});

describe('owner-confirmed removed URLs', () => {
  const missingUrl = `${scope.websiteUrl}services/retired-service`;
  const anotherUrl = `${scope.websiteUrl}services/another-retired-service`;
  const missing = code => Object.assign(fail(), { httpStatus: code });
  const recordsOfRemoval = () => [...records.entries()].filter(([path]) => path.startsWith(`${root}/retirements/`)).map(([, value]) => value);
  async function seedMissing(urls = [missingUrl], status = 404) {
    await db.collection('onboarding').doc('u1').set({ revampPages: urls });
    fetchCurrentPageContent.mockImplementation(async url => {
      if (urls.includes(url)) throw missing(status);
      return content(url);
    });
    const inventory = await continueNewPageInventory('u1');
    publicFetch.mockImplementation(async url => urls.includes(url) ? response('', status)
      : url.endsWith('robots.txt') ? response('', 404) : response(xml([])));
    return inventory;
  }
  const retire = inventory => updateNewPageRetirements('u1', { urls: [missingUrl], inventoryRevision: inventory.revision, confirmed: true, action: 'retire' });

  it.each([404, 410])('requires a fresh direct HTTP %s and keeps a persistent owner declaration without inventing indexing', async status => {
    const inventory = await seedMissing([missingUrl], status);
    const saved = await retire(inventory);
    expect(saved.revision).toBe(inventory.revision + 1);
    expect(saved.coverage).toMatchObject({ fetched: 1, failed: 0, retired: 1 });
    expect(saved.pages.find(page => page.url === missingUrl)).toMatchObject({ status: 'retired', reason: 'owner_confirmed_removed',
      retirementProof: { ownerConfirmedAt: expect.any(String), verifiedAt: expect.any(String), httpStatus: status } });
    expect(recordsOfRemoval()).toHaveLength(1);
    expect(recordsOfRemoval()[0]).toMatchObject({ active: true, scope, url: missingUrl, httpStatus: status, revision: 1 });
    expect(publicFetch).toHaveBeenLastCalledWith(missingUrl, expect.objectContaining({ allowedHostname: 'example.test', property: scope.property, deadline: expect.any(Number) }));
    expect(JSON.stringify(recordsOfRemoval()[0])).not.toContain('index');
  });
  it('requires explicit confirmation, exact stored URLs, and the current inventory revision', async () => {
    const inventory = await seedMissing();
    publicFetch.mockClear();
    for (const patch of [{ confirmed: false }, { inventoryRevision: inventory.revision - 1 }, { urls: [`${missingUrl}/`] },
      { urls: ['https://other.test/services/retired-service'] }, { urls: [scope.websiteUrl] }, { urls: [missingUrl, missingUrl] }]) {
      await expect(updateNewPageRetirements('u1', { urls: [missingUrl], inventoryRevision: inventory.revision, confirmed: true, action: 'retire', ...patch })).rejects.toBeTruthy();
    }
    expect(publicFetch).not.toHaveBeenCalled(); expect(recordsOfRemoval()).toHaveLength(0);
    expect((await readNewPageInventory('u1')).revision).toBe(inventory.revision);
  });
  it.each(['live', 'server-error', 'redirect', 'network'])('does not retire a URL when its fresh check is %s', async kind => {
    const inventory = await seedMissing();
    publicFetch.mockImplementation(async () => {
      if (kind === 'network') throw fail();
      const result = response('', kind === 'live' ? 200 : kind === 'server-error' ? 500 : 404);
      if (kind === 'redirect') Object.defineProperty(result, 'redirectChain', { value: [{ url: missingUrl, destination: `${scope.websiteUrl}moved`, status: 301 }] });
      return result;
    });
    await expect(retire(inventory)).rejects.toMatchObject({ status: 409 });
    expect(recordsOfRemoval()).toHaveLength(0);
    expect((await readNewPageInventory('u1')).pages.find(page => page.url === missingUrl)).toMatchObject({ status: 'failed', reason: 'http_404' });
    expect(records.get(root).leaseUntil).toBeNull();
  });
  it('keeps a multi-URL confirmation atomic when one URL fails verification', async () => {
    const inventory = await seedMissing([missingUrl, anotherUrl]);
    publicFetch.mockImplementation(async url => response('', url === missingUrl ? 404 : 500));
    await expect(updateNewPageRetirements('u1', { urls: [missingUrl, anotherUrl], inventoryRevision: inventory.revision, confirmed: true, action: 'retire' })).rejects.toMatchObject({ status: 409 });
    expect(recordsOfRemoval()).toHaveLength(0);
    expect((await readNewPageInventory('u1')).coverage).toMatchObject({ failed: 2, retired: 0 });
  });
  it('restores a removed URL as pending and retains declaration history', async () => {
    const saved = await retire(await seedMissing());
    const proof = recordsOfRemoval()[0]; publicFetch.mockClear();
    const restored = await updateNewPageRetirements('u1', { urls: [missingUrl], inventoryRevision: saved.revision, confirmed: true, action: 'restore' });
    expect(restored.canContinue).toBe(true);
    expect(restored.pages.find(page => page.url === missingUrl)).toMatchObject({ status: 'pending', reason: null });
    expect(recordsOfRemoval()[0]).toMatchObject({ active: false, ownerConfirmedAt: proof.ownerConfirmedAt, verifiedAt: proof.verifiedAt, restoredAt: expect.any(String), revision: 2 });
    expect(publicFetch).not.toHaveBeenCalled();
    const checked = await continueNewPageInventory('u1');
    expect(checked.pages.find(page => page.url === missingUrl)).toMatchObject({ status: 'failed', reason: 'http_404' });
  });
  it.each(['missing', 'live', 'server-error', 'redirect'])('rechecks saved removals after restart when the URL is %s', async kind => {
    await retire(await seedMissing());
    fetchCurrentPageContent.mockImplementation(async url => {
      if (url !== missingUrl || kind === 'live') return content(url);
      throw missing(kind === 'server-error' ? 500 : 404);
    });
    if (kind === 'redirect') publicFetch.mockImplementation(async url => {
      if (url !== missingUrl) return url.endsWith('robots.txt') ? response('', 404) : response(xml([]));
      const result = response('', 404);
      Object.defineProperty(result, 'redirectChain', { value: [{ url, destination: `${scope.websiteUrl}other`, status: 301 }] });
      return result;
    });
    const checked = await continueNewPageInventory('u1', { restart: true });
    expect(checked.pages.find(page => page.url === missingUrl).status).toBe(kind === 'missing' ? 'retired' : kind === 'live' ? 'fetched' : 'failed');
    expect(recordsOfRemoval()[0].active).toBe(kind !== 'live');
  });
  it('keeps removed URLs discoverable after old website and Google seeds disappear', async () => {
    await retire(await seedMissing());
    await db.collection('onboarding').doc('u1').set({ revampPages: [] });
    const checked = await continueNewPageInventory('u1', { restart: true });
    expect(checked.pages.find(page => page.url === missingUrl)).toMatchObject({ status: 'retired', sources: ['owner_removal_record'] });
  });
  it('requires a new confirmation after a removed URL becomes live and then fails again', async () => {
    await retire(await seedMissing());
    fetchCurrentPageContent.mockImplementation(async url => content(url));
    await continueNewPageInventory('u1', { restart: true });
    expect(recordsOfRemoval()[0]).toMatchObject({ active: false, reactivatedAt: expect.any(String) });
    fetchCurrentPageContent.mockImplementation(async url => { if (url === missingUrl) throw missing(404); return content(url); });
    const checked = await continueNewPageInventory('u1', { restart: true });
    expect(checked.pages.find(page => page.url === missingUrl)).toMatchObject({ status: 'failed', reason: 'http_404' });
  });
  it('verifies at most three URLs concurrently and respects the shared deadline', async () => {
    const urls = Array.from({ length: 8 }, (_, index) => `${scope.websiteUrl}old-${index}`);
    const inventory = await seedMissing(urls);
    let active = 0, maximum = 0;
    publicFetch.mockImplementation(async (_url, options) => {
      expect(options.deadline).toBeGreaterThan(Date.now());
      active += 1; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active -= 1;
      return response('', 404);
    });
    await updateNewPageRetirements('u1', { urls, inventoryRevision: inventory.revision, confirmed: true, action: 'retire' });
    expect(maximum).toBe(3);
  });
  it('abandons an expired recheck without creating declarations', async () => {
    const inventory = await seedMissing(); let clock = Date.now();
    const date = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      publicFetch.mockImplementation(async () => { clock += 41000; return response('', 404); });
      await expect(retire(inventory)).rejects.toMatchObject({ status: 409 });
      expect(recordsOfRemoval()).toHaveLength(0);
    } finally { date.mockRestore(); }
  });
  it.each(['scope', 'deletion', 'revision', 'lease'])('does not save removal after in-flight %s changes', async change => {
    const inventory = await seedMissing();
    publicFetch.mockImplementation(async () => {
      if (change === 'scope') scopeState.current.property = 'https://new.test/';
      if (change === 'deletion') { scopeState.current = null; records.clear(); }
      if (change === 'revision') records.get(root).revision += 1;
      if (change === 'lease') records.get(root).attempt = 'another-attempt';
      return response('', 404);
    });
    await expect(retire(inventory)).rejects.toBeTruthy();
    expect(recordsOfRemoval()).toHaveLength(0);
    if (change === 'deletion') expect(records.size).toBe(0);
  });
  it('rejects an overlapping review lease before checking URLs', async () => {
    const inventory = await seedMissing();
    records.get(root).leaseUntil = new Date(Date.now() + 60000).toISOString(); publicFetch.mockClear();
    await expect(retire(inventory)).rejects.toMatchObject({ status: 409 });
    expect(publicFetch).not.toHaveBeenCalled();
  });
  it('does not apply a prior website version’s removal declarations', async () => {
    await retire(await seedMissing()); scopeState.current.websiteRunId = 'v2';
    const checked = await continueNewPageInventory('u1');
    expect(checked.pages.find(page => page.url === missingUrl)).toMatchObject({ status: 'failed', reason: 'http_404' });
    expect(recordsOfRemoval()[0].active).toBe(true);
  });
  it('counts rechecked removed URLs toward the 100-page HTML cap', async () => {
    const urls = Array.from({ length: 110 }, (_, index) => `${scope.websiteUrl}removed-${index}`);
    await seedMissing(urls);
    // These server-owned declarations emulate earlier explicit confirmations.
    for (const [index, url] of urls.entries()) await db.collection('newPageInventories').doc('u1-v1').collection('retirements').doc(`prior-${index}`).set({ scope, url, active: true, ownerConfirmedAt: new Date().toISOString() });
    fetchCurrentPageContent.mockClear();
    const checked = await continueNewPageInventory('u1', { restart: true });
    expect(fetchCurrentPageContent).toHaveBeenCalledTimes(100);
    expect(checked).toMatchObject({ canContinue: false, coverage: { fetched: 1, retired: 99, pending: 11, truncated: true } });
  });
});

describe('strict sitemap input', () => {
  it('parses namespaced indexes and XML-escaped URLs without confusing image locs for pages', () => {
    expect(parseInventorySitemap('<sm:sitemapindex xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:sitemap><sm:loc>https://example.test/map.xml</sm:loc></sm:sitemap></sm:sitemapindex>')).toEqual({ kind: 'sitemaps', urls: ['https://example.test/map.xml'], invalid: 0 });
    expect(parseInventorySitemap('<urlset><url><loc>https://example.test/?a=1&amp;b=2</loc><image:image><image:loc>https://example.test/pic.jpg</image:loc></image:image></url></urlset>')).toEqual({ kind: 'pages', urls: ['https://example.test/?a=1&b=2'], invalid: 0 });
  });
  it.each(['<urlset><url></urlset>', '<html><body>Not a sitemap</body></html>', '<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset/>', '<urlset/><sitemapindex/>'])('rejects malformed or unsupported XML: %s', value => {
    expect(() => parseInventorySitemap(value)).toThrow();
  });
  it('records malformed loc entries instead of assuming a valid complete sitemap', () => {
    expect(parseInventorySitemap('<urlset><url><loc>/relative</loc></url><url><loc><nested/></loc></url><url><loc>https://example.test/good</loc></url></urlset>')).toEqual({ kind: 'pages', urls: ['https://example.test/good'], invalid: 2 });
  });
});

describe('evidence-based website discovery', () => {
  it('combines actual HTML, nested sitemaps, robots, stored URLs and Google without requiring search data', async () => {
    await db.collection('onboarding').doc('u1').set({ revampPages: [{ url: 'https://example.test/known-unindexed' }] });
    await db.collection('siteCrawls').doc('u1').set({ websiteRunId: 'v1', manualUrls: ['https://example.test/legacy'] });
    publicFetch.mockImplementation(async url => {
      if (url.endsWith('robots.txt')) return response('User-agent: *\nSitemap: https://example.test/extra.xml', 200, { 'content-type': 'text/plain' });
      if (url.endsWith('sitemap.xml')) return response(indexXml(['https://example.test/child.xml']));
      return response(xml([url.endsWith('extra.xml') ? 'https://example.test/extra' : 'https://example.test/no-search-data']));
    });
    query.mockResolvedValue({ rows: [{ keys: ['https://example.test/from-google'] }] });
    fetchCurrentPageContent.mockImplementation(async url => content(url, url === scope.websiteUrl ? ['https://example.test/linked'] : []));
    const result = await continueNewPageInventory('u1');
    expect(result.pages.map(page => page.url)).toEqual([scope.websiteUrl, 'https://example.test/extra', 'https://example.test/from-google', 'https://example.test/known-unindexed', 'https://example.test/legacy', 'https://example.test/linked', 'https://example.test/no-search-data']);
    expect(result).toMatchObject({ status: 'ready', canContinue: false, coverage: { fetched: 7, failed: 0, pending: 0, googleStatus: 'observed_pages', sitemapsChecked: 3 } });
    expect(result.pages.find(page => page.url.endsWith('no-search-data'))).toMatchObject({ status: 'fetched', sources: ['sitemap'] });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ dimensions: ['page'], rowLimit: 500, dataState: 'final' }));
    expect(fetchCurrentPageContent.mock.calls[0][1]).toMatchObject({ property: scope.property, allowedHostname: 'example.test', deadline: expect.any(Number) });
  });
  it('deduplicates cyclic sitemap indexes and hash-only page variations', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404)
      : url.endsWith('sitemap.xml') ? response(indexXml(['https://example.test/child.xml', 'https://example.test/sitemap.xml']))
        : response(xml(['https://example.test/service#first', 'https://example.test/service#second'])));
    const result = await continueNewPageInventory('u1');
    expect(result.coverage.sitemapsChecked).toBe(2);
    expect(result.coverage.fetched).toBe(2);
    expect(publicFetch.mock.calls.filter(([url]) => url.endsWith('sitemap.xml'))).toHaveLength(1);
  });
  it.each([undefined, 'earlier-version'])('does not seed stale legacy crawl %s into a rebuilt website inventory', async websiteRunId => {
    await db.collection('siteCrawls').doc('u1').set({ ...(websiteRunId ? { websiteRunId } : {}), approvedUrls: ['https://example.test/retired-service'] });
    await db.collection('onboarding').doc('u1').set({ revampPages: [{ url: 'https://example.test/current-service' }] });
    const result = await continueNewPageInventory('u1');
    expect(result.pages.map(page => page.url)).toEqual([scope.websiteUrl, 'https://example.test/current-service']);
    expect(records.get('siteCrawls/u1').approvedUrls).toEqual(['https://example.test/retired-service']);
  });
  it('can use unversioned legacy URL hints before any website rebuild', async () => {
    scopeState.current.websiteRunId = null;
    await db.collection('siteCrawls').doc('u1').set({ approvedUrls: ['https://example.test/known-service'] });
    expect((await continueNewPageInventory('u1')).pages.map(page => page.url)).toEqual([scope.websiteUrl, 'https://example.test/known-service']);
  });
  it('never follows discovered off-property or other-host URLs, even on a domain property', async () => {
    scopeState.current.property = 'sc-domain:example.test';
    getGscConnection.mockResolvedValue({ siteUrl: 'sc-domain:example.test', query });
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404) : response(xml(['https://other.example.test/page', 'https://other.test/page', 'https://user:secret@example.test/private', 'https://example.test:8080/no', 'https://example.test/okay'])));
    expect((await continueNewPageInventory('u1')).pages.map(page => page.url)).toEqual([scope.websiteUrl, 'https://example.test/okay']);
    expect(fetchCurrentPageContent).toHaveBeenCalledTimes(2);
  });
  it('preserves unreadable pages and unsupported sitemaps as incomplete coverage, not gaps', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404) : response('<urlset><url></urlset>'));
    fetchCurrentPageContent.mockRejectedValue(fail());
    getGscConnection.mockRejectedValue(fail());
    const result = await continueNewPageInventory('u1');
    expect(result).toMatchObject({ status: 'unavailable', canContinue: false, coverage: { failed: 1, fetched: 0, googleStatus: 'unavailable' } });
    expect(result.pages[0]).toMatchObject({ status: 'failed', reason: 'unreadable' });
    expect(result.coverage.sitemaps[0].status).toBe('unsupported');
    expect(JSON.stringify(result)).not.toContain('private provider failure');
    expect(result.coverage.limitations.join(' ')).toContain('not proof');
  });
  it('excludes non-HTML resources and respects matching robots disallow with specific allow', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('User-agent: *\nDisallow: /private\nAllow: /private/public', 200, { 'content-type': 'text/plain' })
      : response(xml(['https://example.test/private', 'https://example.test/private/public', 'https://example.test/brochure.pdf', 'https://example.test/data'])));
    fetchCurrentPageContent.mockImplementation(async url => { if (url.endsWith('/data')) throw fail(422); return content(url); });
    const result = await continueNewPageInventory('u1');
    expect(result.coverage).toMatchObject({ fetched: 2, excluded: 3 });
    expect(result.pages.find(page => page.url.endsWith('/private')).reason).toBe('robots_disallowed');
    expect(result.pages.find(page => page.url.endsWith('/brochure.pdf')).reason).toBe('non_html_resource');
    expect(result.pages.find(page => page.url.endsWith('/data')).reason).toBe('non_html_response');
    expect(fetchCurrentPageContent.mock.calls.map(([url]) => url)).not.toContain('https://example.test/private');
  });
  it('reports compressed sitemaps as unsupported without pretending to discover their pages', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('Sitemap: https://example.test/more.xml.gz', 200, { 'content-type': 'text/plain' }) : response(xml([])));
    const result = await continueNewPageInventory('u1');
    expect(result.coverage.sitemaps.find(item => item.url.endsWith('.gz')).status).toBe('unsupported');
    expect(publicFetch.mock.calls.some(([url]) => url.endsWith('.gz'))).toBe(false);
    expect(result.status).toBe('partial');
  });
  it('excludes installer and archive downloads without fetching them or creating coverage gaps', async () => {
    const downloads = ['Captura.dmg', 'PinMemories.DMG?download=1', 'setup.pkg', 'setup.exe', 'setup.msi', 'setup.msix',
      'setup.appx', 'mobile.apk', 'mobile.aab', 'package.deb', 'package.rpm', 'backup.tar', 'backup.tgz',
      'backup.bz2', 'backup.tbz2', 'backup.xz', 'backup.txz', 'backup.zst', 'backup.7z', 'backup.rar',
      'disk.iso', 'disk.img', 'firmware.bin', 'package.jar', 'package.war'].map(file => `${scope.websiteUrl}downloads/${file}`);
    fetchCurrentPageContent.mockImplementation(async url => content(url, downloads));
    const result = await continueNewPageInventory('u1');
    expect(result).toMatchObject({ status: 'ready', canContinue: false, coverage: { fetched: 1, failed: 0, excluded: downloads.length } });
    expect(result.pages.filter(page => downloads.includes(page.url)).every(page => page.status === 'excluded' && page.reason === 'non_html_resource')).toBe(true);
    expect(fetchCurrentPageContent.mock.calls.map(([url]) => url)).toEqual([scope.websiteUrl]);
    expect(publicFetch.mock.calls.some(([url]) => downloads.includes(url))).toBe(false);
    expect(uncertainCoveragePages(result)).toEqual([]);
  });
  it('keeps missing service pages uncertain alongside excluded downloads', async () => {
    const missing = `${scope.websiteUrl}services/seo`;
    fetchCurrentPageContent.mockImplementation(async url => {
      if (url === missing) throw fail(404);
      return content(url, [missing, `${scope.websiteUrl}downloads/Captura.dmg`]);
    });
    const result = await continueNewPageInventory('u1');
    expect(result).toMatchObject({ status: 'partial', coverage: { fetched: 1, failed: 1, excluded: 1 } });
    expect(uncertainCoveragePages(result).map(page => page.url)).toEqual([missing]);
  });
});

describe('bounds, state and races', () => {
  it('caps sitemap documents, discovered URLs and reviewed HTML independently', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404)
      : url.endsWith('sitemap.xml') ? response(indexXml(Array.from({ length: 25 }, (_, i) => `https://example.test/map-${i}.xml`)))
        : response(xml(Array.from({ length: 510 }, (_, i) => `https://example.test/service-${i}`))));
    const result = await continueNewPageInventory('u1');
    expect(result).toMatchObject({ status: 'partial', canContinue: false, coverage: { discovered: 500, fetched: 100, pending: 400, truncated: true, sitemapsChecked: 20 } });
    expect(fetchCurrentPageContent).toHaveBeenCalledTimes(100);
    expect([...records.keys()].filter(key => key.startsWith(`${root}/pages/`))).toHaveLength(500);
    expect(records.get(root)).not.toHaveProperty('pages');
    expect(JSON.stringify(records.get(root)).length).toBeLessThan(30000);
  });
  it('fetches at most three HTML pages concurrently', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404) : response(xml(Array.from({ length: 8 }, (_, i) => `https://example.test/${i}`))));
    let active = 0, maximum = 0;
    fetchCurrentPageContent.mockImplementation(async url => { active += 1; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active -= 1; return content(url); });
    await continueNewPageInventory('u1');
    expect(maximum).toBe(3);
  });
  it('leaves a cancelled batch resumable and reads saved inventory without external calls', async () => {
    const controller = new AbortController();
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404) : response(xml(['https://example.test/service'])));
    fetchCurrentPageContent.mockImplementation(async url => { controller.abort(); return content(url, ['https://example.test/next']); });
    const first = await continueNewPageInventory('u1', { signal: controller.signal });
    expect(first.canContinue).toBe(true);
    expect(first.coverage.pending).toBe(1);
    expect(records.get(root).leaseUntil).toBeNull();
    publicFetch.mockClear(); fetchCurrentPageContent.mockClear(); getGscConnection.mockClear();
    expect((await readNewPageInventory('u1')).coverage).toEqual(first.coverage);
    expect(publicFetch).not.toHaveBeenCalled(); expect(fetchCurrentPageContent).not.toHaveBeenCalled(); expect(getGscConnection).not.toHaveBeenCalled();
    fetchCurrentPageContent.mockImplementation(async url => content(url));
    const next = await continueNewPageInventory('u1');
    expect(next).toMatchObject({ canContinue: false, coverage: { fetched: 3, pending: 0 } });
  });
  it('keeps timed-out URLs pending for continuation instead of claiming a website failure', async () => {
    let clock = Date.now(); const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      fetchCurrentPageContent.mockImplementation(async () => { clock += 41000; throw fail(504); });
      const result = await continueNewPageInventory('u1');
      expect(result).toMatchObject({ canContinue: true, coverage: { pending: 1, failed: 0 } });
    } finally { spy.mockRestore(); }
  });
  it('rejects overlapping scans without fetching and releases only the owning lease', async () => {
    await continueNewPageInventory('u1');
    records.set(root, { ...records.get(root), leaseUntil: new Date(Date.now() + 60000).toISOString(), attempt: 'other' });
    publicFetch.mockClear(); fetchCurrentPageContent.mockClear();
    await expect(continueNewPageInventory('u1')).rejects.toMatchObject({ status: 429 });
    expect(publicFetch).not.toHaveBeenCalled(); expect(fetchCurrentPageContent).not.toHaveBeenCalled();
    expect(records.get(root).attempt).toBe('other');
  });
  it('refuses to save fetched evidence after the selected property changes', async () => {
    fetchCurrentPageContent.mockImplementation(async url => { scopeState.current.property = 'https://new.test/'; return content(url); });
    await expect(continueNewPageInventory('u1')).rejects.toMatchObject({ status: 409 });
    expect([...records.values()].some(value => value.status === 'fetched')).toBe(false);
    expect(records.get(root).leaseUntil).toBeNull();
  });
  it('does not recreate deleted account inventory when an in-flight page finishes', async () => {
    fetchCurrentPageContent.mockImplementation(async url => { scopeState.current = null; records.clear(); return content(url); });
    await expect(continueNewPageInventory('u1')).rejects.toMatchObject({ status: 404 });
    expect(records.size).toBe(0);
  });
  it('isolates website versions and restarts generation without serving old page content', async () => {
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404) : response(xml(['https://example.test/old-service'])));
    const first = await continueNewPageInventory('u1');
    publicFetch.mockImplementation(async url => url.endsWith('robots.txt') ? response('', 404) : response(xml(['https://example.test/new-service'])));
    const restarted = await continueNewPageInventory('u1', { restart: true });
    expect(restarted.revision).toBeGreaterThan(first.revision);
    expect(restarted.pages.map(page => page.url)).toEqual([scope.websiteUrl, 'https://example.test/new-service']);
    scopeState.current.websiteRunId = 'v2';
    expect(await readNewPageInventory('u1')).toBeNull();
    expect(records.has(root)).toBe(true);
  });
});
