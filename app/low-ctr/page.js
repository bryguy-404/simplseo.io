"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, ExternalLink, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { authenticatedFetch } from '../lib/authenticatedFetch';
import { taskPages } from '../lib/pageTaskFlow';
import { propertyContainsUrl } from '../lib/revampState';
import MainLayout from '../components/MainLayout';
import SeoRecommendationPanel from '../components/dashboard/SeoRecommendationPanel';
import PageProgress from '../components/dashboard/PageProgress';
import PageReviewAssessment, { usablePageAssessment } from '../components/dashboard/PageReviewAssessment';
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
  const [suggestion, setSuggestion] = useState(null);
  const [includeResearch, setIncludeResearch] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [taskConfirmed, setTaskConfirmed] = useState(false);
  const generationController = useRef(null);
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
      .then(result => { if (active) setCurrentPage(result.data); })
      .catch(error => { if (active) setContentError(error.message || 'Your website could not be read. Try again.'); })
      .finally(() => { if (active) setContentBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [selectedUrl, contentReload]);

  const resetAssessment = () => {
    generationController.current?.abort();
    setGenerating(false); setSuggestion(null); setGenerationError('');
  };
  const choosePage = value => {
    const page = pages.find(item => item.url === value);
    setSelectedUrl(value); setKeyword(page?.focusKeyword || page?.queries[0]?.keyword || '');
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
      const result = await request('/api/page-review/suggestions', { pageUrl: selected.url, focusKeywords: keyword ? [keyword] : [], includeResearch }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.currentPage?.finalUrl && result.currentPage.finalUrl !== selected.url) {
        setCurrentPage(result.currentPage);
        throw new Error('This page now redirects. Review the destination page before analyzing a change.');
      }
      if (!usablePageAssessment(result) || result.evidence.pageUrl !== selected.url || result.evidence.property !== property) throw new Error('A complete, supported page assessment was not returned. Please try analyzing again. Nothing has been saved.');
      setSuggestion({ ...result, keyword });
      if (result.currentPage) setCurrentPage(result.currentPage);
    } catch (error) { if (!controller.signal.aborted) setGenerationError(error.message || 'This page could not be analyzed. Please try again.'); }
    finally { if (!controller.signal.aborted) setGenerating(false); }
  };

  if (isLoading || !isLoaded || !user) return <MainLayout><p role="status">Loading your website tasks…</p></MainLayout>;
  return <MainLayout>
    <div className="mb-6 space-y-2"><Link href="/dashboard" className="text-sm underline">Back to dashboard</Link><h1 className="text-3xl font-bold">Review a page</h1>
      <p className="text-muted-foreground">Find a useful next step using your page content and search activity.</p></div>
    <Card className="mb-6"><CardHeader><CardTitle>1. Choose a page</CardTitle><CardDescription>Start with one page you want customers to find.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {loading && <p role="status">Loading current pages and search activity…</p>}
        {dataError && <div role="alert" className="space-y-2"><p>{dataError}</p><Button variant="outline" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry search data</Button> <Link className="underline" href="/revamp">Website setup</Link></div>}
        {selectionError && <p role="alert" className="text-amber-600">{selectionError}</p>}
        {!loading && !pages.length && <p>No current pages are available yet. <Link href="/revamp" className="underline">Add or review your website pages</Link> to get started. You can continue using your dashboard.</p>}
        {pages.length > 0 && <><label className="block space-y-2"><span className="text-sm font-medium">Page to review</span><select className="w-full rounded border bg-background p-3" value={selectedUrl} disabled={generating} onChange={event => choosePage(event.target.value)}>
          <option value="" disabled>Choose a page</option>{pages.map(page => <option key={page.url} value={page.url}>{new URL(page.url).pathname === '/' && !new URL(page.url).search ? `Homepage — ${page.url}` : page.url}</option>)}
        </select></label>
          <details className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">Search activity for this page</summary>
            <div className="mt-4 space-y-3">
              {selected?.metrics ? <div className="flex flex-wrap gap-6">
                <p><strong className="block text-xl text-foreground">{selected.metrics.impressions.toLocaleString()}</strong><span className="text-muted-foreground">Appearances in Google</span></p>
                <p><strong className="block text-xl text-foreground">{selected.metrics.clicks.toLocaleString()}</strong><span className="text-muted-foreground">Clicks to your page</span></p>
              </div> : <p>No search activity is available for this page in the current report. You can still review its wording.</p>}
              {overview?.window && <p className="text-xs text-muted-foreground">Google Search Console · {overview.window.startDate}–{overview.window.endDate}</p>}
              <p className="text-xs text-muted-foreground">This report may include only some pages and searches. It does not tell us whether a page is indexed, or prove that its wording needs changing.</p>
            </div>
          </details>
        </>}
      </CardContent></Card>
    {selected && <>
      <Card className="mb-6"><CardHeader><CardTitle>2. Read your current wording</CardTitle><CardDescription>Does this clearly describe what you offer on this page?</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <a href={selected.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-2 text-sm underline"><span className="break-all">{selected.url}</span><ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="sr-only">Open website in new tab</span></a>
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
                {selected.focusKeyword && !selected.queries.some(row => row.keyword === selected.focusKeyword) && <option value={selected.focusKeyword}>{selected.focusKeyword} — saved focus keyword</option>}
                {selected.queries.map(row => <option key={row.keyword} value={row.keyword}>{row.keyword} — observed search query</option>)}
              </select></label>
              <p className="text-muted-foreground">Choose a phrase only if it fits this page, or use your page content alone. Options marked “observed search query” came from Google; saved focus keywords are your earlier selections.</p>
            </div>
          </details>
          {!taskConfirmed && <label className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-violet-600" checked={includeResearch} disabled={generating} onChange={event => { setIncludeResearch(event.target.checked); resetAssessment(); }} /><span><span className="block font-medium">Include web research</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Optional: look at public websites for context. This takes longer and is not a report of competitor rankings.</span></span></label>}
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
