"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { authenticatedFetch } from '../lib/authenticatedFetch';
import { taskPages, usableSuggestion } from '../lib/pageTaskFlow';
import { propertyContainsUrl } from '../lib/revampState';
import MainLayout from '../components/MainLayout';
import SeoRecommendationPanel from '../components/dashboard/SeoRecommendationPanel';
import PageProgress from '../components/dashboard/PageProgress';
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

  const choosePage = value => {
    const page = pages.find(item => item.url === value);
    setSelectedUrl(value); setKeyword(page?.focusKeyword || page?.queries[0]?.keyword || '');
    setSuggestion(null); setGenerationError(''); setTaskConfirmed(false); setSelectionError('');
  };
  const generate = async () => {
    if (!selected || !currentPage || generating || taskConfirmed || redirected) return;
    setGenerating(true); setGenerationError(''); setSuggestion(null);
    const controller = new AbortController(); generationController.current = controller;
    try {
      const result = await request('/api/page-review/suggestions', { pageUrl: selected.url, focusKeywords: keyword ? [keyword] : [] }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.currentPage?.finalUrl && result.currentPage.finalUrl !== selected.url) {
        setCurrentPage(result.currentPage);
        throw new Error('This page now redirects. Review the destination page before generating a change.');
      }
      if (!usableSuggestion(result.title) || !usableSuggestion(result.description)) throw new Error('A complete suggestion was not returned. Please try again.');
      setSuggestion({ ...result, keyword });
      if (result.currentPage) setCurrentPage(result.currentPage);
    } catch (error) { if (!controller.signal.aborted) setGenerationError(error.message || 'Suggestions could not be generated. Please try again.'); }
    finally { if (!controller.signal.aborted) setGenerating(false); }
  };

  if (isLoading || !isLoaded || !user) return <MainLayout><p role="status">Loading your website tasks…</p></MainLayout>;
  return <MainLayout>
    <div className="mb-6 space-y-2"><Link href="/dashboard" className="text-sm underline">Back to dashboard</Link><h1 className="text-3xl font-bold">Review a page</h1>
      <p className="text-muted-foreground">Choose one page, review a useful title and description change, and publish it yourself. Search activity helps you choose where to start; a low click-through rate alone does not prove the title is the problem.</p></div>
    <Card className="mb-6"><CardHeader><CardTitle>1. Choose a current page</CardTitle><CardDescription>Start with a page that already has search activity. Other tracked pages remain available while Google data develops.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {loading && <p role="status">Loading current pages and search activity…</p>}
        {dataError && <div role="alert" className="space-y-2"><p>{dataError}</p><Button variant="outline" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry search data</Button> <Link className="underline" href="/revamp">Website setup</Link></div>}
        {selectionError && <p role="alert" className="text-amber-600">{selectionError}</p>}
        {!loading && !pages.length && <p>No current pages are available yet. <Link href="/revamp" className="underline">Add or review your website pages</Link> to get started. You can continue using your dashboard.</p>}
        {pages.length > 0 && <><label className="block space-y-2"><span className="text-sm font-medium">Page to review</span><select className="w-full rounded border bg-background p-3" value={selectedUrl} disabled={generating} onChange={event => choosePage(event.target.value)}>
          <option value="" disabled>Choose a page</option>{pages.map(page => <option key={page.url} value={page.url}>{page.url}{page.metrics?.impressions > 0 ? ` — ${page.metrics.impressions} impressions` : ''}</option>)}
        </select></label>
          {selected?.metrics && <p className="text-sm text-muted-foreground">{selected.metrics.impressions.toLocaleString()} impressions · {selected.metrics.clicks.toLocaleString()} clicks · {selected.metrics.ctr == null ? 'CTR unavailable' : `${(selected.metrics.ctr * 100).toFixed(1)}% click-through rate`}{overview?.window ? ` · ${overview.window.startDate}–${overview.window.endDate}` : ''} · Google Search Console</p>}
          {selected && !selected.metrics && <p className="text-sm text-muted-foreground">This page has no page-level observation in the current overview. This does not tell us whether Google has crawled or indexed it.</p>}
          <p className="text-xs text-muted-foreground">Search Console may return a limited set of pages and queries. Website titles and descriptions are read separately from your live website.</p>
        </>}
      </CardContent></Card>
    {selected && <>
      <Card className="mb-6"><CardHeader><CardTitle>2. Review the current page</CardTitle><CardDescription>Check that the content still describes the rebuilt website before drafting a change.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <a href={selected.url} target="_blank" rel="noopener noreferrer" className="block break-all underline">{selected.url}</a>
          {contentBusy && <p role="status">Reading your website…</p>}
          {contentError && <div role="alert" className="space-y-2"><p>{contentError}</p><Button variant="outline" onClick={() => setContentReload(value => value + 1)}>Retry reading page</Button></div>}
          {currentPage && <><dl className="space-y-3 text-sm"><div><dt className="font-medium">Current HTML title</dt><dd className="text-muted-foreground">{currentPage.htmlTitle || 'No title tag found.'}</dd></div><div><dt className="font-medium">Current meta description</dt><dd className="text-muted-foreground">{currentPage.seoMetaDescription || 'No meta description tag found.'}</dd></div></dl>
            <p className="text-xs text-muted-foreground">Read from your website{currentPage.fetchedAt ? ` on ${new Date(currentPage.fetchedAt).toLocaleString()}` : ''}. These are not Google search-result titles.</p>
            {redirected && <div role="status" className="space-y-2 rounded border p-3"><p className="text-sm break-all">This URL redirects to {currentPage.finalUrl}. Review and track the destination so your edit is measured against the page you actually change.</p>
              {propertyContainsUrl(property, currentPage.finalUrl) && <Button variant="outline" onClick={() => { const destination = currentPage.finalUrl; setRedirectDestinations(previous => [...new Set([...previous, destination])]); choosePage(destination); }}>Review destination page</Button>}
            </div>}
          </>}
          {queryError && <p className="text-sm text-muted-foreground">{queryError}</p>}
          <label className="block space-y-2"><span className="text-sm font-medium">Optional query to consider</span><select value={keyword} disabled={generating || taskConfirmed} onChange={event => { setKeyword(event.target.value); setSuggestion(null); setGenerationError(''); }} className="w-full rounded border bg-background p-3">
            <option value="">Use current page content without a keyword</option>
            {selected.focusKeyword && !selected.queries.some(row => row.keyword === selected.focusKeyword) && <option value={selected.focusKeyword}>{selected.focusKeyword} — saved focus keyword</option>}
            {selected.queries.map(row => <option key={row.keyword} value={row.keyword}>{row.keyword} — observed search query</option>)}
          </select></label>
          <p className="text-xs text-muted-foreground">A reported query shows that this page appeared for that search. Choose it only if it fits your service and your customers. You do not need a saved focus keyword.</p>
          {generationError && <p role="alert" className="text-destructive">{generationError}</p>}
          {!taskConfirmed && <Button onClick={generate} disabled={!currentPage || contentBusy || generating || redirected}>{generating ? 'Drafting your suggestion…' : suggestion ? 'Generate another draft' : generationError ? 'Try generating again' : 'Generate title and description'}</Button>}
          {!taskConfirmed && <p className="text-xs text-muted-foreground">Suggestions are generated only when you press this button. Review the wording before publishing.</p>}
        </CardContent></Card>
      <div className="mb-6"><SeoRecommendationPanel key={selected.url} pageUrl={selected.url} title={selected.url}
        suggestedTitle={suggestion?.title || ''} suggestedDescription={suggestion?.description || ''}
        focusKeyword={suggestion?.keyword || ''} keywordSource={selected.queries.some(row => row.keyword === suggestion?.keyword) ? 'gsc-observed' : 'gsc-existing'}
        currentPage={currentPage} provenance={suggestion?.provenance} requireServerConfirmation suggestionState={suggestion && !redirected ? 'ready' : generating ? 'loading' : 'idle'} onConfirmed={markConfirmed} /></div>
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
