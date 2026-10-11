"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight, ExternalLink, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { reconnectGsc } from '../../lib/reconnectGsc';
import { propertyContainsUrl } from '../../lib/revampState';
import MainLayout from '../MainLayout';
import PageProgress from './PageProgress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const SearchActivityChart = dynamic(() => import('./SearchActivityChart'), { ssr: false, loading: () => <p>Loading chart…</p> });
const VisualProgressDashboard = dynamic(() => import('./VisualProgressDashboard'), { loading: () => <MainLayout><p role="status">Loading your dashboard…</p></MainLayout> });
const count = value => Number(value).toLocaleString();
const reviewHref = pageUrl => `/low-ctr?page=${encodeURIComponent(pageUrl)}`;
const pageLabel = pageUrl => { try { const url = new URL(pageUrl); return url.pathname === '/' && !url.search ? 'Homepage' : url.pathname + url.search; } catch { return pageUrl; } };

export default function CurrentWebsiteDashboard() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(null);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setEnabled(null);
    if (user?.id) authenticatedFetch('/api/dashboard/config', { signal: controller.signal })
      .then(response => response.ok ? response.json() : { enabled: false })
      .then(value => { if (current) setEnabled(value.enabled === true); })
      .catch(() => { if (current) setEnabled(false); });
    return () => { current = false; controller.abort(); };
  }, [user?.id]);
  if (enabled === null) return <MainLayout><p role="status">Loading your dashboard…</p></MainLayout>;
  return enabled ? <VisualProgressDashboard /> : <LegacyWebsiteDashboard />;
}

