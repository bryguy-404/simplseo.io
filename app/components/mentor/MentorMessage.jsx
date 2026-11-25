"use client";

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const allowedRoutes = ['/dashboard', '/low-ctr', '/generic-keywords', '/settings', '/onboarding', '/chatbot'];
export function safeMentorHref(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('/') && !value.startsWith('//') && allowedRoutes.includes(value.split(/[?#]/)[0])) return value;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function SafeLink({ href, children }) {
  const safe = safeMentorHref(href);
  return safe ? <a href={safe} target={safe.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" className="underline underline-offset-4 break-words">{children}</a> : <span>{children}</span>;
}
const markdownComponents = { a: SafeLink, img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
  h1: ({ children }) => <h3 className="mb-2 mt-6 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-6 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h3 className="mb-2 mt-6 text-base font-semibold first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-3 leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5 leading-7 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 leading-7 marker:text-muted-foreground">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>,
  code: ({ children }) => <code className="whitespace-pre-wrap break-words rounded-md bg-muted px-1.5 py-0.5 text-[0.9em]">{children}</code> };

/** The mentor's mark: the green dot from the SimplSEO logo, in a soft green circle. */
export function MentorMark({ className = '' }) {
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-[#00bf63]/15 ${className}`}><span className="h-[34%] w-[34%] rounded-full bg-[#00bf63]" /></span>;
}
function formatDate(value) {
  if (!value) return '';
  const date = new Date(value?.seconds ? value.seconds * 1000 : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}
export default function MentorMessage({ message, animate = false, onComplete, onCheck, busy }) {
  const content = typeof message.content === 'string' ? message.content : '';
  const [visible, setVisible] = useState(animate ? 0 : content.length);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVisible(content.length); return; }
    setVisible(0);
    let length = 0;
    const tick = setInterval(() => {
      length = Math.min(content.length, length + 12); setVisible(length);
      if (length === content.length) clearInterval(tick);
    }, 20);
    return () => clearInterval(tick);
  }, [animate, content]);
  useEffect(() => { if (animate && visible >= content.length) onComplete?.(); }, [animate, visible, content.length, onComplete]);
  const typing = animate && visible < content.length;
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  const sources = Array.isArray(message.sources) ? message.sources : [];
  const cards = (Array.isArray(message.metricCards) ? message.metricCards : []).flatMap(card => {
    if ('value' in card) return [card];
    const unavailable = ['unavailable', 'error', 'failed', 'missing'].includes(card.status);
    const noData = ['no_data', 'no_rows'].includes(card.status);
    return [['Clicks from Google', card.clicks], ['Appearances in search', card.impressions], ['Average position', card.position]].map(([label, value]) => ({
      id: `${card.id}-${label}`, label, title: card.title, pageUrl: card.pageUrl,
      value: unavailable ? 'Not available' : noData ? 'No reported data' : value == null ? 'Not available' : label === 'Average position' ? Number(value).toFixed(1) : value,
      period: card.window, observedAt: card.observedAt, status: card.status }));
  });
  const actions = Array.isArray(message.actions) ? message.actions : [];
  const isUser = message.role === 'user';
  return <article aria-label={isUser ? 'Your question' : 'Mentor answer'} className={isUser ? 'ml-auto w-fit max-w-[85%] rounded-3xl rounded-br-lg bg-muted px-4 py-2.5' : 'flex gap-3'}>
    {isUser ? <p className="sr-only">You</p> : <MentorMark className="mt-0.5 h-8 w-8" />}
    <div className="min-w-0 flex-1">
    {isUser ? null : <p className="mb-1.5 text-xs font-medium text-muted-foreground">SEO Mentor</p>}
    <div className="min-w-0 break-words text-[15px] sm:text-base" aria-hidden={typing || undefined}>
      <ReactMarkdown components={markdownComponents}>{content.slice(0, visible)}</ReactMarkdown>
    </div>
    {typing ? <><span className="sr-only">{content}</span><Button type="button" size="sm" variant="ghost" className="mt-2 rounded-full text-muted-foreground" onClick={() => { setVisible(content.length); onComplete?.(); }}>Show full answer</Button></> : null}
    {message.image && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(message.image) ? <details className="mt-3"><summary className="text-sm cursor-pointer">View historical attachment</summary>{/* Historical raster data stays local; Next image optimization cannot fetch data URIs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={message.image} alt="Historical attachment from this conversation" className="max-h-80 max-w-full rounded-lg mt-2" /></details> : message.image && safeMentorHref(message.image) ? <a href={safeMentorHref(message.image)} target="_blank" rel="noopener noreferrer" className="text-sm underline">View historical attachment</a> : null}
    {!typing && cards.length > 0 ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4" aria-label="Saved search evidence">
      {cards.map((card, index) => <div key={card.id || `${card.label}-${index}`} className="rounded-2xl border border-border bg-card p-4">
        {card.title ? <p className="text-xs font-medium mb-1">{card.title}</p> : null}<p className="text-xs text-muted-foreground">{card.label}</p>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">{card.value ?? 'Not available'}{card.unit ? ` ${card.unit}` : ''}</p>
        {card.period ? <p className="text-xs text-muted-foreground mt-1">{typeof card.period === 'string' ? card.period : `${card.period.startDate} – ${card.period.endDate}`}</p> : null}
        {card.observedAt ? <p className="text-xs text-muted-foreground">Observed {formatDate(card.observedAt)}</p> : null}
      </div>)}
    </div> : null}
    {!typing && actions.length > 0 ? <div className="flex flex-wrap gap-2 mt-4">{actions.map((action, index) => safeMentorHref(action.href)?.startsWith('/') ? <Button key={action.href + action.label} variant="outline" size="sm" className="rounded-full" asChild><a href={action.href}>{action.label}</a></Button> : ['activity', 'page', 'technical', 'progress'].includes(action.kind) && action.pageUrl ? <Button key={action.id || index} variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => onCheck?.(action)}>{action.label || (action.kind === 'activity' ? 'Check latest data' : 'Check this page')}</Button> : null)}</div> : null}
    {!typing && sources.length > 0 ? <details className="mt-4 border-t border-border pt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Sources and evidence ({sources.length})</summary>
      <ul className="mt-3 space-y-3">{sources.map((source, index) => <li key={source.id || `${source.url}-${index}`}>
        <SafeLink href={source.url}>{source.title || source.label || source.url}<ExternalLink className="inline ml-1 h-3 w-3" /></SafeLink>
        {source.retrievedAt || source.observedAt ? <p className="text-xs text-muted-foreground">Checked {formatDate(source.retrievedAt || source.observedAt)}</p> : null}
        {source.stale || source.status === 'stale' ? <p className="text-xs text-muted-foreground">Saved reference; a fresh check was unavailable.</p> : null}
      </li>)}</ul>
    </details> : null}
    {message.role === 'assistant' && !typing ? <div className="flex items-center gap-2 mt-3">
      <Button type="button" size="sm" variant="ghost" className="-ml-2 h-8 rounded-full px-2.5 text-xs text-muted-foreground" onClick={copy} aria-label="Copy answer">{copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}{copied ? 'Copied' : 'Copy'}</Button>
      {copyError ? <span className="text-xs text-muted-foreground" role="status">Select the answer text to copy it.</span> : null}
    </div> : null}
    </div>
  </article>;
}
