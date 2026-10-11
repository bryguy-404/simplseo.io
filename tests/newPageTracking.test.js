import { beforeEach, afterEach, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  const fake = fakeFirestore(); const original = fake.db.collection;
  const collection = (name, filters = [], order = null, maximum = Infinity) => ({
    ...original(name),
    where: (field, op, value) => collection(name, [...filters, [field, op, value]], order, maximum),
    orderBy: field => collection(name, filters, field, maximum),
    limit: count => collection(name, filters, order, count),
    get: async () => {
      let docs = (await original(name).get()).docs.filter(doc => filters.every(([field, op, value]) => op === '<=' ? doc.data()[field] <= value : doc.data()[field] === value));
      if (order) docs.sort((a, b) => a.data()[order].localeCompare(b.data()[order]) || a.id.localeCompare(b.id));
      docs = docs.slice(0, maximum); return { docs, size: docs.length, empty: !docs.length };
    },
  });
  fake.db.collection = collection; return { ...fake, auth: {} };
});
vi.mock('../app/lib/server/newPageScope', async () => {
  const { db } = await import('../app/lib/firebaseAdmin');
  const { RequestError } = await import('../app/lib/server/requestAuth');
  return {
    readNewPageScope: async (userId, { tx } = {}) => {
      const get = ref => tx ? tx.get(ref) : ref.get();
      const [account, setup] = await Promise.all([get(db.collection('users').doc(userId)), get(db.collection('onboarding').doc(userId))]);
      if (!account.exists || !setup.exists) throw new RequestError('Account unavailable.', 404);
      return { userId, property: setup.data().gscProperty, websiteRunId: setup.data().revampRunId || null, websiteUrl: setup.data().websiteUrl };
    },
    assertSameNewPageScope: (expected, actual) => {
      if (['userId', 'property', 'websiteUrl'].some(key => expected[key] !== actual[key]) || (expected.websiteRunId || null) !== (actual.websiteRunId || null)) throw new RequestError('Website changed.', 409);
    },
    newPageScopeKey: scope => `${scope.userId}|${scope.property}|${scope.websiteRunId}|${scope.websiteUrl}`,
  };
});
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn() }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { publicFetch } from '../app/lib/server/publicFetch';
import { getGscConnection } from '../app/lib/server/gscConnection';
import { confirmNewPagePublication, readNewPageTracking, refreshNewPageTracking, runNewPageCollection, newPageObservationWindows } from '../app/lib/server/newPageTracking';

const scope = { userId: 'alice', property: 'https://example.test/', websiteUrl: 'https://example.test/', websiteRunId: 'run' };
const pageUrl = 'https://example.test/plumbing-mishawaka';
const now = new Date('2026-10-10T18:00:00Z');
const query = vi.fn(), inspect = vi.fn();
const html = (url = pageUrl, extra = '') => {
  const response = new Response(`<html><head><title>Plumbing in Mishawaka</title>${extra}</head><body><h1>Plumbing repairs in Mishawaka</h1><p>Reliable plumbing repairs and water heater maintenance for homes in Mishawaka. Ask our team for an appointment to discuss your plumbing project.</p></body></html>`, { headers: { 'content-type': 'text/html' } });
  Object.defineProperty(response, 'url', { value: url }); return response;
};
const plan = (id = 'plan') => ({ ...scope, id, revision: 1, status: 'draft', idea: { topic: 'plumbing repairs mishawaka', service: 'plumbing repairs' }, draft: { h1: 'Plumbing repairs in Mishawaka', slug: '/plumbing-mishawaka' } });
async function publish(id = 'plan') { return confirmNewPagePublication('alice', { planId: id, revision: 1, pageUrl, confirmed: true }); }
async function storedPublication(overrides = {}, id = 'publication') {
  const publication = { ...scope, id, planId: id, pageUrl: `${pageUrl}/${id}`, ownerDeclaredAt: '2026-09-01T12:00:00Z', verifiedAt: '2026-09-01T12:00:00Z',
    trackingEnabled: true, nextCheckAt: '2026-10-01T12:00:00Z', indexing: null, activity: null, preexistingActivity: null, ...overrides };
  await db.collection('newPagePlans').doc(id).set({ ...plan(id), status: 'published', publicationId: id });
  await db.collection('newPagePublications').doc(id).set(publication); return publication;
}
beforeEach(async () => {
  reset(); vi.useFakeTimers(); vi.setSystemTime(now);
  publicFetch.mockReset().mockImplementation(async () => html());
  query.mockReset().mockResolvedValue({ rows: [{ clicks: 2, impressions: 10, ctr: .2, position: 7.5 }] });
  inspect.mockReset().mockResolvedValue({ inspectionResult: { inspectionResultLink: 'https://search.google.com/search-console/inspect?x=1', indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } } });
  getGscConnection.mockReset().mockResolvedValue({ siteUrl: scope.property, query, inspect });
  await db.collection('users').doc('alice').set({});
  await db.collection('onboarding').doc('alice').set({ gscProperty: scope.property, websiteUrl: scope.websiteUrl, revampRunId: scope.websiteRunId });
  await db.collection('newPagePlans').doc('plan').set(plan());
});
afterEach(() => vi.useRealTimers());

