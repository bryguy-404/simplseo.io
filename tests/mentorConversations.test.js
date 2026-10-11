import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  const fake = fakeFirestore(), original = fake.db.collection;
  const value = (doc, field) => typeof field === 'string' ? doc.data()[field] : doc.id;
  function query(path, filters = [], orders = [], limit = Infinity, cursor = null) {
    return { ...original(path), doc: key => ({ ...original(path).doc(key), collection: name => query(`${path}/${key}/${name}`) }), where: (key, op, expected) => query(path, [...filters, [key, expected]], orders, limit, cursor),
      orderBy: (key, direction = 'asc') => query(path, filters, [...orders, [key, direction]], limit, cursor),
      limit: size => query(path, filters, orders, size, cursor), startAfter: after => query(path, filters, orders, limit, after),
      get: async () => {
        let docs = (await original(path).get()).docs.filter(doc => filters.every(([key, expected]) => doc.data()[key] === expected));
        docs.sort((a, b) => {
          for (const [key, direction] of orders) {
            const first = value(a, key), second = value(b, key), comparison = first > second ? 1 : first < second ? -1 : 0;
            if (comparison) return comparison * (direction === 'desc' ? -1 : 1);
          }
          return 0;
        });
        if (cursor !== null) { const index = docs.findIndex(doc => cursor?.id ? doc.id === cursor.id : value(doc, orders[0][0]) === cursor); docs = docs.slice(index + 1); }
        docs = docs.slice(0, limit); return { docs, empty: !docs.length, size: docs.length };
      } };
  }
  fake.db.collection = path => query(path);
  fake.db.recursiveDelete = async ref => { for (const key of fake.records.keys()) if (key === ref.path || key.startsWith(`${ref.path}/`)) fake.records.delete(key); };
  const transaction = fake.db.runTransaction; let pending = Promise.resolve();
  fake.db.runTransaction = callback => { const next = pending.then(() => transaction(callback)); pending = next.catch(() => {}); return next; };
  return { ...fake, auth: { verifyIdToken: vi.fn(async token => { if (!['alice', 'bob'].includes(token)) throw Error('invalid'); return { uid: token }; }) } };
});
vi.mock('../app/lib/server/mentorGeneration', () => ({ generateMentorAnswer: vi.fn(async () => ({ answer: 'Saved guidance.', sources: [], metricCards: [], actions: [] })) }));
vi.mock('../app/lib/server/mentorEvidence', async () => ({ ...await import('../app/lib/server/mentorAccountScope'), assertMentorEvidenceRevisions: vi.fn(async () => {}), readMentorWorkspaceContext: vi.fn(async () => ({ pageOptions: [] })), runMentorCheck: vi.fn() }));

import { db, records, reset } from '../app/lib/firebaseAdmin';
import { createMentorConversation, mutateMentorConversation, readMentorConversation, readMentorTurn, readMentorWorkspace, sendMentorTurn } from '../app/lib/server/mentorConversations';
import { GET as mentorGET, POST as mentorPOST } from '../app/api/mentor/route';
import { generateMentorAnswer } from '../app/lib/server/mentorGeneration';
import { RequestError } from '../app/lib/server/requestAuth';
import { runMentorCheck, assertMentorEvidenceRevisions } from '../app/lib/server/mentorEvidence';
import { mentorFeatures } from '../app/lib/server/mentorFeature';
import { POST as legacyChat } from '../app/api/chatbot/chat/route';
import { POST as legacyWidget } from '../app/api/seo-assistant/chat/route';
import { PUT as legacyConversationWrite } from '../app/api/conversations/[id]/route';
import { POST as legacyConversationCreate } from '../app/api/conversations/route';
const property = 'https://example.test/';
const answer = { answer: 'Use the saved evidence.', sources: [], metricCards: [], actions: [] };
const create = async (user = 'alice', requestId = 'create-one') => (await createMentorConversation(user, { requestId })).conversation;
const input = (conversation, patch = {}) => ({ conversationId: conversation.id, expectedRevision: conversation.revision, turnId: 'first-turn', message: 'How is my homepage doing?', selection: { pageUrl: property }, ...patch });
let generate;
beforeEach(async () => {
  reset(); Object.assign(process.env, { MENTOR_ENABLED: 'true', MENTOR_PILOT_UIDS: 'alice,bob', MENTOR_GENERATION_ENABLED: 'true', MENTOR_RESEARCH_ENABLED: 'false' });
  for (const user of ['alice', 'bob']) {
    await db.collection('users').doc(user).set({});
    await db.collection('onboarding').doc(user).set({ websiteUrl: property, gscProperty: property, revampRunId: 'website-one' });
  }
  generate = vi.fn(async () => answer); assertMentorEvidenceRevisions.mockReset().mockResolvedValue(undefined); generateMentorAnswer.mockClear(); runMentorCheck.mockReset().mockResolvedValue({ cached: true, result: {} });
});
afterEach(() => { for (const key of ['MENTOR_ENABLED', 'MENTOR_PILOT_UIDS', 'MENTOR_GENERATION_ENABLED', 'MENTOR_RESEARCH_ENABLED']) delete process.env[key]; vi.useRealTimers(); });

