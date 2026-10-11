import { createHash, randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { mentorFeatures } from './mentorFeature';
import { readMentorAccountScope, assertMentorAccountScope, assertMentorEvidenceRevisions } from './mentorEvidence';

const hash = value => createHash('sha256').update(value).digest('hex');
const clean = value => JSON.parse(JSON.stringify(value));
const id = (value, label = 'record') => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new RequestError(`Invalid ${label}.`);
  return value;
};
const ref = value => db.collection('conversations').doc(id(value, 'conversation'));
const workspaceRef = (uid, scope) => db.collection('mentorWorkspaces').doc(hash(`${uid}:${scope.key}`));
const leaseRef = uid => db.collection('mentorOperations').doc(hash(`generation:${uid}`));
const date = value => value?.toDate?.().toISOString() || (value instanceof Date ? value.toISOString() : value || null);
const asRevision = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RequestError('Reload this conversation before continuing.', 409);
  return value;
};
function failureDiagnostics(error) {
  const source = error?.mentorFailure || (error?.name === 'AbortError' ? { category: 'deadline' } : null);
  if (!source || !['input_budget', 'output_budget', 'deadline', 'validation', 'provider', 'evidence'].includes(source.category)) return null;
  // Operator-only metadata. Never store prompts, answers, raw provider errors,
  // resource identifiers or arbitrary exception properties in this field.
  const safe = { category: source.category };
  for (const field of ['inputBound', 'remainingInput', 'remainingOutput', 'providerStatus']) {
    if (Number.isSafeInteger(source[field]) && Math.abs(source[field]) <= 1000000000) safe[field] = source[field];
  }
  return safe;
}
const sameScope = (record, scope) => record?.schemaVersion === 9 && record.scope?.key === scope.key;
const owned = (snapshot, uid) => {
  if (!snapshot.exists || snapshot.data()?.userId !== uid || snapshot.data()?.status === 'deleted') throw new RequestError('Conversation not found.', 404);
  return snapshot.data();
};
function summary(snapshot, scope) {
  const data = snapshot.data();
  return { id: snapshot.id, title: data.title || 'SEO conversation', revision: data.revision || 0,
    messageCount: data.messageCount || data.messages?.length || 0, createdAt: date(data.createdAt), updatedAt: date(data.updatedAt),
    readOnly: !sameScope(data, scope), legacy: data.schemaVersion !== 9, status: data.status || 'active',
    activeTurnId: data.activeTurnId || null, scopeKey: data.scope?.key || null };
}
function turnView(turn) {
  if (!turn) return null;
  const expired = turn.status === 'pending' && Date.now() >= Date.parse(turn.deadlineAt);
  return { id: turn.id, turnId: turn.id, status: expired ? 'unknown' : turn.status, stage: turn.stage || null,
    selection: turn.selection || {},
    createdAt: date(turn.createdAt), completedAt: date(turn.completedAt), retryOf: turn.retryOf || null,
    error: expired ? 'This answer did not finish. Your question is saved; retry explicitly to start another attempt.' : turn.error || null };
}
function messageView(snapshot) {
  const data = snapshot.data();
  // Earlier widget messages stored the attachment URL as content with type:image.
  // Preserve it for history rendering; it is never imported into a current turn.
  const image = data.image || (data.type === 'image' && typeof data.content === 'string' ? data.content : null);
  return { id: snapshot.id, turnId: data.turnId || null, role: data.role, content: data.type === 'image' ? 'Previously attached image' : data.content || '', createdAt: date(data.createdAt),
    retryOf: data.retryOf || null, sources: data.sources || [], metricCards: data.metricCards || [], actions: data.actions || [],
    provenance: data.provenance || null, ...(image ? { image } : {}) };
}
function inputSelection(value) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new RequestError('Choose a page again.');
  const result = {};
  for (const key of ['pageUrl', 'cycleId', 'planId', 'taskId', 'ideaId']) {
    if (value?.[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key].length > 2048) throw new RequestError('Choose a page again.');
      result[key] = value[key];
    }
  }
  return result;
}
function requireGeneration(uid) {
  if (!mentorFeatures(uid).generationEnabled) throw new RequestError('New mentor answers are paused. Your saved conversations remain available.', 409);
}

