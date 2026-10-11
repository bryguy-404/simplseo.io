"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChartNoAxesCombined, Clock3, LoaderCircle, TriangleAlert } from 'lucide-react';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { pageIdentity } from './PageSearchActivity';
import { googleInspectionLink } from './PageReviewDiagnostics';
import { Button } from '@/components/ui/button';
import { ElapsedProgress, SearchResultCards, progressDate as reviewDate } from './ProgressVisuals';
import { resultMetrics } from '../../lib/progressPresentation';

export { reviewDate };
const number = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
const labels = { keep_monitoring: 'Keep monitoring this page', gather_evidence: 'More evidence is needed', fix_technical: 'Check a technical issue first', investigate_visibility: 'Look closer at search visibility', improve_page: 'Useful next changes to review' };
const validDecision = (value, cycle) => value && typeof value.id === 'string' && value.cycleId === cycle.id && value.pageUrl === cycle.pageUrl && Object.hasOwn(labels, value.outcome) && ['summary', 'whatChanged', 'meaning', 'nextStep'].every(key => typeof value[key] === 'string') && Array.isArray(value.proposedTasks);
const validCycle = (value, cycle) => value?.id === cycle.id && value.pageUrl === cycle.pageUrl && value.property === cycle.property && (value.websiteRunId || null) === (cycle.websiteRunId || null) && Number.isInteger(value.revision) && value.revision >= cycle.revision;

export function CycleObservations({ checkpoint }) {
  if (!checkpoint) return null;
  const before = checkpoint.windows?.baseline || checkpoint.baseline;
  const after = checkpoint.windows?.post || checkpoint.post;
  const unavailable = checkpoint.state === 'incomplete' || checkpoint.baseline?.status === 'unavailable' || checkpoint.post?.status === 'unavailable';
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Before: {reviewDate(before?.startDate)}–{reviewDate(before?.endDate)}<br />After: {reviewDate(after?.startDate)}–{reviewDate(after?.endDate)} · Pacific dates.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="pb-2 text-left text-xs text-muted-foreground">Exact-page search activity · saved observations</caption><thead><tr className="border-b"><th scope="col" className="py-2 text-left">Metric</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>{resultMetrics(checkpoint).map(metric => <tr key={metric.key} className="border-b"><th scope="row" className="py-2 text-left font-normal">{metric.label}</th><td className="text-center">{number(metric.before)}</td><td className="text-center">{number(metric.after)}</td></tr>)}</tbody></table></div>
    <p className="text-xs text-muted-foreground">Average position is a reported average, not a fixed Google results page. Traffic changes do not prove that your edits caused them.</p>
    {unavailable && <p className="text-sm">Some observations are unavailable. Missing data does not mean this page received no traffic.</p>}
    {checkpoint.lowVolume && !unavailable && <p className="text-sm">There is too little search activity for a reliable direction yet. This period is inconclusive.</p>}
    {(checkpoint.post?.fetchedAt || checkpoint.observedAt || checkpoint.createdAt) && <p className="text-xs text-muted-foreground">Observed {reviewDate(checkpoint.post?.fetchedAt || checkpoint.observedAt || checkpoint.createdAt)}.</p>}
  </div>;
}

export function CycleChanges({ cycle }) {
  const taskLabels = Array.isArray(cycle.confirmation?.taskLabels) ? cycle.confirmation.taskLabels.filter(value => typeof value === 'string') : [];
  return <details className="text-sm"><summary className="cursor-pointer font-medium">Published changes ({taskLabels.length || 1})</summary><div className="mt-3 space-y-2">{taskLabels.length > 0 && <ul className="list-disc space-y-1 pl-5">{taskLabels.map((label, index) => <li key={`${index}-${label}`}>{label}</li>)}</ul>}{cycle.confirmation?.summary && <p className="whitespace-pre-wrap break-words text-muted-foreground">{cycle.confirmation.summary}</p>}<p className="text-xs text-muted-foreground">Confirmed {reviewDate(cycle.confirmedAt)}. Previous edits stay in this record.</p></div></details>;
}

