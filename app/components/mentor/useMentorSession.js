"use client";

import { useEffect, useSyncExternalStore } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebaseConfig';
import { authenticatedFetch } from '../../lib/authenticatedFetch';

const initial = { uid: null, workspace: null, conversation: null, messages: [], nextCursor: null,
  loading: false, busy: false, status: '', error: '', draft: '', pending: null, animateId: null, lastCheck: null };
let state = initial;
let loadPromise;
let requestEpoch = 0;
let authWatching = false;
let creationRequest = null;
const listeners = new Set();
const publish = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const getSnapshot = () => state;
const getServerSnapshot = () => initial;
const uidNow = () => auth.currentUser?.uid;
const current = (uid, epoch) => uid === uidNow() && uid === state.uid && epoch === requestEpoch;
const newId = () => crypto.randomUUID();

function clearDrafts() {
  try {
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = storage.length - 1; i >= 0; i--) {
        const key = storage.key(i);
        if (key?.startsWith('mentor-draft-v1:') || ['chatbotMessages-v1', 'chatAssistantDraft', 'seoChatMessages', 'skipLoadConversation', 'chatbotInput', 'chatAssistantInput', 'chatContext', 'chatbotContext'].includes(key)) storage.removeItem(key);
      }
    }
  } catch { /* A blocked browser cache must not prevent server history reads. */ }
}
function watchAuth() {
  if (authWatching || typeof window === 'undefined') return;
  authWatching = true;
  try { for (const key of ['chatbotMessages-v1', 'chatAssistantDraft', 'seoChatMessages', 'skipLoadConversation', 'chatContext']) localStorage.removeItem(key); } catch {}
  onAuthStateChanged(auth, user => {
    if (state.uid && state.uid !== user?.uid) {
      clearDrafts(); requestEpoch += 1; loadPromise = null; creationRequest = null;
      state = { ...initial, uid: user?.uid || null }; listeners.forEach(listener => listener());
    }
  });
}
function draftKey(workspace = state.workspace) {
  if (!state.uid || !workspace?.scope) return null;
  const scope = workspace.scope;
  return `mentor-draft-v1:${state.uid}:${encodeURIComponent(JSON.stringify([scope.websiteUrl || scope.website, scope.property, scope.websiteRunId || scope.websiteVersion]))}`;
}
function readDraft(workspace) {
  try { const key = draftKey(workspace); return key ? sessionStorage.getItem(key) || '' : ''; } catch { return ''; }
}
function writeDraft(value) {
  publish({ draft: value });
  try { const key = draftKey(); if (key) value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); } catch { /* Server conversation remains available. */ }
}
async function api(action, body, query = {}) {
  const response = body ? await authenticatedFetch('/api/mentor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) })
    : await authenticatedFetch(`/api/mentor?${new URLSearchParams({ action, ...Object.fromEntries(Object.entries(query).filter(([, value]) => value != null && value !== '')) })}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    const error = new Error(result.error?.message || result.message || (typeof result.error === 'string' ? result.error : 'We couldn’t finish that request. Your saved conversation is still available.'));
    error.status = response.status; error.code = result.code || result.error?.code; throw error;
  }
  return result;
}
function mergeMessages(old, incoming) {
  const records = new Map(old.map(message => [message.id, message]));
  for (const message of incoming || []) records.set(message.id, message);
  return [...records.values()];
}
function updateConversation(conversation) {
  if (!conversation) return;
  const workspace = state.workspace;
  publish({ conversation, workspace: workspace ? { ...workspace, activeConversationId: conversation.id,
    conversations: [conversation, ...(workspace.conversations || []).filter(row => row.id !== conversation.id)] } : workspace });
}
async function loadConversation(id, activate = false) {
  if (!id || state.busy) return;
  const uid = state.uid; const epoch = ++requestEpoch;
  publish({ loading: true, error: '', animateId: null });
  try {
    const result = activate ? await api('activate', { requestId: newId(), conversationId: id, expectedRevision: state.workspace?.conversations?.find(row => row.id === id)?.revision })
      : await api('conversation', null, { conversationId: id });
    if (!current(uid, epoch)) return;
    const conversation = result.conversation;
    if (!activate && conversation && !conversation.readOnly && !conversation.legacy) await api('activate', { requestId: newId(), conversationId: id, expectedRevision: conversation.revision });
    let data = result;
    if (conversation && !result.messages) data = await api('conversation', null, { conversationId: conversation.id });
    if (!current(uid, epoch)) return;
    updateConversation(data.conversation || conversation);
    publish({ messages: data.messages || [], nextCursor: data.nextCursor || null, pending: null });
    await restorePending(data, uid, epoch);
  } catch (error) { if (current(uid, epoch)) publish({ error: error.message }); }
  finally { if (current(uid, epoch)) publish({ loading: false }); }
}
async function restorePending(result, uid, epoch) {
  const latest = result.messages?.at(-1);
  if (latest?.role !== 'user' || !latest.turnId || result.conversation?.readOnly) return;
  try {
    const { turn } = await api('turn', null, { conversationId: result.conversation.id, turnId: latest.turnId });
    if (current(uid, epoch) && turn && turn.status !== 'completed') publish({ pending: { turnId: latest.turnId,
      conversationId: result.conversation.id, message: latest.content, selection: turn.selection || {}, status: turn.status }, status: 'Your previous question is saved.' });
  } catch { if (current(uid, epoch)) publish({ pending: { turnId: latest.turnId, conversationId: result.conversation.id, message: latest.content, selection: {}, status: 'unknown' } }); }
}
let historyRequest = 0;
async function loadHistory(search = '', cursor = null) {
  const uid = state.uid; const epoch = requestEpoch; const request = ++historyRequest;
  try {
    const result = await api('workspace', null, { search, cursor });
    if (!current(uid, epoch) || request !== historyRequest) return;
    if (result.scope?.key && result.scope.key !== state.workspace?.scope?.key) return loadWorkspace(uid, true);
    publish({ workspace: { ...state.workspace, conversations: cursor ? mergeMessages(state.workspace?.conversations || [], result.conversations) : result.conversations || [], nextCursor: result.nextCursor || null } });
  } catch (error) { if (current(uid, epoch) && request === historyRequest) publish({ error: error.message }); }
}
async function loadWorkspace(uid, force = false) {
  if (!uid || uid !== uidNow() || state.busy) return;
  if (loadPromise && state.uid === uid) return loadPromise;
  if (state.uid === uid && state.workspace && !force) return;
  if (state.uid && state.uid !== uid) clearDrafts();
  const epoch = ++requestEpoch;
  publish({ ...(state.uid !== uid ? initial : {}), uid, loading: true, error: '' });
  loadPromise = (async () => {
    try {
      const workspace = await api('workspace');
      if (!current(uid, epoch)) return;
      publish({ workspace, draft: readDraft(workspace) });
      const id = workspace.activeConversationId;
      if (id) {
        const result = await api('conversation', null, { conversationId: id });
        if (!current(uid, epoch)) return;
        publish({ conversation: result.conversation, messages: result.messages || [], nextCursor: result.nextCursor || null, animateId: null });
        await restorePending(result, uid, epoch);
      } else publish({ conversation: null, messages: [], nextCursor: null });
    } catch (error) { if (current(uid, epoch)) publish({ error: error.message }); }
    finally { if (current(uid, epoch)) publish({ loading: false }); loadPromise = null; }
  })();
  return loadPromise;
}
async function createConversation() {
  if (state.busy || state.loading) return null;
  const uid = state.uid; const epoch = requestEpoch;
  publish({ loading: true, error: '' });
  try {
    const scopeKey = draftKey();
    if (!creationRequest || creationRequest.scopeKey !== scopeKey) creationRequest = { scopeKey, requestId: newId() };
    const result = await api('create', { requestId: creationRequest.requestId });
    if (!current(uid, epoch)) return null;
    creationRequest = null;
    updateConversation(result.conversation);
    publish({ messages: result.messages || [], nextCursor: null, pending: null, animateId: null });
    return result.conversation;
  } catch (error) { if (current(uid, epoch)) publish({ error: error.message }); return null; }
  finally { if (current(uid, epoch)) publish({ loading: false }); }
}
async function refreshConversation(id, uid, epoch) {
  const result = await api('conversation', null, { conversationId: id });
  if (!current(uid, epoch)) return;
  updateConversation(result.conversation);
  publish({ messages: result.messages || [], nextCursor: result.nextCursor || null });
}
async function send(message, selection = {}, retry = null) {
  const text = message.trim();
  if (!text || state.busy || state.loading || !state.workspace?.generationEnabled) return;
  let conversation = state.conversation;
  if (!conversation) conversation = await createConversation();
  if (!conversation || conversation.readOnly) return;
  const uid = state.uid; const epoch = requestEpoch;
  const turnId = newId();
  const pending = { turnId, conversationId: conversation.id, message: text, selection, status: 'sending' };
  publish({ busy: true, status: 'Reading the relevant evidence…', error: '', pending, animateId: null });
  writeDraft('');
  try {
    const result = await api('send', { conversationId: conversation.id, turnId, expectedRevision: conversation.revision, message: text, selection, ...(retry && retry.status !== 'not_saved' ? { retryOf: retry.turnId } : {}) });
    if (!current(uid, epoch)) return;
    updateConversation(result.conversation);
    const messages = mergeMessages(state.messages, result.messages);
    const assistant = result.messages?.find(item => item.role === 'assistant');
    const pendingTurn = result.turn?.status !== 'completed' && !assistant;
    publish({ messages, animateId: assistant?.id || null, pending: pendingTurn ? { ...pending, status: result.turn?.status || 'pending' } : null,
      error: result.turn?.error?.message || (typeof result.turn?.error === 'string' ? result.turn.error : ''),
      status: pendingTurn ? 'Your question is saved. Check the reply shortly.' : 'Reply saved.' });
  } catch (error) {
    if (!current(uid, epoch)) return;
    // A lost HTTP response does not establish that generation failed. Read the
    // saved turn before offering a paid retry, never silently submit a new turn.
    try {
      const result = await api('turn', null, { conversationId: conversation.id, turnId });
      if (!current(uid, epoch)) return;
      if (result.turn?.status === 'completed') {
        await refreshConversation(conversation.id, uid, epoch);
        if (current(uid, epoch)) publish({ pending: null, status: 'Reply restored from your saved conversation.' });
      } else {
        await refreshConversation(conversation.id, uid, epoch);
        if (current(uid, epoch)) publish({ pending: { ...pending, status: result.turn?.status || 'unknown' }, error: error.message });
      }
    } catch {
      if (current(uid, epoch)) publish({ pending: { ...pending, status: error.status && error.status < 500 ? 'not_saved' : 'unknown' }, error: error.message });
    }
  } finally { if (current(uid, epoch)) publish({ busy: false }); }
}
async function checkReply() {
  const pending = state.pending;
  if (!pending || state.busy) return;
  const uid = state.uid; const epoch = requestEpoch;
  publish({ busy: true, error: '', status: 'Checking your saved reply…' });
  try {
    const result = await api('turn', null, { conversationId: pending.conversationId, turnId: pending.turnId });
    if (!current(uid, epoch)) return;
    await refreshConversation(pending.conversationId, uid, epoch);
    if (current(uid, epoch)) publish({ pending: result.turn?.status === 'completed' ? null : { ...pending, status: result.turn?.status || 'unknown' }, status: result.turn?.status === 'completed' ? 'Reply saved.' : 'No completed reply yet. Your previous messages are saved.' });
  } catch (error) { if (current(uid, epoch)) publish({ error: error.message }); }
  finally { if (current(uid, epoch)) publish({ busy: false }); }
}
async function check(kind, selection) {
  if (state.busy || !selection?.pageUrl) return;
  const uid = state.uid; const epoch = requestEpoch;
  publish({ busy: true, error: '', status: kind === 'activity' ? 'Checking the latest search data…' : kind === 'progress' ? 'Checking saved page progress…' : 'Checking this page…' });
  try {
    const result = await api('check', { requestId: newId(), kind, selection });
    if (!current(uid, epoch)) return;
    const check = result.check;
    publish({ lastCheck: check || null, status: result.message || check?.message || (check?.pending ? 'A check is already running. Try again shortly.' : check?.lastError ? 'Some observations could not be updated. Your saved information is preserved.' : check?.cached ? 'Showing your recent saved check. Try again after the 15-minute cooldown for a new check.' : 'Check saved. Your website and task plan are unchanged.') });
  } catch (error) { if (current(uid, epoch)) publish({ error: error.message, status: '' }); }
  finally { if (current(uid, epoch)) publish({ busy: false }); }
}
async function metadata(action, id, extra = {}) {
  if (state.busy) return;
  const row = state.workspace?.conversations?.find(item => item.id === id);
  const uid = state.uid; const epoch = requestEpoch;
  publish({ busy: true, error: '' });
  try {
    const result = await api(action, { conversationId: id, expectedRevision: row?.revision, ...extra });
    if (!current(uid, epoch)) return;
    if (action === 'delete') {
      publish({ workspace: { ...state.workspace, conversations: state.workspace.conversations.filter(item => item.id !== id) },
        ...(state.conversation?.id === id ? { conversation: null, messages: [], pending: null, nextCursor: null } : {}) });
    } else if (result.conversation) {
      publish({ workspace: { ...state.workspace, conversations: state.workspace.conversations.map(item => item.id === id ? result.conversation : item) },
        ...(state.conversation?.id === id ? { conversation: result.conversation } : {}) });
    }
  } catch (error) { if (current(uid, epoch)) publish({ error: error.message }); }
  finally { if (current(uid, epoch)) publish({ busy: false }); }
}
async function loadOlder() {
  if (!state.nextCursor || state.busy) return;
  const uid = state.uid; const epoch = requestEpoch;
  publish({ busy: true });
  try {
    const result = await api('conversation', null, { conversationId: state.conversation.id, cursor: state.nextCursor });
    if (current(uid, epoch)) publish({ messages: mergeMessages(result.messages || [], state.messages), nextCursor: result.nextCursor || null });
  } catch (error) { if (current(uid, epoch)) publish({ error: error.message }); }
  finally { if (current(uid, epoch)) publish({ busy: false }); }
}

const completeAnimation = () => { if (state.animateId) publish({ animateId: null }); };

export default function useMentorSession(uid) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    watchAuth(); if (uid) loadWorkspace(uid, true);
    const resume = () => { if (uid && document.visibilityState === 'visible') loadWorkspace(uid, true); };
    window.addEventListener('focus', resume);
    return () => window.removeEventListener('focus', resume);
  }, [uid]);
  // Every response and render is account-scoped, including while AuthProvider
  // and Firebase are settling after a switch between accounts.
  return { ...(snapshot.uid === uid ? snapshot : initial), writeDraft, send, check, checkReply,
    reload: () => loadWorkspace(uid, true), createConversation,
    openConversation: id => loadConversation(id, false),
    activate: id => loadConversation(id, true), metadata, loadOlder, loadHistory,
    completeAnimation };
}
