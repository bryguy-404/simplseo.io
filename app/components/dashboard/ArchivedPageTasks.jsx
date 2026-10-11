"use client";

import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { usableSavedPagePlan } from './SavedPagePlan';
import { reviewDate } from './OngoingPageProgress';
import { Button } from '@/components/ui/button';

export default function ArchivedPageTasks({ pageUrl, property, websiteRunId }) {
  const [history, setHistory] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);
  useEffect(() => { setHistory([]); setLoaded(false); setCursor(null); setError(''); return () => controller.current?.abort(); }, [pageUrl, property, websiteRunId]);
  const load = async () => {
    if (busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError('');
    try {
      const response = await authenticatedFetch(`/api/page-review/plan?pageUrl=${encodeURIComponent(pageUrl)}&history=1${cursor ? `&beforeRevision=${encodeURIComponent(cursor)}` : ''}`, { signal: request.signal });
      const body = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || 'Earlier tasks could not be loaded.');
      if (!Array.isArray(body.history) || !body.history.every(plan => usableSavedPagePlan(plan, { pageUrl, property, websiteRunId }))) throw new Error('Earlier tasks could not be verified for this page.');
      setHistory(previous => [...previous, ...body.history.filter(plan => !previous.some(item => item.revision === plan.revision))]); setCursor(body.nextCursor || null); setLoaded(true);
    } catch (failure) { if (!request.signal.aborted) setError(failure.message); }
    finally { if (!request.signal.aborted) setBusy(false); }
  };
  return <details className="mb-6 rounded-xl border p-5 text-sm"><summary className="cursor-pointer font-medium">Earlier task lists</summary><div className="mt-4 space-y-4">
    <p className="text-xs text-muted-foreground">Read-only tasks saved before a later review. Their original wording remains available.</p>
    {history.map(plan => <details key={plan.revision}><summary className="cursor-pointer font-medium">Tasks saved {reviewDate(plan.archivedAt || plan.updatedAt)}</summary><div className="mt-3 space-y-3">{plan.tasks.map(task => <article key={task.id} className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">{task.recommendation.label}</h3><p className="text-xs text-muted-foreground">{task.status === 'done' ? 'Completed' : task.status === 'dismissed' ? 'Dismissed' : 'Saved suggestion'}</p><p>{task.recommendation.instruction}</p>{task.recommendation.proposedText && <p className="whitespace-pre-wrap rounded-lg bg-muted p-3">{task.recommendation.proposedText}</p>}</article>)}</div></details>)}
    {(!loaded || cursor || error) && <Button variant="outline" size="sm" disabled={busy} onClick={load}>{busy ? 'Loading earlier tasks…' : error ? 'Retry earlier tasks' : loaded ? 'Load more earlier tasks' : 'Load earlier tasks'}</Button>}
    {loaded && !history.length && <p>No earlier task lists were saved for this page.</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
  </div></details>;
}
