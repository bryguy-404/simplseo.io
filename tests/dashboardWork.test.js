import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', () => {
  const records = new Map(), reads = [], failures = new Set();
  const state = { hook: null };
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const nested = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);
  const project = (value, fields) => {
    if (!fields) return clone(value);
    const result = {};
    for (const field of fields) {
      const data = nested(value, field); if (data === undefined) continue;
      const parts = field.split('.'); let target = result;
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      target[parts.at(-1)] = clone(data);
    }
    return result;
  };
  const snapshot = (path, fields) => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => project(records.get(path), fields) });
  const doc = path => ({ id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`), get: async () => {
    reads.push({ type: 'doc', path }); await state.hook?.({ type: 'doc', path });
    if (failures.has(`doc:${path}`)) throw Error('PRIVATE provider error');
    return snapshot(path);
  } });
  const collection = (path, settings = {}) => ({
    doc: id => doc(`${path}/${id}`),
    where: (field, op, value) => {
      if (op !== '==') throw Error('Unsupported test operator');
      return collection(path, { ...settings, filters: [...(settings.filters || []), [field, value]] });
    },
    orderBy: field => {
      if (field !== '__name__') throw Error('Test expects stable document ordering');
      return collection(path, { ...settings, ordered: true });
    },
    select: (...fields) => collection(path, { ...settings, fields }),
    limit: limit => collection(path, { ...settings, limit }),
    startAfter: after => collection(path, { ...settings, after }),
    get: async () => {
      reads.push({ type: 'query', path, ...settings }); await state.hook?.({ type: 'query', path, ...settings });
      if (failures.has(`query:${path}`)) throw Error('PRIVATE provider error');
      const keys = [...records.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1
        && (settings.filters || []).every(([field, value]) => nested(records.get(key), field) === value)
        && (!settings.after || key.split('/').at(-1) > settings.after)).sort();
      const docs = keys.slice(0, settings.limit).map(key => snapshot(key, settings.fields));
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  const auth = { verifyIdToken: vi.fn(async token => ({ uid: token })), getUser: vi.fn() };
  return { db: { collection, getAll: async (ref, { fieldMask }) => {
    const value = await ref.get();
    return [{ ...value, data: () => project(value.data(), fieldMask) }];
  } }, auth, records, reads, failures, state,
    reset: () => { records.clear(); reads.length = 0; failures.clear(); state.hook = null; } };
});
import { records, reads, failures, state, reset } from '../app/lib/firebaseAdmin';
import { readDashboardWork } from '../app/lib/server/dashboardWork';
import { GET } from '../app/api/dashboard/work/route';

const site = 'https://example.test/';
const identity = { userId: 'u1', property: 'sc-domain:example.test', websiteUrl: site, websiteRunId: 'run1' };
const now = new Date('2026-10-11T12:00:00.000Z');
const metric = (clicks, impressions) => ({ status: 'has_data', clicks, impressions, position: 14,
  startDate: '2026-09-01', endDate: '2026-09-28', fetchedAt: now.toISOString(), queries: [{ query: 'PRIVATE', clicks: 7 }] });
const plan = (url = site) => ({ ...identity, pageUrl: url, revision: 2, createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-10-10T12:00:00Z',
  tasks: [{ id: 't1', status: 'todo', priority: 'first', recommendation: { type: 'content', label: 'Clarify service', instruction: 'PRIVATE long recommendation' }, draft: 'PRIVATE OWNER COPY' }],
  review: { evidence: 'PRIVATE BODY' } });
const cycle = (url = site) => ({ ...identity, pageUrl: url, revision: 3, lifecycle: 'active', reviewStatus: 'review_due', confirmedAt: '2026-09-01T12:00:00Z', nextReviewAt: '2026-10-30',
  confirmation: { tasks: ['PRIVATE'] }, latestCheckpointId: 'day-28', latestCheckpoint: { id: 'day-28', state: 'available', day: 28, evidenceRevision: 2, observedAt: now.toISOString(), baseline: metric(2, 30), post: metric(3, 40) },
  latestDecision: { outcome: 'keep_monitoring', checkpointId: 'day-28', checkpointRevision: 1, summary: 'Keep monitoring.', proposedTasks: [{ draft: 'PRIVATE' }] },
  technical: { checkedAt: now.toISOString(), issues: [{ code: 'noindex', checkedAt: '2026-10-01T00:00:00Z', message: '<b>Check indexing</b>', stale: true }], errors: { publicPage: 'temporarily_unavailable' } } });
const legacy = (url = site) => ({ userId: 'u1', pageUrl: url, gscProperty: identity.property, websiteRunId: 'run1', status: 'implemented', implementedAt: '2026-09-01T12:00:00Z' });
const newPlan = () => ({ ...identity, status: 'draft', revision: 1, context: { area: { name: 'South Bend', region: 'Indiana', country: 'United States' }, facts: 'PRIVATE' },
  idea: { topic: 'Drain repair', purpose: 'PRIVATE' }, draft: { h1: 'Drain repair', body: 'PRIVATE' }, createdAt: now.toISOString(), updatedAt: now.toISOString() });
beforeEach(() => {
  reset(); vi.clearAllMocks();
  records.set('users/u1', { gscSiteUrl: identity.property }); // Deliberately disconnected: saved work remains readable.
  records.set('onboarding/u1', { isComplete: true, gscProperty: identity.property, websiteUrl: site, revampRunId: 'run1' });
});

describe('saved dashboard work', () => {
  it('returns compact scoped fragments with dated metrics and never writes or requests providers', async () => {
    records.set('pageReviewPlans/p1', plan()); records.set('pageProgressCycles/c1', cycle()); records.set('implementedSeoTips/l1', legacy());
    records.set('newPagePlans/n1', newPlan());
    const before = structuredClone([...records]), result = await readDashboardWork('u1', { now });
    expect(result.items).toHaveLength(4);
    const savedPlan = result.items.find(item => item.kind === 'plan');
    expect(savedPlan).toMatchObject({ taskCounts: { todo: 1, published: 0 }, nextTask: { label: 'Clarify service' }, revision: 2 });
    const savedCycle = result.items.find(item => item.kind === 'cycle');
    expect(savedCycle.latestCheckpoint).toMatchObject({ observedAt: now.toISOString(), state: 'available', baseline: { clicks: 2 }, post: { clicks: 3 } });
    expect(savedCycle.technical).toMatchObject({ issues: [{ message: 'Check indexing', stale: true, checkedAt: '2026-10-01T00:00:00Z' }] });
    expect(savedCycle.latestDecision.checkpointRevision).toBe(1);
    expect(result.items.find(item => item.kind === 'legacy').activeCycle.id).toBe('c1');
    expect(result.items.find(item => item.kind === 'new_page')).toMatchObject({ hasDraft: true, topic: 'Drain repair' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(result.coverage).toMatchObject({ partial: false, countsAreComplete: true });
    expect([...records]).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps done checks separate from explicitly published edits', async () => {
    const saved = plan(); saved.tasks = [
      { status: 'done', recommendation: { type: 'check' } },
      { status: 'done', recommendation: { type: 'content' }, publication: { implementedAt: now.toISOString() } },
      { status: 'needs_review', recommendation: { type: 'heading', label: 'Review earlier suggestion' } },
    ];
    records.set('pageReviewPlans/p1', saved);
    expect((await readDashboardWork('u1')).items[0].taskCounts).toEqual({ done: 2, published: 1, todo: 0, dismissed: 0, needs_review: 1 });
  });

  it('bounds source queries at ten plus sentinel and scopes modern work before paging', async () => {
    for (let index = 0; index < 25; index++) records.set(`pageReviewPlans/old-${String(index).padStart(2, '0')}`, { ...plan(), websiteRunId: 'old' });
    for (let index = 0; index < 23; index++) records.set(`pageReviewPlans/p${String(index).padStart(2, '0')}`, plan(`${site}page-${index}`));
    const first = await readDashboardWork('u1');
    expect(first.items).toHaveLength(10); expect(first.sources.plans).toMatchObject({ scanned: 10, hasMore: true });
    expect(first.coverage.countsAreComplete).toBe(false);
    const second = await readDashboardWork('u1', { cursor: first.nextCursor });
    const third = await readDashboardWork('u1', { cursor: second.nextCursor });
    expect(second.items).toHaveLength(10); expect(third.items).toHaveLength(3); expect(third.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size).toBe(23);
    expect(reads.filter(read => read.type === 'query').every(read => read.limit === 11)).toBe(true);
    expect(reads.filter(read => read.type === 'query' && read.path === 'newPagePlans')).toHaveLength(1);
  });

  it('continues beyond excluded legacy rows without counting historical work', async () => {
    for (let index = 0; index < 12; index++) records.set(`implementedSeoTips/a${String(index).padStart(2, '0')}`, { ...legacy(), websiteRunId: 'old' });
    records.set('implementedSeoTips/current', legacy());
    const first = await readDashboardWork('u1');
    expect(first.items).toEqual([]); expect(first.sources.legacy.hasMore).toBe(true);
    const second = await readDashboardWork('u1', { cursor: first.nextCursor });
    expect(second.items).toHaveLength(1); expect(second.items[0].id).toBe('current');
  });

  it('resolves a modern cycle outside the loaded cycle page before showing legacy status', async () => {
    for (let index = 0; index < 10; index++) records.set(`pageProgressCycles/a${index}`, cycle(`${site}other-${index}`));
    records.set('pageProgressCycles/zcurrent', cycle()); records.set('implementedSeoTips/old', legacy());
    const result = await readDashboardWork('u1');
    const item = result.items.find(item => item.kind === 'legacy');
    expect(item.activeCycle.id).toBe('zcurrent');
    expect(reads.filter(read => read.type === 'query' && read.limit === 2)).toHaveLength(1);
  });

  it('flags duplicate active cycles even when only one is in the first source batch', async () => {
    records.set('pageProgressCycles/a-current', cycle());
    for (let index = 0; index < 9; index++) records.set(`pageProgressCycles/b${index}`, cycle(`${site}other-${index}`));
    records.set('pageProgressCycles/z-duplicate', cycle()); records.set('implementedSeoTips/old', legacy());
    const result = await readDashboardWork('u1');
    expect(result.items.find(item => item.kind === 'legacy')).toMatchObject({ activeCycle: null, activeCycleLookupFailed: true });
    expect(result.sources.legacy.error).toBeTruthy();
  });

  it('does not trust a legacy assessment saved for another confirmation or property', async () => {
    const item = legacy(); item.progressAssessment = { schemaVersion: 1, source: 'google_search_console', pageUrl: site, property: 'sc-domain:other.test', websiteRunId: 'run1', implementedAt: item.implementedAt, state: 'ready', baseline: metric(2, 30), post: metric(20, 300) };
    records.set('implementedSeoTips/l1', item);
    expect((await readDashboardWork('u1')).items[0].assessment).toMatchObject({ state: 'collecting', baseline: null, post: null });
  });

  it('filters cross-account, other-property, historical, dismissed and invalid-page records', async () => {
    records.set('pageReviewPlans/other', { ...plan(), userId: 'other' });
    records.set('pageReviewPlans/property', { ...plan(), property: 'sc-domain:other.test' });
    records.set('pageReviewPlans/outside', plan('https://other.test/'));
    records.set('pageReviewPlans/version', { ...plan(), websiteRunId: 'old' });
    records.set('pageProgressCycles/history', { ...cycle(), lifecycle: 'superseded' });
    records.set('implementedSeoTips/retired', { ...legacy(), preRevampArchived: true });
    records.set('newPagePlans/dismissed', { ...newPlan(), status: 'dismissed' });
    records.set('newPagePlans/website', { ...newPlan(), websiteUrl: 'https://other.example.test/' });
    expect((await readDashboardWork('u1')).items).toEqual([]);
  });

  it('reads only linked publications and keeps verified, indexing and activity states separate', async () => {
    records.set('newPagePlans/n1', { ...newPlan(), status: 'published', publicationId: 'pub1' });
    records.set('newPagePublications/pub1', { ...identity, planId: 'n1', pageUrl: `${site}drains`, ownerDeclaredAt: '2026-10-01T12:00:00Z', verifiedAt: '2026-10-01T12:01:00Z',
      publicPage: { status: 'available', warnings: ['Different canonical'] }, indexing: { status: 'available', verdict: 'NEUTRAL', fetchedAt: '2026-10-02T00:00:00Z' },
      activity: { rolling: metric(3, 80), sinceVerified: { status: 'collecting' } }, preexistingActivity: metric(2, 30), lastError: { indexing: 'temporarily_unavailable' } });
    records.set('newPagePublications/unlinked', { ...identity, pageUrl: `${site}unrelated`, title: 'PRIVATE' });
    const result = await readDashboardWork('u1');
    expect(result.items[0].publication).toMatchObject({ ownerDeclaredAt: '2026-10-01T12:00:00Z', verifiedAt: '2026-10-01T12:01:00Z',
      indexing: { verdict: 'NEUTRAL' }, activity: { rolling: { clicks: 3 }, sinceVerified: { status: 'collecting', clicks: null } }, preexistingActivity: { clicks: 2 }, lastError: { indexing: 'temporarily_unavailable' } });
    expect(reads.filter(read => read.path.startsWith('newPagePublications/')).map(read => read.path)).toEqual(['newPagePublications/pub1']);
  });

  it('preserves other sources after query failure and retries only unfinished sources', async () => {
    records.set('pageReviewPlans/p1', plan()); records.set('newPagePlans/n1', newPlan()); failures.add('query:pageReviewPlans');
    const first = await readDashboardWork('u1');
    expect(first.items.map(item => item.kind)).toEqual(['new_page']); expect(first.sources.plans.error).toBeTruthy();
    expect(first.sources.plans.readFailed).toBe(true); expect(first.sources.newPages.readFailed).toBe(false);
    expect(JSON.stringify(first)).not.toContain('PRIVATE provider error');
    failures.clear(); reads.length = 0;
    const second = await readDashboardWork('u1', { cursor: first.nextCursor });
    expect(second.items.map(item => item.kind)).toEqual(['plan']);
    expect(second.sources.plans).toMatchObject({ error: null, readFailed: false });
    expect(reads.filter(read => read.type === 'query').map(read => read.path)).toEqual(['pageReviewPlans']);
  });

  it('marks unresolved modern-cycle and linked-publication reads as unavailable without leaking other work', async () => {
    records.set('implementedSeoTips/l1', legacy()); failures.add('query:pageProgressCycles');
    records.set('newPagePlans/n1', { ...newPlan(), publicationId: 'other' });
    records.set('newPagePublications/other', { ...identity, userId: 'u2', planId: 'n1', pageUrl: site, verifiedAt: now.toISOString() });
    const result = await readDashboardWork('u1');
    expect(result.items.find(item => item.kind === 'legacy')).toMatchObject({ activeCycle: null, activeCycleLookupFailed: true });
    expect(result.items.find(item => item.kind === 'new_page')).toMatchObject({ publication: null, publicationError: expect.any(String) });
    expect(result.sources.newPages).toMatchObject({ error: expect.any(String), readFailed: false, scanned: 1 });
    expect(result.coverage.partial).toBe(true);
  });

  it.each(['deletion', 'property', 'website', 'version'])('rejects %s during the saved read', async kind => {
    state.hook = async read => {
      if (read.type !== 'query') return;
      state.hook = null;
      if (kind === 'deletion') records.delete('users/u1');
      else records.get('onboarding/u1')[{ property: 'gscProperty', website: 'websiteUrl', version: 'revampRunId' }[kind]] = 'changed';
    };
    await expect(readDashboardWork('u1')).rejects.toMatchObject({ status: 409 });
  });

  it('rejects malformed and previous-scope continuation cursors', async () => {
    await expect(readDashboardWork('u1', { cursor: 'not-a-cursor' })).rejects.toMatchObject({ status: 400 });
    for (let index = 0; index < 11; index++) records.set(`pageReviewPlans/p${index}`, plan());
    const first = await readDashboardWork('u1'); records.get('onboarding/u1').revampRunId = 'run2';
    await expect(readDashboardWork('u1', { cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
  });
});

describe('dashboard work route', () => {
  it('requires authentication, rejects forged identity/inputs and uses private saved responses', async () => {
    expect((await GET(new Request('https://app.test/api/dashboard/work'))).status).toBe(401);
    expect((await GET(new Request('https://app.test/api/dashboard/work?userId=other', { headers: { authorization: 'Bearer u1' } }))).status).toBe(403);
    expect((await GET(new Request('https://app.test/api/dashboard/work?property=sc-domain:other.test', { headers: { authorization: 'Bearer u1' } }))).status).toBe(400);
    records.set('pageReviewPlans/p1', plan());
    const response = await GET(new Request('https://app.test/api/dashboard/work', { headers: { authorization: 'Bearer u1' } }));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).items[0].pageUrl).toBe(site);
  });
});
