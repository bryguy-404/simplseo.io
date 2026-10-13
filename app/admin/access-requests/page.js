"use client";
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
const deliveryLabel = { accepted: 'Email accepted by Resend', failed: 'Email failed — retry is available', unknown: 'Delivery uncertain — check Resend before replacing', sending: 'Email send in progress', pending: 'Email waiting to send', cancelled: 'Email cancelled' };
export default function AccessRequestsAdmin() {
  const { user, access, isLoading } = useAuth();
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null), [filter, setFilter] = useState('pending');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [email, setEmail] = useState(''), [name, setName] = useState('');
  const load = useCallback(async (after = null) => {
    const response = await authenticatedFetch(`/api/admin/approve${after ? `?cursor=${encodeURIComponent(after)}` : ''}`);
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not load access requests.');
    setItems(old => after ? [...old.filter(x => !result.requests.some(y => y.id === x.id)), ...result.requests] : result.requests); setCursor(result.cursor);
  }, []);
  useEffect(() => { if (access?.isAdmin) load().catch(failure => setError(failure.message)); }, [access?.isAdmin, load]);
  const action = async (input, key) => {
    if (busy) return; setBusy(key); setError(''); setNotice('');
    try {
      const response = await authenticatedFetch('/api/admin/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'This action could not finish.');
      setNotice(result.message || 'Request updated.');
      if (input.action === 'invite') { setEmail(''); setName(''); setFilter('invited'); }
      await load();
    } catch (failure) { setError(failure.message); await load().catch(() => {}); }
    finally { setBusy(''); }
  };
  if (isLoading || access?.status === 'loading') return <p role="status" className="p-8">Checking administrator access…</p>;
  if (!user || !access?.isAdmin) return <main className="max-w-lg mx-auto p-6 space-y-4"><h1 className="text-2xl font-semibold">Early-access invitations</h1><p>Sign in with your administrator account to review requests and invite people.</p><Button asChild><Link href="/auth?returnTo=%2Fadmin%2Faccess-requests">Sign in</Link></Button></main>;
  const filtered = items.filter(r => filter === 'all' || (filter === 'joined' ? ['joined', 'approved'].includes(r.status) : r.status === filter)).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  return <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
    <Link href="/dashboard" className="text-sm text-muted-foreground underline">← Back to dashboard</Link><div><h1 className="text-3xl font-semibold">Early-access invitations</h1><p className="text-muted-foreground mt-2">Approve requests or invite someone directly. Access starts when they accept the email link.</p></div>
    <Card><CardContent className="pt-6"><form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] items-end" onSubmit={e => { e.preventDefault(); action({ action: 'invite', email, name }, 'direct'); }}><div className="space-y-2"><Label htmlFor="invite-email">Invitation email</Label><Input id="invite-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="invite-name">Name (optional)</Label><Input id="invite-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} /></div><Button disabled={Boolean(busy)} type="submit">{busy === 'direct' ? 'Sending…' : 'Send invitation'}</Button></form><p className="text-xs text-muted-foreground mt-3">The recipient chooses their Google sign-in account. Their Search Console account can be different. Invitations expire after 14 days.</p></CardContent></Card>
    {error && <p role="alert" className="rounded-lg border border-destructive/40 p-4">{error}</p>}{notice && <p role="status" className="rounded-lg border p-4">{notice}</p>}
    <div className="flex flex-wrap gap-2" aria-label="Filter access requests">{[['pending', 'Requests'], ['invited', 'Invited'], ['joined', 'Joined / earlier approvals'], ['rejected', 'Declined'], ['all', 'All']].map(([value, label]) => <Button key={value} variant={value === filter ? 'default' : 'outline'} onClick={() => setFilter(value)} aria-pressed={value === filter}>{label}</Button>)}<Button variant="ghost" disabled={Boolean(busy)} onClick={() => load().catch(failure => setError(failure.message))}>Refresh</Button></div>
    <p className="text-xs text-muted-foreground">{cursor ? 'Showing loaded requests. Load more to see earlier records.' : `${items.length} saved request${items.length === 1 ? '' : 's'}.`}</p>
    {!filtered.length && <p className="rounded-xl border p-6 text-muted-foreground">No matching requests in the loaded records.</p>}
    {filtered.map(r => <Card key={r.id}><CardContent className="pt-6 space-y-3"><div className="flex flex-wrap gap-3 justify-between"><div className="min-w-0"><p className="font-medium break-all">{r.email}</p><p className="text-sm text-muted-foreground">{[r.name, r.company].filter(Boolean).join(' · ')}</p></div><span className="text-sm capitalize">{r.status === 'approved' ? 'Earlier approval preserved' : r.status}</span></div>{r.reason && <p className="text-sm whitespace-pre-wrap break-words">{r.reason}</p>}<p className="text-xs text-muted-foreground">Requested {new Date(r.requestedAt).toLocaleDateString()}{r.expiresAt ? ` · Invitation expires ${new Date(r.expiresAt).toLocaleDateString()}` : ''}</p>{r.delivery && <p className="text-sm">{deliveryLabel[r.delivery] || r.delivery}</p>}
      {r.status === 'pending' && <div className="flex flex-wrap gap-2"><Button disabled={Boolean(busy)} onClick={() => action({ action: 'approve', requestId: r.id }, r.id)}>Approve and email invitation</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => action({ action: 'reject', requestId: r.id }, r.id)}>Decline</Button>{!['accepted', 'sending'].includes(r.adminNotice) && <Button variant="ghost" disabled={Boolean(busy)} onClick={() => action({ action: 'retry_notice', requestId: r.id }, r.id)}>Retry admin email</Button>}</div>}
      {r.status === 'invited' && <div className="flex flex-wrap gap-2">{!['accepted', 'sending'].includes(r.delivery) && <Button variant="outline" disabled={Boolean(busy)} onClick={() => action({ action: 'approve', requestId: r.id }, r.id)}>Retry saved email</Button>}<Button variant="outline" disabled={Boolean(busy)} onClick={() => { if (window.confirm('Send a fresh invitation and disable the previous link? The old email may already have arrived.')) action({ action: 'replace', requestId: r.id }, r.id); }}>Send replacement link</Button><Button variant="ghost" disabled={Boolean(busy)} onClick={() => { if (window.confirm('Cancel this unused invitation?')) action({ action: 'reject', requestId: r.id }, r.id); }}>Cancel invitation</Button></div>}
    </CardContent></Card>)}
    {cursor && <Button variant="outline" disabled={Boolean(busy)} onClick={async () => { setBusy('more'); try { await load(cursor); } catch (failure) { setError(failure.message); } finally { setBusy(''); } }}>Load more</Button>}
  </main>;
}
