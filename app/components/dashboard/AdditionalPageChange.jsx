"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// For an owner-published edit outside the saved checklist. This uses the same
// server confirmation boundary as a selected task; opening it changes nothing.
export default function AdditionalPageChange({ cycle, provenance, disabled, onConfirmed }) {
  const id = useId();
  const [summary, setSummary] = useState('');
  const [published, setPublished] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { setOpen(false); setPublished(false); }, [cycle.id, cycle.revision]);
  const available = cycle.canRecordInterveningChange && !cycle.readOnly && provenance?.pageUrl === cycle.pageUrl && Number.isInteger(cycle.revision);
  const ready = available && !disabled && !busy && summary.trim().length > 0 && summary.trim().length <= 600;
  const confirm = async () => {
    if (!ready || !published) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const response = await authenticatedFetch('/api/page-review/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ pageUrl: cycle.pageUrl, provenance, changeType: 'page_content', changeSummary: summary.trim(), published: true, previousCycleId: cycle.id, previousCycleRevision: cycle.revision, interveningChange: true }) });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(result.error || 'Please retry after checking the saved progress.');
      if (result.record?.pageUrl !== cycle.pageUrl || result.record.changeType !== 'page_content' || result.record.pageChangeSummary !== summary.trim() || result.record.confirmationMethod !== 'user-confirmed' || !Number.isFinite(Date.parse(result.record.implementedAt))) throw new Error('The saved publication could not be verified. Reload progress before retrying.');
      setOpen(false); window.dispatchEvent(new Event('seo-implementation-changed')); onConfirmed?.(result.record, result.plan);
    } catch (failure) { if (!controller.signal.aborted) setError(`We could not confirm the save. ${failure.message}`); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <details className="mb-6 rounded-xl border p-5 text-sm"><summary className="cursor-pointer font-medium">Published a different edit?</summary><div className="mt-4 space-y-4">
    <p className="text-muted-foreground">Use this for a real edit you published outside the saved tasks. You do not need to record a new edit to keep monitoring.</p>
    <Label htmlFor={`${id}-summary`}>What did you actually publish?</Label><Textarea id={`${id}-summary`} value={summary} maxLength={600} disabled={busy || disabled} onChange={event => { setSummary(event.target.value); setPublished(false); }} />
    <Button variant="outline" disabled={!ready} onClick={() => { setPublished(false); setOpen(true); }}>Review this published edit</Button>
    {error && !open && <p role="alert" className="text-destructive">{error}</p>}
  </div><Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Is this additional edit live?</DialogTitle><DialogDescription>Another published edit starts a new tracking cycle today. Your earlier edits and results stay saved, but this new edit can affect how their results are interpreted.</DialogDescription></DialogHeader>
    <a href={cycle.pageUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">{cycle.pageUrl}</a><p className="whitespace-pre-wrap text-sm">{summary.trim()}</p>
    <div className="flex items-start gap-2 rounded-lg border p-3"><Checkbox id={`${id}-live`} checked={published} disabled={busy || disabled} onCheckedChange={value => setPublished(value === true)} /><Label htmlFor={`${id}-live`} className="leading-5">I confirm this additional edit is live on this exact page.</Label></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Not yet</Button><Button disabled={!ready || !published} onClick={confirm}>{busy ? 'Saving…' : 'Yes, track this additional edit'}</Button></DialogFooter>
  </DialogContent></Dialog></details>;
}
