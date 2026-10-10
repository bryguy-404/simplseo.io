"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { authenticatedFetch } from '../lib/authenticatedFetch';
import { taskPages } from '../lib/pageTaskFlow';
import { propertyContainsUrl } from '../lib/revampState';
import MainLayout from '../components/MainLayout';
import SeoRecommendationPanel from '../components/dashboard/SeoRecommendationPanel';
import PageProgress from '../components/dashboard/PageProgress';
import PageReviewAssessment, { SearchFocus, recommendedReviewPage, usablePageAssessment } from '../components/dashboard/PageReviewAssessment';
import PageSearchActivity, { pageOptionLabel, usablePageActivity } from '../components/dashboard/PageSearchActivity';
import PageContentChangeConfirmation from '../components/dashboard/PageContentChangeConfirmation';
import SavedPagePlan, { isSelectableEdit, usableSavedPagePlan } from '../components/dashboard/SavedPagePlan';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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
  const [updateCheck, setUpdateCheck] = useState(null);
  const [taskConfirmed, setTaskConfirmed] = useState(false);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [trackingStatus, setTrackingStatus] = useState({ loading: true, error: '' });
  const generationController = useRef(null);
  const activityController = useRef(null);
  const planController = useRef(null);
  const taskController = useRef(null);
  const loadedPlanScope = useRef('');
  const markConfirmed = useCallback(() => { setTaskConfirmed(true); }, []);
  const markContentConfirmed = useCallback((record, updatedPlan) => {
    setContentConfirmed(true); setTaskConfirmed(true); setSelectedTaskIds([]);
    if (updatedPlan) setPlan(updatedPlan);
  }, []);
  const onProgress = useCallback(result => {
    if (!result) return;
    const record = result.records?.find(item => item.pageUrl === selectedUrl) || null;
    setTaskConfirmed(Boolean(record));
  }, [selectedUrl]);
  const onProgressLoad = useCallback(status => setTrackingStatus(status), []);
  const onCycleStarted = useCallback(() => {
    setTaskConfirmed(false); setContentConfirmed(false); setSelectedTaskIds([]);
    setPlanReload(value => value + 1); setContentReload(value => value + 1);
  }, []);
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
      setSelectedTaskIds([]); setUpdateCheck(null);
    }
    setPlanBusy(true); setPlanError(''); setTaskError('');
    request(`/api/page-review/plan?pageUrl=${encodeURIComponent(selectedUrl)}`, undefined, controller.signal)
      .then(result => {
        if (!active || controller.signal.aborted) return;
        if (result.plan === null) { setPlan(null); setSuggestion(null); return; }
        if (!usableSavedPagePlan(result.plan, { pageUrl: selectedUrl, property, websiteRunId: data.revampRunId })) throw new Error('The saved tasks for this exact page could not be verified. Retry loading them before checking for updates.');
        setPlan(result.plan); setSuggestion(result.plan.review); setGoal(result.plan.review.ownerGoal || ''); setSelectedTaskIds([]);
      })
      .catch(error => { if (active && !controller.signal.aborted) setPlanError(error.message || 'Your saved tasks could not be loaded. Please retry.'); })
      .finally(() => { if (active && !controller.signal.aborted) setPlanBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [selectedUrl, property, data.revampRunId, planReload]);

  const resetAssessment = () => {
    generationController.current?.abort();
    setGenerating(false); setSuggestion(null); setGenerationError(''); setUpdateCheck(null);
  };
  const choosePage = value => {
    if (value === selectedUrl) return;
    planController.current?.abort(); taskController.current?.abort();
    setSelectedUrl(value); setPlan(null); setPlanError(''); setTaskError(''); setTaskSaving(false); setPlanBusy(true);
    setGoal(''); setContentConfirmed(false); setSelectedTaskIds([]); setTrackingStatus({ loading: true, error: '' });
    setActivity(null); setActivityError(''); setActivityBusy(true);
    setCurrentPage(null); setCurrentPageProvenance(null); setContentError(''); setContentBusy(true);
    resetAssessment(); setTaskConfirmed(false); setSelectionError('');
  };
  const reviewRelatedPage = value => {
    if (suggestion?.analysis.action !== 'review_page' || suggestion.analysis.targetPageUrl !== value ||
      recommendedReviewPage(suggestion) !== value || !propertyContainsUrl(property, value)) return;
    setRedirectDestinations(previous => [...new Set([...previous, value])]);
    choosePage(value);
  };
  const generate = async () => {
    if (!selected || !currentPage || pageLoading || generating || taskConfirmed || redirected || taskSaving || planError || trackingStatus.error) return;
    planController.current?.abort();
    setGenerating(true); setGenerationError(''); setTaskError(''); setUpdateCheck(null);
    const controller = new AbortController(); generationController.current = controller;
    try {
      const result = await request('/api/page-review/suggestions', { pageUrl: selected.url, focusKeywords: [], includeResearch: true, ...(goal.trim() ? { goal: goal.trim() } : {}) }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.currentPage?.finalUrl && result.currentPage.finalUrl !== selected.url) {
        setCurrentPage(result.currentPage);
        throw new Error('This page now redirects. Review the destination page before analyzing a change.');
      }
      const scope = { pageUrl: selected.url, property, websiteRunId: data.revampRunId };
      if (!usablePageAssessment(result) || !usablePageActivity({ success: true, evidence: result.evidence, provenance: result.provenance }, scope) || result.currentPage?.url !== selected.url) throw new Error('A complete, supported page assessment was not returned. Your previous saved tasks are unchanged. Please try again.');
      if (result.provenance.reviewVersion >= 6 && !usableSavedPagePlan(result.plan, scope)) throw new Error('The new task list could not be verified as saved. Your previous tasks remain here. Reload saved tasks before trying again.');
      const preserved = ['unchanged', 'incomplete'].includes(result.updateCheck?.status);
      if (preserved && !result.plan) throw new Error('The saved task list could not be verified. Please reload your saved tasks.');
      setSuggestion(result.plan?.review || result); setPlan(result.plan || null);
      // A check is not a new review. Keep the user's local publication selection,
      // while respecting any checklist changes saved by another tab.
      setSelectedTaskIds(previous => preserved ? previous.filter(id => result.plan.tasks.some(task => task.id === id && isSelectableEdit(task, selected.url))) : []);
      setUpdateCheck(result.updateCheck || null);
      const latest = preserved ? result.checkContext : result;
      if (latest && usablePageActivity({ success: true, evidence: latest.evidence, provenance: latest.provenance }, scope)) {
        activityController.current?.abort(); setActivityBusy(false);
        setActivity(latest.evidence); setActivityError('');
        setActivityByPage(previous => ({ ...previous, [selected.url]: latest.evidence }));
      }
      if (latest?.currentPage?.url === selected.url && latest.provenance?.pageUrl === selected.url && latest.provenance.property === property && (latest.provenance.websiteRunId || null) === (data.revampRunId || null)) {
        setCurrentPage(latest.currentPage); setCurrentPageProvenance(latest.provenance);
      }
    } catch (error) { if (!controller.signal.aborted) setGenerationError(error.message || 'This page could not be analyzed. Please try again.'); }
    finally { if (!controller.signal.aborted) setGenerating(false); }
  };

  const updateTaskStatus = async (taskId, status) => {
    if (!plan || taskSaving || generating || pageLoading || trackingStatus.error) return;
    const controller = new AbortController(); taskController.current = controller;
    setTaskSaving(true); setTaskError('');
    try {
      const result = await request('/api/page-review/plan', { pageUrl: selectedUrl, taskId, status, revision: plan.revision }, controller.signal);
      if (controller.signal.aborted) return;
      if (!usableSavedPagePlan(result.plan, { pageUrl: selectedUrl, property, websiteRunId: data.revampRunId })) throw new Error('The updated task status could not be verified.');
      setPlan(result.plan);
      setSelectedTaskIds(previous => previous.filter(id => id !== taskId));
    } catch (error) { if (!controller.signal.aborted) setTaskError(`Your task status was not confirmed as saved. ${error.message || 'Reload your saved tasks and try again.'}`); }
    finally { if (!controller.signal.aborted) setTaskSaving(false); }
  };

  const pageLoading = Boolean(selectedUrl && (contentBusy || activityBusy || planBusy || trackingStatus.loading));
  const publishingBusy = taskSaving || generating || pageLoading;
  const hasExistingReview = Boolean(plan || suggestion);
  const togglePublished = (taskId, checked) => {
    if (publishingBusy || taskConfirmed) return;
    setSelectedTaskIds(previous => checked ? [...new Set([...previous, taskId])] : previous.filter(id => id !== taskId));
  };

  if (isLoading || !isLoaded || !user) return <MainLayout><p role="status">Loading your website tasks…</p></MainLayout>;
  return <MainLayout>
    <div className="mb-6 space-y-2"><Link href="/dashboard" className="text-sm underline">Back to dashboard</Link><h1 className="text-3xl font-bold">Improve a page</h1></div>
    <Card className="mb-4"><CardContent className="space-y-3 pt-5">
      {loading && <p role="status">Loading your pages…</p>}
      {dataError && <div role="alert" className="space-y-2 text-sm"><p>{dataError}</p><Button variant="outline" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry search data</Button> <Link className="underline" href="/revamp">Website setup</Link></div>}
      {selectionError && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{selectionError}</p>}
      {!loading && !pages.length && <p>No current pages are available yet. <Link href="/revamp" className="underline">Review your website pages</Link> to get started.</p>}
      {pages.length > 0 && <label className="block space-y-2"><span className="text-sm font-medium">Choose a page to improve</span><select className="w-full min-w-0 rounded-lg border bg-background p-3 text-sm" value={selectedUrl} disabled={generating} onChange={event => choosePage(event.target.value)}>
        <option value="" disabled>Choose a page</option>{pages.map(page => <option key={page.url} value={page.url}>{pageOptionLabel(Object.hasOwn(activityByPage, page.url) ? { ...page, metrics: activityByPage[page.url].current.totals, activityStatus: activityByPage[page.url].current.totalsStatus } : { ...page, activityStatus: dataError ? 'unavailable' : undefined })}</option>)}
      </select></label>}
    </CardContent></Card>
    {selected && <>
      {pageLoading && <div role="status" aria-live="polite" className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm"><LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /><span>Loading this page…</span></div>}
      <div aria-busy={pageLoading} aria-label="Page review workspace">
      <PageSearchActivity key={selected.url} pageUrl={selected.url} evidence={visibleActivity} busy={activityBusy} error={activityError} onRetry={() => setActivityReload(value => value + 1)} />
      <PageProgress key={`progress-${selected.url}`} pageUrl={selected.url} hideEmpty onResult={onProgress} onLoadState={onProgressLoad} onCycleStarted={onCycleStarted} />
      {contentError && <div role="alert" className="mb-4 space-y-2 rounded-lg border p-4 text-sm"><p>{contentError}</p><Button variant="outline" size="sm" onClick={() => setContentReload(value => value + 1)}>Retry reading page</Button></div>}
      {redirected && <div role="status" className="mb-4 space-y-2 rounded-lg border p-4"><p className="break-all text-sm">This URL redirects to {currentPage.finalUrl}. Review the destination page to track the edit there.</p>
        {propertyContainsUrl(property, currentPage.finalUrl) && <Button variant="outline" onClick={() => { const destination = currentPage.finalUrl; setRedirectDestinations(previous => [...new Set([...previous, destination])]); choosePage(destination); }}>Review destination page</Button>}
      </div>}
      {planError && <div role="alert" className="mb-4 space-y-2 rounded-lg border p-4 text-sm text-destructive"><p>{planError}</p><Button variant="outline" size="sm" disabled={planBusy || generating} onClick={() => setPlanReload(value => value + 1)}>Retry saved tasks</Button></div>}
      {generationError && <div role="alert" className="mb-4 space-y-2 rounded-lg border p-4 text-sm text-destructive"><p>{generationError}</p><Button size="sm" variant="outline" disabled={planBusy || generating} onClick={() => setPlanReload(value => value + 1)}>Reload saved tasks</Button></div>}
      {savedContentChanged && !redirected && !taskConfirmed && <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100">Your website changed since this analysis. If you published the suggested edits, confirm them below. Otherwise, use Check for updates to review the tasks.</p>}
      {suggestion?.analysis.searchFocus && !redirected && !taskConfirmed && <div className="mb-4"><SearchFocus focus={suggestion.analysis.searchFocus} /></div>}
      {plan && !redirected && <SavedPagePlan plan={plan} busy={publishingBusy || Boolean(trackingStatus.error)} savingStatus={taskSaving} error={taskError} onStatus={updateTaskStatus} onReload={() => setPlanReload(value => value + 1)} selectedTaskIds={selectedTaskIds} onTogglePublished={togglePublished} tracking={taskConfirmed} />}
      {suggestion && !redirected && plan && !taskConfirmed && <PageContentChangeConfirmation key={`${selected.url}:${suggestion.provenance.generatedAt}`} pageUrl={selected.url} provenance={suggestion.provenance} plan={plan} selectedTaskIds={selectedTaskIds} loading={publishingBusy} tracking={taskConfirmed} error={trackingStatus.error} onConfirmed={markContentConfirmed} />}
      {suggestion && !redirected && !plan && <fieldset disabled={pageLoading} className="min-w-0">
        <PageReviewAssessment review={suggestion} onReviewPage={reviewRelatedPage} />
        {(contentConfirmed || !taskConfirmed) && hasContentTasks && <PageContentChangeConfirmation key={`${selected.url}:${suggestion.provenance.generatedAt}`} pageUrl={selected.url} provenance={suggestion.provenance} onConfirmed={markContentConfirmed} onExisting={markConfirmed} hasMetadataEditor={suggestion.analysis.action === 'revise_metadata'} />}
        {!contentConfirmed && suggestion.analysis.action === 'revise_metadata' && <SeoRecommendationPanel key={selected.url} pageUrl={selected.url} title={selected.url} suggestedTitle={suggestion.title || ''} suggestedDescription={suggestion.description || ''} focusKeyword={suggestion.analysis.searchFocus?.phrase || ''} keywordSource={suggestion.analysis.searchFocus?.source === 'observed' ? 'gsc-observed' : 'ai-generated'} currentPage={currentPage} provenance={suggestion.provenance} requireServerConfirmation suggestionState="ready" onConfirmed={markConfirmed} />}
      </fieldset>}
      {!taskConfirmed && <section aria-label="Analyze this page" className="mb-6 space-y-4 rounded-xl border p-5">
        {!suggestion && <div><h2 className="text-lg font-semibold">Find your next useful changes</h2><p className="mt-1 text-sm text-muted-foreground">We’ll review this page, choose a search focus, and save your tasks.</p></div>}
        <details className="text-sm"><summary className="cursor-pointer font-medium">Tell us more about this page (optional)</summary><label className="mt-3 block space-y-2"><span>What should this page help visitors do?</span><input value={goal} maxLength={180} disabled={pageLoading || generating} onChange={event => { setGoal(event.target.value); setUpdateCheck(null); }} className="w-full rounded-lg border bg-background p-3 text-sm" placeholder="For example: understand my service and request a quote." /></label></details>
        <div className="flex flex-wrap items-center gap-3"><Button onClick={generate} variant={hasExistingReview ? 'link' : 'default'} className={hasExistingReview ? 'px-0 text-muted-foreground underline underline-offset-4 hover:text-foreground' : undefined} disabled={!currentPage || publishingBusy || redirected || Boolean(planError) || Boolean(trackingStatus.error)}>{generating ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : hasExistingReview ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{generating ? hasExistingReview ? 'Checking for updates…' : 'Reviewing your page…' : hasExistingReview ? 'Check for updates' : 'Analyze this page'}</Button><span className="text-xs text-muted-foreground">{plan ? 'Your saved tasks stay unless new information supports an update.' : 'Web research included. Your website won’t change.'}</span></div>
        {generating && <p role="status" className="text-xs text-muted-foreground">{plan ? 'Checking your page and search data. Your saved tasks stay available.' : 'Reviewing your page and search data. This may take a moment.'}</p>}
        {updateCheck && !generating && <p role="status" aria-live="polite" className={`text-sm ${updateCheck.status === 'incomplete' ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}`}>{updateCheck.status === 'unchanged' ? 'Your saved plan is up to date.' : updateCheck.message || (updateCheck.status === 'updated' ? 'Your saved plan has been updated.' : 'We couldn’t finish checking. Your saved plan is unchanged.')} {updateCheck.limitation && <span className="block pt-1 text-xs">{updateCheck.limitation}</span>}</p>}
      </section>}
      {currentPage && <details className="mb-4 rounded-xl border bg-card p-5"><summary className="cursor-pointer text-sm font-medium">Current title and description</summary><section aria-label="Currently on your website" className="mt-4 overflow-hidden rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"><dl className="divide-y divide-sky-200 dark:divide-sky-800/60">
        <div className="p-4"><dt className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-800 dark:text-sky-300"><FileText className="h-4 w-4" aria-hidden="true" />Page title</dt><dd className="break-words text-base font-medium text-sky-950 dark:text-sky-50">{currentPage.htmlTitle || 'No title tag found.'}</dd></div>
        <div className="p-4"><dt className="mb-2 text-xs font-semibold text-sky-800 dark:text-sky-300">Page description</dt><dd className="break-words text-sm leading-relaxed text-sky-950 dark:text-sky-100">{currentPage.seoMetaDescription || 'No meta description tag found.'}</dd></div>
      </dl></section><p className="mt-3 text-xs text-muted-foreground">Read from your website{currentPage.fetchedAt ? ` on ${new Date(currentPage.fetchedAt).toLocaleDateString()}` : ''}. Google may display different wording.</p></details>}
      {plan && suggestion && !redirected && <details className="mb-6 rounded-xl border bg-card p-5"><summary className="cursor-pointer text-sm font-medium">Full analysis and sources</summary><div className="mt-4"><PageReviewAssessment review={suggestion} onReviewPage={reviewRelatedPage} hideActions /></div></details>}
      </div>
    </>}
  </MainLayout>;
}

export default function LowCtrPage() {
  const { user, isLoading } = useAuth();
  const { data, isLoaded } = useOnboarding();
  if (isLoading || !isLoaded || !user) return <MainLayout><p role="status">Loading your website tasks…</p></MainLayout>;
  // Discard unfinished drafts and requests when the account, property or website changes.
  return <LowCtrWorkspace key={`${user.id}:${data.gscProperty || ''}:${data.revampRunId || ''}`} />;
}
