"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowUp, History, X, Maximize2, Search, Pencil, Trash2, RefreshCw, Globe, SquarePen, ChevronDown } from 'lucide-react';
import BrandLoader, { PageLoader } from '@/app/components/BrandLoader';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useAuth } from '../../contexts/AuthContext';
import useMentorSession from './useMentorSession';
import MentorMessage, { MentorMark } from './MentorMessage';
import MentorCheckResult from './MentorCheckResult';
import MentorDot from './MentorDot';
import { firstNameFrom, pickTagline } from './mentorTaglines';

const starters = ['How is my homepage doing?', 'What should I work on next?', 'Why might a page not be indexed?'];
function routeSelection() {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries([['pageUrl', params.get('page') || params.get('pageUrl')], ['cycleId', params.get('cycleId')], ['planId', params.get('planId')]].filter(([, value]) => value));
}
function labelPage(value) { try { const url = new URL(value); return url.pathname === '/' ? 'Homepage' : url.pathname; } catch { return value; } }
export default function MentorWorkspace(props) {
  const { user } = useAuth();
  const session = useMentorSession(user?.id);
  return <MentorWorkspaceView {...props} session={session} firstName={firstNameFrom(user?.displayName)} />;
}

/** The mentor's screen. It only draws what the session holds, so it can be shown with any session data. */
export function MentorWorkspaceView({ session, compact = false, onClose, firstName = '' }) {
  const pathname = usePathname();
  const [showHistory, setShowHistory] = useState(false);
  const [search, setSearch] = useState('');
  const [rename, setRename] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [selection, setSelection] = useState({});
  // A light-hearted greeting, picked after the page loads so the server and browser never disagree.
  const [tagline, setTagline] = useState('');
  useEffect(() => { setTagline(pickTagline(firstName)); }, [firstName]);
  const scrollRef = useRef(null);
  const followBottom = useRef(true);
  const draftRef = useRef(null);
  const previousConversation = useRef(null);
  const hasTurns = session.messages.length > 0 || Boolean(session.pending);
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
    // A conversation stays at its latest message; an empty chat stays at its greeting.
    if (followBottom.current && scrollRef.current) scrollRef.current.scrollTop = hasTurns ? scrollRef.current.scrollHeight : 0;
  }, [session.messages, session.pending, session.conversation?.id, hasTurns]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => { if (followBottom.current) node.scrollTop = hasTurns ? node.scrollHeight : 0; });
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [session.loading, hasTurns]);
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
  const newChat = async () => { await session.createConversation(); setShowHistory(false); setTagline(current => pickTagline(firstName, current)); draftRef.current?.focus(); };
  const empty = !session.loading && session.messages.length === 0 && !session.pending;
  // A new chat opens with the greeting and the message box together in the middle of the page.
  const centred = empty && !compact && !showHistory;
  const thinking = session.busy && session.pending?.status === 'sending';

  // What the mentor's dot is doing. None of this changes the conversation.
  const [typing, setTyping] = useState(false);
  const [nod, setNod] = useState(0);
  const [cheer, setCheer] = useState(false);
  const typingTimer = useRef(null);
  const cheerTimer = useRef(null);
  const noteTyping = () => {
    setNod(count => count + 1);
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1600);
  };
  // A new reply gets a happy hop.
  useEffect(() => {
    if (!session.animateId) return;
    setCheer(true);
    clearTimeout(cheerTimer.current);
    cheerTimer.current = setTimeout(() => setCheer(false), 1800);
  }, [session.animateId]);
  useEffect(() => () => { clearTimeout(typingTimer.current); clearTimeout(cheerTimer.current); }, []);
  const dotMood = session.busy ? 'thinking'
    : cheer ? 'happy'
    : typing ? ((session.draft || '').trim().endsWith('?') ? 'curious' : 'listening')
    : session.error || terminalFailure ? 'worried'
    : 'idle';

  const starterButtons = <div className={`mt-4 flex flex-wrap gap-2 ${centred ? 'justify-center' : ''}`}>{starters.map(question => <Button key={question} type="button" variant="outline" size="sm" className="h-auto whitespace-normal rounded-full px-4 py-2 text-left font-normal text-muted-foreground hover:text-foreground" disabled={!enabled} onClick={() => { session.writeDraft(question); draftRef.current?.focus(); }}>{question}</Button>)}</div>;

  return <section aria-label="SEO Mentor workspace" className={`flex min-w-0 flex-col bg-background ${compact ? 'h-[min(660px,75dvh)] w-full' : 'h-[calc(100dvh-120px)] min-h-[440px]'}`}>
    <header className={`flex items-center justify-between gap-2 ${compact ? 'border-b border-border p-3' : 'px-1 pb-3 sm:px-2'}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* On a new full-page chat the large dot in the middle does the reacting, so this one stays calm. */}
        <MentorDot size={32} mood={centred ? 'idle' : dotMood} nod={nod} calm={centred} />
        <div className="min-w-0"><h1 className="truncate text-base font-semibold leading-tight">SEO Mentor</h1><p className={`text-xs text-muted-foreground ${compact ? 'sr-only' : 'hidden sm:block'}`}>SEO guidance for your business</p></div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size={compact ? 'icon' : 'sm'} className="rounded-full" disabled={busy || !enabled} onClick={newChat}><SquarePen className="h-4 w-4" aria-hidden="true" /><span className={compact ? 'sr-only' : ''}>New chat</span></Button>
        <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label={showHistory ? 'Close conversation history' : 'Open conversation history'} onClick={() => setShowHistory(!showHistory)}><History className="h-4 w-4" /></Button>
        {compact ? <><Button variant="ghost" size="icon" className="rounded-full" asChild><a href="/chatbot" aria-label="Open full SEO Mentor"><Maximize2 className="h-4 w-4" /></a></Button><Button variant="ghost" size="icon" className="rounded-full" aria-label="Close SEO Mentor" onClick={onClose}><X className="h-4 w-4" /></Button></> : null}
      </div>
    </header>

    <div className="relative flex min-h-0 flex-1">
      {showHistory ? <aside aria-label="Conversation history" className={`flex min-h-0 flex-col bg-background p-3 ${compact ? 'absolute inset-0 z-10' : 'absolute inset-0 z-10 sm:relative sm:mr-4 sm:w-72 sm:shrink-0 sm:rounded-2xl sm:border sm:border-border sm:bg-card/40'}`}>
        <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search conversations" placeholder="Search conversations" className="rounded-full pl-9" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {conversations.length === 0 ? <p className="p-2 text-sm text-muted-foreground">{search ? 'No matching conversations.' : 'Your saved conversations will appear here.'}</p> : null}
          {conversations.map(row => <div key={row.id} className={`group rounded-xl px-2 py-1.5 transition-colors ${row.id === session.conversation?.id ? 'bg-primary/10' : 'hover:bg-muted/60'}`}>
            {rename?.id === row.id ? <form onSubmit={async event => { event.preventDefault(); await session.metadata('rename', row.id, { title: rename.title }); setRename(null); }} className="space-y-2 py-1"><Input aria-label="Conversation name" autoFocus value={rename.title} maxLength={100} onChange={event => setRename({ ...rename, title: event.target.value })} /><div className="flex gap-1"><Button size="sm" disabled={busy || !rename.title.trim()}>Save name</Button><Button type="button" size="sm" variant="ghost" onClick={() => setRename(null)}>Cancel</Button></div></form> : <>
              <div className="flex items-start gap-1">
                <button type="button" disabled={busy} className="min-w-0 flex-1 break-words py-1 text-left text-sm" onClick={async () => { await session.openConversation(row.id); setShowHistory(false); }}>{row.title || 'SEO conversation'}{row.legacy || row.readOnly ? <span className="mt-1 block text-xs text-muted-foreground">Previous website / legacy history</span> : null}</button>
                <div className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" aria-label={`Rename ${row.title || 'conversation'}`} disabled={busy} onClick={() => setRename({ id: row.id, title: row.title || '' })}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" aria-label={`Delete ${row.title || 'conversation'}`} disabled={busy} onClick={() => setDeleteId(row.id)}><Trash2 className="h-3 w-3" /></Button></div>
              </div>
              {deleteId === row.id ? <div role="alert" className="mt-1 border-t border-border pt-2 text-sm">Delete this conversation? Your SEO plans and tracking stay saved.<div className="mt-2 flex gap-1"><Button size="sm" variant="destructive" disabled={busy} onClick={async () => { await session.metadata('delete', row.id); setDeleteId(null); }}>Delete conversation</Button><Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button></div></div> : null}
            </>}
          </div>)}
        </div>
        {workspace?.nextCursor ? <Button variant="ghost" size="sm" onClick={() => session.loadHistory(search, workspace.nextCursor)}>Load more conversations</Button> : null}
        <Button variant="ghost" className="mt-1 rounded-full" onClick={() => setShowHistory(false)}>Back to conversation</Button>
      </aside> : null}

      <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${centred ? 'sm:justify-center sm:pb-[8vh]' : ''}`}>
        <div ref={scrollRef} role="log" aria-label="SEO conversation" aria-live="polite" aria-relevant="additions" aria-busy={session.loading} tabIndex={0} onScroll={event => { const node = event.currentTarget; followBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} className={`overflow-y-auto overscroll-contain px-3 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] focus-visible:outline focus-visible:outline-primary sm:px-5 ${centred ? 'flex-1 pt-6 sm:flex-none' : 'flex-1 py-4'}`}>
          <div className={`mx-auto max-w-3xl space-y-6 ${centred ? 'flex min-h-full flex-col justify-center sm:block' : ''}`}>
            {session.loading ? <PageLoader compact label="Opening your saved conversation…" /> : null}
            {empty ? <div className={centred ? 'pb-7 text-center' : compact ? 'py-2' : 'py-6'}>
              {centred ? <div className="mb-5 flex justify-center"><MentorDot size={48} mood={dotMood} nod={nod} /></div> : null}
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Your SEO questions, explained</p>
              <h2 className={`mt-3 text-balance font-semibold tracking-tight transition-opacity duration-500 motion-reduce:transition-none ${centred ? 'mx-auto max-w-2xl text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'} ${tagline ? '' : 'opacity-0'}`}>{tagline || 'What would you like help with?'}</h2>
              <p className={`mt-3 text-sm leading-relaxed text-muted-foreground ${centred ? 'mx-auto max-w-md' : 'max-w-lg'}`}>Ask about your website, your next steps, or how SEO works. I use saved account evidence and Google guidance when relevant.</p>
              {centred ? null : starterButtons}
            </div> : null}
            {readOnly ? <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p className="font-medium">Saved conversation history</p><p className="mt-1 text-muted-foreground">These older messages may describe an earlier website. Start a current conversation to check today’s saved evidence.</p><Button size="sm" variant="outline" className="mt-3 rounded-full" disabled={busy || !enabled} onClick={() => session.activate(session.conversation.id)}>Continue in a current conversation</Button></div> : null}
            {session.nextCursor ? <div className="text-center"><Button size="sm" variant="ghost" className="rounded-full" disabled={busy} onClick={async () => { const node = scrollRef.current; const height = node?.scrollHeight || 0; const top = node?.scrollTop || 0; followBottom.current = false; await session.loadOlder(); requestAnimationFrame(() => { if (node) node.scrollTop = top + node.scrollHeight - height; }); }}>Load earlier messages</Button></div> : null}
            {session.messages.map(message => <MentorMessage key={message.id} message={message} animate={message.id === session.animateId} onComplete={completeAnimation} busy={busy} onCheck={action => session.check(action.kind === 'technical' ? 'page' : action.kind, { pageUrl: action.pageUrl, ...(action.cycleId ? { cycleId: action.cycleId } : {}) })} />)}
            {pendingShown ? <div aria-label="Your pending question" className="ml-auto w-fit max-w-[85%]"><p className="whitespace-pre-wrap rounded-3xl rounded-br-lg bg-muted px-4 py-2.5 text-[15px] leading-relaxed">{session.pending.message}</p><p className="mt-1 text-right text-xs text-muted-foreground">You · {session.pending.status === 'sending' ? 'sending' : 'waiting for reply'}</p></div> : null}
            {thinking ? <div className="flex items-center gap-3" aria-hidden="true"><MentorMark className="h-8 w-8" /><BrandLoader tone="brand" className="h-5 w-5" /></div> : null}
            {session.lastCheck ? <MentorCheckResult check={session.lastCheck} /> : null}
            {session.pending && !session.busy ? <div className="rounded-2xl border border-border p-4 text-sm"><p>{terminalFailure ? 'This reply did not finish. Your earlier conversation is saved.' : 'Your question is saved. The reply is not ready yet.'}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" className="rounded-full" onClick={session.checkReply}>Check saved reply</Button>{terminalFailure && enabled ? <Button size="sm" variant="outline" className="rounded-full" onClick={() => session.send(session.pending.message, session.pending.selection, session.pending)}>Retry answer</Button> : null}</div>{terminalFailure ? <p className="mt-2 text-xs text-muted-foreground">Retrying starts a new request and uses your mentor allowance.</p> : null}</div> : null}
          </div>
        </div>

        <div className={`px-3 sm:px-5 ${compact ? 'border-t border-border py-3' : 'pb-1 pt-2'}`}>
          <div className="mx-auto max-w-3xl">
            {session.error ? <div role="alert" className="mb-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">{session.error}{!workspace ? <Button size="sm" variant="ghost" onClick={session.reload}>Try again</Button> : null}</div> : null}
            <div role="status" aria-live="polite" className={`mb-1.5 flex min-h-5 items-center gap-2 px-2 text-xs text-muted-foreground ${centred ? 'justify-center' : ''}`}>{session.busy ? <BrandLoader tone="brand" aria-hidden="true" className="h-3.5 w-3.5" /> : null}{session.status}</div>
            {!session.loading && workspace && !enabled ? <p className="mb-3 px-2 text-sm text-muted-foreground">{workspace.notice || 'New mentor replies are paused. Your saved conversations remain available.'}</p> : null}
            <form onSubmit={submit} className="relative rounded-[1.75rem] border border-border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_12%,transparent)]">
              <Textarea ref={draftRef} aria-label="Ask your SEO question" placeholder={readOnly ? 'Open a current conversation to continue' : 'Ask an SEO question…'} value={session.draft} maxLength={6000} disabled={busy || !enabled || readOnly} onChange={event => { session.writeDraft(event.target.value); noteTyping(); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} className="max-h-40 min-h-[52px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-5 pb-1 pt-4 text-base shadow-none focus-visible:ring-0 md:text-base dark:bg-transparent" />
              <div className="flex items-end justify-between gap-2 px-3 pb-3 pt-1">
                {selectedPage && !readOnly && enabled ? <details className="group min-w-0 text-xs">
                  <summary className="inline-flex max-w-full cursor-pointer list-none items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"><Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">Page context · {labelPage(selectedPage)}</span><ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
                  <div className="absolute inset-x-0 bottom-full z-20 mb-2 space-y-2 rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lg"><label htmlFor={`mentor-page-${compact ? 'widget' : 'full'}`} className="block">Page to discuss or check</label><select id={`mentor-page-${compact ? 'widget' : 'full'}`} className="w-full rounded-lg border border-border bg-background p-2 text-sm" value={selectedPage} disabled={busy} onChange={event => setSelection({ pageUrl: event.target.value })}>{pages.map(page => <option value={page.pageUrl} key={page.pageUrl}>{page.label}</option>)}</select><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => session.check('activity', effectiveSelection)}><RefreshCw className="mr-1 h-3 w-3" />Check latest data</Button><Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => session.check('page', effectiveSelection)}><Globe className="mr-1 h-3 w-3" />Check this page</Button></div><p className="text-muted-foreground">Checks update observations only. They don’t edit your website or mark tasks complete.</p></div>
                </details> : <span />}
                <Button type="submit" size="icon" className="h-9 w-9 shrink-0 rounded-full" aria-label="Send question" disabled={busy || !enabled || readOnly || !session.draft.trim()}><ArrowUp className="h-5 w-5" /></Button>
              </div>
            </form>
            {centred ? starterButtons : null}
            <p className={`mt-3 px-2 text-[11px] text-muted-foreground ${centred || !compact ? 'text-center' : ''}`}>Guidance can be mistaken. Check important details before editing your website.</p>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
