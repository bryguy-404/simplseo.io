"use client";

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { CheckCircle2 } from 'lucide-react';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { db } from '../../lib/firebaseConfig';
import { seoImplementationId } from '../../lib/pageTaskFlow';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function PageContentChangeConfirmation({ pageUrl, provenance, onConfirmed, onExisting, hasMetadataEditor = false }) {
  const { user } = useAuth();
  const id = useId();
  const active = useRef(true);
  const [summary, setSummary] = useState('');
  const [published, setPublished] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !pageUrl) return;
    getDoc(doc(db, 'implementedSeoTips', seoImplementationId(user.id, pageUrl))).then(snapshot => {
      if (cancelled) return;
      const record = snapshot.data();
      if (record && record.pageUrl === pageUrl && !record.preRevampArchived && record.status === 'implemented') onExisting?.(record);
    }).catch(() => { if (!cancelled) setLoadError('We could not check existing changes. Reload before starting another comparison.'); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [user?.id, pageUrl, onExisting]);

  const ready = Boolean(user?.id && provenance && summary.trim() && summary.trim().length <= 600 && published && !checking && !loadError && !busy && !saved);
  const confirm = async () => {
    if (!ready) return;
    setBusy(true); setError('');
    try {
      const response = await authenticatedFetch('/api/page-review/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl, provenance, changeType: 'page_content', changeSummary: summary.trim(), published: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please try saving again.');
      if (result.record?.pageUrl !== pageUrl || result.record.changeType !== 'page_content' || result.record.pageChangeSummary !== summary.trim()) throw new Error('The saved change could not be verified. Reload to check its status.');
      if (!active.current) return;
      setSaved(result.record); setConfirmOpen(false);
      window.dispatchEvent(new Event('seo-implementation-changed'));
      onConfirmed?.(result.record);
    } catch (failure) { if (active.current) setError(`Your confirmation was not saved. ${failure.message || 'Please try again.'}`); }
    finally { if (active.current) setBusy(false); }
  };

  return <section className="mb-6 rounded-xl border p-5 md:p-6" aria-label="Track a published page-content change">
    {saved ? <div className="space-y-3"><h3 className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />Your page-content change is saved</h3><p className="text-sm">{saved.pageChangeSummary}</p><Link href="/dashboard#page-progress" className="text-sm underline underline-offset-4">View page progress</Link></div>
      : <details><summary className="cursor-pointer text-base font-semibold">Published a change to this page’s content?</summary><div className="mt-4 space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">Track a heading, body text, internal link, or technical edit after you publish it yourself. Reading a report or checking a setting is not a published change.{hasMetadataEditor ? ' Use the title editor below for title and description changes.' : ''}</p>
        <p className="break-all text-xs text-muted-foreground">{pageUrl}</p>
        <div className="space-y-2"><Label htmlFor={`${id}-summary`}>What did you actually publish?</Label><Textarea id={`${id}-summary`} value={summary} maxLength={600} disabled={busy} onChange={event => { setSummary(event.target.value); setPublished(false); }} placeholder="For example: rewrote the opening heading to clearly name the service this page offers." /><p className="text-xs text-muted-foreground">{summary.length}/600 characters. Describe your own edit; this will appear in Page progress.</p></div>
        <div className="flex items-start gap-2"><Checkbox id={`${id}-published`} checked={published} disabled={busy || checking || Boolean(loadError)} onCheckedChange={value => setPublished(value === true)} /><Label htmlFor={`${id}-published`} className="leading-5">I published the page-content change described above on this exact page.</Label></div>
        {checking && <p role="status" className="text-sm text-muted-foreground">Checking saved changes…</p>}
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        {error && !confirmOpen && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button disabled={!ready} onClick={() => setConfirmOpen(true)}>Track this published page change</Button>
        <p className="text-xs leading-relaxed text-muted-foreground">Your confirmation records what you report publishing. It starts a dated comparison; it does not prove the edit caused later traffic changes.</p>
      </div></details>}
    <Dialog open={confirmOpen} onOpenChange={value => { if (!busy) setConfirmOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Track this published page-content change?</DialogTitle><DialogDescription>Today will be the change date for the comparison. Confirm only after publishing your edit on this exact page.</DialogDescription></DialogHeader><p className="break-all text-xs text-muted-foreground">{pageUrl}</p><p className="whitespace-pre-wrap break-words text-sm">{summary.trim()}</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>Not yet</Button><Button disabled={!ready} onClick={confirm}>{busy ? 'Saving…' : 'Yes, track my published page change'}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
