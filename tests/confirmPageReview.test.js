import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { verifyIdToken: vi.fn(async token => { if (token !== 'alice') throw Error('invalid'); return { uid: token }; }) } };
});
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn(async () => ({ siteUrl: 'https://example.test/' })) }));
vi.mock('../app/lib/server/publicFetch', () => ({ publicFetch: vi.fn() }));
vi.mock('openai', () => ({ default: class { constructor() { throw Error('Confirmation must never call AI'); } } }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { publicFetch } from '../app/lib/server/publicFetch';
import { seoImplementationId } from '../app/lib/pageTaskFlow';
import { POST as confirm } from '../app/api/page-review/confirm/route';

const pageUrl = 'https://example.test/Services?Topic=Design';
const id = seoImplementationId('alice', pageUrl);
const recordPath = `implementedSeoTips/${id}`;
const historyPath = 'users/alice/revampHistory/current-website';
const archivePath = `${historyPath}/records/implementedSeoTips_${id}`;
const draft = { title: 'Custom Web Design | Example Studio', description: 'Read about website design from Example Studio and contact us to discuss your website.' };
const provenance = { property: 'https://example.test/', websiteRunId: 'current-website', pageUrl, finalUrl: pageUrl };
const request = (data = {}, uid = 'alice') => new Request('https://simplseo.test/api/page-review/confirm', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid}` } : {}) },
  body: JSON.stringify({ pageUrl, ...draft, provenance, ...data }),
});
const htmlResponse = (url = pageUrl) => {
  const response = new Response('<html><head><title>Current website title</title><meta name="description" content="Current website description"></head><body><h1>Current website</h1></body></html>', { headers: { 'Content-Type': 'text/html' } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
beforeEach(async () => {
  reset(); publicFetch.mockReset(); delete process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST;
  await db.collection('onboarding').doc('alice').set({ isComplete: true, gscProperty: provenance.property, revampRunId: provenance.websiteRunId, revampStatus: 'complete' });
  await db.collection('users').doc('alice').set({ gscSiteUrl: provenance.property, gscAccessToken: 'isolated-connection' });
  await db.collection('users').doc('alice').collection('revampHistory').doc('current-website').set({ complete: true });
  publicFetch.mockImplementation(async () => htmlResponse());
});

describe('server-confirmed manual page changes', () => {
  it('authenticates before any fetch or data write and rejects a supplied other account', async () => {
    expect((await confirm(request({}, null))).status).toBe(401);
    expect((await confirm(request({ userId: 'bob' }))).status).toBe(403);
    expect(publicFetch).not.toHaveBeenCalled();
    expect(records.has(recordPath)).toBe(false);
  });

  it('uses a server timestamp, connected run and fresh observation while ignoring client metrics and credentials', async () => {
    const response = await confirm(request({
      implementedAt: '1900-01-01', status: 'success', preRevampArchived: true, userId: 'alice',
      progressAssessment: { state: 'ready' }, preStats: { clicks: 999 }, gscToken: 'forged-credential',
      previousMetaTitle: 'Forged previous title', metadataObservedAt: '1900-01-01',
      focusKeyword: 'web design', keywordSource: 'gsc-observed',
    }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ alreadyConfirmed: false, record: { id, ...draft, userId: 'alice', pageUrl, status: 'implemented', websiteRunId: 'current-website', gscProperty: provenance.property, preRevampArchived: false, focusKeyword: 'web design', keywordSource: 'user-selected', confirmedPageObservation: { htmlTitle: 'Current website title', source: 'website-html', finalUrl: pageUrl } } });
    expect(Math.abs(Date.now() - Date.parse(result.record.implementedAt))).toBeLessThan(5000);
    const stored = records.get(recordPath);
    for (const key of ['preStats', 'progressAssessment', 'gscToken', 'previousMetaTitle', 'metadataObservedAt']) expect(stored).not.toHaveProperty(key);
    expect(stored).not.toHaveProperty('id');
  });

  it('accepts a v3 metadata edit while rejecting a no-edit v3 assessment before a confirmation write', async () => {
    const v3Provenance = { ...provenance, reviewVersion: 3, model: 'gpt-6.1-sol', generatedAt: '2026-10-10T16:00:00.000Z' };
    const noEdit = await confirm(request({ title: null, description: null, provenance: v3Provenance }));
    expect(noEdit.status).toBe(400);
    expect(records.has(recordPath)).toBe(false);
    expect(publicFetch).not.toHaveBeenCalled();

    const confirmed = await confirm(request({ provenance: v3Provenance }));
    expect(confirmed.status).toBe(200);
    const result = await confirmed.json();
    expect(result.record).toMatchObject({ ...draft, pageUrl, websiteRunId: provenance.websiteRunId,
      gscProperty: provenance.property, confirmationMethod: 'user-confirmed', status: 'implemented' });
    expect(result.record.confirmedPageObservation.finalUrl).toBe(pageUrl);
    expect(records.get(recordPath).implementedAt).not.toBe(v3Provenance.generatedAt);
  });

  it('rejects stale website runs and wrong properties without writing a record', async () => {
    for (const changes of [{ websiteRunId: 'old-website' }, { property: 'https://elsewhere.test/' }]) {
      expect((await confirm(request({ provenance: { ...provenance, ...changes } }))).status).toBe(409);
    }
    expect(records.has(recordPath)).toBe(false);
  });

  it('binds the confirmation to the exact reviewed page URL, including its query and case', async () => {
    for (const changes of [{ pageUrl: pageUrl.toLowerCase() }, { finalUrl: 'https://example.test/another-page' }]) {
      expect((await confirm(request({ provenance: { ...provenance, ...changes } }))).status).toBe(409);
    }
    expect(publicFetch).not.toHaveBeenCalled();
    expect(records.has(recordPath)).toBe(false);
  });

  it('rejects another website even when all client URL bindings match it', async () => {
    const elsewhere = 'https://elsewhere.test/page';
    const response = await confirm(request({ pageUrl: elsewhere, provenance: { ...provenance, pageUrl: elsewhere, finalUrl: elsewhere } }));
    expect(response.status).toBe(403);
    expect(publicFetch).not.toHaveBeenCalled();
    expect(records.has(recordPath)).toBe(false);
  });

  it('independently rejects a changed redirect even when client provenance pretends there is none', async () => {
    publicFetch.mockImplementation(async () => htmlResponse('https://example.test/new-destination'));
    const response = await confirm(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('redirects');
    expect(records.has(recordPath)).toBe(false);
  });

  it('returns an identical prior confirmation without restarting its clock', async () => {
    const first = await (await confirm(request())).json();
    const second = await (await confirm(request({ implementedAt: '2099-01-01', progressAssessment: { state: 'ready' } }))).json();
    expect(second.alreadyConfirmed).toBe(true);
    expect(second.record).toEqual(first.record);
    expect(records.get(recordPath).implementedAt).toBe(first.record.implementedAt);
    expect((await confirm(request({ title: 'A different subsequent title' }))).status).toBe(409);
    expect(records.get(recordPath).title).toBe(draft.title);
  });

  it('preserves immutable historical data before replacing an archived active record', async () => {
    const old = { userId: 'alice', pageUrl, title: 'Old website', description: 'Old description', status: 'implemented', implementedAt: '2020-01-01', preRevampArchived: true, preRevampRunId: 'current-website', progressAssessment: { state: 'ready', old: true }, preStats: { clicks: 999 } };
    records.set(recordPath, old);
    const archived = { collection: 'implementedSeoTips', sourceId: id, data: structuredClone(old) };
    records.set(archivePath, archived);
    const response = await confirm(request());
    expect(response.status).toBe(200);
    expect(records.get(archivePath)).toEqual(archived);
    expect(records.get(recordPath)).toMatchObject({ ...draft, preRevampArchived: false, status: 'implemented' });
    expect(records.get(recordPath)).not.toHaveProperty('progressAssessment');
    expect(records.get(recordPath)).not.toHaveProperty('preStats');
  });

  it('refuses to replace an archived record when its historical copy is absent', async () => {
    const old = { userId: 'alice', pageUrl, preRevampArchived: true, status: 'implemented', title: 'Old work' };
    records.set(recordPath, old);
    expect((await confirm(request())).status).toBe(409);
    expect(records.get(recordPath)).toEqual(old);
  });

  it('refuses work while preservation is incomplete or pending', async () => {
    records.set(historyPath, { complete: false });
    expect((await confirm(request())).status).toBe(409);
    records.set(historyPath, { complete: true });
    await db.collection('onboarding').doc('alice').update({ revampArchivePending: true });
    expect((await confirm(request())).status).toBe(409);
    expect(publicFetch).not.toHaveBeenCalled();
    expect(records.has(recordPath)).toBe(false);
  });

  it('rechecks the website run inside the transaction after all website reads', async () => {
    const transaction = db.runTransaction;
    vi.spyOn(db, 'runTransaction').mockImplementation(async callback => {
      await db.collection('onboarding').doc('alice').update({ revampRunId: 'changed-after-read' });
      return transaction(callback);
    });
    expect((await confirm(request())).status).toBe(409);
    expect(records.has(recordPath)).toBe(false);
  });

  it('rechecks stored OAuth property identity and completed history inside the transaction', async () => {
    const transaction = db.runTransaction;
    vi.spyOn(db, 'runTransaction').mockImplementation(async callback => {
      await db.collection('users').doc('alice').update({ gscSiteUrl: 'https://elsewhere.test/' });
      return transaction(callback);
    });
    expect((await confirm(request())).status).toBe(409);
    expect(records.has(recordPath)).toBe(false);
    db.runTransaction.mockRestore();
    await db.collection('users').doc('alice').update({ gscSiteUrl: provenance.property });
    vi.spyOn(db, 'runTransaction').mockImplementation(async callback => {
      records.set(historyPath, { complete: false });
      return transaction(callback);
    });
    expect((await confirm(request())).status).toBe(409);
    expect(records.has(recordPath)).toBe(false);
  });

  it('refuses confirmation after the stored Google connection has been removed', async () => {
    records.delete('users/alice');
    expect((await confirm(request())).status).toBe(409);
    expect(records.has(recordPath)).toBe(false);
  });

  it('never overwrites a colliding ID belonging to another page or account', async () => {
    for (const old of [{ userId: 'alice', pageUrl: 'https://example.test/other' }, { userId: 'bob', pageUrl }]) {
      records.set(recordPath, old);
      expect((await confirm(request())).status).toBe(409);
      expect(records.get(recordPath)).toEqual(old);
    }
  });
});
