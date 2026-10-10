"use client";

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../../lib/firebaseConfig';
import { useAuth } from '../../contexts/AuthContext';
import { writeSeoRecord } from '../../lib/writeSeoRecord';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { seoImplementationId, usableSuggestion } from '../../lib/pageTaskFlow';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function SeoRecommendationPanel({
  pageUrl, title, suggestedTitle = '', suggestedDescription = '', focusKeyword = '',
  keywordSource = 'gsc-existing', currentPage = null, suggestionState = 'ready', provenance, requireServerConfirmation = false, onConfirmed,
}) {
  const { user } = useAuth();
  const id = useId();
  const [saved, setSaved] = useState(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draftTitle, setDraftTitle] = useState(suggestedTitle);
  const [draftDescription, setDraftDescription] = useState(suggestedDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmedLive, setConfirmedLive] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setDraftTitle(suggestedTitle || ''); setDraftDescription(suggestedDescription || ''); setConfirmedLive(false);
  }, [suggestedTitle, suggestedDescription, pageUrl]);

  useEffect(() => {
    let cancelled = false;
    setSaved(null); setLoadingSaved(true); setLoadError('');
    if (!user?.id || !pageUrl) { setLoadingSaved(false); return; }
    getDoc(doc(db, 'implementedSeoTips', seoImplementationId(user.id, pageUrl)))
      .then(snapshot => {
        if (cancelled) return;
        const record = snapshot.data();
        if (record && record.pageUrl === pageUrl && !record.preRevampArchived && record.status === 'implemented') { setSaved(record); onConfirmed?.(record); }
      })
      .catch(() => { if (!cancelled) setLoadError('We could not check whether this page already has a confirmed change. Reload before confirming another change.'); })
      .finally(() => { if (!cancelled) setLoadingSaved(false); });
    return () => { cancelled = true; };
  }, [user?.id, pageUrl, onConfirmed]);

  const sourceReady = suggestionState === 'ready' && usableSuggestion(suggestedTitle) && usableSuggestion(suggestedDescription) &&
    (!currentPage?.finalUrl || currentPage.finalUrl === pageUrl) && (!requireServerConfirmation || Boolean(provenance));
  const ready = sourceReady && usableSuggestion(draftTitle) && usableSuggestion(draftDescription);
  const copy = async (value, label) => {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied`); }
    catch { toast.error('Copy failed. You can select and copy the text yourself.'); }
  };
  const confirm = async () => {
    if (!user?.id || !pageUrl || !ready || busy || loadingSaved || saved || !confirmedLive || loadError) return;
    setBusy(true); setError('');
    try {
      let record = { userId: user.id, pageUrl, implementedAt: new Date().toISOString(),
        title: draftTitle.trim(), description: draftDescription.trim(), status: 'implemented',
        ...(focusKeyword ? { focusKeyword, keywordSource } : {}),
        ...(currentPage ? { previousMetaTitle: currentPage.htmlTitle ?? currentPage.title ?? '',
          previousMetaDescription: currentPage.seoMetaDescription ?? currentPage.metaDescription ?? '',
          metadataObservedAt: currentPage.fetchedAt || null } : {}),
      };
      if (requireServerConfirmation) {
        const response = await authenticatedFetch('/api/page-review/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...record, provenance }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Your confirmation was not saved. Please try again.');
        if (!body.record || body.record.pageUrl !== pageUrl) throw new Error('The saved change could not be verified. Reload to check its status.');
        record = body.record;
      } else {
        await writeSeoRecord(doc(db, 'implementedSeoTips', seoImplementationId(user.id, pageUrl)), record, { merge: true });
      }
      setSaved(record); setConfirmOpen(false);
      window.dispatchEvent(new Event('seo-implementation-changed'));
      onConfirmed?.(record);
      toast.success('Change saved. Page progress will collect dated search observations.');
    } catch (failure) { setError(`Your confirmation was not saved. ${failure.message || 'Your website edit is unaffected. Please try saving again.'}`); }
    finally { setBusy(false); }
  };

  const fields = [
    { key: 'title', label: 'SEO title', current: currentPage?.htmlTitle ?? currentPage?.title, value: saved ? saved.title || '' : draftTitle, set: setDraftTitle },
    { key: 'description', label: 'Meta description', current: currentPage?.seoMetaDescription ?? currentPage?.metaDescription, value: saved ? saved.description || '' : draftDescription, set: setDraftDescription },
  ];

  return <section className="rounded-lg border p-5 space-y-5" aria-label="Website edit task">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-lg font-semibold">{saved ? 'Your confirmed website change' : 'Review your website edit'}</h3>
        {title && <p className="text-sm text-muted-foreground break-all">{title.replace(/^(Fix|Focus):\s*/, '')}</p>}
      </div>
      <Button variant="outline" asChild><a href={pageUrl} target="_blank" rel="noopener noreferrer">Open website page <ExternalLink className="ml-2 h-4 w-4" /></a></Button>
    </div>
    {loadingSaved && <p role="status">Checking saved changes…</p>}
    {loadError && <p role="alert" className="text-destructive">{loadError}</p>}
    {error && !confirmOpen && <p role="alert" className="text-destructive">{error}</p>}
    {saved ? <p className="rounded border bg-muted/30 p-3 text-sm">Confirmed {new Date(saved.implementedAt).toLocaleDateString()}. These are the values you saved. <Link href="/dashboard#page-progress" className="underline">View page progress</Link> for dated observations. Leave this change in place while its comparison is collected.</p> : <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
      <li>Review the draft and adjust it so it accurately describes this page.</li>
      <li>Open your website editor, update this page’s SEO title and meta description, then publish.</li>
      <li>Check the published page and confirm below. SimplSEO does not make website edits for you.</li>
    </ol>}
    {focusKeyword && <p className="text-sm text-muted-foreground">{keywordSource === 'ai-generated' ? 'AI keyword idea' : keywordSource === 'gsc-observed' ? 'Observed Google search query' : 'Selected focus keyword'}: <span className="text-foreground">{focusKeyword}</span>. Use it only if it matches this page.</p>}
    {(saved || sourceReady) ? <div className="grid gap-5">
      {fields.map(field => <div className="space-y-2" key={field.key}>
        <Label htmlFor={`${id}-${field.key}`}>{field.label}</Label>
        {!saved && currentPage && <div className="rounded border bg-muted/30 p-3 text-sm"><p className="mb-1 text-xs text-muted-foreground">Read from your website</p>{field.current || 'This field was not found in the page HTML.'}</div>}
        <div className="flex items-start gap-2"><Textarea id={`${id}-${field.key}`} value={field.value} readOnly={Boolean(saved)} onChange={event => { field.set(event.target.value); setConfirmedLive(false); }} className="min-h-24" aria-label={`${saved ? 'Confirmed' : 'Suggested'} ${field.label.toLowerCase()}`} />
          <Button variant="outline" size="icon" aria-label={`Copy ${field.label.toLowerCase()}`} onClick={() => copy(field.value, field.label)}><Copy className="h-4 w-4" /></Button></div>
      </div>)}
      {!saved && <p className="text-xs text-muted-foreground">Titles and descriptions above come from your website, not Search Console. Google may display different text in search results. Suggestions are drafts to review; results are not guaranteed.</p>}
    </div> : <p className="text-sm text-muted-foreground">Generate a draft above before confirming a website change.</p>}
    {!saved && <div className="space-y-3 border-t pt-4">
      <div className="flex items-start gap-2"><Checkbox id={`${id}-implemented`} checked={confirmedLive} disabled={!ready || busy || loadingSaved || Boolean(loadError)} onCheckedChange={value => setConfirmedLive(value === true)} />
        <Label htmlFor={`${id}-implemented`} className="leading-5">I published these title and description changes on this page.</Label></div>
      <Button onClick={() => setConfirmOpen(true)} disabled={!ready || !confirmedLive || busy || loadingSaved || Boolean(loadError)}>Confirm change and start tracking</Button>
      <p className="text-xs text-muted-foreground">Tracking uses 28 days before and after your confirmation date, plus Google’s reporting delay. Low traffic may leave the comparison inconclusive.</p>
    </div>}
    <Dialog open={confirmOpen} onOpenChange={value => { if (!busy) setConfirmOpen(value); }}>
      <DialogContent><DialogHeader><DialogTitle>Start tracking this published change?</DialogTitle><DialogDescription>Confirm only after publishing these edits on your website. Today will be the change date used for your before-and-after comparison.</DialogDescription></DialogHeader>
        <p className="break-all text-sm">{pageUrl}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>Not yet</Button><Button disabled={busy} onClick={confirm}>{busy ? 'Saving…' : 'Yes, I published these changes'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