describe('mentor append-only conversations', () => {
  it('resolves independent server flags without exposing the allowlist', () => {
    expect(mentorFeatures('alice')).toEqual({ enabled: true, generationEnabled: true, researchEnabled: false });
    expect(mentorFeatures('other').enabled).toBe(false);
    process.env.MENTOR_GENERATION_ENABLED = 'false'; process.env.MENTOR_RESEARCH_ENABLED = 'true';
    expect(mentorFeatures('alice')).toEqual({ enabled: true, generationEnabled: false, researchEnabled: true });
  });
  it('creates idempotently and restores the same active thread from server reads', async () => {
    const first = await create(), second = await create();
    expect(second.id).toBe(first.id);
    expect((await readMentorWorkspace('alice')).activeConversationId).toBe(first.id);
    expect((await readMentorWorkspace('alice')).conversations).toHaveLength(1);
    expect(generate).not.toHaveBeenCalled();
  });
  it('saves the question before generation and saves the answer before returning completed', async () => {
    const conversation = await create();
    generate.mockImplementation(async payload => {
      expect(records.get(`conversations/${conversation.id}/messages/first-turn-user`).content).toBe(payload.message);
      expect(records.get(`conversations/${conversation.id}/turns/first-turn`).status).toBe('pending');
      expect(payload.history).toEqual([]); return answer;
    });
    const result = await sendMentorTurn('alice', input(conversation), generate);
    expect(result.turn.status).toBe('completed'); expect(result.conversation.revision).toBe(2);
    expect(result.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect((await readMentorConversation('alice', conversation.id)).messages).toEqual(result.messages);
  });
  it('replays completed requests without generation or a current revision requirement', async () => {
    const conversation = await create(), first = await sendMentorTurn('alice', input(conversation), generate);
    process.env.MENTOR_GENERATION_ENABLED = 'false';
    const again = await sendMentorTurn('alice', input(conversation), generate);
    expect(again.messages).toEqual(first.messages); expect(again.replayed).toBe(true); expect(generate).toHaveBeenCalledTimes(1);
    await expect(sendMentorTurn('alice', input(conversation, { message: 'Different request' }), generate)).rejects.toMatchObject({ status: 409 });
  });
  it('does not regenerate a failed turn unless the owner sends an explicit new retry ID', async () => {
    const conversation = await create(); generate.mockRejectedValueOnce(Error('secret upstream details'));
    const failed = await sendMentorTurn('alice', input(conversation), generate);
    expect(failed.turn.status).toBe('failed'); expect(failed.turn.error).not.toContain('secret');
    await sendMentorTurn('alice', input(conversation), generate); expect(generate).toHaveBeenCalledTimes(1);
    const retry = await sendMentorTurn('alice', input(failed.conversation, { turnId: 'retry-turn', retryOf: 'first-turn' }), generate);
    expect(retry.turn.status).toBe('completed'); expect(retry.messages[0].retryOf).toBe('first-turn'); expect(generate).toHaveBeenCalledTimes(2);
  });
  it('uses one generation lease across threads and replays pending requests', async () => {
    const conversation = await create(), other = await create('alice', 'create-two'); let finish;
    generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = sendMentorTurn('alice', input(conversation), generate);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const replay = await sendMentorTurn('alice', input(conversation), generate); expect(replay.turn.status).toBe('pending');
    await expect(sendMentorTurn('alice', input(other, { turnId: 'other' }), generate)).rejects.toMatchObject({ status: 409 });
    finish(answer); await pending; expect(generate).toHaveBeenCalledTimes(1);
  });
  it('rejects stale revisions and forged cross-account identifiers without provider work', async () => {
    const conversation = await create();
    await mutateMentorConversation('alice', { action: 'rename', conversationId: conversation.id, expectedRevision: 0, title: 'Useful title' });
    await expect(sendMentorTurn('alice', input(conversation), generate)).rejects.toMatchObject({ status: 409 });
    for (const operation of [() => readMentorConversation('bob', conversation.id), () => sendMentorTurn('bob', input(conversation), generate), () => mutateMentorConversation('bob', { action: 'delete', conversationId: conversation.id, expectedRevision: 1 })]) {
      await expect(operation()).rejects.toMatchObject({ status: 404 });
    }
    expect(generate).not.toHaveBeenCalled();
  });
  it('preserves earlier history and allows simultaneous metadata updates without losing messages', async () => {
    const conversation = await create();
    generate.mockImplementation(async () => {
      await mutateMentorConversation('alice', { action: 'rename', conversationId: conversation.id, expectedRevision: 1, title: 'Renamed while answering' });
      return answer;
    });
    const result = await sendMentorTurn('alice', input(conversation), generate);
    expect(result.conversation.title).toBe('Renamed while answering'); expect(result.conversation.revision).toBe(3); expect(result.messages).toHaveLength(2);
  });
  it('makes old website conversations read-only and continues in a clean current thread', async () => {
    const conversation = await create(); await sendMentorTurn('alice', input(conversation), generate);
    await db.collection('onboarding').doc('alice').update({ revampRunId: 'website-two' });
    const history = await readMentorConversation('alice', conversation.id); expect(history.conversation.readOnly).toBe(true); expect(history.messages).toHaveLength(2);
    expect((await readMentorWorkspace('alice')).activeConversationId).toBeNull();
    await expect(sendMentorTurn('alice', input(history.conversation, { turnId: 'new' }), generate)).rejects.toMatchObject({ status: 409 });
    const fresh = await mutateMentorConversation('alice', { action: 'activate', conversationId: conversation.id, requestId: 'continue-old' });
    expect(fresh.conversation.id).not.toBe(conversation.id); expect(fresh.messages).toEqual([]);
  });
  it('keeps unscoped legacy records and attachments as read-only history without importing stale facts', async () => {
    const legacy = { userId: 'alice', title: 'Old chat', source: 'corner-bubble', cornerEnded: false, createdAt: new Date(), updatedAt: new Date(), messages: [{ role: 'user', content: 'Old question', image: 'data:image/png;base64,fixture' }, { role: 'user', type: 'image', content: 'data:image/png;base64,old-format' }] };
    await db.collection('conversations').doc('legacy').set(legacy);
    expect((await readMentorWorkspace('alice')).conversations[0].legacy).toBe(true);
    const saved = await readMentorConversation('alice', 'legacy'); expect(saved.conversation.readOnly).toBe(true); expect(saved.messages[0].image).toContain('data:image'); expect(saved.messages[1]).toMatchObject({ image: 'data:image/png;base64,old-format', content: 'Previously attached image' });
    await mutateMentorConversation('alice', { action: 'activate', conversationId: 'legacy', requestId: 'continue-legacy' });
    expect(records.get('conversations/legacy')).toEqual(legacy);
  });
  it('never saves an answer after deletion or a scope change during generation', async () => {
    const conversation = await create();
    generate.mockImplementation(async () => {
      await db.collection('onboarding').doc('alice').update({ revampRunId: 'replacement' }); return answer;
    });
    const result = await sendMentorTurn('alice', input(conversation), generate);
    expect(result.turn.status).not.toBe('completed'); expect(result.messages).toHaveLength(1);
    expect(records.has(`conversations/${conversation.id}/messages/first-turn-assistant`)).toBe(false);
  });
  it('checks captured evidence revisions inside the final write transaction', async () => {
    const conversation = await create(), references = [{ kind: 'page_plan', id: 'plan', fingerprint: 'a'.repeat(64) }];
    generate.mockResolvedValue({ ...answer, provenance: { evidenceRevisions: references } });
    assertMentorEvidenceRevisions.mockRejectedValue(new RequestError('Saved work changed. Reload before asking again.', 409));
    const result = await sendMentorTurn('alice', input(conversation), generate);
    expect(result.turn.status).toBe('unknown'); expect(result.messages).toHaveLength(1);
    expect(assertMentorEvidenceRevisions).toHaveBeenCalledWith('alice', expect.objectContaining({ userId: 'alice' }), references, { tx: expect.objectContaining({ get: expect.any(Function) }) });
  });
  it('does not recreate a thread deleted while its answer is running', async () => {
    const conversation = await create();
    generate.mockImplementation(async () => {
      await mutateMentorConversation('alice', { action: 'delete', conversationId: conversation.id, expectedRevision: 1 }); return answer;
    });
    await expect(sendMentorTurn('alice', input(conversation), generate)).rejects.toMatchObject({ status: 404 });
    expect([...records.keys()].some(key => key.startsWith(`conversations/${conversation.id}`))).toBe(false);
  });
  it('retains saved history when flags are off without allowing new generation', async () => {
    const conversation = await create(); await sendMentorTurn('alice', input(conversation), generate);
    process.env.MENTOR_ENABLED = 'false';
    const result = await readMentorConversation('alice', conversation.id); expect(result.messages).toHaveLength(2);
    await expect(sendMentorTurn('alice', input(result.conversation, { turnId: 'new' }), generate)).rejects.toMatchObject({ status: 409 });
    expect((await readMentorWorkspace('alice')).enabled).toBe(false);
  });
  it('marks expired saved pending turns unknown without retrying or mutating the record', async () => {
    const conversation = await create();
    await db.collection('conversations').doc(conversation.id).collection('turns').doc('expired').set({ id: 'expired', status: 'pending', deadlineAt: '2000-01-01T00:00:00Z' });
    const saved = await readMentorTurn('alice', conversation.id, 'expired'); expect(saved.turn.status).toBe('unknown');
    expect(records.get(`conversations/${conversation.id}/turns/expired`).status).toBe('pending'); expect(generate).not.toHaveBeenCalled();
  });
  it('enforces the absolute deadline even when a provider ignores cancellation', async () => {
    vi.useFakeTimers(); const conversation = await create();
    generate.mockImplementation(() => new Promise(() => {}));
    const pending = sendMentorTurn('alice', input(conversation), generate);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(120000);
    const result = await pending; expect(result.turn.status).toBe('unknown'); expect(result.messages).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('never saves invalid model output and keeps the original question retryable', async () => {
    const conversation = await create(); generate.mockResolvedValue({ answer: '' });
    const result = await sendMentorTurn('alice', input(conversation), generate);
    expect(result.turn.status).toBe('failed'); expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('How is my homepage doing?');
  });
  it('does not recreate messages after account deletion starts during a request', async () => {
    const conversation = await create();
    generate.mockImplementation(async () => { await db.collection('users').doc('alice').update({ deletionInProgress: true }); return answer; });
    await expect(sendMentorTurn('alice', input(conversation), generate)).rejects.toMatchObject({ status: 409 });
    expect(records.has(`conversations/${conversation.id}/messages/first-turn-assistant`)).toBe(false);
  });
  it('pages saved messages and conversation history without provider work', async () => {
    const conversation = await create();
    for (let index = 1; index <= 75; index++) await db.collection('conversations').doc(conversation.id).collection('messages').doc(`message-${index}`).set({ role: 'user', content: `question ${index}`, sequence: index, createdAt: new Date() });
    const latest = await readMentorConversation('alice', conversation.id); expect(latest.messages).toHaveLength(50); expect(latest.messages[0].content).toBe('question 26');
    const older = await readMentorConversation('alice', conversation.id, { cursor: latest.nextCursor }); expect(older.messages).toHaveLength(25); expect(older.nextCursor).toBeNull();
    for (let index = 0; index < 35; index++) await create('alice', `create-${index}`);
    const first = await readMentorWorkspace('alice'), second = await readMentorWorkspace('alice', { cursor: first.nextCursor });
    expect(first.conversations).toHaveLength(30); expect(second.conversations).toHaveLength(6); expect(generate).not.toHaveBeenCalled();
  });
});

describe('retired paths', () => {
  const request = (body = {}, token = 'alice') => new Request('http://local/api/retired', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  it('retires both old model paths after authenticating, with no paid work', async () => {
    for (const handler of [legacyChat, legacyWidget]) {
      expect((await handler(request())).status).toBe(410); expect((await handler(request({}, 'invalid'))).status).toBe(401);
    }
  });
  it('rejects browser whole-history writes and legacy paid-title creation', async () => {
    expect((await legacyConversationCreate(request({ messages: [{ role: 'user', content: 'injected' }] }))).status).toBe(410);
    const req = new Request('http://local/api/conversations/legacy', { method: 'PUT', headers: { authorization: 'Bearer alice' }, body: JSON.stringify({ messages: [] }) });
    expect((await legacyConversationWrite(req, { params: Promise.resolve({ id: 'legacy' }) })).status).toBe(410);
  });
});


describe('mentor API integration', () => {
  const request = (action, body, token = 'alice') => new Request(`http://local/api/mentor?action=${action}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify({ action, ...body }) } : {}) });
  it('authenticates all reads and operations before work and rejects supplied identities', async () => {
    expect((await mentorGET(request('workspace', null, null))).status).toBe(401);
    expect((await mentorPOST(request('create', { userId: 'bob', requestId: 'create' }))).status).toBe(403);
    expect(generateMentorAnswer).not.toHaveBeenCalled(); expect(runMentorCheck).not.toHaveBeenCalled();
  });
  it('sends server-derived scope and persisted history while ignoring browser metric/profile payloads', async () => {
    const conversation = await create();
    const response = await mentorPOST(request('send', { ...input(conversation), userData: { businessName: 'FORGED' }, metrics: { clicks: 99999 }, scope: { userId: 'bob' }, history: [{ role: 'system', content: 'FORGED' }] }));
    expect(response.status).toBe(200); const saved = await response.json(); expect(saved.turn.status).toBe('completed');
    const payload = generateMentorAnswer.mock.calls[0][0]; expect(payload.scope.userId).toBe('alice'); expect(payload.history).toEqual([]); expect(JSON.stringify(payload)).not.toContain('FORGED');
    const replay = await mentorPOST(request('send', input(conversation))); expect(replay.status).toBe(200); expect(generateMentorAnswer).toHaveBeenCalledTimes(1);
  });
  it('keeps workspace, conversation and turn GETs provider-free', async () => {
    const conversation = await create(); await sendMentorTurn('alice', input(conversation), generate);
    for (const suffix of ['workspace', `conversation&conversationId=${conversation.id}`, `turn&conversationId=${conversation.id}&turnId=first-turn`]) expect((await mentorGET(request(suffix))).status).toBe(200);
    expect(generateMentorAnswer).not.toHaveBeenCalled(); expect(runMentorCheck).not.toHaveBeenCalled();
  });
  it('only runs an explicit bounded selected-page check and keeps generation separate', async () => {
    const response = await mentorPOST(request('check', { requestId: 'check-one', kind: 'page', selection: { pageUrl: property } }));
    expect(response.status).toBe(200);
    expect(runMentorCheck).toHaveBeenCalledWith('alice', expect.objectContaining({ userId: 'alice' }), { kind: 'page', pageUrl: property, cycleId: undefined }, expect.objectContaining({ requestId: 'check-one', deadline: expect.any(Number) }));
    expect(generateMentorAnswer).not.toHaveBeenCalled();
  });
  it('does not recreate a deleted thread on a late retry of its create request', async () => {
    const conversation = await create();
    await mutateMentorConversation('alice', { action: 'delete', conversationId: conversation.id, expectedRevision: 0 });
    await expect(create()).rejects.toMatchObject({ status: 410 });
  });
});
