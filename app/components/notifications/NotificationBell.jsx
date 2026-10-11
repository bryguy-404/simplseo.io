"use client";

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useNotifications } from '../../lib/notificationClient';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function notificationDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export function NotificationItem({ item, compact = false }) {
  const current = item.status === 'active' && item.active !== false;
  return <Link href={`/notifications/${encodeURIComponent(item.id)}`} className={`block min-w-0 rounded-xl border p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current && !item.readAt ? 'border-primary/35 bg-primary/5' : ''}`}>
    <div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold">{item.title}</span>{current && !item.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"><span className="sr-only">Unread</span></span>}</div>
    <p className="mt-1 break-words text-sm">{item.pageName || item.pageUrl || 'Your website'}</p>
    <p className={`mt-1 text-sm text-muted-foreground ${compact ? 'line-clamp-2' : ''}`}>{item.message}</p>
    <p className="mt-2 text-xs text-muted-foreground">{notificationDate(item.occurredAt || item.createdAt)}{!current ? ` · ${item.status === 'resolved' ? 'Resolved' : 'Earlier update'}` : ''}</p>
    <span className="mt-2 block text-xs font-medium text-primary">{current ? 'View update' : 'View history'}<span aria-hidden="true"> →</span></span>
  </Link>;
}

export default function NotificationBell() {
  const { result, error, loading, refresh } = useNotifications();
  if (result?.enabled === false || (!result && !error)) return null;
  const unread = Math.max(0, result?.unreadCount || 0);
  return <Popover onOpenChange={open => { if (open) refresh(); }}><PopoverTrigger asChild><Button variant="ghost" size="icon" className="relative size-10 shrink-0 rounded-full" aria-label={`Page updates${unread ? `, ${result?.unreadCountLimited ? 'at least ' : ''}${unread} unread` : ''}`}>
    <Bell className="size-5" aria-hidden="true" />{unread > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">{unread > 99 ? '99+' : result?.unreadCountLimited ? `${unread}+` : unread}</span>}
  </Button></PopoverTrigger><PopoverContent align="end" collisionPadding={12} className="z-[75] w-[360px] max-w-[calc(100vw-24px)] rounded-xl p-4">
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold">Your page updates</h2><Link href="/settings?tab=notifications" className="text-xs underline">Preferences</Link></div>
    {loading && <p role="status" className="mb-2 text-xs text-muted-foreground">Checking saved updates…</p>}
    {error && <div className="mb-3 text-sm"><p role="alert">{error}</p><Button size="sm" variant="link" onClick={() => refresh({ force: true })}>Retry</Button></div>}
    <div className="max-h-[min(65dvh,480px)] space-y-2 overflow-y-auto">{result?.items?.length ? result.items.slice(0, 5).map(item => <NotificationItem item={item} compact key={item.id} />) : !error && <p className="py-6 text-center text-sm text-muted-foreground">Your page updates will appear here.</p>}</div>
    <Button asChild variant="ghost" className="mt-3 w-full"><Link href="/notifications">View all updates</Link></Button>
  </PopoverContent></Popover>;
}
