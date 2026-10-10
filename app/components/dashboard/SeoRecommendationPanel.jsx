"use client";

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { CheckCircle2, Copy, ExternalLink, Globe, Pencil } from 'lucide-react';
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
    { key: 'title', label: 'Page title', helper: 'Also called the SEO title.', accessibleLabel: 'page title (SEO title)', current: currentPage?.htmlTitle ?? currentPage?.title, value: saved ? saved.title || '' : draftTitle, set: setDraftTitle },
    { key: 'description', label: 'Page description', helper: 'Also called the meta description.', accessibleLabel: 'page description (meta description)', current: currentPage?.seoMetaDescription ?? currentPage?.metaDescription, value: saved ? saved.description || '' : draftDescription, set: setDraftDescription },
  ];

  return <section className={`rounded-xl border p-5 space-y-5 ${saved ? 'border-emerald-300 dark:border-emerald-800' : ''}`} aria-label="Website edit task">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-lg font-semibold">{saved ? 'Your confirmed website change' : sourceReady ? 'Compare and edit your suggestion' : 'Your website edit'}</h3>
        {title && title !== pageUrl && <p className="text-sm text-muted-foreground break-all">{title.replace(/^(Fix|Focus):\s*/, '')}</p>}
      </div>
      <Button variant="outline" asChild><a href={pageUrl} target="_blank" rel="noopener noreferrer">Open website page <ExternalLink className="ml-2 h-4 w-4" /></a></Button>
    </div>
    {loadingSaved && <p role="status">Checking saved changes…</p>}
    {loadError && <p role="alert" className="text-destructive">{loadError}</p>}
    {error && !confirmOpen && <p role="alert" className="text-destructive">{error}</p>}
    {saved ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
      <p className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" /><span><strong>Change saved.</strong> Confirmed {new Date(saved.implementedAt).toLocaleDateString()}.</span></p>
      <Link href="/dashboard#page-progress" className="font-medium underline underline-offset-4">View page progress</Link>
    </div> : sourceReady && <p className="text-sm text-muted-foreground">Adjust the suggestion if needed, then copy it into your website editor.</p>}
    {focusKeyword && <p className="text-sm text-muted-foreground">{keywordSource === 'ai-generated' ? 'AI keyword idea' : keywordSource === 'gsc-observed' ? 'Observed search phrase' : 'Selected search phrase'}: <span className="font-medium text-foreground">{focusKeyword}</span></p>}
    {(saved || sourceReady) ? <div className="grid gap-6">
      {fields.map(field => <div className="space-y-3" key={field.key}>
        <div><Label htmlFor={`${id}-${field.key}`} className="text-base font-semibold">{field.label}</Label><p id={`${id}-${field.key}-help`} className="mt-1 text-xs text-muted-foreground">{field.helper}</p></div>
        <div className={`grid gap-3 ${!saved && currentPage ? 'md:grid-cols-2' : ''}`}>
          {!saved && currentPage && <div className="min-w-0 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/30">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-100"><Globe className="h-4 w-4 shrink-0" aria-hidden="true" />Currently on your website</p>
            <p className="md:min-h-24 whitespace-pre-wrap break-words text-sm text-sky-950 dark:text-sky-100">{field.current || 'Not found on this page.'}</p>
          </div>}
          <div className={`min-w-0 rounded-lg border p-4 ${saved ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30'}`}>
            <p className={`mb-3 flex items-center gap-2 text-sm font-semibold ${saved ? 'text-emerald-900 dark:text-emerald-100' : 'text-violet-900 dark:text-violet-100'}`}>
              {saved ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Pencil className="h-4 w-4 shrink-0" aria-hidden="true" />}{saved ? 'Confirmed wording' : 'Suggested wording'}
            </p>
            <div className="flex items-start gap-2"><Textarea id={`${id}-${field.key}`} value={field.value} readOnly={Boolean(saved)} onChange={event => { field.set(event.target.value); setConfirmedLive(false); }} className={`${field.key === 'description' ? 'min-h-40 md:min-h-28' : 'min-h-24'} bg-background/80 ${saved ? 'border-emerald-300 dark:border-emerald-700' : 'border-violet-300 dark:border-violet-700'}`} aria-label={`${saved ? 'Confirmed' : 'Suggested'} ${field.accessibleLabel}`} aria-describedby={`${id}-${field.key}-help`} />
              <Button variant="outline" size="icon" className="shrink-0 bg-background/80" aria-label={`Copy ${field.accessibleLabel}`} onClick={() => copy(field.value, field.label)}><Copy className="h-4 w-4" /></Button></div>
          </div>
        </div>
      </div>)}
    </div> : !loadingSaved && <p className="text-sm text-muted-foreground">Your draft will appear here after you generate a suggestion.</p>}
    {!saved && <div className="space-y-3 border-t pt-4">
      {sourceReady && <><p className="text-sm font-medium">Publish these changes on your website before confirming here.</p>
        <div className="flex items-start gap-2"><Checkbox id={`${id}-implemented`} checked={confirmedLive} disabled={!ready || busy || loadingSaved || Boolean(loadError)} onCheckedChange={value => setConfirmedLive(value === true)} />
          <Label htmlFor={`${id}-implemented`} className="leading-5">I published these title and description changes on this page.</Label></div></>}
      <Button onClick={() => setConfirmOpen(true)} disabled={!ready || !confirmedLive || busy || loadingSaved || Boolean(loadError)}>Confirm change and start tracking</Button>
    </div>}
    {(saved || sourceReady) && <details className="text-sm text-muted-foreground"><summary className="cursor-pointer rounded py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How does tracking work?</summary><div className="space-y-2 pt-3 text-xs leading-relaxed">
      <p>SimplSEO does not edit your website. Confirm after you publish the changes yourself.</p>
      <p>Tracking compares 28 days before and after your confirmation date, plus Google’s reporting delay. Leave the change in place while data is collected. Low traffic may leave the comparison inconclusive.</p>
      <p>Current wording is read from your website. Google may show different text in search results. A change in traffic does not prove that the edit caused it.</p>
    </div></details>}
    <Dialog open={confirmOpen} onOpenChange={value => { if (!busy) setConfirmOpen(value); }}>
      <DialogContent><DialogHeader><DialogTitle>Start tracking this published change?</DialogTitle><DialogDescription>Confirm only after publishing these edits on your website. Today will be the change date used for your before-and-after comparison.</DialogDescription></DialogHeader>
        <p className="break-all text-sm">{pageUrl}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>Not yet</Button><Button disabled={busy} onClick={confirm}>{busy ? 'Saving…' : 'Yes, I published these changes'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
