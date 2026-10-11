"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import MainLayout from '../components/MainLayout';
import { NotificationItem } from '../components/notifications/NotificationBell';
import { notificationRequest, useNotifications } from '../lib/notificationClient';
import { Button } from '@/components/ui/button';

export default function NotificationsPage() {
  const { result, error, loading, refresh, scope } = useNotifications();
  const [more, setMore] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState('');
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => { setMore([]); setCursor(result?.nextCursor || null); setMoreError(''); setBusy(false); }, [result, scope]);
  const loadMore = async () => {
    if (!cursor || busy) return;
    const capturedScope = scope;
    setBusy(true); setMoreError('');
    try {
      const next = await notificationRequest(`/api/notifications?limit=20&cursor=${encodeURIComponent(cursor)}`);
      if (capturedScope !== currentScope.current) return;
      setMore(previous => [...previous, ...(next.items || [])]); setCursor(next.nextCursor || null);
    } catch (failure) { if (capturedScope === currentScope.current) setMoreError(failure.message); }
    finally { if (capturedScope === currentScope.current) setBusy(false); }
  };
  const items = [...new Map([...(result?.items || []), ...more].map(item => [item.id, item])).values()];
  return <MainLayout><div className="mx-auto max-w-3xl space-y-6 py-6 sm:py-10"><header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">Your page updates</h1><p className="mt-2 text-sm text-muted-foreground">Results, check-ins and useful next steps for your saved work.</p></div><Button asChild variant="outline"><Link href="/settings?tab=notifications">Email preferences</Link></Button></header>
    {loading && <p role="status" className="text-sm">Loading saved updates…</p>}
    {(error || moreError) && <div className="rounded-xl border p-4"><p role="alert" className="text-sm">{error || moreError}</p><Button variant="link" onClick={() => moreError ? loadMore() : refresh({ force: true })}>Retry</Button></div>}
    {result?.enabled === false ? <p>Page notifications will be available when enabled for your account.</p> : !loading && !items.length && !error ? <p className="rounded-xl border bg-card p-10 text-center text-muted-foreground">Your page updates will appear here.</p> : <div className="space-y-3">{items.map(item => <NotificationItem key={item.id} item={item} />)}</div>}
    {cursor && <Button variant="outline" disabled={busy} onClick={loadMore}>{busy ? 'Loading…' : 'Load more updates'}</Button>}
  </div></MainLayout>;
}
