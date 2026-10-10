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
import { savePageReviewPlan, readPageReviewPlan, updatePageReviewTask } from '../app/lib/server/pageReviewPlans';

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
const contentSummary = 'Added a section explaining the web design process and linked it to the contact page.';
const contentRequest = (data = {}, uid = 'alice') => request({ title: undefined, description: undefined,
  changeType: 'page_content', changeSummary: contentSummary, published: true, ...data }, uid);
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
  const plannedTasks = async () => savePageReviewPlan('alice', { ...draft,
    provenance: { ...provenance, generatedAt: new Date().toISOString(), contentFingerprint: 'fixture' },
    analysis: { changedFields: ['title'], recommendations: [
      { id: 'action-1', type: 'heading', significance: 'primary', benefit: 'search_relevance', basis: 'opportunity', label: 'Clarify the heading', location: 'Hero', currentQuote: 'Current website', proposedText: 'Website design', targetUrl: null, evidenceIds: [] },
      { id: 'action-2', type: 'internal_link', significance: 'supporting', benefit: 'navigation', basis: 'opportunity', label: 'Link the service card', location: 'Service card', currentQuote: '', proposedText: 'View service', targetUrl: 'https://example.test/service', evidenceIds: [] },
      { id: 'action-3', type: 'check', significance: 'supporting', benefit: 'diagnosis', basis: 'needs_check', label: 'Check the screenshot', location: 'Visual layout', currentQuote: '', proposedText: null, targetUrl: null, evidenceIds: [] },
    ] } });

  it('atomically links only selected saved tasks to an owner-confirmed publication', async () => {
    const plan = await plannedTasks(); const taskIds = plan.tasks.slice(0, 2).map(task => task.id);
    const response = await confirm(contentRequest({ taskIds, planRevision: plan.revision }));
    expect(response.status).toBe(200); const result = await response.json();
    expect(result.record).toMatchObject({ confirmedTaskIds: taskIds, confirmedTaskLabels: ['Clarify the heading', 'Link the service card'], sourcePlanId: plan.id, sourcePlanRevision: 1 });
    expect(result.plan.revision).toBe(2);
    expect(result.plan.tasks.slice(0, 2).every(task => task.status === 'done' && task.publication.implementedAt === result.record.implementedAt && task.publication.implementationId === id && task.publication.pageUrl === pageUrl)).toBe(true);
    expect(result.plan.tasks[2]).not.toHaveProperty('publication'); expect(result.plan.tasks[2].status).toBe('todo');
    const stored = await readPageReviewPlan('alice', pageUrl); expect(stored).toEqual(result.plan);
    const retry = await (await confirm(contentRequest({ taskIds: [...taskIds].reverse(), planRevision: plan.revision }))).json();
    expect(retry.alreadyConfirmed).toBe(true); expect(retry.record.implementedAt).toBe(result.record.implementedAt); expect(retry.plan).toEqual(result.plan);
  });

  it('does not treat a legacy checklist Done as a publication but permits its explicit confirmation', async () => {
    const first = await plannedTasks();
    const plan = await updatePageReviewTask('alice', pageUrl, first.tasks[0].id, 'done', first.revision);
    expect(plan.tasks[0]).not.toHaveProperty('publication'); expect(records.has(recordPath)).toBe(false);
    const response = await confirm(contentRequest({ taskIds: [plan.tasks[0].id], planRevision: plan.revision }));
    expect(response.status).toBe(200); const result = await response.json();
    expect(result.plan.tasks[0].publication.confirmationMethod).toBe('user-confirmed');
  });

  it('rejects invalid or stale task selections without partially publishing the page', async () => {
    const plan = await plannedTasks(); const taskIds = [plan.tasks[0].id];
    for (const changes of [{ taskIds: [] }, { taskIds: ['bad'] }, { taskIds: [taskIds[0], taskIds[0]] }, { planRevision: undefined }, { planRevision: 0 }]) {
      expect((await confirm(contentRequest({ taskIds, planRevision: plan.revision, ...changes }))).status).toBe(400);
    }
    for (const changes of [{ taskIds: ['f'.repeat(64)] }, { taskIds: [plan.tasks[2].id] }, { planRevision: 9 }]) {
      expect((await confirm(contentRequest({ taskIds, planRevision: plan.revision, ...changes }))).status).toBe(409);
    }
    for (const status of ['dismissed', 'needs_review']) {
      const current = await readPageReviewPlan('alice', pageUrl);
      const changed = await updatePageReviewTask('alice', pageUrl, taskIds[0], status, current.revision);
      expect((await confirm(contentRequest({ taskIds, planRevision: changed.revision }))).status).toBe(409);
    }
    expect(records.has(recordPath)).toBe(false);
    expect((await readPageReviewPlan('alice', pageUrl)).tasks.every(task => !task.publication)).toBe(true);
  });

  it('rejects IDs from another exact page plan and conflicting selected-task retries', async () => {
    const plan = await plannedTasks();
    const otherPage = 'https://example.test/other';
    const other = await savePageReviewPlan('alice', { ...plan.review, provenance: { ...plan.review.provenance, pageUrl: otherPage },
      analysis: { ...plan.review.analysis, recommendations: [{ ...plan.review.analysis.recommendations[0], location: 'Other page area', currentQuote: 'Other page quote' }] } });
    expect((await confirm(contentRequest({ taskIds: [other.tasks[0].id], planRevision: plan.revision }))).status).toBe(409);
    const first = await (await confirm(contentRequest({ taskIds: [plan.tasks[0].id], planRevision: plan.revision }))).json();
    expect((await confirm(contentRequest({ taskIds: [plan.tasks[1].id], planRevision: first.plan.revision }))).status).toBe(409);
    expect(records.get(recordPath).confirmedTaskIds).toEqual([plan.tasks[0].id]);
  });

  it('leaves both saved tasks and the implementation untouched when the transaction cannot commit', async () => {
    const plan = await plannedTasks(); const before = [...records.entries()]; const transaction = db.runTransaction;
    const spy = vi.spyOn(db, 'runTransaction').mockImplementation(callback => transaction(async tx => { await callback(tx); throw new Error('simulated commit failure'); }));
    try { expect((await confirm(contentRequest({ taskIds: [plan.tasks[0].id], planRevision: plan.revision }))).status).toBe(500); }
    finally { spy.mockRestore(); }
    expect([...records.entries()]).toEqual(before);
  });

  it.each(['observed', 'proposed'])('records the saved automatic focus source rather than trusting the client: %s', async source => {
    await savePageReviewPlan('alice', { ...draft, provenance: { ...provenance, generatedAt: new Date().toISOString(), contentFingerprint: 'fixture' },
      analysis: { recommendations: [], searchFocus: { phrase: 'web design', source } } });
    const response = await confirm(request({ focusKeyword: 'web design', keywordSource: 'invented-client-source' }));
    expect(response.status).toBe(200);
    expect((await response.json()).record.keywordSource).toBe(source === 'observed' ? 'gsc-observed' : 'ai-generated');
  });

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

  it('records an owner-confirmed content edit with fresh observed tags rather than supplied metadata or AI claims', async () => {
    const response = await confirm(contentRequest({ title: 'Forged changed title', description: 'Forged changed description',
      implementedAt: '1900-01-01', pageChangeSummary: 'A forged alternative summary', verifiedPublished: true,
      recommendation: { kind: 'technical', title: 'AI says done' }, progressAssessment: { state: 'success' },
      provenance: { ...provenance, reviewVersion: 4, contentFingerprint: 'pre-edit-fingerprint' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const result = await response.json();
    expect(result).toMatchObject({ alreadyConfirmed: false, record: { id, userId: 'alice', pageUrl,
      changeType: 'page_content', pageChangeSummary: contentSummary, title: 'Current website title',
      description: 'Current website description', status: 'implemented', websiteRunId: provenance.websiteRunId,
      confirmationMethod: 'user-confirmed', confirmedPageObservation: { htmlTitle: 'Current website title', finalUrl: pageUrl } } });
    expect(Math.abs(Date.now() - Date.parse(result.record.implementedAt))).toBeLessThan(5000);
    for (const key of ['verifiedPublished', 'recommendation', 'progressAssessment', 'changeSummary', 'published']) expect(records.get(recordPath)).not.toHaveProperty(key);
  });

  it('allows actual content edits when the page has no metadata, without inventing tags', async () => {
    publicFetch.mockImplementation(async () => {
      const response = new Response('<html><body><h1>How we build websites</h1><p>A newly published explanation.</p></body></html>', { headers: { 'Content-Type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: pageUrl });
      return response;
    });
    const response = await confirm(contentRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).record).toMatchObject({ changeType: 'page_content', pageChangeSummary: contentSummary, title: '', description: '' });
  });

  it('requires an explicit published acknowledgement and bounded owner-entered summary before fetching', async () => {
    for (const changes of [{ published: false }, { published: undefined }, { published: 'true' }, { published: 1 },
      { changeSummary: undefined }, { changeSummary: null }, { changeSummary: '   ' }, { changeSummary: 123 },
      { changeSummary: 'x'.repeat(601) }, { changeSummary: '<script>alert(1)</script>' }, { changeSummary: 'Updated\u0000content' }]) {
      expect((await confirm(contentRequest(changes))).status).toBe(400);
    }
    expect(publicFetch).not.toHaveBeenCalled();
    expect(records.has(recordPath)).toBe(false);
    const response = await confirm(contentRequest({ changeSummary: `  ${'a'.repeat(600)}  ` }));
    expect(response.status).toBe(200);
    expect(records.get(recordPath).pageChangeSummary).toHaveLength(600);
  });

  it('does not accept review, check, or unknown action types as a published edit', async () => {
    for (const changeType of ['check', 'monitor', 'review_page', 'technical', '', null, {}, []]) {
      expect((await confirm(contentRequest({ changeType }))).status).toBe(400);
    }
    expect(publicFetch).not.toHaveBeenCalled();
    expect(records.has(recordPath)).toBe(false);
  });

  it('keeps the same content confirmation and clock after retries even if live tags later change', async () => {
    const first = await (await confirm(contentRequest())).json();
    publicFetch.mockImplementation(async () => {
      const response = new Response('<html><head><title>Later observed title</title></head><body><p>Later content</p></body></html>', { headers: { 'Content-Type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: pageUrl });
      return response;
    });
    const second = await (await confirm(contentRequest({ changeSummary: ` ${contentSummary} ` }))).json();
    expect(second).toEqual({ ...first, alreadyConfirmed: true });
    expect(records.get(recordPath).title).toBe('Current website title');
    expect((await confirm(contentRequest({ changeSummary: 'Published a different edit later.' }))).status).toBe(409);
    expect((await confirm(request())).status).toBe(409);
    expect(records.get(recordPath).implementedAt).toBe(first.record.implementedAt);
    expect(records.get(recordPath).pageChangeSummary).toBe(contentSummary);
  });

  it('does not overwrite an active metadata cycle with a content edit', async () => {
    const first = await (await confirm(request())).json();
    expect((await confirm(contentRequest())).status).toBe(409);
    expect(records.get(recordPath)).toMatchObject({ ...draft, implementedAt: first.record.implementedAt });
    expect(records.get(recordPath)).not.toHaveProperty('changeType');
  });

  it('applies account, exact URL, property, run, redirect and archive guards to content edits', async () => {
    expect((await confirm(contentRequest({}, null))).status).toBe(401);
    expect((await confirm(contentRequest({ userId: 'bob' }))).status).toBe(403);
    expect((await confirm(contentRequest({ provenance: { ...provenance, finalUrl: 'https://example.test/other' } }))).status).toBe(409);
    const elsewhere = 'https://elsewhere.test/page';
    expect((await confirm(contentRequest({ pageUrl: elsewhere, provenance: { ...provenance, pageUrl: elsewhere, finalUrl: elsewhere } }))).status).toBe(403);
    expect((await confirm(contentRequest({ provenance: { ...provenance, websiteRunId: 'old-website' } }))).status).toBe(409);
    publicFetch.mockImplementation(async () => htmlResponse('https://example.test/destination'));
    expect((await confirm(contentRequest())).status).toBe(409);
    publicFetch.mockImplementation(async () => htmlResponse());
    records.set(recordPath, { userId: 'alice', pageUrl, preRevampArchived: true, status: 'implemented' });
    expect((await confirm(contentRequest())).status).toBe(409);
    expect(records.get(recordPath).preRevampArchived).toBe(true);
  });

  it('rechecks the content confirmation run inside the transaction after reading the published page', async () => {
    const transaction = db.runTransaction;
    vi.spyOn(db, 'runTransaction').mockImplementation(async callback => {
      await db.collection('onboarding').doc('alice').update({ revampRunId: 'changed-after-read' });
      return transaction(callback);
    });
    expect((await confirm(contentRequest())).status).toBe(409);
    expect(records.has(recordPath)).toBe(false);
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
