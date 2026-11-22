"use client";

import { useEffect, useRef, useState } from 'react';
import { Eye, LoaderCircle } from 'lucide-react';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { isMonitoringCycle } from '../../lib/pageMonitoring';
import { Button } from '@/components/ui/button';

export default function PageMonitoringControl({ pageUrl, property, websiteRunId, cycle, goal, enabled, disabled, onChanged, onRefresh, onBusy }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { onBusy?.(Boolean(busy)); return () => onBusy?.(false); }, [busy, onBusy]);
  if (!enabled) return null;
  const active = cycle?.lifecycle === 'active';
  const retry = active && isMonitoringCycle(cycle) && cycle.initialReviewStatus !== 'complete';

  const act = async action => {
    if (busy || disabled) return;
    const request = new AbortController(); controller.current = request;
    setBusy(action); setError(''); setNotice('');
    try {
      const response = await authenticatedFetch('/api/page-review/monitor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: request.signal,
        body: JSON.stringify(action === 'stop' ? { action, cycleId: cycle.id, expectedRevision: cycle.revision } : { action, pageUrl, ...(goal?.trim() ? { goal: goal.trim() } : {}) }),
      });
      const body = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || 'This request could not finish. Please retry.');
      if (!body.success || body.cycle?.pageUrl !== pageUrl || body.cycle.property !== property || (body.cycle.websiteRunId || null) !== (websiteRunId || null)
        || body.cycle.lifecycle !== (action === 'stop' ? 'stopped' : 'active')) throw new Error('The monitoring status could not be verified. Reload this page to check it.');
      onChanged?.(body);
      setNotice(action === 'stop' ? 'Monitoring stopped. Your earlier results and tasks are saved.' : body.reviewError ? 'Monitoring is active. Your initial review needs a retry.' : 'Monitoring is active. Your recommendations and results are saved below.');
    } catch (failure) { if (!request.signal.aborted) setError(failure.message); }
    finally { if (!request.signal.aborted) { setBusy(''); onRefresh?.(); } }
  };

  return <section aria-label="Page monitoring" className="mb-4 space-y-3 rounded-xl border bg-card p-5">
    {!active && <><div><h2 className="text-lg font-semibold">Know when this page needs attention</h2><p className="mt-1 text-sm text-muted-foreground">Get an initial recommendation and monthly review reminders. You don’t need to edit your website first.</p></div><Button disabled={disabled || Boolean(busy)} onClick={() => act('start')}><Eye className="h-4 w-4" aria-hidden="true" />Monitor this page</Button><p className="text-xs text-muted-foreground">We reuse a current review when possible. A new review uses your existing review allowance.</p></>}
    {retry && <div className="space-y-2"><p className="text-sm">Monitoring is active. {cycle.initialReviewStatus === 'checking' ? 'Your initial review is still being prepared.' : cycle.initialReviewError || 'Your initial review has not finished yet.'}</p><Button variant="outline" disabled={disabled || Boolean(busy)} onClick={() => act('start')}>Retry initial review</Button></div>}
    {active && cycle.canStopMonitoring && <details className="text-sm"><summary className="cursor-pointer font-medium">Monitoring settings</summary><p className="my-3 text-muted-foreground">Stop future checks and reminders for this page. Your saved tasks and history stay available.</p><Button variant="outline" disabled={disabled || Boolean(busy)} onClick={() => act('stop')}>Stop monitoring</Button></details>}
    {busy && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{busy === 'stop' ? 'Stopping monitoring…' : 'Starting monitoring and reviewing your page…'}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && !busy && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </section>;
}