export async function readMentorWorkspace(uid, { cursor, search = '' } = {}) {
  const scope = await readMentorAccountScope(uid);
  let query = db.collection('conversations').where('userId', '==', uid).orderBy('updatedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (cursor) {
    const after = await ref(cursor).get(); owned(after, uid);
    query = query.startAfter(after);
  }
  const [snapshot, active] = await Promise.all([query.limit(31).get(), workspaceRef(uid, scope).get()]);
  const documents = snapshot.docs.slice(0, 30), term = String(search ?? '').trim().toLowerCase().slice(0, 100);
  const visible = documents.filter(doc => doc.data().status !== 'deleted' && (!term || `${doc.data().title || ''} ${doc.data().searchText || ''} ${(doc.data().messages || []).map(message => message.content || '').join(' ')}`.toLowerCase().includes(term)));
  let activeConversationId = active.data()?.activeConversationId || null;
  if (activeConversationId) {
    const saved = await ref(activeConversationId).get();
    if (!saved.exists || saved.data().userId !== uid || !sameScope(saved.data(), scope) || saved.data().status === 'deleted') activeConversationId = null;
  }
  await assertMentorAccountScope(uid, scope);
  return { ...mentorFeatures(uid), scope, homepageUrl: scope.websiteUrl, activeConversationId,
    conversations: visible.map(doc => summary(doc, scope)), nextCursor: snapshot.size > 30 ? documents.at(-1).id : null };
}

export async function readMentorConversation(uid, conversationId, { cursor } = {}) {
  const scope = await readMentorAccountScope(uid), conversationRef = ref(conversationId), snapshot = await conversationRef.get();
  const data = owned(snapshot, uid);
  let messages, nextCursor = null;
  if (data.schemaVersion !== 9) {
    const all = Array.isArray(data.messages) ? data.messages : [];
    const end = cursor ? Number(cursor) : all.length;
    if (!Number.isSafeInteger(end) || end < 0 || end > all.length) throw new RequestError('Invalid conversation cursor.');
    const start = Math.max(0, end - 50);
    messages = all.slice(start, end).map((message, index) => messageView({ id: `legacy-${start + index}`, data: () => ({ ...message, createdAt: message.createdAt || message.timestamp || data.createdAt }) }));
    nextCursor = start > 0 ? String(start) : null;
  } else {
    let query = conversationRef.collection('messages').orderBy('sequence', 'desc');
    if (cursor) {
      if (!/^\d+$/.test(cursor)) throw new RequestError('Invalid conversation cursor.');
      query = query.startAfter(Number(cursor));
    }
    const found = await query.limit(51).get(), docs = found.docs.slice(0, 50);
    messages = docs.map(messageView).reverse();
    nextCursor = found.size > 50 ? String(docs.at(-1).data().sequence) : null;
  }
  await assertMentorAccountScope(uid, scope);
  return { conversation: summary(snapshot, scope), messages, nextCursor };
}

export async function readMentorTurn(uid, conversationId, turnId) {
  const scope = await readMentorAccountScope(uid), conversationRef = ref(conversationId), snapshot = await conversationRef.get();
  owned(snapshot, uid);
  const turn = (await conversationRef.collection('turns').doc(id(turnId, 'turn')).get()).data();
  if (!turn) throw new RequestError('Saved question not found.', 404);
  const messages = await Promise.all([`${turnId}-user`, `${turnId}-assistant`].map(key => conversationRef.collection('messages').doc(key).get()));
  await assertMentorAccountScope(uid, scope);
  return { conversation: summary(snapshot, scope), turn: turnView(turn), messages: messages.filter(doc => doc.exists).map(messageView) };
}