function LegacyWebsiteDashboard() {
  const { user } = useAuth();
  const { data, setupWorkspace } = useOnboarding();
  const [overview, setOverview] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectionNeeded, setConnectionNeeded] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [allPages, setAllPages] = useState(false);
  const sequence = useRef(0);
  const invalidateRequests = useCallback(() => { sequence.current++; }, []);

  const load = useCallback(async (refresh = false) => {
    if (!user?.id) return;
    const attempt = ++sequence.current;
    setBusy(true); setError('');
    try {
      const response = await authenticatedFetch(`/api/dashboard/overview${refresh ? '?refresh=true' : ''}`);
      const body = await response.json();
      if (attempt !== sequence.current) return;
      if (!response.ok) {
        setConnectionNeeded(response.status === 409);
        throw new Error(response.status === 409 ? 'Connect Google Search Console to see recent search activity.' : 'Search activity could not be refreshed. Please try again.');
      }
      if (body.source !== 'google_search_console' || !Array.isArray(body.pages) || !body.window || !body.totals) throw new Error('Search activity is unavailable. Please try again.');
      setOverview(body); setConnectionNeeded(false);
      if (body.observation?.lastError) setError('The latest check could not finish. Your previously saved search activity is shown below with its original dates.');
    } catch (failure) { if (attempt === sequence.current) setError(failure.message); }
    finally { if (attempt === sequence.current) setBusy(false); }
  }, [user?.id]);
  useEffect(() => {
    setOverview(null); setProgress(null); setAllPages(false); load();
    return invalidateRequests;
  }, [load, invalidateRequests, data.gscProperty, data.revampRunId]);

  const connect = async () => {
    setBusy(true); setError('');
    try { await reconnectGsc(data.gscProperty); await load(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const tracked = useMemo(() => (data.revampPages || []).map(value => typeof value === 'string' ? { url: value } : value)
    .filter(page => page?.url && propertyContainsUrl(data.gscProperty || overview?.property || '', page.url)), [data.revampPages, data.gscProperty, overview?.property]);
  const activePages = useMemo(() => new Set((progress?.records || []).map(record => record.pageUrl)), [progress]);
  const availablePages = useMemo(() => (overview?.pages || []).filter(page => page.impressions > 0)
    .slice().sort((a, b) => b.impressions - a.impressions || a.pageUrl.localeCompare(b.pageUrl)), [overview]);
  const nextPage = availablePages.find(page => !activePages.has(page.pageUrl));
  const hasChanges = activePages.size > 0;
  const visiblePages = allPages ? availablePages : availablePages.slice(0, 5);
  const observedTracked = tracked.filter(page => page.searchDataStatus === 'has_data').length;
  const noDataTracked = tracked.filter(page => page.searchDataStatus === 'no_data').length;
  const uncheckedTracked = tracked.length - observedTracked - noDataTracked;
  const business = data.businessName || data.websiteUrl || 'Your website';

  return <MainLayout topPages={availablePages.map(page => ({ ...page, page: page.pageUrl }))} impressionTrends={overview?.daily || []}>
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Current website</p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Your SEO workspace</h1>
          <p className="text-muted-foreground break-all">{business} <span aria-hidden="true">·</span> {overview?.property || data.gscProperty || data.websiteUrl}</p>
        </div>
        <Button asChild variant="outline"><Link href="/revamp">Website setup</Link></Button>
      </header>

      {setupWorkspace?.eligible && !setupWorkspace?.profile?.confirmedAt && !setupWorkspace?.session?.profileConfirmed && <aside className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-3" aria-label="Business details reminder"><div><p className="text-sm font-medium">Help us understand your business</p><p className="text-sm text-muted-foreground">Review your services and areas for more relevant recommendations.</p></div><Link href="/settings" className="text-sm underline">Review business details</Link></aside>}

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">One page at a time</p>
          <CardTitle role="heading" aria-level={2} className="text-2xl">{hasChanges ? 'Keep track of your changes' : 'Make your first useful change'}</CardTitle>
          <CardDescription className="max-w-3xl leading-relaxed">Review a page, choose wording that accurately describes your business, then make the edit in your website builder. Confirm it here to start a dated comparison.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ol className="grid gap-3 text-sm sm:grid-cols-3">
            {['Review one page', 'Edit it on your website', 'Confirm and track the change'].map((step, index) => <li key={step} className="flex items-center gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background border text-primary font-semibold">{index + 1}</span>{step}</li>)}
          </ol>
          <div className="border-t border-primary/20 pt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              {hasChanges ? <><p className="font-medium">{activePages.size} {activePages.size === 1 ? 'page has' : 'pages have'} confirmed changes</p><p className="text-sm text-muted-foreground">Check the dated observations below. A new edit needs time and enough search activity before a comparison is available.</p></>
                : nextPage ? <><p className="font-medium break-all">Start with {pageLabel(nextPage.pageUrl)}</p>{pageLabel(nextPage.pageUrl) === 'Homepage' && <a href={nextPage.pageUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm underline break-all">{nextPage.pageUrl}<span className="sr-only"> Open homepage in new tab</span></a>}<p className="text-sm text-muted-foreground">This page has recent search activity. Review it to decide whether its title or description needs a change.</p></>
                  : <><p className="font-medium">Choose a page from your current website</p><p className="text-sm text-muted-foreground">{busy ? 'Loading recent search activity…' : 'You can review a tracked page even when Google has no search data for it yet.'}</p></>}
            </div>
            <Button asChild><Link href={hasChanges ? '#page-progress' : nextPage ? reviewHref(nextPage.pageUrl) : '/low-ctr'}>{hasChanges ? 'View progress' : nextPage ? 'Review this page' : 'Choose a page'}<ArrowRight className="h-4 w-4 ml-2" /></Link></Button>
          </div>
        </CardContent>
      </Card>

      <PageProgress onResult={setProgress} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap justify-between gap-3 items-center"><CardTitle role="heading" aria-level={2} className="text-xl">Current search activity</CardTitle><Button variant="outline" size="sm" onClick={() => load(true)} disabled={busy}><RefreshCw className={`h-4 w-4 mr-2 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Refreshing…' : 'Refresh search data'}</Button></div>
          <CardDescription>{overview ? <>Google Search Console <span aria-hidden="true">·</span> {overview.window.startDate} – {overview.window.endDate} <span aria-hidden="true">·</span> 28 complete days, Pacific time</> : 'Recent Google Search Console activity for your connected website.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-2"><p>{error}</p>{overview && <p className="text-sm">The last successful observation remains visible below with its original dates.</p>}{connectionNeeded && <Button variant="outline" disabled={busy} onClick={connect}>Connect Google</Button>}</div>}
          {busy && !overview && <p role="status" className="text-muted-foreground">Loading search activity…</p>}
          {overview && <>
            <div className="grid grid-cols-2 gap-4 max-w-xl">
              <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Clicks from Google</p><p className="text-3xl font-semibold mt-1">{count(overview.totals.clicks)}</p></div>
              <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Appearances in search</p><p className="text-3xl font-semibold mt-1">{count(overview.totals.impressions)}</p></div>
            </div>
            <p className="text-sm text-muted-foreground">This is overall search activity. Use Page progress to compare the periods around a confirmed edit.</p>
            <div className="space-y-3">
              <h2 className="font-semibold">Pages to review</h2>
              {availablePages.length === 0 ? <p className="text-muted-foreground text-sm">No page activity was returned for this period. This does not tell us whether Google has crawled or indexed your pages. You can still <Link href="/low-ctr" className="underline">review a tracked page</Link>.</p> : <ul className="divide-y">
                {visiblePages.map(page => <li key={page.pageUrl} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1"><a href={page.pageUrl} target="_blank" rel="noopener noreferrer" className="font-medium break-all hover:underline">{pageLabel(page.pageUrl)} <ExternalLink className="inline h-3 w-3" aria-hidden="true" />{pageLabel(page.pageUrl) === 'Homepage' && <span className="block mt-1 text-sm font-normal text-muted-foreground">{page.pageUrl}</span>}<span className="sr-only"> Open website in new tab</span></a><p className="text-sm text-muted-foreground mt-1">{count(page.clicks)} clicks <span aria-hidden="true">·</span> {count(page.impressions)} appearances{activePages.has(page.pageUrl) && <span> <span aria-hidden="true">·</span> Change confirmed</span>}</p></div>
                  <Button variant="outline" size="sm" asChild><Link href={activePages.has(page.pageUrl) ? '#page-progress' : reviewHref(page.pageUrl)} aria-label={`${activePages.has(page.pageUrl) ? 'View progress for' : 'Review'} ${pageLabel(page.pageUrl)}`}>{activePages.has(page.pageUrl) ? 'View progress' : 'Review page'}</Link></Button>
                </li>)}
              </ul>}
              {availablePages.length > 5 && <Button variant="ghost" size="sm" onClick={() => setAllPages(value => !value)}>{allPages ? 'Show fewer pages' : `Show all ${availablePages.length} returned pages`}</Button>}
              <p className="text-xs text-muted-foreground">Up to {overview.coverage?.pages?.limit || 100} pages returned by Google, ordered here by appearances. This is a partial search report, not a complete list of your website or its indexed pages.</p>
            </div>
            <details className="border-t pt-4" onToggle={event => setChartOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Show daily search activity</summary>{chartOpen && <SearchActivityChart daily={overview.daily || []} />}</details>
            <p className="text-xs text-muted-foreground">Observed {new Date(overview.fetchedAt).toLocaleString()}. The most recent three days are excluded while reporting settles.</p>
          </>}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardHeader><CardTitle role="heading" aria-level={2}>Website update monitoring</CardTitle><CardDescription>Your dashboard stays available while search data arrives.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">
          {tracked.length > 0 ? <p>Last checks of {tracked.length} tracked pages: <strong>{observedTracked} with search data</strong>, {noDataTracked} without data, {uncheckedTracked} not checked. These checks can use different dates from the report above.</p> : <p>Keep a list of pages on your current website and check their search observations.</p>}
          <p className="text-muted-foreground">No search data does not mean a page is unindexed. Review the dates and use Google&apos;s URL Inspection tool when you need its index status.</p><Link className="underline" href="/revamp">Review tracked pages and rebuild guidance</Link>
        </CardContent></Card>
        <Card><CardHeader><CardTitle role="heading" aria-level={2}>More tools, when you need them</CardTitle><CardDescription>Keep your first task small. You can explore other ideas later.</CardDescription></CardHeader><CardContent className="flex flex-col items-start gap-3 text-sm"><Link className="underline" href="/low-ctr">Review another page</Link><Link className="underline" href="/generic-keywords">Find new page ideas</Link><Link className="underline" href="/chatbot">Ask the SEO Mentor</Link><Link className="text-muted-foreground underline" href="/revamp/history">Previous website work</Link></CardContent></Card>
      </div>
    </div>
  </MainLayout>;
}
