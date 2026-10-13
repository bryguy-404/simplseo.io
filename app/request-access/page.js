"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
export default function RequestAccessPage() {
  const { access } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', company: '', reason: '' });
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch('/api/access-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'We couldn’t save your request. Please try again.');
      setSent(true);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-background px-5 py-12"><div className="mx-auto max-w-lg space-y-6"><Link href="/home" className="text-sm text-muted-foreground">← Back to home</Link><Card>
    <CardHeader><p className="text-sm font-semibold text-primary">SIMPLSEO · EARLY ACCESS</p><CardTitle className="text-2xl">{sent ? 'Your request is saved' : 'Request early access'}</CardTitle><CardDescription>{sent ? 'We’ll review your request and email you an invitation link if approved. Check your spam folder too.' : 'We’re inviting a small group of business owners to try SimplSEO and help shape it.'}</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      {access.status === 'approved' ? <><p>You already have access. Your saved work is ready for you.</p><Button asChild><Link href={access.nextPath || '/dashboard'}>Continue to your account</Link></Button></> : !sent && <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="request-name">Your name</Label><Input id="request-name" autoComplete="name" required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="request-email">Where should we send your invitation?</Label><Input id="request-email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /><p className="text-xs text-muted-foreground">Use an inbox you check. It doesn’t need to be your Search Console email.</p></div>
        <div className="space-y-2"><Label htmlFor="request-company">Business name (optional)</Label><Input id="request-company" maxLength={200} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="request-reason">What would you like help with? (optional)</Label><Textarea id="request-reason" maxLength={2000} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
        <p className="text-xs text-muted-foreground">We’ll use these details to review your request and contact you about access. <Link href="/privacy" className="underline">Privacy policy</Link></p>
        {error && <p role="alert" className="text-sm">{error}</p>}<Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving your request…' : 'Request invitation'}</Button>
      </form>}
      {sent && <p role="status">No code to enter. Your invitation will have an Accept invitation button.</p>}
      <p className="text-sm text-muted-foreground">Already joined? <Link href="/auth" className="underline text-primary">Sign in</Link></p>
    </CardContent></Card></div></main>;
}