export async function createMentorConversation(uid, { requestId, title } = {}) {
  if (!mentorFeatures(uid).enabled) throw new RequestError('The new mentor is not available for this account yet. Saved conversations remain available.', 409);
  const scope = await readMentorAccountScope(uid), key = hash(`${uid}:${scope.key}:create:${id(requestId, 'request')}`), conversationRef = ref(key);
  const creationRef = db.collection('mentorOperations').doc(`create-${key}`);
  await db.runTransaction(async tx => {
    await assertMentorAccountScope(uid, scope, tx);
    const [existing, previous] = await Promise.all([tx.get(conversationRef), tx.get(creationRef)]);
    if (existing.exists) { owned(existing, uid); return; }
    if (previous.exists) throw new RequestError('This conversation was deleted. Start a new conversation.', 410);
    const now = new Date();
    tx.create(conversationRef, { schemaVersion: 9, userId: uid, scope, title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 100) : 'New SEO conversation',
      revision: 0, messageCount: 0, status: 'active', createdAt: now, updatedAt: now, activeTurnId: null, searchText: '' });
    tx.set(workspaceRef(uid, scope), { userId: uid, scope, activeConversationId: key, updatedAt: now });
    tx.create(creationRef, { userId: uid, kind: 'conversation_created', conversationId: key, createdAt: now });
  });
  return readMentorConversation(uid, key);
}

export async function mutateMentorConversation(uid, { action, conversationId, expectedRevision, title, requestId } = {}) {
  const scope = await readMentorAccountScope(uid), conversationRef = ref(conversationId);
  const saved = await conversationRef.get(), data = owned(saved, uid);
  if (action === 'activate' && !sameScope(data, scope)) return createMentorConversation(uid, { requestId });
  if (!['activate', 'rename', 'delete'].includes(action)) throw new RequestError('Unknown conversation action.');
  if (action === 'rename' && (typeof title !== 'string' || !title.trim() || title.length > 100)) throw new RequestError('Enter a title of up to 100 characters.');
  await db.runTransaction(async tx => {
    await assertMentorAccountScope(uid, scope, tx);
    const [current, workspace] = await Promise.all([tx.get(conversationRef), tx.get(workspaceRef(uid, scope))]);
    const record = owned(current, uid);
    if ((record.revision || 0) !== asRevision(expectedRevision)) throw new RequestError('This conversation changed in another window. Reload it before continuing.', 409);
    if (action === 'activate') {
      if (!sameScope(record, scope)) throw new RequestError('This is historical work. Start a new conversation.', 409);
      tx.set(workspaceRef(uid, scope), { userId: uid, scope, activeConversationId: conversationId, updatedAt: new Date() });
    } else {
      tx.update(conversationRef, { ...(action === 'rename' ? { title: title.trim() } : { status: 'deleted' }), revision: (record.revision || 0) + 1, updatedAt: new Date() });
      if (action === 'delete' && workspace.data()?.activeConversationId === conversationId) tx.update(workspaceRef(uid, scope), { activeConversationId: null, updatedAt: new Date() });
    }
  });
  // Tombstone first: in-flight generation can never recreate a deleted thread.
  if (action === 'delete') { await db.recursiveDelete(conversationRef); return { deleted: true, conversationId }; }
  return readMentorConversation(uid, conversationId);
}

export async function sendMentorTurn(uid, input, generate) {
  // Bound the entire request, including Firestore reads, validation, persistence
  // and cleanup. A provider-only race cannot bound a stalled database request.
  const deadline = Date.now() + 120000, controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener('abort', abort, { once: true });
  if (input.signal?.aborted) abort();
  const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
  const stopped = new Promise((_, reject) => {
    const stop = () => reject(new RequestError('The mentor could not finish in time. Check this conversation for your saved question before retrying.', 503));
    if (controller.signal.aborted) stop(); else controller.signal.addEventListener('abort', stop, { once: true });
  });
  try {
    return await Promise.race([sendMentorTurnWithinDeadline(uid, { ...input, signal: controller.signal }, generate, deadline), stopped]);
  } finally {
    clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
  }
}

