"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCheck, ChevronDown, ExternalLink, Eye, Files, Loader2, Minus, MousePointer2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { reconnectGsc } from '../../lib/reconnectGsc';
import { propertyContainsUrl } from '../../lib/revampState';
import { dashboardActivityState, activityDayLabel } from '../../lib/dashboardActivityPresentation';
import { dashboardNextAction, mergeDashboardWork, prioritizeDashboardWork } from '../../lib/dashboardWorkPresentation';
import { progressTimeline, resultMetrics } from '../../lib/progressPresentation';
import { progressDate } from './ProgressVisuals';
import MainLayout from '../MainLayout';
import WeeklySearchActivity from './WeeklySearchActivity';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const count = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
const reviewHref = pageUrl => `/low-ctr?page=${encodeURIComponent(pageUrl)}`;
const workSourceForKind = { plan: 'plans', cycle: 'cycles', legacy: 'legacy', new_page: 'newPages' };
const pageLabel = pageUrl => { try { const url = new URL(pageUrl); return url.pathname === '/' && !url.search ? 'Homepage' : url.pathname + url.search; } catch { return pageUrl; } };
const toneClasses = {
  positive: 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300',
  negative: 'border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200',
  attention: 'border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200',
  info: 'border-sky-200 bg-sky-50/50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/20 dark:text-sky-200',
  neutral: 'border-border bg-background/50 text-muted-foreground',
};

function WorkComparison({ checkpoint }) {
  const metrics = resultMetrics(checkpoint);
  const before = checkpoint.windows?.baseline || checkpoint.baseline;
  const after = checkpoint.windows?.post || checkpoint.post;
  return <div className="space-y-3" aria-label="Saved page comparison">
    <dl className="space-y-2">{metrics.map(metric => {
      const Icon = metric.tone === 'positive' ? ArrowUpRight : metric.tone === 'negative' ? ArrowDownRight : Minus;
      const deltaText = metric.delta === null ? 'Comparison unavailable' : metric.delta === 0 ? 'No change' : metric.key === 'position' ? `${count(Math.abs(metric.delta))} ${metric.tone === 'positive' ? 'better' : 'worse'}` : `${metric.delta > 0 ? '+' : ''}${count(metric.delta)}`;
      return <div key={metric.key} className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 rounded-lg border bg-background/30 px-3 py-2">
        <dt className="text-xs text-muted-foreground">{metric.key === 'impressions' ? 'Appearances' : metric.label}</dt>
        <dd className="flex items-baseline gap-2 tabular-nums"><span className="font-semibold">{count(metric.after)}</span><span className={`inline-flex items-center gap-0.5 text-xs ${metric.tone === 'positive' ? 'text-emerald-700 dark:text-emerald-300' : metric.tone === 'negative' ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}`}><Icon className="h-3 w-3 self-center" aria-hidden="true" />{deltaText}</span></dd>
      </div>;
    })}</dl>
    <details><summary className="cursor-pointer text-xs text-muted-foreground">Comparison dates and previous numbers</summary><div className="mt-2 space-y-2 text-xs text-muted-foreground"><p>Before: {progressDate(before?.startDate)}–{progressDate(before?.endDate)}<br />After: {progressDate(after?.startDate)}–{progressDate(after?.endDate)}</p><p>{metrics.map(metric => `${metric.label}: ${count(metric.before)} → ${count(metric.after)}`).join(' · ')}</p><p>Average position is an average; closer to 1 is better. These numbers do not establish what caused a change.</p>{checkpoint.lowVolume && <p>A small amount of activity so far. More time can help clarify the direction.</p>}</div></details>
  </div>;
}

