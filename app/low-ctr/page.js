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
import PageReviewAssessment, { recommendedReviewPage, usablePageAssessment } from '../components/dashboard/PageReviewAssessment';
import PageSearchActivity, { pageOptionLabel, usablePageActivity } from '../components/dashboard/PageSearchActivity';
import PageContentChangeConfirmation from '../components/dashboard/PageContentChangeConfirmation';
import SavedPagePlan, { usableSavedPagePlan } from '../components/dashboard/SavedPagePlan';
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
  const [reload, setReload] = useState(0);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [requestedUrl, setRequestedUrl] = useState(null);
  const [selectionError, setSelectionError] = useState('');
  const [goal, setGoal] = useState('');
  const [currentPage, setCurrentPage] = useState(null);
  const [currentPageProvenance, setCurrentPageProvenance] = useState(null);
  const [contentBusy, setContentBusy] = useState(false);
  const [contentError, setContentError] = useState('');
  const [contentReload, setContentReload] = useState(0);
  const [activity, setActivity] = useState(null);
  const [activityByPage, setActivityByPage] = useState({});
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [activityReload, setActivityReload] = useState(0);
  const [suggestion, setSuggestion] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState('');
  const [planReload, setPlanReload] = useState(0);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [taskConfirmed, setTaskConfirmed] = useState(false);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const generationController = useRef(null);
  const activityController = useRef(null);
  const planController = useRef(null);
  const taskController = useRef(null);
  const loadedPlanScope = useRef('');
  const markConfirmed = useCallback(() => setTaskConfirmed(true), []);
  const markContentConfirmed = useCallback(() => { setContentConfirmed(true); setTaskConfirmed(true); }, []);
  useEffect(() => () => { generationController.current?.abort(); taskController.current?.abort(); }, []);

  useEffect(() => { setRequestedUrl(new URL(window.location.href).searchParams.get('page') || ''); }, []);
  useEffect(() => {
    if (!user?.id) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true); setDataError('');
    Promise.allSettled([
      request('/api/dashboard/overview', undefined, controller.signal),
      request('/api/gsc/fetch-keywords', { dateRange: '28' }, controller.signal),
      request('/api/focus-keywords', undefined, controller.signal),
    ]).then(([summary, queries, focus]) => {
      if (!active) return;
      if (summary.status === 'fulfilled') setOverview(summary.value);
      else setDataError('Search activity could not be loaded. Your tracked pages are still available. Reconnect Google in website setup if the problem continues.');
      if (queries.status === 'fulfilled') setKeywords(queries.value.keywords || []);
      if (focus.status === 'fulfilled') setFocusKeywords(focus.value.keywords || []);
      setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [user?.id, reload]);

  const property = overview?.property || data.gscProperty;
  const pages = useMemo(() => taskPages({ property, trackedPages: [...(data.revampPages || []), ...redirectDestinations], observedPages: overview?.pages || [], keywords, focusKeywords }), [property, data.revampPages, redirectDestinations, overview?.pages, keywords, focusKeywords]);
  const selected = pages.find(page => page.url === selectedUrl);
  const visibleActivity = activity?.pageUrl === selectedUrl ? activity : null;
  const redirected = Boolean(currentPage?.finalUrl && currentPage.finalUrl !== selectedUrl);
  const savedContentChanged = Boolean(plan && currentPageProvenance?.contentFingerprint && plan.review.provenance.contentFingerprint !== currentPageProvenance.contentFingerprint);
  const hasContentTasks = suggestion?.analysis.recommendations.some(item => ['heading', 'content', 'internal_link', 'technical'].includes(item.type)) || plan?.tasks.some(task => task.status !== 'dismissed' && (['heading', 'content', 'internal_link', 'technical'].includes(task.recommendation.type) || (task.recommendation.type === 'metadata' && suggestion?.analysis.action !== 'revise_metadata')));
  useEffect(() => {
    if (loading || !isLoaded || requestedUrl === null) return;
    if (requestedUrl && !pages.some(page => page.url === requestedUrl)) {
      setSelectionError('That exact page is not in your current tracked pages or reported search data. Choose a page below, or add it in website setup.');
      setRequestedUrl(''); return;
    }
    if (!selectedUrl && pages.length) {
      const page = pages.find(item => item.url === requestedUrl) || pages[0];
      setSelectedUrl(page.url);
    }
  }, [loading, isLoaded, requestedUrl, selectedUrl, pages]);

  useEffect(() => {
    if (!selectedUrl) return;
    const controller = new AbortController(); let active = true;
    setCurrentPage(null); setCurrentPageProvenance(null); setContentError(''); setContentBusy(true);
    request('/api/page-review/content', { pageUrl: selectedUrl }, controller.signal)
      .then(result => { if (!active) return; if (result.data?.url !== selectedUrl) throw new Error('The content for this exact page could not be verified. Please retry.'); setCurrentPage(result.data); setCurrentPageProvenance(result.provenance || null); })
      .catch(error => { if (active) setContentError(error.message || 'Your website could not be read. Try again.'); })
      .finally(() => { if (active) setContentBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [selectedUrl, property, data.revampRunId, contentReload]);

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

  useEffect(() => {
    if (!selectedUrl || !property) return;
    const controller = new AbortController(); let active = true;
    planController.current = controller;
    const scopeKey = JSON.stringify([selectedUrl, property, data.revampRunId || null]);
    if (loadedPlanScope.current !== scopeKey) {
      loadedPlanScope.current = scopeKey;
      generationController.current?.abort(); taskController.current?.abort();
      setPlan(null); setSuggestion(null); setGoal(''); setGenerating(false); setTaskSaving(false); setGenerationError('');
    }
    setPlanBusy(true); setPlanError(''); setTaskError('');
    request(`/api/page-review/plan?pageUrl=${encodeURIComponent(selectedUrl)}`, undefined, controller.signal)
      .then(result => {
        if (!active || controller.signal.aborted) return;
        if (result.plan === null) { setPlan(null); setSuggestion(null); return; }
        if (!usableSavedPagePlan(result.plan, { pageUrl: selectedUrl, property, websiteRunId: data.revampRunId })) throw new Error('The saved tasks for this exact page could not be verified. Retry loading them before analyzing again.');
        setPlan(result.plan); setSuggestion(result.plan.review); setGoal(result.plan.review.ownerGoal || '');
      })
      .catch(error => { if (active && !controller.signal.aborted) setPlanError(error.message || 'Your saved tasks could not be loaded. Please retry.'); })
      .finally(() => { if (active && !controller.signal.aborted) setPlanBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [selectedUrl, property, data.revampRunId, planReload]);

  const resetAssessment = () => {
    generationController.current?.abort();
    setGenerating(false); setSuggestion(null); setGenerationError('');
  };
  const choosePage = value => {
    planController.current?.abort(); taskController.current?.abort();
    setSelectedUrl(value); setPlan(null); setPlanError(''); setTaskError(''); setTaskSaving(false); setPlanBusy(true);
    setGoal(''); setContentConfirmed(false);
    setActivity(null); setActivityError(''); setActivityBusy(true);
    resetAssessment(); setTaskConfirmed(false); setSelectionError('');
  };
  const reviewRelatedPage = value => {
    if (suggestion?.analysis.action !== 'review_page' || suggestion.analysis.targetPageUrl !== value ||
      recommendedReviewPage(suggestion) !== value || !propertyContainsUrl(property, value)) return;
    setRedirectDestinations(previous => [...new Set([...previous, value])]);
    choosePage(value);
  };
  const generate = async () => {
    if (!selected || !currentPage || generating || taskConfirmed || redirected || planBusy || taskSaving || planError) return;
    planController.current?.abort();
    setGenerating(true); setGenerationError(''); setTaskError('');
    const controller = new AbortController(); generationController.current = controller;
    try {
      const result = await request('/api/page-review/suggestions', { pageUrl: selected.url, focusKeywords: [], includeResearch: true, ...(goal.trim() ? { goal: goal.trim() } : {}) }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.currentPage?.finalUrl && result.currentPage.finalUrl !== selected.url) {
        setCurrentPage(result.currentPage);
        throw new Error('This page now redirects. Review the destination page before analyzing a change.');
      }
      const scope = { pageUrl: selected.url, property, websiteRunId: data.revampRunId };
      if (!usablePageAssessment(result) || !usablePageActivity({ success: true, evidence: result.evidence, provenance: result.provenance }, scope) || result.currentPage?.url !== selected.url) throw new Error('A complete, supported page assessment was not returned. Your previous saved tasks are unchanged. Please try analyzing again.');
      if (result.provenance.reviewVersion >= 6 && !usableSavedPagePlan(result.plan, scope)) throw new Error('The new task list could not be verified as saved. Your previous tasks remain here. Reload saved tasks before trying again.');
      setSuggestion(result.plan?.review || result); setPlan(result.plan || null);
      activityController.current?.abort(); setActivityBusy(false);
      setActivity(result.evidence); setActivityError('');
      setActivityByPage(previous => ({ ...previous, [selected.url]: result.evidence }));
      if (result.currentPage) { setCurrentPage(result.currentPage); setCurrentPageProvenance(result.provenance); }
    } catch (error) { if (!controller.signal.aborted) setGenerationError(error.message || 'This page could not be analyzed. Please try again.'); }
    finally { if (!controller.signal.aborted) setGenerating(false); }
  };

  const updateTaskStatus = async (taskId, status) => {
    if (!plan || taskSaving || generating || planBusy) return;
    const controller = new AbortController(); taskController.current = controller;
    setTaskSaving(true); setTaskError('');
    try {
      const result = await request('/api/page-review/plan', { pageUrl: selectedUrl, taskId, status, revision: plan.revision }, controller.signal);
      if (controller.signal.aborted) return;
      if (!usableSavedPagePlan(result.plan, { pageUrl: selectedUrl, property, websiteRunId: data.revampRunId })) throw new Error('The updated task status could not be verified.');
      setPlan(result.plan);
    } catch (error) { if (!controller.signal.aborted) setTaskError(`Your task status was not confirmed as saved. ${error.message || 'Reload your saved tasks and try again.'}`); }
    finally { if (!controller.signal.aborted) setTaskSaving(false); }
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
          {contentError && <div role="alert" className="space-y-2"><p>{contentError}</p><Button variant="outline" onClick={() => setContentReload(value => value + 1)}>Retry reading page</Button></div>}
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
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/20"><span className="block font-medium">We’ll choose a search focus for you</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">The analysis uses this page, your service and location, and available search evidence to recommend how new customers could find you. You don’t need to research keywords.</span></p>
          <label className="block space-y-2"><span className="text-sm font-medium">What should this page help visitors do? <span className="font-normal text-muted-foreground">(optional)</span></span><input value={goal} maxLength={180} disabled={taskConfirmed || planBusy || generating} onChange={event => { setGoal(event.target.value); generationController.current?.abort(); setGenerating(false); }} className="w-full rounded-lg border bg-background p-3 text-sm" placeholder="For example: understand my website design service and request a consultation." /><span className="block text-xs leading-relaxed text-muted-foreground">This is your goal for the review, not a verified fact about your business. The analysis will still check it against your page.</span></label>
          {!taskConfirmed && <p className="rounded-lg border px-4 py-3 text-sm"><span className="block font-medium">Web research is included</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Each analysis checks public websites for context. You’ll see the sources or a notice if research is unavailable.</span></p>}
          {planBusy && <p role="status" className="text-sm text-muted-foreground">Loading your saved page tasks…</p>}
          {planError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{planError}</p><Button variant="outline" size="sm" disabled={planBusy || generating} onClick={() => setPlanReload(value => value + 1)}>Retry saved tasks</Button></div>}
          {generationError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{generationError}</p><Button size="sm" variant="outline" disabled={planBusy || generating} onClick={() => setPlanReload(value => value + 1)}>Reload saved tasks</Button></div>}
          {generating && plan && <p role="status" className="text-xs text-muted-foreground">Your saved tasks stay available while we check for useful updates.</p>}
          {!taskConfirmed && <Button onClick={generate} disabled={!currentPage || contentBusy || generating || redirected || planBusy || taskSaving || Boolean(planError)}><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />{generating ? 'Reviewing your page…' : suggestion || generationError ? 'Analyze again' : 'Analyze this page'}</Button>}
          {!taskConfirmed && <p className="text-xs text-muted-foreground">We’ll save a prioritized list of useful changes. Sometimes your wording can stay as it is. Your website won’t change.</p>}
        </CardContent></Card>
      {savedContentChanged && !redirected && <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100">Your page has changed since this saved analysis. The tasks and wording below come from that earlier version. Analyze again to check which suggestions still fit before using them.</p>}
      {suggestion && !redirected && <PageReviewAssessment review={suggestion} onReviewPage={reviewRelatedPage} hideActions={Boolean(plan)} />}
      {plan && !redirected && <SavedPagePlan plan={plan} busy={taskSaving || generating || planBusy} savingStatus={taskSaving} error={taskError} onStatus={updateTaskStatus} onReload={() => setPlanReload(value => value + 1)} />}
      {suggestion && !redirected && (contentConfirmed || !taskConfirmed) && hasContentTasks && <PageContentChangeConfirmation key={`${selected.url}:${suggestion.provenance.generatedAt}`} pageUrl={selected.url} provenance={suggestion.provenance} onConfirmed={markContentConfirmed} onExisting={markConfirmed} hasMetadataEditor={suggestion.analysis.action === 'revise_metadata'} />}
      <div className="mb-6" hidden={contentConfirmed || Boolean(suggestion && suggestion.analysis.action !== 'revise_metadata' && !taskConfirmed)}><SeoRecommendationPanel key={selected.url} pageUrl={selected.url} title={selected.url}
        suggestedTitle={suggestion?.title || ''} suggestedDescription={suggestion?.description || ''}
        focusKeyword={suggestion?.analysis.searchFocus?.phrase || ''} keywordSource={suggestion?.analysis.searchFocus?.source === 'observed' ? 'gsc-observed' : 'ai-generated'}
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