async function sendMentorTurnWithinDeadline(uid, input, generate, deadline) {
  const ensureTime = () => {
    if (input.signal.aborted || Date.now() >= deadline) throw Object.assign(new Error('Mentor deadline or cancellation'), { name: 'AbortError' });
  };
  ensureTime();
  const conversationRef = ref(input.conversationId), turnId = id(input.turnId, 'turn'), selection = inputSelection(input.selection);
  if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 12000) throw new RequestError('Enter a question of up to 12,000 characters.');
  const message = input.message.trim(), scope = await readMentorAccountScope(uid), turnRef = conversationRef.collection('turns').doc(turnId);
  ensureTime();
  const fingerprint = hash(JSON.stringify([message, selection])), token = randomUUID();
  const start = await db.runTransaction(async tx => {
    await assertMentorAccountScope(uid, scope, tx);
    const [conversation, previous, lease] = await Promise.all([tx.get(conversationRef), tx.get(turnRef), tx.get(leaseRef(uid))]);
    ensureTime();
    const data = owned(conversation, uid);
    if (previous.exists) {
      if (previous.data().fingerprint !== fingerprint) throw new RequestError('This question identifier was already used. Start a new question.', 409);
      return { duplicate: true };
    }
    requireGeneration(uid);
    if (!sameScope(data, scope)) throw new RequestError('This conversation belongs to an earlier website. Continue in a new conversation.', 409);
    if (data.revision !== asRevision(input.expectedRevision)) throw new RequestError('This conversation changed in another window. Reload it before sending.', 409);
    if (lease.data()?.expiresAt > Date.now()) throw new RequestError('Another mentor answer is still being prepared. Wait for it to finish.', 409);
    if (input.retryOf) {
      const prior = await tx.get(conversationRef.collection('turns').doc(id(input.retryOf, 'previous turn')));
      if (!prior.exists || prior.data().fingerprint !== fingerprint || turnView(prior.data()).status === 'pending' || prior.data().status === 'completed') throw new RequestError('Only an unfinished saved question can be retried.', 409);
    }
    const now = new Date(), sequence = (data.messageCount || 0) + 1;
    tx.create(turnRef, { id: turnId, userId: uid, fingerprint, selection, status: 'pending', stage: 'reading_evidence', createdAt: now,
      deadlineAt: new Date(deadline).toISOString(), leaseToken: token, retryOf: input.retryOf || null });
    tx.create(conversationRef.collection('messages').doc(`${turnId}-user`), { userId: uid, role: 'user', content: message, turnId,
      retryOf: input.retryOf || null, sequence, createdAt: now });
    tx.update(conversationRef, { revision: data.revision + 1, messageCount: sequence, updatedAt: now, activeTurnId: turnId,
      ...(data.messageCount === 0 ? { title: message.replace(/\s+/g, ' ').slice(0, 80) } : {}),
      searchText: `${data.searchText || ''} ${message}`.slice(-12000) });
    tx.set(leaseRef(uid), { userId: uid, conversationId: input.conversationId, turnId, token, expiresAt: deadline });
    tx.set(workspaceRef(uid, scope), { userId: uid, scope, activeConversationId: input.conversationId, updatedAt: now });
    return { duplicate: false };
  });
  if (start.duplicate) return { ...await readMentorTurn(uid, input.conversationId, turnId), replayed: true };

  const controller = new AbortController();
  const abort = () => controller.abort(); input.signal?.addEventListener('abort', abort, { once: true });
  // Stop generation early enough to save a completed answer or a retryable
  // failure inside the outer 120-second boundary.
  const generationDeadline = deadline - 6000;
  const timeout = setTimeout(abort, Math.max(1, generationDeadline - Date.now()));
  let result, failure;
  try {
    const historyResult = await conversationRef.collection('messages').orderBy('sequence', 'desc').limit(21).get();
    ensureTime();
    const history = historyResult.docs.reverse().map(doc => doc.data()).filter(item => item.turnId !== turnId).map(item => ({ role: item.role, content: item.content })).slice(-20);
    if (input.signal?.aborted) controller.abort();
    const stopped = new Promise((_, reject) => {
      const stop = () => reject(Object.assign(new Error('Mentor deadline or cancellation'), { name: 'AbortError' }));
      if (controller.signal.aborted) stop(); else controller.signal.addEventListener('abort', stop, { once: true });
    });
    result = await Promise.race([generate({ uid, scope, conversationId: input.conversationId, turnId, message, history, selection, signal: controller.signal, deadline: generationDeadline }), stopped]);
    if (controller.signal.aborted || Date.now() >= deadline) throw Object.assign(new Error('deadline'), { name: 'AbortError' });
    if (typeof result?.answer !== 'string' || !result.answer.trim() || result.answer.length > 60000) throw new Error('Invalid saved answer');
    await db.runTransaction(async tx => {
      await assertMentorAccountScope(uid, scope, tx);
      if (result.provenance?.evidenceRevisions?.length) await assertMentorEvidenceRevisions(uid, scope, result.provenance.evidenceRevisions, { tx });
      const [conversation, lease, turn] = await Promise.all([tx.get(conversationRef), tx.get(leaseRef(uid)), tx.get(turnRef)]);
      ensureTime();
      const data = owned(conversation, uid);
      if (!sameScope(data, scope) || data.activeTurnId !== turnId || lease.data()?.token !== token || turn.data()?.status !== 'pending' || Date.now() >= deadline) throw new RequestError('This conversation changed while the answer was being prepared. Your question is saved.', 409);
      requireGeneration(uid);
      const now = new Date(), sequence = (data.messageCount || 0) + 1;
      tx.create(conversationRef.collection('messages').doc(`${turnId}-assistant`), clean({ userId: uid, role: 'assistant', content: result.answer, turnId, sequence, createdAt: now,
        sources: result.sources || [], metricCards: result.metricCards || [], actions: result.actions || [], provenance: result.provenance || null }));
      tx.update(turnRef, { status: 'completed', stage: 'saved', completedAt: now });
      tx.update(conversationRef, { revision: data.revision + 1, messageCount: sequence, activeTurnId: null, updatedAt: now,
        searchText: `${data.searchText || ''} ${result.answer}`.slice(-12000) });
      tx.delete(leaseRef(uid));
    });
  } catch (error) { failure = error; }
  finally { clearTimeout(timeout); input.signal?.removeEventListener('abort', abort); }
  if (failure) {
    // Failure cleanup is scoped too; never recreate records after deletion/rebuild.
    await db.runTransaction(async tx => {
      await assertMentorAccountScope(uid, scope, tx);
      const [conversation, lease, turn] = await Promise.all([tx.get(conversationRef), tx.get(leaseRef(uid)), tx.get(turnRef)]);
      ensureTime();
      const data = owned(conversation, uid);
      if (turn.data()?.status !== 'pending' || lease.data()?.token !== token) return;
      const unknown = failure.name === 'AbortError' || failure.status === 409;
      tx.update(turnRef, { status: unknown ? 'unknown' : 'failed', stage: null, completedAt: new Date(),
        failureDiagnostics: failureDiagnostics(failure),
        error: failure.status && failure.status < 500 ? failure.message : 'The answer could not be completed. Your question and earlier replies are saved. You can retry.' });
      if (data.activeTurnId === turnId) tx.update(conversationRef, { activeTurnId: null, revision: data.revision + 1 });
      tx.delete(leaseRef(uid));
    }).catch(() => {});
  }
  return readMentorTurn(uid, input.conversationId, turnId);
}