function WorkCard({ item, now }) {
  const timeline = progressTimeline(item, now);
  const collecting = ['collecting', 'monitoring'].includes(item.state) && timeline;
  return <article className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm" aria-label={`${item.label}: ${item.title}`}>
    <div className="space-y-2">
      <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-medium ${toneClasses[item.tone] || toneClasses.neutral}`}>{item.title}</span>
      <h3 className="break-words text-lg font-semibold leading-snug">{item.label}</h3>
      {item.pageUrl && <p className="truncate text-xs text-muted-foreground" title={item.pageUrl}>{item.pageUrl.replace(/^https?:\/\//, '')}</p>}
      <p className="text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
    </div>
    {item.stale && <p className="text-xs text-amber-800 dark:text-amber-200">A newer check could not finish. Showing the last saved observations{item.observedAt ? ` from ${progressDate(item.observedAt)}` : ''}.</p>}
    {item.latestCheckpoint && <WorkComparison checkpoint={item.latestCheckpoint} />}
    {collecting && <div className="space-y-2">
      <p className="text-sm font-medium tabular-nums">{timeline.elapsedDays} {timeline.elapsedDays === 1 ? 'day' : 'days'} since your changes</p>
      <div role="progressbar" aria-label={`Time until comparison for ${item.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(timeline.percent)} aria-valuetext={timeline.due ? 'Waiting for the latest search data' : `${timeline.daysRemaining} days until the comparison`} className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${timeline.due ? 'bg-sky-500' : 'bg-emerald-500'}`} style={{ width: `${timeline.percent}%` }} /></div>
      <p className="text-xs text-muted-foreground">{timeline.due ? 'Waiting for the latest search data' : 'This measures time, not your ranking.'}</p>
    </div>}
    {item.nextReviewAt && <p className="text-xs text-muted-foreground">{timeline?.due ? 'Review expected' : 'Next review'}: <span className="font-medium text-foreground">{progressDate(item.nextReviewAt)}</span></p>}
    {item.publication && <PublicationSummary publication={item.publication} />}
    <Button asChild variant="outline" className="mt-auto w-full justify-between whitespace-normal text-left text-foreground"><Link href={item.href}>{item.actionLabel}<ArrowRight className="ml-2 h-4 w-4 shrink-0" aria-hidden="true" /></Link></Button>
  </article>;
}

function PublicationSummary({ publication }) {
  // These fields remain independent: a published page is not necessarily indexed.
  const indexing = publication.indexing;
  const rolling = publication.activity?.rolling;
  const observation = rolling?.totals || rolling;
  const hasActivity = ['has_data', 'no_data', 'available'].includes(observation?.status);
  const since = publication.activity?.sinceVerified;
  const sinceAvailable = ['has_data', 'no_data', 'available'].includes(since?.status);
  const prior = publication.preexistingActivity;
  const priorActivity = ['has_data', 'available'].includes(prior?.status) && (prior.clicks > 0 || prior.impressions > 0);
  const period = value => value?.startDate && value?.endDate ? `${activityDayLabel(value.startDate)}–${activityDayLabel(value.endDate, { year: 'numeric' })}` : 'Reporting dates unavailable';
  return <div className="space-y-2 rounded-lg border bg-background/30 p-3 text-xs">
    <p><span className="text-muted-foreground">Publication checked:</span> {progressDate(publication.verifiedAt)}</p>
    <p><span className="text-muted-foreground">Google index status:</span> {indexing?.status === 'available' ? indexing.coverageState || 'Stored status available' : 'No stored status available'}{indexing?.fetchedAt && <span className="block mt-1 text-muted-foreground">Observed {progressDate(indexing.fetchedAt)}</span>}</p>
    {hasActivity ? <p><span className="text-muted-foreground">Search activity:</span> {count(observation.clicks)} clicks · {count(observation.impressions)} appearances<span className="block mt-1 text-muted-foreground">{period(rolling)}{rolling.fetchedAt ? ` · observed ${progressDate(rolling.fetchedAt)}` : ''}</span></p> : <p className="text-muted-foreground">Search activity is not available yet.</p>}
    <details><summary className="cursor-pointer text-muted-foreground">Publication and activity details</summary><div className="mt-2 space-y-2">
      {hasActivity && <p>Average position: {observation.impressions > 0 && observation.position >= 1 ? count(observation.position) : 'Unavailable'}. Closer to 1 is better.</p>}
      <p>Since publication verification: {sinceAvailable ? `${count(since.clicks)} clicks · ${count(since.impressions)} appearances (${period(since)})` : since?.status === 'collecting' ? 'Collecting reported data.' : 'No saved observation available.'}</p>
      {priorActivity && <p>This URL had search activity before verification. These numbers do not establish a new-page result.</p>}
      {publication.publicPage?.warnings?.filter(Boolean).map((warning, index) => <p key={index} className="text-amber-800 dark:text-amber-200">{warning}</p>)}
      <p className="text-muted-foreground">Publication, Google’s stored index status and search activity are checked separately.</p>
    </div></details>
    {publication.lastError && <p className="text-amber-800 dark:text-amber-200">The latest check could not finish. Previous observations retain their original dates.</p>}
  </div>;
}

export default function VisualProgressDashboard() {
  const { user } = useAuth();
  const { data, setupWorkspace } = useOnboarding();
  const [overview, setOverview] = useState(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [connectionNeeded, setConnectionNeeded] = useState(false);
  const [fragments, setFragments] = useState([]);
  const [workResponse, setWorkResponse] = useState(null);
  const [workBusy, setWorkBusy] = useState(false);
  const [workError, setWorkError] = useState('');
  const [allWork, setAllWork] = useState(false);
  const [allPages, setAllPages] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const activitySequence = useRef(0);
  const workSequence = useRef(0);
  const workSources = useRef({});
  const invalidateRequests = useCallback(() => { activitySequence.current++; workSequence.current++; }, []);
  const scopeKey = `${user?.id || ''}:${data.gscProperty || ''}:${data.revampRunId || ''}:${data.websiteUrl || ''}`;

  const loadActivity = useCallback(async (refresh = false) => {
    if (!user?.id) return;
    const attempt = ++activitySequence.current;
    setActivityBusy(true); setActivityError('');
    try {
      const response = await authenticatedFetch(`/api/dashboard/overview${refresh ? '?refresh=true' : ''}`);
      const body = await response.json();
      if (attempt !== activitySequence.current) return;
      if (!response.ok) {
        setConnectionNeeded(response.status === 409);
        throw new Error(response.status === 409 ? 'Reconnect Google to see recent search activity. Your saved work is still available.' : 'Search activity could not be refreshed. Please try again.');
      }
      if (dashboardActivityState(body) === 'unavailable' || !body.window || !Array.isArray(body.pages)) throw new Error('Search activity is unavailable. Please try again.');
      const lastError = body.observation?.lastError;
      const reconnectRequired = lastError === 'reconnect_required' || lastError?.code === 'reconnect_required';
      setOverview(body); setConnectionNeeded(reconnectRequired);
      if (lastError) setActivityError(reconnectRequired ? 'Reconnect Google to refresh these numbers. Your previous search activity remains visible.' : 'The latest check could not finish. Your previous search activity is shown with its original dates.');
    } catch (failure) { if (attempt === activitySequence.current) setActivityError(failure.message); }
    finally { if (attempt === activitySequence.current) setActivityBusy(false); }
  }, [user?.id]);

  const loadWork = useCallback(async (cursor = null) => {
    if (!user?.id) return;
    const attempt = ++workSequence.current;
    setWorkBusy(true); setWorkError('');
    try {
      const response = await authenticatedFetch(`/api/dashboard/work${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      const body = await response.json();
      if (attempt !== workSequence.current) return;
      if (!response.ok || !Array.isArray(body.items)) throw new Error('Your saved work could not be loaded. Please try again.');
      const sources = cursor ? Object.fromEntries(Object.entries(body.sources || {}).map(([name, source]) => {
        const previous = workSources.current[name];
        // Completed sources are skipped by the continuation cursor. Keep their
        // unresolved point-read errors, but let a successful retry of an
        // unfinished source replace its previous query failure.
        return [name, previous?.hasMore === false ? { ...source, error: previous.error, readFailed: previous.readFailed } : source];
      })) : body.sources || {};
      workSources.current = sources;
      const sourceFailed = Object.values(sources).some(source => source.error);
      setFragments(previous => {
        const merged = mergeDashboardWork(previous, body.items);
        if (cursor) return merged;
        const incoming = new Set(body.items.map(item => `${item.kind}:${item.id}`));
        return merged.filter(item => {
          const source = body.sources?.[workSourceForKind[item.kind]];
          const readFailed = source?.readFailed ?? Boolean(source?.error && !source.scanned);
          return readFailed || incoming.has(`${item.kind}:${item.id}`);
        });
      });
      setWorkResponse({ ...body, sources, coverage: { ...body.coverage, partial: Boolean(body.coverage?.partial || sourceFailed) } });
      if (sourceFailed) setWorkError('Some saved work could not be checked. Previously loaded work remains visible.');
    } catch (failure) { if (attempt === workSequence.current) setWorkError(failure.message); }
    finally { if (attempt === workSequence.current) setWorkBusy(false); }
  }, [user?.id]);

  useEffect(() => {
    setOverview(null); setFragments([]); setWorkResponse(null); setAllWork(false); setAllPages(false); setConnectionNeeded(false); workSources.current = {};
    loadActivity(); loadWork();
    return invalidateRequests;
  }, [scopeKey, loadActivity, loadWork, invalidateRequests]);
  useEffect(() => {
    const refresh = () => loadWork();
    window.addEventListener('seo-implementation-changed', refresh);
    return () => window.removeEventListener('seo-implementation-changed', refresh);
  }, [loadWork]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);

  const connect = async () => {
    const scopeAttempt = activitySequence.current;
    setActivityBusy(true); setActivityError('');
    try { await reconnectGsc(data.gscProperty); if (scopeAttempt === activitySequence.current) await loadActivity(); }
    catch (failure) { if (scopeAttempt === activitySequence.current) setActivityError(failure.message); }
    finally { if (scopeAttempt === activitySequence.current) setActivityBusy(false); }
  };
  const work = useMemo(() => prioritizeDashboardWork(fragments, now), [fragments, now]);
  const activityState = dashboardActivityState(overview);
  const availablePages = useMemo(() => (overview?.pages || []).filter(page => page.impressions > 0).slice().sort((a, b) => b.impressions - a.impressions || a.pageUrl.localeCompare(b.pageUrl)), [overview]);
  const knownPages = useMemo(() => new Set(work.map(item => item.pageUrl).filter(Boolean)), [work]);
  const tracked = useMemo(() => (data.revampPages || []).map(value => typeof value === 'string' ? { url: value } : value).filter(page => page?.url && propertyContainsUrl(data.gscProperty || overview?.property || '', page.url)), [data.revampPages, data.gscProperty, overview?.property]);
  const nextPage = availablePages.find(page => !knownPages.has(page.pageUrl))?.pageUrl || tracked.find(page => !knownPages.has(page.url))?.url;
  const action = dashboardNextAction(work, { reconnectRequired: connectionNeeded, setupRequired: Boolean(data.progressReviewRequired || data.revampStatus === 'in-progress'), hasWorkError: Boolean(workError), fallbackPage: nextPage, now });
  const partial = Boolean(workResponse?.coverage?.partial || workResponse?.nextCursor || workError);
  const business = data.businessName || 'Your website';

  return <MainLayout topPages={availablePages.map(page => ({ ...page, page: page.pageUrl }))} impressionTrends={overview?.daily || []}>
    <div className="space-y-6 text-foreground sm:space-y-8" data-testid="visual-progress-dashboard">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2"><p className="text-xs font-semibold uppercase tracking-widest text-primary">Your SEO workspace</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">A clear view of your progress.</h1><p className="break-all text-sm text-muted-foreground sm:text-base">{business} <span aria-hidden="true">·</span> {data.websiteUrl || overview?.property || data.gscProperty}</p></div>
        <Button asChild variant="ghost" size="sm"><Link href="/revamp">Website setup</Link></Button>
      </header>

      <section className={`flex flex-wrap items-center justify-between gap-5 rounded-xl border px-5 py-5 sm:px-6 ${connectionNeeded || action.tone === 'attention' ? 'border-amber-500/30 bg-amber-500/5' : 'border-primary/30 bg-primary/5'}`} aria-label="Your next step">
        <div className="min-w-0 flex-1 basis-full space-y-1.5 sm:basis-0"><p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Your next step</p><h2 className="text-xl font-semibold tracking-tight">{!workResponse && workBusy ? 'Finding your next step…' : action.title}</h2><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{!workResponse && workBusy ? 'Loading your saved work and recent observations.' : action.detail}</p></div>
        {connectionNeeded ? <Button className="w-full sm:w-auto" onClick={connect} disabled={activityBusy}>Connect Google<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button> : <Button asChild className="w-full sm:w-auto"><Link href={action.href}>{action.actionLabel}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></Button>}
      </section>

      <Card className="gap-5 overflow-hidden">
        <CardHeader className="px-5 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle role="heading" aria-level={2} className="text-xl">Your website on Google</CardTitle><Button variant="ghost" size="sm" disabled={activityBusy} onClick={() => loadActivity(true)}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${activityBusy ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />{activityBusy ? 'Refreshing…' : 'Refresh search data'}</Button></div><CardDescription>{overview ? <>Search activity · {activityDayLabel(overview.window.startDate)}–{activityDayLabel(overview.window.endDate, { year: 'numeric' })} · 28 days</> : 'Recent search activity for your connected website.'}</CardDescription></CardHeader>
        <CardContent className="space-y-5 px-5 sm:px-6">
          {activityError && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><p>{activityError}</p>{overview && <p className="mt-1 text-xs text-muted-foreground">Last successful observation: {progressDate(overview.fetchedAt)}.</p>}</div>}
          {activityBusy && !overview && <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading search activity…</div>}
          {overview && <>
            <div className="grid grid-cols-2 gap-3 sm:gap-6">
              {[['impressions', 'Appearances in Google', 'Times your pages appeared in search', Eye], ['clicks', 'Clicks from Google', 'Visits from a Google search result', MousePointer2]].map(([key, label, description, Icon]) => <div key={key} className={`min-w-0 rounded-xl border p-4 sm:p-5 ${key === 'impressions' ? 'border-emerald-300/50 bg-emerald-50/40 dark:border-emerald-700/50 dark:bg-emerald-950/15' : 'bg-background/30'}`}><p className="flex items-center gap-2 text-xs font-medium sm:text-sm"><Icon className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />{label}</p><p className="my-2 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{count(overview.totals[key])}</p><p className="text-xs leading-relaxed text-muted-foreground">{description}</p></div>)}
            </div>
            {activityState === 'zero' ? <div className="rounded-xl border border-dashed p-5"><h3 className="font-medium">Start with one useful page improvement</h3><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Google reported no search activity in this period. You can still review a page and make sure it clearly explains your services.</p><Link href={nextPage ? reviewHref(nextPage) : '/low-ctr'} className="mt-3 inline-flex items-center gap-2 text-sm font-medium underline">Choose a page to review<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div> : <WeeklySearchActivity overview={overview} />}
            {activityState === 'appearances' && <p className="text-sm text-muted-foreground">Your pages appeared in search. No clicks were reported in this period.</p>}
            <p className="text-xs leading-relaxed text-muted-foreground">Google Search Console · observed {progressDate(overview.fetchedAt)}. Pacific reporting dates; the most recent three days are excluded. This is overall search activity, not a measured result of your edits.</p>
          </>}
          {!activityBusy && !overview && !activityError && <p className="text-sm text-muted-foreground">Search activity is not available yet.</p>}
        </CardContent>
      </Card>

      <section id="page-progress" className="scroll-mt-24 space-y-4" aria-labelledby="page-work-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="page-work-heading" className="text-xl font-semibold">Your page work</h2><p className="mt-1 text-sm text-muted-foreground">{work.length ? `${work.length} saved ${work.length === 1 ? 'page' : 'pages'}${partial ? ' loaded · this list may be incomplete' : ''}` : 'Your edits, drafts and next reviews in one place.'}</p></div>{(work.length > 3 || workResponse?.nextCursor) && <Button variant="ghost" size="sm" onClick={() => setAllWork(value => !value)} aria-expanded={allWork}>{allWork ? 'Show top three' : 'View all saved work'}<ChevronDown className={`ml-2 h-4 w-4 ${allWork ? 'rotate-180' : ''}`} aria-hidden="true" /></Button>}</div>
        {workError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><p>{workError}</p><Button size="sm" variant="outline" disabled={workBusy} onClick={() => loadWork()}>Retry saved work</Button></div>}
        {workBusy && !workResponse && <p role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading saved work…</p>}
        {work.length > 0 ? <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">{(allWork ? work : work.slice(0, 3)).map(item => <WorkCard key={item.key} item={item} now={now} />)}</div> : workResponse && !workError && <div className="flex items-start gap-4 rounded-xl border border-dashed p-5"><Files className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div><h3 className="text-sm font-medium">{partial ? 'There is more saved work to check' : 'Your work will appear here'}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{partial ? 'Open all saved work and load the next batch to see more pages.' : 'Save a page plan or a new-page draft. After you publish and confirm an edit, we’ll show its tracking dates here too.'}</p></div></div>}
        {allWork && workResponse?.nextCursor && <Button variant="outline" disabled={workBusy} onClick={() => loadWork(workResponse.nextCursor)}>{workBusy ? 'Loading…' : 'Load more saved work'}</Button>}
        {workBusy && workResponse && <p role="status" className="text-xs text-muted-foreground">Loading saved work…</p>}
      </section>

      {overview && <Card className="gap-4"><CardHeader className="px-5 sm:px-6"><CardTitle role="heading" aria-level={2} className="text-lg">Pages to review</CardTitle><CardDescription>Choose a page using its current search activity.</CardDescription></CardHeader><CardContent className="space-y-3 px-5 sm:px-6">
        {availablePages.length ? <ul className="divide-y">{(allPages ? availablePages : availablePages.slice(0, 5)).map(page => <li key={page.pageUrl} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0 flex-1"><a href={page.pageUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm font-medium hover:underline">{pageLabel(page.pageUrl)} <ExternalLink className="inline h-3 w-3" aria-hidden="true" /><span className="sr-only"> Open website in a new tab</span></a>{pageLabel(page.pageUrl) === 'Homepage' && <p className="mt-1 break-all text-xs text-muted-foreground">{page.pageUrl}</p>}<p className="mt-1 text-xs text-muted-foreground">{count(page.clicks)} clicks · {count(page.impressions)} appearances</p></div><Button variant="outline" size="sm" asChild><Link href={reviewHref(page.pageUrl)} aria-label={`${knownPages.has(page.pageUrl) ? 'Open work for' : 'Review'} ${pageLabel(page.pageUrl)}`}>{knownPages.has(page.pageUrl) ? 'Open page work' : 'Review page'}</Link></Button></li>)}</ul> : <p className="text-sm text-muted-foreground">Google returned no page activity for this period. You can still <Link href="/low-ctr" className="underline">review an existing page</Link>.</p>}
        {availablePages.length > 5 && <Button variant="ghost" size="sm" onClick={() => setAllPages(value => !value)}>{allPages ? 'Show fewer pages' : `Show all ${availablePages.length} returned pages`}</Button>}
        <p className="text-xs text-muted-foreground">Up to {overview.coverage?.pages?.limit || 100} pages returned by Google, ordered by appearances. This is a partial search report, not an indexing report or a complete website list.</p>
      </CardContent></Card>}

      <details className="rounded-xl border px-5 py-4 text-sm sm:px-6"><summary className="cursor-pointer font-medium">Website details and more tools</summary><div className="mt-5 grid gap-5 md:grid-cols-2"><div className="space-y-3 text-muted-foreground"><p className="flex items-center gap-2 font-medium text-foreground"><CheckCheck className="h-4 w-4" aria-hidden="true" />Website monitoring</p><p>{tracked.length ? `${tracked.length} tracked pages. Their observations may use different dates from the search activity above.` : 'Review your website setup and saved page observations.'} No search data does not mean a page is unindexed.</p><Link href="/revamp" className="inline-block underline">Review website setup</Link>{setupWorkspace?.eligible && !setupWorkspace?.profile?.confirmedAt && !setupWorkspace?.session?.profileConfirmed && <p><Link href="/settings" className="underline">Review your business details</Link> for more relevant recommendations.</p>}</div><nav aria-label="More SEO tools" className="flex flex-col items-start gap-3"><Link href="/low-ctr" className="underline">Improve an existing page</Link><Link href="/generic-keywords" className="underline">Find new page ideas</Link><Link href="/chatbot" className="underline">Ask the SEO Mentor</Link><Link href="/revamp/history" className="text-muted-foreground underline">Previous website work</Link></nav></div></details>
    </div>
  </MainLayout>;
}
