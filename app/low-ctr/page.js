"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { authenticatedFetch } from '../lib/authenticatedFetch';
import { taskPages } from '../lib/pageTaskFlow';
import { propertyContainsUrl } from '../lib/revampState';
import MainLayout from '../components/MainLayout';
import SeoRecommendationPanel from '../components/dashboard/SeoRecommendationPanel';
import PageProgress from '../components/dashboard/PageProgress';
import PageReviewAssessment, { usablePageAssessment } from '../components/dashboard/PageReviewAssessment';
import PageSearchActivity, { pageOptionLabel, usablePageActivity } from '../components/dashboard/PageSearchActivity';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

async function request(path, body, signal) {
  const response = await authenticatedFetch(path, body === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'This check is unavailable. Please try again.');
  return result;
}

function LowCtrWorkspace() {
  const { user, isLoading } = useAuth();
  const { data, isLoaded } = useOnboarding();
  const [overview, setOverview] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [focusKeywords, setFocusKeywords] = useState([]);
  const [redirectDestinations, setRedirectDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [queryError, setQueryError] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [requestedUrl, setRequestedUrl] = useState(null);
  const [selectionError, setSelectionError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(null);
  const [contentBusy, setContentBusy] = useState(false);
  const [contentError, setContentError] = useState('');
  const [contentReload, setContentReload] = useState(0);
  const [activity, setActivity] = useState(null);
  const [activityByPage, setActivityByPage] = useState({});
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [activityReload, setActivityReload] = useState(0);
  const [suggestion, setSuggestion] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [taskConfirmed, setTaskConfirmed] = useState(false);
  const generationController = useRef(null);
  const activityController = useRef(null);
  const markConfirmed = useCallback(() => setTaskConfirmed(true), []);
  useEffect(() => () => generationController.current?.abort(), []);

  useEffect(() => { setRequestedUrl(new URL(window.location.href).searchParams.get('page') || ''); }, []);
  useEffect(() => {
    if (!user?.id) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true); setDataError(''); setQueryError('');
    Promise.allSettled([
      request('/api/dashboard/overview', undefined, controller.signal),
      request('/api/gsc/fetch-keywords', { dateRange: '28' }, controller.signal),
      request('/api/focus-keywords', undefined, controller.signal),
    ]).then(([summary, queries, focus]) => {
      if (!active) return;
      if (summary.status === 'fulfilled') setOverview(summary.value);
      else setDataError('Search activity could not be loaded. Your tracked pages are still available. Reconnect Google in website setup if the problem continues.');
      if (queries.status === 'fulfilled') setKeywords(queries.value.keywords || []);
      else setQueryError('Search queries are unavailable. You can review a page using its current website content.');
      if (focus.status === 'fulfilled') setFocusKeywords(focus.value.keywords || []);
      setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [user?.id, reload]);

  const property = overview?.property || data.gscProperty;
  const pages = useMemo(() => taskPages({ property, trackedPages: [...(data.revampPages || []), ...redirectDestinations], observedPages: overview?.pages || [], keywords, focusKeywords }), [property, data.revampPages, redirectDestinations, overview?.pages, keywords, focusKeywords]);
  const selected = pages.find(page => page.url === selectedUrl);
  const visibleActivity = activity?.pageUrl === selectedUrl ? activity : null;
  const reviewQueries = visibleActivity?.current.queries?.map(row => ({ ...row, keyword: row.query })) || selected?.queries || [];
  const redirected = Boolean(currentPage?.finalUrl && currentPage.finalUrl !== selectedUrl);
  useEffect(() => {
    if (loading || !isLoaded || requestedUrl === null) return;
    if (requestedUrl && !pages.some(page => page.url === requestedUrl)) {
      setSelectionError('That exact page is not in your current tracked pages or reported search data. Choose a page below, or add it in website setup.');
      setRequestedUrl(''); return;
    }
    if (!selectedUrl && pages.length) {
      const page = pages.find(item => item.url === requestedUrl) || pages[0];
      setSelectedUrl(page.url); setKeyword(page.focusKeyword || page.queries[0]?.keyword || '');
    }
  }, [loading, isLoaded, requestedUrl, selectedUrl, pages]);

  useEffect(() => {
    if (!selectedUrl) return;
    const controller = new AbortController(); let active = true;
    setCurrentPage(null); setContentError(''); setContentBusy(true);
    request('/api/page-review/content', { pageUrl: selectedUrl }, controller.signal)
      .then(result => { if (!active) return; if (result.data?.url !== selectedUrl) throw new Error('The content for this exact page could not be verified. Please retry.'); setCurrentPage(result.data); })
      .catch(error => { if (active) setContentError(error.message || 'Your website could not be read. Try again.'); })
      .finally(() => { if (active) setContentBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [selectedUrl, contentReload]);

  useEffect(() => {
    if (!selectedUrl || !property) return;
    const controller = new AbortController(); let active = true;
    activityController.current = controller;
    setActivity(null); setActivityError(''); setActivityBusy(true);
    request('/api/page-review/activity', { pageUrl: selectedUrl }, controller.signal)
      .then(result => {
        if (!active || controller.signal.aborted) return;
        if (!usablePageActivity(result, { pageUrl: selectedUrl, property, websiteRunId: data.revampRunId })) throw new Error('Search activity for this exact page could not be verified. Please retry.');
        setActivity(result.evidence);
        setActivityByPage(previous => ({ ...previous, [selectedUrl]: result.evidence }));
      })
      .catch(error => { if (active && !controller.signal.aborted) { setActivityError(error.message || 'Search activity is unavailable. You can still review the page content.'); setActivityByPage(previous => ({ ...previous, [selectedUrl]: { current: { totals: null, totalsStatus: 'unavailable' } } })); } })
      .finally(() => { if (active && !controller.signal.aborted) setActivityBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [selectedUrl, property, data.revampRunId, activityReload]);

  const resetAssessment = () => {
    generationController.current?.abort();
    setGenerating(false); setSuggestion(null); setGenerationError('');
  };
  const choosePage = value => {
    const page = pages.find(item => item.url === value);
    setSelectedUrl(value); setKeyword(page?.focusKeyword || page?.queries[0]?.keyword || '');
    setActivity(null); setActivityError(''); setActivityBusy(true);
    resetAssessment(); setTaskConfirmed(false); setSelectionError('');
  };
  const reviewRelatedPage = value => {
    if (suggestion?.analysis.action !== 'review_page' || suggestion.analysis.targetPageUrl !== value ||
      !suggestion.evidence.relatedPages?.some(page => page.pageUrl === value) || !propertyContainsUrl(property, value)) return;
    setRedirectDestinations(previous => [...new Set([...previous, value])]);
    choosePage(value);
  };
  const generate = async () => {
    if (!selected || !currentPage || generating || taskConfirmed || redirected) return;
    setGenerating(true); setGenerationError(''); setSuggestion(null);
    const controller = new AbortController(); generationController.current = controller;
    try {
      const result = await request('/api/page-review/suggestions', { pageUrl: selected.url, focusKeywords: keyword ? [keyword] : [], includeResearch: true }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.currentPage?.finalUrl && result.currentPage.finalUrl !== selected.url) {
        setCurrentPage(result.currentPage);
        throw new Error('This page now redirects. Review the destination page before analyzing a change.');
      }
      if (!usablePageAssessment(result) || !usablePageActivity({ success: true, evidence: result.evidence, provenance: result.provenance }, { pageUrl: selected.url, property, websiteRunId: data.revampRunId }) || result.currentPage?.url !== selected.url) throw new Error('A complete, supported page assessment was not returned. Please try analyzing again. Nothing has been saved.');
      setSuggestion({ ...result, keyword });
      activityController.current?.abort(); setActivityBusy(false);
      setActivity(result.evidence); setActivityError('');
      setActivityByPage(previous => ({ ...previous, [selected.url]: result.evidence }));
      if (result.currentPage) setCurrentPage(result.currentPage);
    } catch (error) { if (!controller.signal.aborted) setGenerationError(error.message || 'This page could not be analyzed. Please try again.'); }
    finally { if (!controller.signal.aborted) setGenerating(false); }
  };

  if (isLoading || !isLoaded || !user) return <MainLayout><p role="status">Loading your website tasks…</p></MainLayout>;
  return <MainLayout>
    <div className="mb-6 space-y-2"><Link href="/dashboard" className="text-sm underline">Back to dashboard</Link><h1 className="text-3xl font-bold">Improve a page</h1>
      <p className="text-muted-foreground">Find a useful next step using your page content and search activity.</p></div>
    <Card className="mb-6"><CardHeader><CardTitle>1. Choose a page</CardTitle><CardDescription>Start with one page you want customers to find.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {loading && <p role="status">Loading current pages and search activity…</p>}
        {dataError && <div role="alert" className="space-y-2"><p>{dataError}</p><Button variant="outline" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry search data</Button> <Link className="underline" href="/revamp">Website setup</Link></div>}
        {selectionError && <p role="alert" className="text-amber-600">{selectionError}</p>}
        {!loading && !pages.length && <p>No current pages are available yet. <Link href="/revamp" className="underline">Add or review your website pages</Link> to get started. You can continue using your dashboard.</p>}
        {pages.length > 0 && <><label className="block space-y-2"><span className="text-sm font-medium">Page to review</span><select className="w-full rounded border bg-background p-3" value={selectedUrl} disabled={generating} onChange={event => choosePage(event.target.value)}>
          <option value="" disabled>Choose a page</option>{pages.map(page => <option key={page.url} value={page.url}>{pageOptionLabel(Object.hasOwn(activityByPage, page.url) ? { ...page, metrics: activityByPage[page.url].current.totals, activityStatus: activityByPage[page.url].current.totalsStatus } : { ...page, activityStatus: dataError ? 'unavailable' : undefined })}</option>)}
        </select></label>
          {overview?.window && <p className="text-xs text-muted-foreground">Page activity · {overview.window.startDate}–{overview.window.endDate}. Some pages may not appear in Google’s report.</p>}
        </>}
      </CardContent></Card>
    {selected && <>
      <PageSearchActivity key={selected.url} pageUrl={selected.url} evidence={visibleActivity} busy={activityBusy} error={activityError} onRetry={() => setActivityReload(value => value + 1)} />
      <Card className="mb-6"><CardHeader><CardTitle>2. Read your current wording</CardTitle><CardDescription>Does this clearly describe what you offer on this page?</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {contentBusy && <p role="status">Reading your website…</p>}
          {contentError && <div role="alert" className="space-y-2"><p>{contentError}</p><Button variant="outline" onClick={() => { resetAssessment(); setContentReload(value => value + 1); }}>Retry reading page</Button></div>}
          {currentPage && <>
            <section aria-label="Currently on your website" className="overflow-hidden rounded-xl border border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30">
              <div className="flex items-center gap-2 border-b border-sky-200 bg-sky-100/60 px-5 py-3 text-sm font-semibold text-sky-900 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200"><FileText className="h-4 w-4 shrink-0" aria-hidden="true" />Currently on your website</div>
              <dl className="divide-y divide-sky-200 dark:divide-sky-800/60">
                <div className="px-5 py-4"><dt className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">Page title</dt><dd className="text-lg font-medium leading-relaxed break-words text-slate-950 dark:text-sky-50">{currentPage.htmlTitle || 'No title tag found.'}</dd></div>
                <div className="px-5 py-4"><dt className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">Page description</dt><dd className="leading-relaxed break-words text-slate-800 dark:text-sky-100">{currentPage.seoMetaDescription || 'No meta description tag found.'}</dd></div>
              </dl>
            </section>
            <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">What are the title and description?</summary><div className="mt-2 space-y-2 leading-relaxed"><p>The title names your page. The description is a short summary. Your website editor may call these the SEO title and meta description.</p><p>We read these from your website{currentPage.fetchedAt ? ` on ${new Date(currentPage.fetchedAt).toLocaleString()}` : ''}. Google may show different wording in search results.</p></div></details>
            {redirected && <div role="status" className="space-y-2 rounded border p-3"><p className="text-sm break-all">This URL redirects to {currentPage.finalUrl}. Review and track the destination so your edit is measured against the page you actually change.</p>
              {propertyContainsUrl(property, currentPage.finalUrl) && <Button variant="outline" onClick={() => { const destination = currentPage.finalUrl; setRedirectDestinations(previous => [...new Set([...previous, destination])]); choosePage(destination); }}>Review destination page</Button>}
            </div>}
          </>}
          <details className="rounded-lg border px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">Optional: choose a search phrase{keyword ? <span className="ml-2 font-normal text-muted-foreground">· {keyword}</span> : ''}</summary>
            <div className="mt-3 space-y-3">
              {queryError && <p className="text-muted-foreground">{queryError}</p>}
              <label className="block space-y-2"><span className="font-medium">Search phrase to consider</span><select value={keyword} disabled={generating || taskConfirmed} onChange={event => { setKeyword(event.target.value); resetAssessment(); }} className="w-full rounded border bg-background p-3">
                <option value="">Use current page content without a keyword</option>
                {keyword && !reviewQueries.some(row => row.keyword === keyword) && <option value={keyword}>{keyword} — selected phrase</option>}
                {selected.focusKeyword && selected.focusKeyword !== keyword && !reviewQueries.some(row => row.keyword === selected.focusKeyword) && <option value={selected.focusKeyword}>{selected.focusKeyword} — saved focus keyword</option>}
                {reviewQueries.map(row => <option key={row.keyword} value={row.keyword}>{row.keyword} — observed search query</option>)}
              </select></label>
              <p className="text-muted-foreground">Choose a phrase only if it fits this page, or use your page content alone. Options marked “observed search query” came from Google; saved focus keywords are your earlier selections.</p>
            </div>
          </details>
          {!taskConfirmed && <p className="rounded-lg border px-4 py-3 text-sm"><span className="block font-medium">Web research is included</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Each analysis checks public websites for context. You’ll see the sources or a notice if research is unavailable.</span></p>}
          {generationError && <p role="alert" className="text-destructive">{generationError}</p>}
          {!taskConfirmed && <Button onClick={generate} disabled={!currentPage || contentBusy || generating || redirected}><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />{generating ? 'Reviewing your page…' : suggestion || generationError ? 'Analyze again' : 'Analyze this page'}</Button>}
          {!taskConfirmed && <p className="text-xs text-muted-foreground">We’ll recommend a next step. Sometimes the best choice is to keep your wording. Your website won’t change.</p>}
        </CardContent></Card>
      {suggestion && !redirected && <PageReviewAssessment review={suggestion} onReviewPage={reviewRelatedPage} />}
      <div className="mb-6" hidden={Boolean(suggestion && suggestion.analysis.action !== 'revise_metadata' && !taskConfirmed)}><SeoRecommendationPanel key={selected.url} pageUrl={selected.url} title={selected.url}
        suggestedTitle={suggestion?.title || ''} suggestedDescription={suggestion?.description || ''}
        focusKeyword={suggestion?.keyword || ''} keywordSource={selected.queries.some(row => row.keyword === suggestion?.keyword) ? 'gsc-observed' : 'gsc-existing'}
        currentPage={currentPage} provenance={suggestion?.provenance} requireServerConfirmation suggestionState={suggestion?.analysis.action === 'revise_metadata' && !redirected ? 'ready' : generating ? 'loading' : 'idle'} onConfirmed={markConfirmed} /></div>
    </>}
    <PageProgress />
  </MainLayout>;
}

export default function LowCtrPage() {
  const { user, isLoading } = useAuth();
  const { data, isLoaded } = useOnboarding();
  if (isLoading || !isLoaded || !user) return <MainLayout><p role="status">Loading your website tasks…</p></MainLayout>;
  // Discard unfinished drafts and requests when the account, property or website changes.
  return <LowCtrWorkspace key={`${user.id}:${data.gscProperty || ''}:${data.revampRunId || ''}`} />;
}
