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
import { isSelectableEdit, isPublishedTask, usableSavedPagePlan } from './SavedPagePlan';

function LegacyPageContentChangeConfirmation({ pageUrl, provenance, onConfirmed, onExisting, hasMetadataEditor = false }) {
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
        <p className="text-sm leading-relaxed text-muted-foreground">Track a heading, body text, internal link, or technical edit after you publish it yourself.{hasMetadataEditor ? ' Use the title editor below for title and description changes.' : ' You can also describe a title or description edit from an earlier saved task.'} Reading a report or marking a task done is not a published change.</p>
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


function SelectedTaskConfirmation({ pageUrl, provenance, plan, selectedTaskIds = [], onConfirmed, tracking = false, loading = false, error: statusError = '' }) {
  const { user } = useAuth();
  const id = useId();
  const active = useRef(true);
  const [summary, setSummary] = useState('');
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  const selectedTasks = plan.tasks.filter(task => selectedTaskIds.includes(task.id) && isSelectableEdit(task, pageUrl));
  const selectionKey = JSON.stringify(selectedTasks.map(task => [task.id, task.recommendation.label]));
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const selected = JSON.parse(selectionKey);
    setSummary(selected.map(([, label]) => label).join('; ').slice(0, 600));
    setPublished(false); setConfirmOpen(false); setError('');
  }, [selectionKey, pageUrl]);
  const selectionReady = selectedTasks.length > 0 && selectedTasks.length === selectedTaskIds.length && new Set(selectedTaskIds).size === selectedTaskIds.length;
  const canOpen = Boolean(user?.id && provenance && selectionReady && !loading && !statusError && !busy && !saved && !tracking);
  const ready = canOpen && published && Boolean(summary.trim()) && summary.trim().length <= 600;
  const confirm = async () => {
    if (!ready) return;
    setBusy(true); setError('');
    try {
      const response = await authenticatedFetch('/api/page-review/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl, provenance, changeType: 'page_content', changeSummary: summary.trim(), published: true, taskIds: selectedTaskIds, planRevision: plan.revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please try saving again.');
      const record = result.record;
      const scope = { pageUrl, property: provenance.property, websiteRunId: provenance.websiteRunId };
      if (record?.pageUrl !== pageUrl || record.changeType !== 'page_content' || record.pageChangeSummary !== summary.trim() || record.confirmationMethod !== 'user-confirmed' || !Number.isFinite(Date.parse(record.implementedAt)) ||
        !Array.isArray(record.confirmedTaskIds) || record.confirmedTaskIds.length !== selectedTaskIds.length || !selectedTaskIds.every(taskId => record.confirmedTaskIds.includes(taskId)) ||
        !usableSavedPagePlan(result.plan, scope) || !selectedTaskIds.every(taskId => result.plan.tasks.some(task => task.id === taskId && isPublishedTask(task, pageUrl) && task.publication.implementationId === record.id && task.publication.implementedAt === record.implementedAt))) throw new Error('The saved publication could not be verified. Reload to check its status before trying again.');
      if (!active.current) return;
      setSaved(record); setConfirmOpen(false);
      window.dispatchEvent(new Event('seo-implementation-changed'));
      onConfirmed?.(record, result.plan);
    } catch (failure) { if (active.current) setError(`We could not confirm the save. ${failure.message || 'Please try again.'}`); }
    finally { if (active.current) setBusy(false); }
  };
  if (tracking || !plan.tasks.some(task => isSelectableEdit(task, pageUrl))) return null;
  return <section aria-label="Confirm published edits" className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/20">
    {saved ? <p role="status" className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />Published edits recorded. Collecting search data.</p> : <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="font-semibold">{selectedTasks.length ? `${selectedTasks.length} published ${selectedTasks.length === 1 ? 'edit' : 'edits'} selected` : 'Ready after you publish'}</h2><p className="mt-1 text-sm text-muted-foreground">{selectedTasks.length ? 'Confirm these edits to start a dated comparison.' : 'Select the edits you made on your website above.'}</p></div>
      <Button disabled={!canOpen} onClick={() => { setPublished(false); setConfirmOpen(true); }}>Start tracking published edits</Button>
    </div>}
    {loading && <p role="status" className="mt-3 text-xs text-muted-foreground">Checking existing progress…</p>}
    {statusError && <p role="alert" className="mt-3 text-sm text-destructive">Progress status is unavailable. Retry the progress check before confirming.</p>}
    {error && !confirmOpen && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <Dialog open={confirmOpen} onOpenChange={value => { if (!busy) setConfirmOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Are these changes live on your website?</DialogTitle><DialogDescription>Confirming edits you haven’t published would make the comparison misleading. Only continue when these edits are live; today starts tracking.</DialogDescription></DialogHeader>
      <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">{pageUrl}<span className="sr-only"> (opens in a new tab)</span></a>
      <ul className="list-disc space-y-1 pl-5 text-sm">{selectedTasks.map(task => <li key={task.id}>{task.recommendation.label}</li>)}</ul>
      <div className="space-y-2"><Label htmlFor={`${id}-summary`}>What did you publish?</Label><Textarea id={`${id}-summary`} value={summary} maxLength={600} disabled={busy} onChange={event => { setSummary(event.target.value); setPublished(false); }} /><p className="text-xs text-muted-foreground">Adjust this summary to describe your actual edits.</p></div>
      <div className="flex items-start gap-2 rounded-lg border p-3"><Checkbox id={`${id}-published`} checked={published} disabled={busy || loading || Boolean(statusError)} onCheckedChange={value => setPublished(value === true)} /><Label htmlFor={`${id}-published`} className="leading-5">I confirm these edits are live on this exact page.</Label></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>Not yet</Button><Button disabled={!ready} onClick={confirm}>{busy ? 'Saving…' : 'Yes, start tracking'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}

export default function PageContentChangeConfirmation(props) {
  return props.plan ? <SelectedTaskConfirmation {...props} /> : <LegacyPageContentChangeConfirmation {...props} />;
}
