"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function UnsubscribePage() {
  const [token, setToken] = useState('');
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    const value = new URLSearchParams(window.location.search).get('token') || '';
    setToken(value);
    fetch(`/api/notifications/unsubscribe?token=${encodeURIComponent(value)}`).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'This unsubscribe link is unavailable.'); if (active) setState(result); }).catch(error => { if (active) setState({ error: error.message }); });
    return () => { active = false; };
  }, []);
  const unsubscribe = async () => {
    setState(previous => ({ ...previous, busy: true, error: '' }));
    try { const response = await fetch('/api/notifications/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'We could not save your choice. Please retry.'); setState({ ...result, valid: true, emailEnabled: false }); }
    catch (error) { setState(previous => ({ ...previous, busy: false, error: error.message })); }
  };
  return <main className="mx-auto max-w-lg space-y-5 px-5 py-16"><Link href="/" className="font-semibold">SimplSEO</Link><h1 className="text-2xl font-semibold">Progress email preferences</h1>{state.loading ? <p role="status">Checking this link…</p> : state.unsubscribed || (state.valid && !state.emailEnabled) ? <p role="status">Progress emails are off. Your in-app updates and saved SEO work remain available.</p> : state.valid && <><p>Turn off SimplSEO progress emails? You can still find your page updates in the bell after signing in.</p><Button disabled={state.busy} onClick={unsubscribe}>{state.busy ? 'Saving…' : 'Turn off progress emails'}</Button></>}{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}<p><Link href="/settings?tab=notifications" className="text-sm underline">Open notification settings</Link></p></main>;
}
