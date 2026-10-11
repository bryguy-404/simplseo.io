"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import MainLayout from '../../components/MainLayout';
import { notificationDate } from '../../components/notifications/NotificationBell';
import { invalidateNotifications, notificationRequest } from '../../lib/notificationClient';
import { safeNotificationDestination } from '../../lib/notificationNavigation';
import { Button } from '@/components/ui/button';

export default function NotificationDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, isLoaded } = useOnboarding();
  const scope = JSON.stringify([user?.id, data?.websiteUrl, data?.gscProperty, data?.revampRunId]);
  const [state, setState] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user?.id || !isLoaded || !data?.isComplete) return;
    let active = true;
    setState({ scope, loading: true });
    (async () => {
      try {
        const result = await notificationRequest(`/api/notifications/${encodeURIComponent(id)}`);
        if (!active) return;
        setState({ scope, result });
        if (!result.event?.readAt) {
          try { await notificationRequest(`/api/notifications/${encodeURIComponent(id)}/read`, {}); if (active) invalidateNotifications(); }
          catch { if (active) setState({ scope, result, readError: 'This update is open, but its read status could not be saved. You can retry safely.' }); }
        }
      } catch (failure) { if (active) setState({ scope, error: failure.message }); }
    })();
    return () => { active = false; };
  }, [id, user?.id, scope, isLoaded, data?.isComplete, retry]);
  const visible = state?.scope === scope ? state : null;
  const event = visible?.result?.event;
  const destination = visible?.result?.destination;
  const href = safeNotificationDestination(destination?.href);
  return <MainLayout><div className="mx-auto max-w-2xl space-y-5 py-8"><Link href="/notifications" className="text-sm underline">← All updates</Link>
    {(!visible || visible.loading) && <p role="status">Opening your saved update…</p>}
    {visible?.error && <div className="rounded-xl border p-5"><h1 className="text-xl font-semibold">This update is unavailable</h1><p role="alert" className="mt-3 text-sm">{visible.error}</p><Button variant="outline" className="mt-4" onClick={() => setRetry(value => value + 1)}>Try again</Button></div>}
    {event && <article className="space-y-4 rounded-xl border bg-card p-6"><p className="text-xs text-muted-foreground">{notificationDate(event.occurredAt || event.createdAt)}{destination?.historical ? ' · Saved history' : ''}</p><h1 className="text-2xl font-semibold">{event.title}</h1><p className="break-words font-medium">{event.pageName || event.pageUrl || 'Your website'}</p><p className="text-sm leading-relaxed">{event.message}</p>{destination?.message && <p className="text-sm text-muted-foreground">{destination.message}</p>}{href ? <Button asChild><Link href={href}>{event.type === 'reconnect_google' ? 'Reconnect Google' : 'Open this page’s work'}</Link></Button> : <p className="text-sm text-muted-foreground">The original work is no longer available in your current website. This dated update remains here as history.</p>}{visible?.readError && <div><p role="alert" className="text-sm">{visible.readError}</p><Button variant="link" onClick={() => setRetry(value => value + 1)}>Retry read status</Button></div>}</article>}
  </div></MainLayout>;
}
