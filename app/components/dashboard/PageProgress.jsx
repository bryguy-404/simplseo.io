"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Clock3, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { comparisonWindows, pacificDay, shiftDay } from '../../lib/progressAssessment';
import { pageIdentity } from './PageSearchActivity';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const stateLabels = { ready: 'Comparison available', collecting: 'Collecting search data', insufficient_data: 'Not enough data', error: 'Check unavailable', paused: 'Review paused' };
const reasons = {
  account_review_required: 'Progress reviews are paused for this website update.',
  not_enough_search_activity: 'This period has too little search activity for a useful comparison. It is inconclusive, not a failed result.',
  baseline_outside_available_history: 'The earlier period is outside the available Search Console history.',
  implementation_date_or_page_missing: 'The saved change is missing its page or confirmation date.',
  reconnect_required: 'Reconnect Google from website setup to resume checks.',
  search_data_unavailable: 'Google data could not be loaded. Earlier observations remain dated below.',
};
const metric = (value, percent = false) => value == null ? '—' : percent ? `${(value * 100).toFixed(2)}%` : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const calendarLabel = value => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`))) return 'Date unavailable';
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
};
const confirmationDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : pacificDay(value);

function ObservedMetrics({ assessment }) {
  const { baseline, post, windows, comparison } = assessment;
  return <div className="mt-3 space-y-3">
    {windows && <p className="text-xs text-muted-foreground">Before: {calendarLabel(windows.baseline.startDate)}–{calendarLabel(windows.baseline.endDate)}<br />After: {calendarLabel(windows.post.startDate)}–{calendarLabel(windows.post.endDate)} · Pacific dates.</p>}
    {baseline && post ? <div className="overflow-x-auto"><table className="w-full text-sm">
      <caption className="pb-2 text-left text-xs text-muted-foreground">Reported search activity{assessment.state === 'error' ? ' · last successful observations' : ''}</caption>
      <thead><tr className="border-b"><th scope="col" className="py-2 text-left">Metric</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
      <tbody>{[['Impressions', 'impressions'], ['Clicks', 'clicks'], ['Click-through rate', 'ctr'], ['Average position', 'position']].map(([label, key]) => <tr key={key} className="border-b"><th scope="row" className="py-2 text-left font-normal">{label}</th><td className="text-center">{metric(baseline[key], key === 'ctr')}</td><td className="text-center">{metric(post[key], key === 'ctr')}</td></tr>)}</tbody>
    </table></div> : <p className="text-xs text-muted-foreground">A complete before-and-after observation is not available yet.</p>}
    {assessment.state === 'ready' && comparison && <p className="text-sm">Click change: {comparison.clicksDelta > 0 ? '+' : ''}{metric(comparison.clicksDelta)}{comparison.clicksPercent == null ? ' · No percentage change because the earlier period had zero clicks.' : ` (${comparison.clicksPercent > 0 ? '+' : ''}${comparison.clicksPercent.toFixed(1)}%)`}</p>}
    {(baseline?.fetchedAt || post?.fetchedAt) && <p className="text-xs text-muted-foreground">Observed {new Date(post?.fetchedAt || baseline.fetchedAt).toLocaleString()} · {assessment.property}</p>}
  </div>;
}

export default function PageProgress({ pageUrl, hideEmpty = true, onResult, onLoadState, onCycleStarted }) {
  const { user } = useAuth();
  const { data } = useOnboarding();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [cycleBusy, setCycleBusy] = useState(null);
  const [cycleError, setCycleError] = useState(null);
  const sequence = useRef(0);
  const scope = useRef(0);
  const invalidateRequests = useCallback(() => { sequence.current++; scope.current++; }, []);
  const load = useCallback(async (refresh = false) => {
    if (!user?.id) return;
    const attempt = ++sequence.current;
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch('/api/progress', { method: refresh ? 'POST' : 'GET' });
      const body = await response.json();
      if (attempt !== sequence.current) return;
      if (!response.ok) throw new Error(body.error || 'Unable to load progress. Please try again.');
      if (!Array.isArray(body.records)) throw new Error('Progress could not be verified. Please retry.');
      setResult(body);
    } catch (failure) { if (attempt === sequence.current) setError(failure.message); }
    finally { if (attempt === sequence.current) setBusy(false); }
  }, [user?.id]);
  useEffect(() => { setResult(null); setCycleError(null); setCycleBusy(null); load(); return invalidateRequests; }, [load, invalidateRequests, data.gscProperty, data.revampRunId, pageUrl]);
  useEffect(() => { onResult?.(result); }, [result, onResult]);
  useEffect(() => { onLoadState?.({ loading: busy, error }); }, [busy, error, onLoadState]);
  useEffect(() => {
    const reload = () => load();
    window.addEventListener('seo-implementation-changed', reload);
    return () => window.removeEventListener('seo-implementation-changed', reload);
  }, [load]);

  const startNextCycle = async record => {
    if (cycleBusy || busy || !record.canStartNextCycle) return;
    const attempt = scope.current;
    setCycleBusy(record.id); setCycleError(null);
    try {
      const response = await authenticatedFetch('/api/page-review/cycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl: record.pageUrl, implementedAt: record.implementedAt }) });
      const body = await response.json();
      if (attempt !== scope.current) return;
      if (!response.ok) throw new Error(body.error || 'The next review could not be started.');
      if (body.success !== true || body.pageUrl !== record.pageUrl || body.implementedAt !== record.implementedAt || body.record?.status !== 'reviewed' || body.record.pageUrl !== record.pageUrl || body.record.implementedAt !== record.implementedAt) throw new Error('The next review could not be verified. Reload progress before trying again.');
      setResult(previous => previous ? { ...previous, records: previous.records.filter(item => item.id !== record.id) } : previous);
      onCycleStarted?.(body.record);
      window.dispatchEvent(new Event('seo-implementation-changed'));
    } catch (failure) { if (attempt === scope.current) setCycleError({ id: record.id, message: failure.message }); }
    finally { if (attempt === scope.current) setCycleBusy(null); }
  };

  const records = (result?.records || []).filter(record => !pageUrl || record.pageUrl === pageUrl);
  const history = (Array.isArray(result?.history) ? result.history : []).filter(record => !pageUrl || record.pageUrl === pageUrl);
  if (hideEmpty && !error && result && !records.length && !history.length && !result.historyUnavailable) return null;
  return <Card id="page-progress" className="mb-6 scroll-mt-6" aria-label="Page progress">
    <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle role="heading" aria-level={2}>Page progress</CardTitle><Button size="sm" variant="outline" onClick={() => load(Boolean(result))} disabled={busy || Boolean(cycleBusy) || result?.paused || (!error && !records.length)}>{busy ? 'Checking…' : error ? 'Retry progress' : 'Check progress'}</Button></div></CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {result?.historyUnavailable && <div className="space-y-2"><p role="status" className="text-xs text-muted-foreground">Some previous comparisons could not be loaded.</p><Button size="sm" variant="outline" disabled={busy} onClick={() => load(false)}>Reload previous comparisons</Button></div>}
      {!result && !error && <p role="status" className="text-sm text-muted-foreground">Checking saved progress…</p>}
      {result && !records.length && !hideEmpty && <div className="space-y-2 rounded-lg border border-dashed p-4"><p className="font-medium">Ready for your first change</p><p className="text-sm text-muted-foreground">Publish an edit, then confirm it to start tracking.</p><Link className="text-sm underline" href="/low-ctr">Choose a page to review</Link></div>}
      {records.map(record => {
        const assessment = record.assessment || {};
        const windows = assessment.windows || comparisonWindows(record.implementedAt);
        const firstCheck = windows?.post?.endDate ? shiftDay(windows.post.endDate, result.policy?.reportingDelayDays ?? 3) : null;
        const collecting = assessment.state === 'collecting';
        const publishedLabels = Array.isArray(record.confirmedTaskLabels) ? record.confirmedTaskLabels.filter(label => typeof label === 'string') : [];
        const hasMetadata = record.changeType !== 'page_content' && (typeof record.title === 'string' && record.title || typeof record.description === 'string' && record.description);
        return <section key={record.id} aria-label={`Progress for ${pageIdentity(record.pageUrl)}`} className={`space-y-3 rounded-xl border p-4 ${collecting ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20' : ''}`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold">{collecting ? <Clock3 className="h-4 w-4" aria-hidden="true" /> : assessment.state === 'ready' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : null}{stateLabels[assessment.state] || 'Not checked yet'}</h3>{!pageUrl && <a className="break-all text-sm underline" href={record.pageUrl} target="_blank" rel="noopener noreferrer">{pageIdentity(record.pageUrl)}</a>}</div>
          <p className="text-xs text-muted-foreground">Changes confirmed {calendarLabel(confirmationDay(record.implementedAt))}.</p>
          {collecting ? <><p className="text-sm">Your edits are recorded. Search activity is being collected for this page.</p>{firstCheck && <p className="text-sm font-medium">First comparison check: {calendarLabel(firstCheck)}</p>}<p className="text-xs text-muted-foreground">Allow 28 complete days plus Google’s reporting delay. A useful comparison also needs enough search activity.</p></> : reasons[assessment.reason] && <p className="text-sm text-muted-foreground">{reasons[assessment.reason]}</p>}
          {(publishedLabels.length > 0 || record.pageChangeSummary || hasMetadata) && <details className="text-sm"><summary className="cursor-pointer font-medium">Published changes ({publishedLabels.length || 1})</summary><div className="mt-3 space-y-2">{publishedLabels.length > 0 && <ul className="list-disc space-y-1 pl-5">{publishedLabels.map((label, index) => <li key={`${index}-${label}`}>{label}</li>)}</ul>}{record.pageChangeSummary && <p className="whitespace-pre-wrap break-words text-muted-foreground">{record.pageChangeSummary}</p>}{hasMetadata && <dl className="space-y-3">{record.title && <div><dt className="text-xs text-muted-foreground">Confirmed title</dt><dd className="mt-1 break-words">{record.title}</dd></div>}{record.description && <div><dt className="text-xs text-muted-foreground">Confirmed description</dt><dd className="mt-1 break-words">{record.description}</dd></div>}</dl>}</div></details>}
          {assessment.state === 'ready' && assessment.baseline && assessment.post ? <ObservedMetrics assessment={assessment} /> : assessment.baseline && assessment.post ? <details className="text-sm"><summary className="cursor-pointer font-medium">View dated observations</summary><ObservedMetrics assessment={assessment} /></details> : null}
          {record.canStartNextCycle && !result.paused && <div className="space-y-2 border-t pt-3"><Button size="sm" variant="outline" disabled={busy || Boolean(cycleBusy)} onClick={() => startNextCycle(record)}>{cycleBusy === record.id ? 'Starting…' : 'Start another review'}</Button><p className="text-xs text-muted-foreground">Save this comparison and review the page again.</p></div>}
          {cycleError?.id === record.id && <p role="alert" className="text-sm text-destructive">{cycleError.message}</p>}
        </section>;
      })}
      {history.length > 0 && <details className="border-t pt-3 text-sm"><summary className="cursor-pointer font-medium">Previous comparisons ({history.length})</summary>{result.historyLimited && <p className="mt-3 text-xs text-muted-foreground">Showing the most recent saved comparisons.</p>}<div className="mt-4 space-y-4">{history.map(record => <article key={`${record.id}:${record.implementedAt}`} className="space-y-3 rounded-lg border p-4" aria-label={`Previous comparison for ${pageIdentity(record.pageUrl)} on ${confirmationDay(record.implementedAt)}`}>
        <div><h3 className="font-semibold">{pageIdentity(record.pageUrl)} · {calendarLabel(confirmationDay(record.implementedAt))}</h3><p className="mt-1 text-xs text-muted-foreground">{stateLabels[record.assessment?.state] || 'Earlier comparison'} · Saved before starting another review</p></div>
        {record.pageChangeSummary && <p className="whitespace-pre-wrap break-words text-sm">{record.pageChangeSummary}</p>}
        {Array.isArray(record.confirmedTaskLabels) && record.confirmedTaskLabels.length > 0 && <details><summary className="cursor-pointer text-xs font-medium">Published changes ({record.confirmedTaskLabels.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{record.confirmedTaskLabels.map((label, index) => <li key={`${index}-${label}`}>{label}</li>)}</ul></details>}
        {record.changeType !== 'page_content' && (record.title || record.description) && <details><summary className="cursor-pointer text-xs font-medium">Confirmed wording</summary><div className="mt-2 space-y-2 text-xs">{record.title && <p>{record.title}</p>}{record.description && <p>{record.description}</p>}</div></details>}
        {reasons[record.assessment?.reason] && <p className="text-xs text-muted-foreground">{reasons[record.assessment.reason]}</p>}
        <ObservedMetrics assessment={record.assessment || {}} />
      </article>)}</div></details>}
      {(records.length > 0 || history.length > 0) && <details className="border-t pt-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">How progress is measured</summary><div className="mt-3 space-y-2"><p>We compare 28 days before and after confirmation, excluding the confirmation day. Dates use Pacific time; the latest three reporting days are excluded.</p><p>A comparison needs at least {result.policy?.minImpressionsPerWindow || 100} impressions in each period and {result.policy?.minCombinedClicks || 10} clicks combined. Low activity can leave this fixed comparison inconclusive even after more time passes.</p><p>These thresholds are not a statistical test. Traffic changes do not prove that your edits caused them.</p><Link className="underline" href="/revamp/history">Previous website work</Link></div></details>}
    </CardContent>
  </Card>;
}
