"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ANALYTICS_CHOICES_EVENT, ANALYTICS_CHOICE_KEY, initializeAnalytics, openAnalyticsChoices, readAnalyticsChoice, trackAnalyticsEvent } from '@/app/lib/analytics';

export function AnalyticsChoicesButton({ className }) {
  return <button type="button" className={className} onClick={openAnalyticsChoices}>Analytics choices</button>;
}

export default function Analytics({ measurementId }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const client = useRef(null);

  useEffect(() => {
    if (!measurementId) return;
    client.current = initializeAnalytics(measurementId, pathname);
    if (client.current && !client.current.choice() && !navigator.globalPrivacyControl) setOpen(true);
  }, [measurementId, pathname]);

  useEffect(() => {
    if (!measurementId) return;
    const show = () => setOpen(true);
    const sync = event => {
      if (event.key === ANALYTICS_CHOICE_KEY) {
        client.current?.choose(readAnalyticsChoice(localStorage) || 'denied', false);
        setOpen(false);
      }
    };
    const click = event => {
      const link = event.target.closest?.('a[href]');
      if (link && new URL(link.href, location.origin).origin === location.origin && new URL(link.href, location.origin).pathname === '/request-access') trackAnalyticsEvent('early_access_click');
    };
    window.addEventListener(ANALYTICS_CHOICES_EVENT, show);
    window.addEventListener('storage', sync);
    document.addEventListener('click', click);
    return () => {
      window.removeEventListener(ANALYTICS_CHOICES_EVENT, show);
      window.removeEventListener('storage', sync);
      document.removeEventListener('click', click);
    };
  }, [measurementId]);

  const choose = choice => { client.current?.choose(choice); setOpen(false); };
  if (!open) return null;
  return <section aria-label="Analytics choices" className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl sm:right-auto sm:max-w-sm">
    <p className="text-sm font-semibold">Help us improve SimplSEO?</p>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">With your permission, Google Analytics measures visits and useful actions. We don’t send your form answers or private SEO content. You can change your choice in our <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link>.</p>
    <div className="mt-4 grid grid-cols-2 gap-3">
      <button type="button" onClick={() => choose('denied')} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2">No thanks</button>
      <button type="button" onClick={() => choose('granted')} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2">Allow analytics</button>
    </div>
  </section>;
}
