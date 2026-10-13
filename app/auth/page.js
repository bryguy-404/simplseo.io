"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { notificationAuthPath, notificationReturnFromLocation } from '../lib/notificationNavigation';
import EmailVerification from '../components/onboarding/EmailVerification';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AuthPage() {
  const { user, isLoading, access, signInWithGoogle, login, logout, refreshAccess } = useAuth();
  const { isDarkMode } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  useEffect(() => {
    if (access.status !== 'approved') return;
    const destination = notificationReturnFromLocation(window.location);
    if (destination === '/admin/access-requests' && access.isAdmin) { router.replace(destination); return; }
    router.replace(access.nextPath === '/dashboard' ? destination || '/dashboard' : notificationAuthPath('/onboarding', destination));
  }, [access, router]);
  const signIn = async (action = signInWithGoogle) => {
    setBusy(true); setError('');
    try { await action(); await refreshAccess(); }
    catch (failure) { setError(failure.code === 'auth/popup-closed-by-user' ? 'Sign-in was closed. Try again when you’re ready.' : failure.code === 'auth/popup-blocked' ? 'Open SimplSEO directly in Safari or Chrome, then try signing in again.' : 'Sign-in could not finish. Please try again.'); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-background flex items-center justify-center p-5 relative">
    <div className="pointer-events-none absolute inset-0 overflow-hidden"><div className="absolute top-10 left-0 size-80 bg-primary/10 rounded-full blur-3xl" /></div>
    <div className="relative w-full max-w-md space-y-6">
      <Link href="/home" className="text-sm text-muted-foreground hover:underline">← Back to home</Link>
      <img src={isDarkMode ? '/dark.png' : '/light.png'} alt="SimplSEO" className="mx-auto w-64 h-auto" />
      <Card><CardHeader><CardTitle>Sign in</CardTitle><CardDescription>Welcome back. Use the Google account you joined SimplSEO with.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          {access.status === 'pending' && user ? <>
            {access.reason === 'verify_email' ? <EmailVerification userId={user.id} email={user.email} onVerified={refreshAccess} onSignOut={logout} /> : <>
              <p role="status">This account hasn’t joined early access yet. Open the <strong>Accept invitation</strong> link in your email, or request an invitation below.</p>
              <Button asChild className="w-full"><Link href="/request-access">Request early access</Link></Button>
              <Button variant="outline" className="w-full" onClick={() => signIn() } disabled={busy}>Try another Google account</Button>
            </>}
          </> : <Button variant="outline" className="w-full" onClick={() => signIn()} disabled={busy || isLoading || access.status === 'loading' || access.status === 'approved'}>{busy || access.status === 'loading' ? 'Checking your sign-in…' : 'Continue with Google'}</Button>}
          {(error || access.status === 'error') && <div role="alert" className="space-y-2 text-sm"><p>{error || access.error}</p>{access.status === 'error' && <Button variant="outline" onClick={refreshAccess}>Retry access check</Button>}</div>}
          {process.env.NEXT_PUBLIC_SIMPLESEO_TEST_MODE === '1' && <form className="space-y-2" onSubmit={e => { e.preventDefault(); signIn(() => login(email, password)); }}><Label htmlFor="email">Email</Label><Input id="email" value={email} onChange={e => setEmail(e.target.value)} /><Label htmlFor="password">Password</Label><Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} /><Button type="submit">Log In</Button></form>}
          <p className="text-sm text-muted-foreground">New to SimplSEO? <Link className="text-primary underline" href="/request-access">Request early access</Link></p>
        </CardContent></Card>
    </div>
  </main>;
}
