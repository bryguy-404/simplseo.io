"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ANALYTICS_CHOICES_EVENT, ANALYTICS_CHOICE_KEY, analyticsPromptPage, initializeAnalytics, openAnalyticsChoices, readAnalyticsChoice, trackAnalyticsEvent } from '@/app/lib/analytics';
import AnalyticsConsent from './AnalyticsConsent';

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
    // Ask only on public pages. If someone moves into the workspace without
    // choosing, the card steps aside; it returns on their next public page.
    if (client.current && !client.current.choice() && !navigator.globalPrivacyControl) setOpen(analyticsPromptPage(pathname));
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

  if (!open) return null;
  // The choice is saved straight away; the card closes once its short goodbye has played.
  return <AnalyticsConsent onChoose={choice => client.current?.choose(choice)} onDone={() => setOpen(false)} />;
}
