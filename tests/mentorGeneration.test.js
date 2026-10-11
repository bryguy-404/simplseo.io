import { describe, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => (await import('./fakeFirestore')).fakeFirestore());
import { RequestError } from '../app/lib/server/requestAuth';
import { generateMentorAnswer } from '../app/lib/server/mentorGeneration';
const scope = { userId: 'alice', property: 'sc-domain:example.test', websiteUrl: 'https://example.test/', websiteRunId: null, profileRevision: 1 };
const args = { uid: 'alice', scope, conversationId: 'convo1', turnId: 'turn1', message: 'How is my homepage doing?', history: [] };
const tool = (name, params) => ({ type: 'function_call', name, arguments: JSON.stringify(params), call_id: `${name}-call` });
const final = (answer = 'The saved report is dated. Keep monitoring before deciding on another edit.', sourceIds = ['page']) => ({ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ answer, sourceIds, metricIds: [], actionIds: [] }) }] });
const response = output => ({ status: 'completed', usage: { input_tokens: 1000, output_tokens: 200 }, output });
function deps(outputs = [[final()]]) {
  const provider = { create: vi.fn() }; outputs.forEach(items => provider.create.mockResolvedValueOnce(response(items)));
  return { provider, assertScope: vi.fn(), assertEvidence: vi.fn(), reserve: vi.fn().mockResolvedValue({ id: 'budget' }), settle: vi.fn().mockResolvedValue(undefined),
    record: vi.fn(async (_, execute) => execute()), researchEnabled: false,
    toolDefinitions: [{ type: 'function', name: 'mentor_page_evidence', parameters: { type: 'object', properties: { pageUrl: { type: 'string' } } } }],
    executeEvidence: vi.fn(async () => ({ data: { status: 'saved', clicks: 6, date: '2026-10-07' }, sources: [{ id: 'page', title: 'Saved homepage report' }] })),
    lookupDocs: vi.fn(async () => ({ topic: 'indexing', documents: [{ id: 'google', title: 'Indexing', url: 'https://support.google.com/webmasters/answer/7440203', excerpt: 'Discovered and crawled are different states.', status: 'available', observedAt: '2026-10-11' }] })),
  };
}
describe('bounded mentor answer pipeline', () => {
  it('uses scoped server evidence and returns saved-source references', async () => {
    const d = deps([[tool('mentor_page_evidence', { pageUrl: 'https://example.test/' })], [final()]]);
    const result = await generateMentorAnswer(args, d);
    expect(result.provenance.providerAttempts).toBe(2); expect(result.sources[0].id).toBe('page');
    expect(d.executeEvidence).toHaveBeenCalledWith('alice', scope, 'mentor_page_evidence', { pageUrl: 'https://example.test/' }, expect.any(Object));
    expect(d.reserve).toHaveBeenCalledTimes(1); expect(d.settle).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ unknown: false, providerAttempts: 2 }));
  });
  it('namespaces usage accounting when different accounts submit the same client turn ID', async () => {
    const first = deps(), second = deps();
    await generateMentorAnswer(args, first);
    await generateMentorAnswer({ ...args, uid: 'bob', scope: { ...scope, userId: 'bob' } }, second);
    const firstId = first.record.mock.calls[0][0].reviewRunId, secondId = second.record.mock.calls[0][0].reviewRunId;
    expect(firstId).toMatch(/^[a-f0-9]{64}$/); expect(secondId).not.toBe(firstId);
  });
  it('looks up Google references for general questions without a Google connection', async () => {
    const d = deps([[tool('read_google_guidance', { topic: 'indexing', latest: false })], [final('Let us distinguish discovery from indexing.', ['google'])]]);
    const result = await generateMentorAnswer({ ...args, scope: { ...scope, property: null }, message: 'What does indexing mean?' }, d);
    expect(result.sources[0].type).toBe('google_documentation'); expect(d.lookupDocs).toHaveBeenCalledTimes(1);
  });
  it('caps the tool loop and forces the third call to answer without tools', async () => {
    const d = deps([[tool('mentor_page_evidence', { pageUrl: 'https://example.test/' })], [tool('mentor_page_evidence', { pageUrl: 'https://example.test/' })], [final()]]);
    await generateMentorAnswer(args, d);
    expect(d.provider.create.mock.calls[2][0].tools).toBeUndefined(); expect(d.provider.create).toHaveBeenCalledTimes(3);
  });
  it('uses reported input tokens after conservative preflight reservations across three evidence rounds', async () => {
    const d = deps([[tool('mentor_page_evidence', { pageUrl: 'https://example.test/' })], [tool('mentor_page_evidence', { pageUrl: 'https://example.test/' })], [final()]]);
    d.executeEvidence.mockResolvedValue({ data: { excerpt: 'A relevant observation. '.repeat(140) }, sources: [{ id: 'page' }] });
    const result = await generateMentorAnswer(args, d);
    expect(result.provenance.providerAttempts).toBe(3);
    const byteTotal = d.provider.create.mock.calls.reduce((total, [request]) => total + Buffer.byteLength(JSON.stringify(request)), 0);
    expect(byteTotal).toBeGreaterThan(24000);
  });
  it('fails safely rather than returning fabricated citations', async () => {
    const d = deps([[final('A fabricated answer.', ['invented'])]]);
    await expect(generateMentorAnswer(args, d)).rejects.toMatchObject({ status: 503, mentorFailure: { category: 'validation' } }); expect(d.provider.create).toHaveBeenCalledTimes(1);
  });
  it('diagnoses oversized evidence before a second provider attempt without retaining its contents', async () => {
    const d = deps([[tool('mentor_page_evidence', { pageUrl: 'https://example.test/' })], [final()]]);
    d.executeEvidence.mockResolvedValueOnce({ data: { status: 'saved' }, sources: [{ id: 'page' }] })
      .mockResolvedValueOnce({ data: { privateExcerpt: 'PRIVATE business facts '.repeat(2000) }, sources: [{ id: 'page' }] });
    const error = await generateMentorAnswer(args, d).catch(value => value);
    expect(error).toMatchObject({ status: 503, mentorFailure: { category: 'input_budget', remainingInput: 23000 } });
    expect(error.mentorFailure.inputBound).toBeGreaterThan(23000);
    expect(JSON.stringify(error.mentorFailure)).not.toContain('PRIVATE');
    expect(d.provider.create).toHaveBeenCalledTimes(1);
    expect(d.settle).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ unknown: false, providerAttempts: 1 }));
  });
  it('distinguishes exhausted output allowance from input and provider failures', async () => {
    const d = deps();
    d.provider.create.mockReset().mockResolvedValueOnce({ ...response([tool('mentor_page_evidence', { pageUrl: 'https://example.test/' })]),
      usage: { input_tokens: 1000, output_tokens: 5900 } });
    await expect(generateMentorAnswer(args, d)).rejects.toMatchObject({ status: 503, mentorFailure: { category: 'output_budget', remainingOutput: 100 } });
    expect(d.provider.create).toHaveBeenCalledTimes(1);
  });
  it('diagnoses an initial evidence failure without retaining private exception details', async () => {
    const d = deps(); d.executeEvidence.mockRejectedValue(new Error('PRIVATE account payload'));
    const error = await generateMentorAnswer(args, d).catch(value => value);
    expect(error).toMatchObject({ status: 503, mentorFailure: { category: 'evidence' } });
    expect(error.message).not.toContain('PRIVATE'); expect(d.provider.create).not.toHaveBeenCalled();
  });
  it('rechecks account scope after generation and returns nothing after deletion', async () => {
    const d = deps([]); d.provider.create.mockImplementationOnce(async () => {
      d.assertScope.mockRejectedValue(Object.assign(new Error('Changed'), { status: 409 })); return response([final()]);
    });
    await expect(generateMentorAnswer(args, d)).rejects.toThrow(); expect(d.settle).toHaveBeenCalled();
  });
  it('revalidates captured plan revisions and returns private references for atomic message persistence', async () => {
    const d = deps(); const reference = { kind: 'page_plan', id: 'saved-plan', fingerprint: 'a'.repeat(64) };
    d.executeEvidence.mockResolvedValue({ sources: [{ id: 'page' }], evidenceRevisions: [reference] });
    const result = await generateMentorAnswer(args, d);
    expect(d.assertEvidence).toHaveBeenCalledWith('alice', scope, [reference]);
    expect(result.provenance.evidenceRevisions).toEqual([reference]);
    expect(JSON.stringify(d.provider.create.mock.calls[0][0].input)).not.toContain('evidenceRevisions');
  });
  it('rejects an answer when its saved tasks change during generation', async () => {
    const d = deps();
    d.executeEvidence.mockResolvedValue({ sources: [{ id: 'page' }], evidenceRevisions: [{ kind: 'page_plan', id: 'saved-plan', fingerprint: 'a'.repeat(64) }] });
    d.assertEvidence.mockRejectedValue(new RequestError('Saved tasks changed.', 409));
    await expect(generateMentorAnswer(args, d)).rejects.toMatchObject({ status: 409 });
  });
  it('refuses contradictory revisions read in successive tool rounds', async () => {
    const d = deps([[tool('mentor_page_evidence', { pageUrl: 'https://example.test/' })], [final()]]);
    let iteration = 0;
    d.executeEvidence.mockImplementation(async () => ({ sources: [{ id: 'page' }], evidenceRevisions: [{ kind: 'page_plan', id: 'saved-plan', fingerprint: (++iteration === 1 ? 'a' : 'b').repeat(64) }] }));
    await expect(generateMentorAnswer(args, d)).rejects.toMatchObject({ status: 409 });
    expect(d.provider.create).toHaveBeenCalledTimes(1);
  });
  it('retains unknown billing and does not retry a provider failure', async () => {
    const d = deps([]); d.provider.create.mockRejectedValue(Object.assign(new Error('secret upstream detail'), { status: 502 }));
    await expect(generateMentorAnswer(args, d)).rejects.toMatchObject({ status: 503, mentorFailure: { category: 'provider', providerStatus: 502 } });
    expect(d.provider.create).toHaveBeenCalledTimes(1); expect(d.settle).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ unknown: true }));
  });
  it('stops before external work when the absolute deadline is exhausted', async () => {
    const d = deps(); await expect(generateMentorAnswer({ ...args, deadline: Date.now() - 1 }, d)).rejects.toMatchObject({ status: 503, mentorFailure: { category: 'deadline' } }); expect(d.provider.create).not.toHaveBeenCalled();
  });
  it('does not accept private raw text as a documentation search topic', async () => {
    const d = deps([[tool('read_google_guidance', { topic: 'indexing', latest: true })], [final('Check the documented status.', ['google'])]]);
    d.researchEnabled = true; d.reserveResearch = vi.fn().mockResolvedValue(false);
    await generateMentorAnswer({ ...args, message: 'PRIVATE account has 13 clicks' }, d);
    expect(d.provider.create).toHaveBeenCalledTimes(2); expect(d.reserveResearch).toHaveBeenCalledTimes(1);
  });
});