it('requires actual owner confirmation, a draft, current revision and account scope before fetching', async () => {
  await expect(confirmNewPagePublication('alice', { planId: 'plan', revision: 1, pageUrl })).rejects.toThrow('Confirm');
  await expect(confirmNewPagePublication('alice', { planId: 'plan', revision: 2, pageUrl, confirmed: true })).rejects.toMatchObject({ status: 409 });
  records.get('newPagePlans/plan').userId = 'bob';
  await expect(publish()).rejects.toMatchObject({ status: 404 });
  expect(publicFetch).not.toHaveBeenCalled();
});
it.each(['https://other.test/service', 'https://sub.example.test/service', 'https://user:pass@example.test/service', 'http://127.0.0.1/a', `${pageUrl}#part`])('rejects an unsafe or out-of-website publication URL %s', async url => {
  await expect(confirmNewPagePublication('alice', { planId: 'plan', revision: 1, pageUrl: url, confirmed: true })).rejects.toMatchObject({ status: 403 });
  expect(publicFetch).not.toHaveBeenCalled();
});
it('checks public HTML and saves separate owner declaration and verification without invoking Google', async () => {
  const result = await publish();
  expect(result.plan).toMatchObject({ status: 'published', revision: 2 });
  expect(result.publication).toMatchObject({ pageUrl, ownerDeclaredAt: now.toISOString(), verifiedAt: now.toISOString(), indexing: null, activity: null });
  expect(publicFetch).toHaveBeenCalledWith(pageUrl, expect.objectContaining({ property: scope.property, allowedHostname: 'example.test', deadline: now.getTime() + 25000 }));
  expect(getGscConnection).not.toHaveBeenCalled();
  expect([...records.keys()].some(key => key.startsWith('implementedSeoTips/'))).toBe(false);
});
it.each([404, 500])('retains a draft when public verification returns %s', async status => {
  publicFetch.mockResolvedValue(new Response('', { status }));
  await expect(publish()).rejects.toMatchObject({ status: 409 });
  expect(records.get('newPagePlans/plan')).toEqual(plan());
});
it('rejects a file, unrelated page, homepage and soft404 rather than starting tracking', async () => {
  publicFetch.mockResolvedValueOnce(new Response('PDF', { headers: { 'content-type': 'application/pdf' } }));
  await expect(publish()).rejects.toThrow('HTML');
  publicFetch.mockResolvedValueOnce(new Response('<html><title>Login</title><body>Enter your username and password to continue.</body></html>', { headers: { 'content-type': 'text/html' } }));
  await expect(publish()).rejects.toThrow('match');
  publicFetch.mockResolvedValueOnce(html(scope.websiteUrl));
  await expect(confirmNewPagePublication('alice', { planId: 'plan', revision: 1, pageUrl: scope.websiteUrl, confirmed: true })).rejects.toThrow('match');
});
it('requires a redirect confirmation and never follows an off-host destination at the service boundary', async () => {
  const destination = `${pageUrl}-final`;
  publicFetch.mockImplementation(async () => html(destination));
  await expect(publish()).rejects.toMatchObject({ status: 409, code: 'confirm_redirect', destination });
  expect(records.get('newPagePlans/plan').status).toBe('draft');
  await expect(confirmNewPagePublication('alice', { planId: 'plan', revision: 1, pageUrl, confirmed: true, confirmRedirect: true })).rejects.toMatchObject({ code: 'confirm_redirect', destination });
  expect((await confirmNewPagePublication('alice', { planId: 'plan', revision: 1, pageUrl, confirmed: true, confirmRedirect: true, confirmedRedirectUrl: destination })).publication.pageUrl).toBe(destination);
});
it('requires a new confirmation if the redirect destination changes after the owner reviewed it', async () => {
  const reviewedDestination = `${pageUrl}-reviewed`, changedDestination = `${pageUrl}-changed`;
  publicFetch.mockResolvedValueOnce(html(reviewedDestination)).mockImplementation(async () => html(changedDestination));
  await expect(publish()).rejects.toMatchObject({ code: 'confirm_redirect', destination: reviewedDestination });
  await expect(confirmNewPagePublication('alice', { planId: 'plan', revision: 1, pageUrl, confirmed: true, confirmRedirect: true, confirmedRedirectUrl: reviewedDestination }))
    .rejects.toMatchObject({ status: 409, code: 'confirm_redirect', destination: changedDestination });
  expect(records.get('newPagePlans/plan').status).toBe('draft');
  expect([...records.keys()].some(key => key.startsWith('newPagePublications/'))).toBe(false);
});
it('records noindex and another canonical as concerns independent of live publication', async () => {
  publicFetch.mockImplementation(async () => html(pageUrl, '<meta name="robots" content="noindex"><link rel="canonical" href="/other">'));
  const result = await publish();
  expect(result.publication.publicPage.warnings).toHaveLength(2);
  expect(result.plan.status).toBe('published'); expect(result.publication.indexing).toBeNull();
});
it.each(['delete', 'property', 'revision'])('rejects a %s race while verification is in flight', async change => {
  publicFetch.mockImplementation(async () => {
    if (change === 'delete') { records.delete('users/alice'); records.delete('onboarding/alice'); }
    else if (change === 'property') records.get('onboarding/alice').gscProperty = 'https://other.test/';
    else records.get('newPagePlans/plan').revision++;
    return html();
  });
  await expect(publish()).rejects.toMatchObject({ status: expect.any(Number) });
  expect([...records.keys()].some(key => key.startsWith('newPagePublications/'))).toBe(false);
});
it('prevents two plans from claiming the same URL and preserves a stable publication ID', async () => {
  const result = await publish();
  await db.collection('newPagePlans').doc('second').set(plan('second'));
  await expect(publish('second')).rejects.toThrow('already tracked');
  const reread = await confirmNewPagePublication('alice', { planId: 'plan', revision: 2, pageUrl, confirmed: true });
  expect(reread.publication.id).toBe(result.publication.id);
});
it('reads stored state without crawling or Google refresh and shares the manual/background cache', async () => {
  await storedPublication();
  await readNewPageTracking('alice', 'publication');
  expect(getGscConnection).not.toHaveBeenCalled(); expect(publicFetch).not.toHaveBeenCalled();
  await refreshNewPageTracking('alice', 'publication', { now });
  expect((await refreshNewPageTracking('alice', 'publication', { now })).state).toBe('skipped');
  expect(getGscConnection).toHaveBeenCalledTimes(1);
  expect((await runNewPageCollection({ now })).checked).toBe(0);
});
it('uses exact-page, dated observations and reports earlier activity without declaring a new-page success', async () => {
  const publication = await storedPublication();
  const result = await refreshNewPageTracking('alice', publication.planId, { now });
  expect(query).toHaveBeenCalledTimes(3);
  for (const [body] of query.mock.calls) expect(body).toMatchObject({ type: 'web', dataState: 'final', dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: publication.pageUrl }] }] });
  expect(result.tracking.activity.rolling).toMatchObject({ startDate: '2026-09-10', endDate: '2026-10-07', clicks: 2, impressions: 10, position: 7.5 });
  expect(result.tracking.activity.sinceVerified).toMatchObject({ startDate: '2026-09-02', endDate: '2026-10-07' });
  expect(result.tracking.preexistingActivity.clicks).toBe(2);
  expect(result.tracking.reviewDue).toBe('28_day_review');
  expect(result.tracking.indexing.inspectionUrl).toContain('search.google.com');
  expect(JSON.stringify(result)).not.toMatch(/success_score|ranking_improvement/);
});
it('excludes the verification day and unsettled three days from since-verification reporting', async () => {
  expect(newPageObservationWindows('2026-10-10T01:00:00Z', now)).toMatchObject({ sinceVerified: null, prior: { endDate: '2026-10-08' } });
  await storedPublication({ verifiedAt: now.toISOString() });
  const result = await refreshNewPageTracking('alice', 'publication', { now });
  expect(result.tracking.activity.sinceVerified.status).toBe('collecting');
  expect(query).toHaveBeenCalledTimes(2);
});
it('preserves successful observations independently when Google inspection or analytics fails', async () => {
  await storedPublication({ indexing: { status: 'available', fetchedAt: 'old-index' }, activity: { rolling: { clicks: 15, fetchedAt: 'old-analytics' } } });
  inspect.mockRejectedValue(new Error('private google payload'));
  query.mockRejectedValueOnce(new Error('private google payload'));
  const result = await refreshNewPageTracking('alice', 'publication', { now });
  expect(result.tracking.indexing.fetchedAt).toBe('old-index');
  expect(result.tracking.activity.rolling.clicks).toBe(15);
  expect(result.tracking.activity.sinceVerified.clicks).toBe(2);
  expect(result.tracking.lastError).toEqual({ indexing: 'temporarily_unavailable', rolling: 'temporarily_unavailable' });
  expect(JSON.stringify(result)).not.toContain('private google payload');
});
it('preserves all observations on reconnect and never writes after scope changes during Google work', async () => {
  await storedPublication({ activity: { rolling: { clicks: 3 } } });
  getGscConnection.mockRejectedValueOnce(new Error('reconnect_required'));
  const result = await refreshNewPageTracking('alice', 'publication', { now });
  expect(result.state).toBe('reconnect_required'); expect(result.tracking.activity.rolling.clicks).toBe(3);
  records.get('newPagePublications/publication').nextCheckAt = now.toISOString();
  records.get('newPagePublications/publication').lastAttemptAt = null;
  query.mockImplementation(async () => { records.delete('users/alice'); return {}; });
  await expect(refreshNewPageTracking('alice', 'publication', { now })).rejects.toMatchObject({ status: 404 });
  expect(records.has('users/alice')).toBe(false);
  expect(records.get('newPagePublications/publication').activity.rolling.clicks).toBe(3);
});
it('checks daily through90days then weekly and offers review reminders without locks', async () => {
  await storedPublication({ verifiedAt: '2026-01-01T12:00:00Z' });
  const result = await refreshNewPageTracking('alice', 'publication', { now });
  expect(result.tracking.nextCheckAt).toBe('2026-10-17T18:00:00.000Z');
  expect(result.tracking.reviewDue).toBe('84_day_review');
  expect(records.get('newPagePlans/publication').status).toBe('published');
  const tomorrow = new Date(now.getTime() + 86400000);
  expect((await refreshNewPageTracking('alice', 'publication', { now: tomorrow })).state).toBe('usable');
});
it('caps a collection at20pages, with two page workflows at once and oldest-due fairness', async () => {
  for (let i = 0; i < 23; i++) await storedPublication({}, `publication-${String(i).padStart(2, '0')}`);
  let active = 0, peak = 0;
  inspect.mockImplementation(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); await Promise.resolve(); active--; return { inspectionResult: { indexStatusResult: { verdict: 'PASS' } } }; });
  const result = await runNewPageCollection({ now });
  expect(result).toMatchObject({ checked: 20, moreRecords: true, notificationsSent: 0, counts: { usable: 20 } });
  expect(peak).toBeLessThanOrEqual(2);
  const next = await runNewPageCollection({ now: new Date(now.getTime() + 300000) });
  expect(next).toMatchObject({ checked: 3, moreRecords: false });
});
it('has a separate overlap lease and stops safely at its shared deadline', async () => {
  await storedPublication();
  expect((await runNewPageCollection({ now, deadline: now.getTime() })).checked).toBe(0);
  expect(getGscConnection).not.toHaveBeenCalled();
  await expect(runNewPageCollection({ now })).rejects.toMatchObject({ status: 429 });
});
it('retains old-version publications as history but removes them from the due queue', async () => {
  await storedPublication({ websiteRunId: 'old-version' });
  const result = await runNewPageCollection({ now });
  expect(result.counts.skipped).toBe(1);
  expect(records.get('newPagePublications/publication').trackingEnabled).toBe(false);
  expect(getGscConnection).not.toHaveBeenCalled();
});
