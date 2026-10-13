"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { authenticatedFetch } from '../lib/authenticatedFetch';
import { useOnboarding } from '../contexts/OnboardingContext';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function AcceptInvitationPage() {
  const { user, isLoading, signInWithGoogle, refreshAccess, logout } = useAuth();
  const { refreshSetup } = useOnboarding();
  const router = useRouter();
  const [token, setToken] = useState(''), [invitation, setInvitation] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    setToken(value);
    if (!value) { setError('Open the Accept invitation button in your invitation email to get started.'); return; }
    let cancelled = false;
    fetch('/api/access/invitation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inspect', token: value }) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!cancelled) setInvitation(data); })
      .catch(failure => { if (!cancelled) setError(failure.message || 'We could not check this invitation. Refresh to try again.'); });
    return () => { cancelled = true; };
  }, []);
  const accept = async () => {
    if (busy) return;
    setBusy('Joining…'); setError('');
    try {
      if (!user) { setBusy('Waiting for Google sign-in…'); await signInWithGoogle(); }
      setBusy('Saving your access…');
      const response = await authenticatedFetch('/api/access/invitation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept', token }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Your invitation could not be accepted.');
      const result = await refreshAccess();
      if (!result?.approved) throw new Error('Your invitation was accepted, but we couldn’t finish loading your account. Use Sign in or retry.');
      await refreshSetup().catch(() => {});
      window.history.replaceState(null, '', '/accept-invite');
      router.replace(result.nextPath);
    } catch (failure) { setError(failure.code === 'auth/popup-closed-by-user' ? 'Sign-in was closed. Your invitation is still available.' : failure.code ? 'Google sign-in could not finish. Open SimplSEO in Safari or Chrome and try again.' : failure.message); }
    finally { setBusy(''); }
  };
  return <main className="min-h-screen bg-background flex items-center justify-center p-5"><div className="w-full max-w-lg space-y-6"><Link href="/home" className="text-sm text-muted-foreground">← SimplSEO home</Link><Card>
    <CardHeader><p className="text-sm font-semibold text-primary">PRIVATE EARLY ACCESS</p><CardTitle className="text-2xl">You’re invited to SimplSEO</CardTitle><CardDescription>Choose the Google account you’ll use to sign in. We’ll help you connect your website during setup.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      {invitation?.status === 'accepted' ? <><p>This invitation has already been accepted. If you joined, sign in with the Google account you chose.</p><Button asChild><Link href="/auth">Sign in</Link></Button></> : <>
        <p className="text-sm">Your Search Console account can be different. If you haven’t set up Search Console yet, onboarding will guide you.</p>
        {user && <p className="text-sm break-words">Joining as <strong>{user.email}</strong>. <button className="underline" onClick={logout} disabled={Boolean(busy)}>Use another account</button></p>}
        <Button className="w-full" disabled={!invitation || isLoading || Boolean(busy)} onClick={accept}>{busy || (user ? 'Accept invitation and continue' : 'Accept invitation with Google')}</Button>
        {invitation?.expiresAt && <p className="text-xs text-muted-foreground">One-use invitation · Expires {new Date(invitation.expiresAt).toLocaleDateString()}</p>}
      </>}
      {busy && <p role="status" className="text-sm">{busy}</p>}{error && <p role="alert" className="text-sm">{error}</p>}
      <p className="text-sm text-muted-foreground">Need a new invitation? <Link href="/request-access" className="underline">Request early access</Link></p>
    </CardContent></Card></div></main>;
}