function TechnicalCheck({ technical }) {
  if (!technical) return null;
  const issues = Array.isArray(technical.issues) ? technical.issues : [];
  const inspectionUrl = googleInspectionLink(technical.indexing?.inspectionUrl || technical.indexing?.inspectionResultLink);
  return <details className="text-sm" open={issues.length > 0 || undefined}><summary className="cursor-pointer font-medium">Latest website checks</summary><div className="mt-3 space-y-3">
    {issues.length > 0 ? <ul className="list-disc space-y-2 pl-5">{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.stale && <span className="font-medium">Earlier observation, not verified by the latest check: </span>}{issue.message}{issue.checkedAt && <p className="mt-1 text-xs text-muted-foreground">Observed {reviewDate(issue.checkedAt)}.</p>}</li>)}</ul> : <p>{technical.errors ? 'Some checks could not finish. Any earlier observations below keep their original dates.' : 'No issue was identified by these checks. They do not cover every possible SEO issue.'}</p>}
    {technical.errors && issues.length > 0 && <p className="text-xs text-muted-foreground">Some checks could not finish. Earlier issues keep their observation dates and may have changed.</p>}
    {technical.publicPage && <p className="text-xs text-muted-foreground">Website check: {[404, 410].includes(technical.publicPage.httpStatus) ? `Page not found (${technical.publicPage.httpStatus})` : technical.publicPage.status === 'available' ? 'Page could be read' : 'Unavailable'} · {reviewDate(technical.publicPage.checkedAt)}</p>}
    {technical.indexing && <p className="text-xs text-muted-foreground">Google’s stored indexing result: {technical.indexing.coverageState || technical.indexing.indexingState || technical.indexing.status || 'Unavailable'} · checked {reviewDate(technical.indexing.checkedAt)}{technical.indexing.lastCrawlTime ? ` · Google’s last reported visit ${reviewDate(technical.indexing.lastCrawlTime)}` : ''}</p>}
    {inspectionUrl && <a href={inspectionUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline">Open Google inspection</a>}
    <p className="text-xs text-muted-foreground">Checking this page does not request indexing or restart your comparison.</p>
  </div></details>;
}

function DecisionSummary({ decision }) {
  return <div className="space-y-3 rounded-xl border bg-background/40 p-4 text-sm"><p className="font-semibold">{decision.summary}</p><dl className="space-y-3"><div><dt className="font-medium">What it means</dt><dd className="mt-1 text-muted-foreground">{decision.meaning}</dd></div><div><dt className="font-medium">What to do next</dt><dd className="mt-1">{decision.nextStep}</dd></div></dl><details><summary className="cursor-pointer text-xs text-muted-foreground">Why this recommendation?</summary><p className="mt-2 text-muted-foreground">{decision.whatChanged}</p><p className="mt-2 text-xs text-muted-foreground">Review saved {reviewDate(decision.reviewedAt)}.</p></details></div>;
}

export default function OngoingPageProgress({ cycle, selected = false, disabled = false, planRevision, onCycle, onPlan, onBusy, onRecordEdit }) {
  const [decision, setDecision] = useState(validDecision(cycle.latestDecision, cycle) ? cycle.latestDecision : null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const controller = useRef(null);
  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;
  useEffect(() => {
    if (!selected) return;
    const request = new AbortController(); controller.current = request;
    setBusy('load'); setError('');
    authenticatedFetch(`/api/page-review/follow-up?cycleId=${encodeURIComponent(cycle.id)}`, { signal: request.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'The saved review could not be loaded.'); if (request.signal.aborted) return;
        if (!validCycle(body.cycle, cycleRef.current) || (body.decision && !validDecision(body.decision, body.cycle))) throw new Error('The saved review could not be verified for this page. Reload it before continuing.');
        setDecision(body.decision || null); onCycle?.(body.cycle);
      }).catch(failure => { if (!request.signal.aborted) setError(failure.message); })
      .finally(() => { if (!request.signal.aborted) setBusy(''); });
    return () => request.abort();
  }, [cycle.id, selected, reload, onCycle]);
  useEffect(() => { if (validDecision(cycle.latestDecision, { id: cycle.id, pageUrl: cycle.pageUrl })) setDecision(cycle.latestDecision); }, [cycle.latestDecision, cycle.id, cycle.pageUrl]);
  useEffect(() => { onBusy?.(Boolean(busy)); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => () => controller.current?.abort(), []);

  const act = async action => {
    if (busy || disabled || cycle.readOnly) return;
    const request = new AbortController(); controller.current?.abort(); controller.current = request;
    setBusy(action); setError(''); setNotice('');
    try {
      const response = await authenticatedFetch('/api/page-review/follow-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: request.signal,
        body: JSON.stringify({ cycleId: cycle.id, expectedRevision: cycle.revision, action, ...(action === 'accept_tasks' ? { decisionId: decision.id, expectedPlanRevision: planRevision } : {}) }) });
      const body = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || 'This check could not finish. Your saved review is unchanged.');
      if (!validCycle(body.cycle, cycle) || (body.decision && !validDecision(body.decision, body.cycle))) throw new Error('The result could not be verified for this page. Reload the saved review before continuing.');
      if (action === 'accept_tasks' && (!body.plan || onPlan?.(body.plan) === false)) throw new Error('The updated task list could not be verified. Reload saved tasks before continuing.');
      setDecision(body.decision || null); onCycle?.(body.cycle);
      setNotice(action === 'troubleshoot' ? 'Website checks updated. Your published-change date and monitoring remain unchanged.' : action === 'accept_tasks' ? 'Next tasks saved below. Tracking continues until you publish and confirm another edit.' : body.unchanged ? 'Your saved review still applies to the available evidence.' : 'Review saved. Your page remains tracked.');
    } catch (failure) { if (!request.signal.aborted) setError(failure.message || 'This check could not finish. Please retry.'); }
    finally { if (!request.signal.aborted) setBusy(''); }
  };
  const collecting = !cycle.latestCheckpoint;
  const needsAttention = cycle.state === 'needs_attention';
  const newResults = cycle.state === 'review_due' || cycle.reviewStatus === 'review_due' || Boolean(decision?.checkpointId && cycle.latestCheckpoint && (decision.checkpointId !== cycle.latestCheckpoint.id || (Number.isInteger(decision.checkpointRevision) && decision.checkpointRevision !== (cycle.latestCheckpoint.evidenceRevision || 1))));
  const title = needsAttention ? 'A website check needs attention' : newResults ? 'New results ready to review' : decision ? labels[decision.outcome] : collecting ? 'Collecting search data' : 'Ready to review your results';
  const locked = disabled || Boolean(busy) || cycle.readOnly;
  return <section aria-label={`Ongoing progress for ${pageIdentity(cycle.pageUrl)}`} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5" aria-busy={Boolean(busy)}>
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className={`flex items-center gap-2 font-semibold ${needsAttention ? 'text-amber-800 dark:text-amber-300' : ''}`}>{needsAttention ? <TriangleAlert className="h-4 w-4" aria-hidden="true" /> : collecting ? <Clock3 className="h-4 w-4" aria-hidden="true" /> : <ChartNoAxesCombined className="h-4 w-4" aria-hidden="true" />}{title}</h3>{!selected && <a className="break-all text-sm underline" href={cycle.pageUrl} target="_blank" rel="noopener noreferrer">{pageIdentity(cycle.pageUrl)}</a>}</div>
    {collecting ? <ElapsedProgress cycle={cycle} /> : <SearchResultCards checkpoint={cycle.latestCheckpoint} previous={Boolean(cycle.lastError || cycle.state === 'error')} />}
    {decision && !newResults ? <DecisionSummary decision={decision} /> : !collecting && <p className="text-sm text-muted-foreground">Review these results to choose the next useful step.</p>}
    {decision && newResults && <details className="text-sm"><summary className="cursor-pointer font-medium">Previous review · {reviewDate(decision.reviewedAt)}</summary><div className="mt-3"><p className="mb-3 text-xs text-muted-foreground">This earlier recommendation has not been reassessed against the new reporting period.</p><DecisionSummary decision={decision} /></div></details>}
    {cycle.nextReviewAt && <p className="text-sm font-medium">{collecting ? 'First comparison check' : 'Next comparison check'}: {reviewDate(cycle.nextReviewAt)}</p>}
    {(cycle.lastError || cycle.state === 'error') && <p role="status" className="rounded-lg border p-3 text-sm">A recent check could not finish. Earlier observations and reviews remain saved with their original dates. {cycle.lastError?.connection === 'reconnect_required' ? <Link href="/revamp" className="underline">Reconnect Google in website setup</Link> : <span>Use Check progress to retry.</span>}</p>}
    {cycle.latestCheckpoint && <details className="text-sm"><summary className="cursor-pointer font-medium">View dated search results</summary><div className="mt-3"><CycleObservations checkpoint={cycle.latestCheckpoint} /></div></details>}
    {cycle.latestCheckpoint?.day > 28 && cycle.originalComparison && <details className="text-sm"><summary className="cursor-pointer font-medium">Original comparison after these edits</summary><div className="mt-3"><CycleObservations checkpoint={cycle.originalComparison} /></div></details>}
    <CycleChanges cycle={cycle} />
    <TechnicalCheck technical={cycle.technical} />
    {selected ? <div className="space-y-3 border-t pt-3">
      {!newResults && decision?.proposedTasks?.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-medium">Suggested next tasks ({decision.proposedTasks.length})</summary><ul className="mt-3 list-disc space-y-2 pl-5">{decision.proposedTasks.map((task, index) => <li key={task.id || index}><span className="font-medium">{task.label}</span>{task.instruction && <p className="mt-1 text-muted-foreground">{task.instruction}</p>}</li>)}</ul></details>}
      {!newResults && decision?.canAcceptTasks && !decision.acceptedAt && <Button className="mr-4" disabled={locked || !Number.isInteger(planRevision)} onClick={() => act('accept_tasks')}>Use these next tasks</Button>}
      {decision?.acceptedAt && <p className="text-sm">Next tasks are saved in your task list below. Publish useful edits before confirming them.</p>}
      {!cycle.readOnly && cycle.latestCheckpoint && <Button variant={decision && !newResults ? 'link' : 'default'} className={decision && !newResults ? 'h-auto px-0 text-sm' : undefined} disabled={locked} onClick={() => act('review')}>{busy === 'review' ? 'Reviewing results…' : decision && !newResults ? 'Check this review for updates' : 'Review my results'}</Button>}
      <div className="flex flex-wrap gap-x-5 gap-y-2"><Button variant="link" className="h-auto px-0 text-xs text-muted-foreground" disabled={locked} onClick={() => act('troubleshoot')}>Something seems wrong</Button>{cycle.canRecordInterveningChange && onRecordEdit && <Button variant="link" className="h-auto px-0 text-xs text-muted-foreground" disabled={locked} onClick={() => onRecordEdit(cycle)}>Record another published edit</Button>}</div>
    </div> : <Link className="inline-block text-sm underline" href={`/low-ctr?page=${encodeURIComponent(cycle.pageUrl)}`}>{collecting ? 'View this page’s tracking' : 'Review my results'}</Link>}
    {busy && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{busy === 'load' ? 'Loading your saved review…' : busy === 'troubleshoot' ? 'Checking the live page and Google’s stored indexing result…' : busy === 'accept_tasks' ? 'Saving your next tasks…' : 'Reviewing the evidence for this page…'}</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => setReload(value => value + 1)}>Reload saved review</Button></div>}
    {notice && !busy && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </section>;
}
