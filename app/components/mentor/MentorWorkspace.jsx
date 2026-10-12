"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowUp, History, X, Maximize2, Search, Pencil, Trash2, Loader2, RefreshCw, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useAuth } from '../../contexts/AuthContext';
import useMentorSession from './useMentorSession';
import MentorMessage from './MentorMessage';
import MentorCheckResult from './MentorCheckResult';

const starters = ['How is my homepage doing?', 'What should I work on next?', 'Why might a page not be indexed?'];
function routeSelection() {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries([['pageUrl', params.get('page') || params.get('pageUrl')], ['cycleId', params.get('cycleId')], ['planId', params.get('planId')]].filter(([, value]) => value));
}
function labelPage(value) { try { const url = new URL(value); return url.pathname === '/' ? 'Homepage' : url.pathname; } catch { return value; } }
export default function MentorWorkspace({ compact = false, onClose }) {
  const { user } = useAuth();
  const session = useMentorSession(user?.id);
  const pathname = usePathname();
  const [showHistory, setShowHistory] = useState(false);
  const [search, setSearch] = useState('');
  const [rename, setRename] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [selection, setSelection] = useState({});
  const scrollRef = useRef(null);
  const followBottom = useRef(true);
  const draftRef = useRef(null);
  const previousConversation = useRef(null);
  const { completeAnimation, loadHistory } = session;
  const currentSearch = typeof window === 'undefined' ? '' : window.location.search;
  useEffect(() => { setSelection(routeSelection()); }, [pathname, currentSearch]);
  useEffect(() => {
    const refreshSelection = () => setSelection(routeSelection());
    window.addEventListener('popstate', refreshSelection);
    window.addEventListener('mentorSelectionChanged', refreshSelection);
    return () => { window.removeEventListener('popstate', refreshSelection); window.removeEventListener('mentorSelectionChanged', refreshSelection); };
  }, []);
  useEffect(() => {
    if (previousConversation.current !== session.conversation?.id) {
      followBottom.current = true; previousConversation.current = session.conversation?.id;
    }
    if (followBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session.messages, session.pending, session.conversation?.id]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => { if (followBottom.current) node.scrollTop = node.scrollHeight; });
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [session.loading]);
  const busy = session.busy || session.loading;
  const readOnly = Boolean(session.conversation?.readOnly || session.conversation?.legacy);
  const workspace = session.workspace;
  const enabled = Boolean(workspace?.generationEnabled && workspace?.enabled);
  const selectedPage = selection.pageUrl || workspace?.homepageUrl || workspace?.scope?.websiteUrl;
  const effectiveSelection = { ...selection, ...(selectedPage ? { pageUrl: selectedPage } : {}) };
  const options = workspace?.pageOptions || [];
  const pages = [...new Map([...(selectedPage ? [{ pageUrl: selectedPage, label: labelPage(selectedPage) }] : []), ...options.map(option => typeof option === 'string' ? { pageUrl: option, label: labelPage(option) } : { ...option, pageUrl: option.pageUrl || option.url, label: option.label || option.title || labelPage(option.pageUrl || option.url) })].filter(option => option.pageUrl).map(option => [option.pageUrl, option])).values()];
  const conversations = workspace?.conversations || [];
  useEffect(() => { if (!showHistory) return; const timeout = setTimeout(() => loadHistory(search), 200); return () => clearTimeout(timeout); }, [showHistory, search, loadHistory]);
  const submit = event => { event?.preventDefault(); followBottom.current = true; session.send(session.draft, effectiveSelection); };
  const pendingShown = session.pending && !session.messages.some(message => message.turnId === session.pending.turnId || message.id === `${session.pending.turnId}-user`);
  const terminalFailure = ['failed', 'unknown', 'not_saved'].includes(session.pending?.status);
  const newChat = async () => { await session.createConversation(); setShowHistory(false); draftRef.current?.focus(); };
  return <section aria-label="SEO Mentor workspace" className={`flex min-w-0 flex-col bg-background ${compact ? 'w-full h-[min(660px,75dvh)]' : 'h-[calc(100dvh-130px)] min-h-[440px] max-h-[1000px] rounded-2xl border border-border overflow-hidden'}`}>
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border p-3 sm:p-4">
      <div className="min-w-32 flex-1"><h1 className={`${compact ? 'text-base' : 'text-xl'} font-semibold`}>SEO Mentor</h1><p className="text-xs text-muted-foreground">SEO guidance for your business</p></div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button type="button" variant="outline" size="sm" disabled={busy || !enabled} onClick={newChat}>New chat</Button>
        <Button type="button" variant="ghost" size="icon" aria-label={showHistory ? 'Close conversation history' : 'Open conversation history'} onClick={() => setShowHistory(!showHistory)}><History className="h-4 w-4" /></Button>
        {compact ? <><Button variant="ghost" size="icon" asChild><a href="/chatbot" aria-label="Open full SEO Mentor"><Maximize2 className="h-4 w-4" /></a></Button><Button variant="ghost" size="icon" aria-label="Close SEO Mentor" onClick={onClose}><X className="h-4 w-4" /></Button></> : null}
      </div>
    </header>
    <div className="flex flex-1 min-h-0 relative">
      {showHistory ? <aside aria-label="Conversation history" className={`border-r border-border bg-card p-3 flex flex-col min-h-0 ${compact ? 'absolute inset-0 z-10' : 'absolute inset-0 z-10 sm:relative sm:w-72 sm:shrink-0'}`}>
        <div className="flex items-center gap-2 mb-3"><Search className="h-4 w-4 text-muted-foreground" /><Input aria-label="Search conversations" placeholder="Search conversations" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <div className="flex-1 overflow-y-auto space-y-2">
          {conversations.length === 0 ? <p className="text-sm text-muted-foreground p-2">{search ? 'No matching conversations.' : 'Your saved conversations will appear here.'}</p> : null}
          {conversations.map(row => <div key={row.id} className={`rounded-xl border p-2 ${row.id === session.conversation?.id ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
            {rename?.id === row.id ? <form onSubmit={async event => { event.preventDefault(); await session.metadata('rename', row.id, { title: rename.title }); setRename(null); }} className="space-y-2"><Input aria-label="Conversation name" autoFocus value={rename.title} maxLength={100} onChange={event => setRename({ ...rename, title: event.target.value })} /><div className="flex gap-1"><Button size="sm" disabled={busy || !rename.title.trim()}>Save name</Button><Button type="button" size="sm" variant="ghost" onClick={() => setRename(null)}>Cancel</Button></div></form> : <>
              <button type="button" disabled={busy} className="text-left text-sm w-full p-1 break-words" onClick={async () => { await session.openConversation(row.id); setShowHistory(false); }}>{row.title || 'SEO conversation'}{row.legacy || row.readOnly ? <span className="block text-xs text-muted-foreground mt-1">Previous website / legacy history</span> : null}</button>
              <div className="flex justify-end"><Button variant="ghost" size="icon" aria-label={`Rename ${row.title || 'conversation'}`} disabled={busy} onClick={() => setRename({ id: row.id, title: row.title || '' })}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="icon" aria-label={`Delete ${row.title || 'conversation'}`} disabled={busy} onClick={() => setDeleteId(row.id)}><Trash2 className="h-3 w-3" /></Button></div>
              {deleteId === row.id ? <div role="alert" className="text-sm border-t border-border pt-2">Delete this conversation? Your SEO plans and tracking stay saved.<div className="flex gap-1 mt-2"><Button size="sm" variant="destructive" disabled={busy} onClick={async () => { await session.metadata('delete', row.id); setDeleteId(null); }}>Delete conversation</Button><Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button></div></div> : null}
            </>}
          </div>)}
        </div>
        {workspace?.nextCursor ? <Button variant="ghost" size="sm" onClick={() => session.loadHistory(search, workspace.nextCursor)}>Load more conversations</Button> : null}
        <Button variant="ghost" onClick={() => setShowHistory(false)}>Back to conversation</Button>
      </aside> : null}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div ref={scrollRef} role="log" aria-label="SEO conversation" aria-live="polite" aria-relevant="additions" aria-busy={session.loading} tabIndex={0} onScroll={event => { const node = event.currentTarget; followBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 focus-visible:outline focus-visible:outline-primary">
          <div className="max-w-3xl mx-auto space-y-4">
            {session.loading ? <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Opening your saved conversation…</div> : null}
            {!session.loading && session.messages.length === 0 && !session.pending ? <div className="py-6 sm:py-10">
              <p className="text-xs uppercase tracking-wider font-semibold text-primary">Your SEO questions, explained</p><h2 className="text-xl sm:text-2xl font-semibold mt-3">What would you like help with?</h2><p className="text-sm text-muted-foreground mt-3 max-w-lg">Ask about your website, your next steps, or how SEO works. I use saved account evidence and Google guidance when relevant.</p>
              <div className="flex flex-col items-start gap-2 mt-6">{starters.map(question => <Button key={question} variant="outline" className="h-auto py-2 text-left whitespace-normal" disabled={!enabled} onClick={() => { session.writeDraft(question); draftRef.current?.focus(); }}>{question}</Button>)}</div>
            </div> : null}
            {readOnly ? <div className="border border-amber-500/30 bg-amber-500/5 p-3 rounded-xl text-sm"><p className="font-medium">Saved conversation history</p><p className="text-muted-foreground mt-1">These older messages may describe an earlier website. Start a current conversation to check today’s saved evidence.</p><Button size="sm" variant="outline" className="mt-3" disabled={busy || !enabled} onClick={() => session.activate(session.conversation.id)}>Continue in a current conversation</Button></div> : null}
            {session.nextCursor ? <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { const node = scrollRef.current; const height = node?.scrollHeight || 0; const top = node?.scrollTop || 0; followBottom.current = false; await session.loadOlder(); requestAnimationFrame(() => { if (node) node.scrollTop = top + node.scrollHeight - height; }); }}>Load earlier messages</Button> : null}
            {session.messages.map(message => <MentorMessage key={message.id} message={message} animate={message.id === session.animateId} onComplete={completeAnimation} busy={busy} onCheck={action => session.check(action.kind === 'technical' ? 'page' : action.kind, { pageUrl: action.pageUrl, ...(action.cycleId ? { cycleId: action.cycleId } : {}) })} />)}
            {pendingShown ? <div aria-label="Your pending question" className="ml-auto max-w-[92%] rounded-2xl bg-primary/10 border border-primary/20 p-4 text-sm"><p className="text-xs text-muted-foreground mb-2">You · {session.pending.status === 'sending' ? 'sending' : 'waiting for reply'}</p><p className="whitespace-pre-wrap">{session.pending.message}</p></div> : null}
            {session.lastCheck ? <MentorCheckResult check={session.lastCheck} /> : null}
            {session.pending && !session.busy ? <div className="border border-border rounded-xl p-3 text-sm"><p>{terminalFailure ? 'This reply did not finish. Your earlier conversation is saved.' : 'Your question is saved. The reply is not ready yet.'}</p><div className="flex flex-wrap gap-2 mt-2"><Button size="sm" variant="outline" onClick={session.checkReply}>Check saved reply</Button>{terminalFailure && enabled ? <Button size="sm" variant="outline" onClick={() => session.send(session.pending.message, session.pending.selection, session.pending)}>Retry answer</Button> : null}</div>{terminalFailure ? <p className="text-xs text-muted-foreground mt-2">Retrying starts a new request and uses your mentor allowance.</p> : null}</div> : null}
          </div>
        </div>
        <div className="border-t border-border p-3 sm:p-4">
          <div className="max-w-3xl mx-auto">
            {session.error ? <div role="alert" className="text-sm rounded-lg border border-destructive/30 bg-destructive/5 p-3 mb-2">{session.error}{!workspace ? <Button size="sm" variant="ghost" onClick={session.reload}>Try again</Button> : null}</div> : null}
            <div role="status" aria-live="polite" className="text-xs text-muted-foreground min-h-5 mb-1 flex items-center gap-2">{session.busy ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : null}{session.status}</div>
            {!session.loading && workspace && !enabled ? <p className="text-sm text-muted-foreground mb-3">{workspace.notice || 'New mentor replies are paused. Your saved conversations remain available.'}</p> : null}
            {selectedPage && !readOnly && enabled ? <details className="mb-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Page context · {labelPage(selectedPage)}</summary><div className="mt-2 space-y-2"><label htmlFor={`mentor-page-${compact ? 'widget' : 'full'}`} className="block">Page to discuss or check</label><select id={`mentor-page-${compact ? 'widget' : 'full'}`} className="w-full rounded-lg border border-border bg-background p-2 text-sm" value={selectedPage} disabled={busy} onChange={event => setSelection({ pageUrl: event.target.value })}>{pages.map(page => <option value={page.pageUrl} key={page.pageUrl}>{page.label}</option>)}</select><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => session.check('activity', effectiveSelection)}><RefreshCw className="h-3 w-3 mr-1" />Check latest data</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => session.check('page', effectiveSelection)}><Globe className="h-3 w-3 mr-1" />Check this page</Button></div><p className="text-muted-foreground">Checks update observations only. They don’t edit your website or mark tasks complete.</p></div></details> : null}
            <form onSubmit={submit} className="flex items-end gap-2">
              <Textarea ref={draftRef} aria-label="Ask your SEO question" placeholder={readOnly ? 'Open a current conversation to continue' : 'Ask an SEO question…'} value={session.draft} maxLength={6000} disabled={busy || !enabled || readOnly} onChange={event => session.writeDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} className="min-h-[64px] max-h-40 resize-y text-base" />
              <Button type="submit" size="icon" aria-label="Send question" disabled={busy || !enabled || readOnly || !session.draft.trim()}><ArrowUp className="h-5 w-5" /></Button>
            </form><p className="text-[11px] text-muted-foreground mt-2">Guidance can be mistaken. Check important details before editing your website.</p>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
