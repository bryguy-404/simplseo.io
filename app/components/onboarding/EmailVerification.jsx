"use client";

import { useEffect, useRef, useState } from 'react';
import { getIdToken, reload, sendEmailVerification } from 'firebase/auth';
import { auth } from '../../lib/firebaseConfig';
import { Button } from '@/components/ui/button';

export default function EmailVerification({ userId, email, onVerified, onSignOut }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const account = useRef(userId);
  const working = useRef(false);
  account.current = userId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const act = async action => {
    if (working.current) return;
    const target = auth.currentUser;
    const expected = userId;
    const current = () => mounted.current && account.current === expected && auth.currentUser?.uid === expected;
    if (!target || target.uid !== expected) { setError('Please sign in again before verifying your email.'); return; }
    working.current = true; setBusy(action); setError(''); setNotice('');
    try {
      if (action === 'send') {
        await sendEmailVerification(target);
        if (current()) setNotice('Verification email sent. Open the link in your inbox, then return here. Check your spam folder if needed.');
      } else {
        await reload(target);
        if (!current()) return;
        await getIdToken(target, true);
        if (!current()) return;
        if (!target.emailVerified) { setError('Your email is not verified yet. Open the link in the verification email, then try again.'); return; }
        // The server still checks access approval after email verification.
        await onVerified();
      }
    } catch (failure) {
      if (current()) setError(failure.code === 'auth/too-many-requests'
        ? 'Please wait a little before requesting another verification email.'
        : failure.code === 'auth/network-request-failed'
          ? 'The connection failed. Your account is saved; please try again.'
          : failure.code ? 'This verification step could not finish. Please try again or sign in again.' : failure.message);
    } finally { working.current = false; if (current()) setBusy(''); }
  };

  return <section className="max-w-xl mx-auto p-6 space-y-4" aria-busy={Boolean(busy)} aria-labelledby="email-verification-heading">
    <h1 id="email-verification-heading" className="text-2xl font-semibold">Verify your email</h1>
    <p>Confirm that {email || 'this email address'} belongs to you before continuing with setup.</p>
    <p className="text-sm text-muted-foreground">Your saved business details will stay here. Email verification does not change your account’s access approval.</p>
    {(error || notice || busy) && <p role={error ? 'alert' : 'status'} className="rounded-md border p-3 text-sm">{error || (busy === 'send' ? 'Sending verification email…' : busy ? 'Checking verification…' : notice)}</p>}
    <div className="flex flex-wrap gap-3"><Button onClick={() => act('send')} disabled={Boolean(busy)}>Send verification email</Button><Button variant="outline" onClick={() => act('check')} disabled={Boolean(busy)}>I’ve verified my email</Button></div>
    <Button variant="link" onClick={onSignOut}>Sign out</Button>
  </section>;
}
