"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, LoaderCircle, MapPin, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import NewPagePlan from './NewPagePlan';
import { areaKey, areaLabel, contextKey, displayDate, fieldClass, safeLink } from './shared';

async function request(path = '', body, signal, method = 'POST') {
  const response = await authenticatedFetch(`/api/new-page-plans${path}`, body === undefined ? { signal } : {
    method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'We couldn’t finish this step. Your saved work is unchanged.');
    error.details = result;
    throw error;
  }
  return result;
}

function Evidence({ research, idea }) {
  return <details className="border-t pt-3 text-sm">
    <summary className="cursor-pointer text-muted-foreground">Why this idea?</summary>
    <div className="mt-3 space-y-3">
      <p>{idea.reason}</p>
      {idea.distinctValue && <p>{idea.distinctValue}</p>}
      {idea.checkedPageUrls?.length > 0 && <div><p className="font-medium">Existing pages compared</p>{idea.checkedPageUrls.map(url => safeLink(url) && <a key={url} className="mt-2 block break-all underline" href={safeLink(url)} target="_blank" rel="noopener noreferrer">{url}</a>)}</div>}
      {research?.summary && <p className="text-muted-foreground">{research.summary}</p>}
      {(research?.sources || []).map((source, index) => safeLink(source.url) && <a key={`${source.url}-${index}`} className="block break-words underline" href={safeLink(source.url)} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>)}
      <p className="text-xs text-muted-foreground">A supported idea to evaluate, not a prediction of rankings or demand.</p>
    </div>
  </details>;
}

function HistoryEntry({ record: summary, act, disabled }) {
  const [detail, setDetail] = useState(null);
  const record = detail || summary;
  return <details className="mt-3 rounded-lg border p-3"><summary className="cursor-pointer">{record.topic || record.keyword || record.idea?.topic || record.draft?.title || record.pageUrl || record.url || 'Previous opportunity record'}</summary><div className="mt-3 space-y-3"><p className="text-xs text-muted-foreground">Read-only history{record.context?.area ? ` · ${areaLabel(record.context.area)}` : ''}{record.createdAt ? ` · ${displayDate(record.createdAt)}` : ''}</p>{safeLink(record.pageUrl || record.url) && <a className="block break-all underline" href={safeLink(record.pageUrl || record.url)} target="_blank" rel="noopener noreferrer">{record.pageUrl || record.url}</a>}{!record.draft && record.hasDraft && !detail && <Button variant="outline" size="sm" disabled={disabled} onClick={() => act('Loading previous website work…', `/plan?planId=${encodeURIComponent(record.id)}`, undefined, result => setDetail(result.plan))}>View saved draft</Button>}{record.draft && <><p><span className="font-medium">SEO title: </span>{record.draft.title}</p><p><span className="font-medium">Description: </span>{record.draft.description}</p><p><span className="font-medium">Main heading: </span>{record.draft.h1}</p>{record.draft.sections?.map((section, index) => <div key={section.id || index}><h3 className="font-medium">{section.heading}</h3><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{section.body}</p></div>)}</>}</div></details>;
}

export default function NewPageWorkspace() {
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [area, setArea] = useState({ name: '', region: '', country: '' });
  const [services, setServices] = useState('');
  const [facts, setFacts] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [contextDirty, setContextDirty] = useState(false);
  const [nearby, setNearby] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const controller = useRef(null);
  const generation = useRef(0);
  const actionActive = useRef(false);

  const fillContext = useCallback((context, business = {}) => {
    setArea(context?.area || { name: business.location || '', region: '', country: '' });
    setServices((context?.services || business.services || []).join('\n'));
    setFacts(context?.facts || '');
    setConfirmed(Boolean(context?.confirmed));
    setContextDirty(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const token = ++generation.current;
    controller.current?.abort();
    actionActive.current = false;
    setBusy(''); setData(null); setError(''); setNotice(''); setNearby([]); setSelectedPlan('');
    if (!user?.id) { setLoading(false); return; }
    const current = new AbortController(); controller.current = current;
    setLoading(true);
    request('', undefined, current.signal).then(result => {
      if (token !== generation.current) return;
      setData(result); fillContext(result.context, result.business);
    }).catch(reason => {
      if (token === generation.current && reason.name !== 'AbortError') setError(reason.message);
    }).finally(() => { if (token === generation.current) setLoading(false); });
    return () => { generation.current = token + 1; current.abort(); controller.current?.abort(); };
  }, [user?.id, authLoading, reload, fillContext]);

  useEffect(() => {
    if (!selectedPlan) return;
    const section = document.getElementById('selected-new-page-plan');
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: 'start' });
  }, [selectedPlan]);

  // Only direct user actions enter this helper. Restoring saved work never calls AI.
  const act = async (label, path, body, apply, method) => {
    if (actionActive.current) return null;
    actionActive.current = true;
    const token = generation.current;
    const current = new AbortController(); controller.current = current;
    setBusy(label); setError(''); setNotice('');
    try {
      const result = await request(path, body, current.signal, method);
      // Area switching restores its stored assessment; this read performs no research.
      if (path === '/context') result.workspace = await request('', undefined, current.signal);
      if (token !== generation.current) return null;
      apply?.(result); return result;
    } catch (reason) {
      if (token === generation.current && reason.name !== 'AbortError') {
        setError(reason.message);
        return { failed: true, ...reason.details };
      }
      return null;
    } finally {
      if (token === generation.current) { actionActive.current = false; setBusy(''); }
    }
  };

  const updatePlan = result => {
    if (!result.plan) return;
    setData(previous => ({ ...previous, plans: [{ ...result.plan,
      ...(result.publication ? { publication: result.publication } : {}),
      ...(result.tracking ? { tracking: result.tracking } : {}),
    }, ...(previous.plans || []).filter(plan => plan.id !== result.plan.id)] }));
  };
  const openSavedPlan = id => {
    if (selectedPlan === id) return;
    setSelectedPlan('');
    return act('Loading your saved plan…', `/plan?planId=${encodeURIComponent(id)}`, undefined, result => {
      updatePlan(result); setSelectedPlan(result.plan.id);
    });
  };
  const saveContext = event => {
    event.preventDefault();
    act('Saving your area…', '/context', { area, services: services.split(/\n|,/).map(value => value.trim()).filter(Boolean), facts, confirmed }, result => {
      setData(previous => ({ ...previous, ...result.workspace, context: result.context, contexts: [result.context,
        ...[...(result.workspace?.contexts || []), previous.context, ...(previous.contexts || [])].filter(context => context && areaKey(context.area) !== areaKey(result.context.area)),
      ] })); fillContext(result.context); setSelectedPlan('');
      setNotice('Area saved. Your other areas and plans are still available.');
    });
  };
  const changeArea = next => { setArea(next); setConfirmed(false); setContextDirty(true); setNotice(''); };
  const savedContext = data?.context;
  const currentArea = areaKey(savedContext?.area);
  const assessments = data?.assessments || [];
  const assessment = !contextDirty ? assessments.find(item => contextKey(item.context) === contextKey(savedContext)) : null;
  const plans = data?.plans || [];
  const currentPlans = plans.filter(plan => areaKey(plan.context?.area) === currentArea && plan.status !== 'dismissed');
  const savedAreas = [...[savedContext, ...(data?.contexts || []), ...assessments.map(item => item.context), ...plans.map(item => item.context)]
    .filter(context => context?.area).reduce((result, context) => {
      if (!result.has(areaKey(context.area))) result.set(areaKey(context.area), context);
      return result;
    }, new Map()).values()];
  const inventory = data?.inventory;
  const inventoryPages = Array.isArray(inventory?.pages) ? inventory.pages : [];
  const reviewed = inventoryPages.filter(page => ['fetched', 'reviewed', 'available'].includes(page.status) || page.content).length;
  const selected = plans.find(plan => plan.id === selectedPlan && plan.status !== 'dismissed');
  const disabled = Boolean(busy);
  const generationDisabled = disabled || data?.enabled === false;

  if (authLoading || loading) return <div role="status" className="flex items-center gap-3 p-8"><LoaderCircle className="size-5 animate-spin" />Loading your saved page ideas…</div>;
  if (!user) return null;
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6" aria-label="New page planning workspace" aria-busy={Boolean(busy)}>
    <header className="space-y-2"><p className="text-xs font-semibold uppercase tracking-widest text-primary">Grow with purpose</p><h1 className="text-3xl font-semibold tracking-tight">New page ideas</h1><p className="text-muted-foreground">Find useful gaps in one area. Create a page only when it adds something worthwhile.</p></header>
    {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{error}</p>{!data && <Button variant="outline" className="mt-3" onClick={() => setReload(value => value + 1)}>Try loading again</Button>}</div>}
    {notice && <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">{notice}</p>}
    {busy && <div role="status" className="sticky top-20 z-10 flex items-center gap-3 rounded-lg border bg-background p-3 text-sm shadow-sm"><LoaderCircle className="size-4 animate-spin" />{busy}</div>}
    {data?.enabled === false && <p className="rounded-lg border p-4 text-sm">New research is temporarily paused. Your saved drafts, editing and tracking remain available.</p>}
    {data && <>
      <Card><CardContent className="space-y-5 pt-6">
        <div><h2 className="text-lg font-semibold">1. Where would you like more customers?</h2><p className="mt-1 text-sm text-muted-foreground">Choose an area you actually serve and the services you offer there.</p></div>
        {savedAreas.length > 1 && <label className="block space-y-2 text-sm"><span>Return to a saved area</span><select className={fieldClass} value="" disabled={disabled} onChange={event => { const context = savedAreas.find(item => areaKey(item.area) === event.target.value); if (context) { fillContext(context); setContextDirty(true); setSelectedPlan(''); } }}><option value="">Choose a saved area</option>{savedAreas.map(context => <option key={areaKey(context.area)} value={areaKey(context.area)}>{areaLabel(context.area)}</option>)}</select></label>}
        <form onSubmit={saveContext} className="space-y-4">
          <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm"><span>City or service area</span><input required maxLength={100} className={fieldClass} value={area.name} onChange={event => changeArea({ ...area, name: event.target.value })} placeholder="South Bend" /></label>
            <label className="space-y-2 text-sm"><span>State or region</span><input required maxLength={100} className={fieldClass} value={area.region} onChange={event => changeArea({ ...area, region: event.target.value })} placeholder="Indiana" /></label>
            <label className="space-y-2 text-sm"><span>Country</span><input required maxLength={100} className={fieldClass} value={area.country} onChange={event => changeArea({ ...area, country: event.target.value })} placeholder="United States" /></label>
          </fieldset>
          <label className="block space-y-2 text-sm"><span>Services offered here</span><textarea required disabled={disabled} className={fieldClass} rows={2} maxLength={1600} value={services} onChange={event => { setServices(event.target.value); setConfirmed(false); setContextDirty(true); }} placeholder="One service per line, such as website design" /></label>
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Add helpful business facts (optional)</summary><label className="mt-3 block space-y-2"><span>What should we know about your work in this area?</span><textarea disabled={disabled} className={fieldClass} rows={3} maxLength={6000} value={facts} onChange={event => { setFacts(event.target.value); setContextDirty(true); }} placeholder="Actual service availability, projects, process or other facts we can use." /></label></details>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={confirmed} disabled={disabled} onChange={event => { setConfirmed(event.target.checked); setContextDirty(true); }} /><span>My business offers these services in this area.</span></label>
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={disabled || !confirmed || !services.trim()}><MapPin className="size-4" />{savedContext && !contextDirty ? 'Area saved' : 'Save this area'}</Button><Button type="button" variant="ghost" disabled={generationDisabled || !savedContext?.confirmed || contextDirty} onClick={() => act('Looking for nearby areas…', '/areas', {}, result => { setNearby(result.areas || []); if (!result.areas?.length) setNotice('No supported nearby areas found. You can enter an area you serve.'); })}>Suggest nearby areas</Button></div>
        </form>
        {nearby.length > 0 && <div className="space-y-3 border-t pt-4"><p className="text-sm text-muted-foreground">Choose only an area your business serves.</p>{nearby.map((candidate, index) => <div key={`${areaLabel(candidate)}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0 text-sm"><p className="font-medium">{areaLabel(candidate)}</p><p className="text-muted-foreground">{candidate.reason}</p>{safeLink(candidate.sourceUrl) && <a className="underline" href={safeLink(candidate.sourceUrl)} target="_blank" rel="noopener noreferrer">Source</a>}</div><Button size="sm" variant="outline" disabled={disabled} onClick={() => { changeArea({ name: candidate.name, region: candidate.region, country: candidate.country }); setNearby([]); setSelectedPlan(''); }}>Choose this area</Button></div>)}</div>}
      </CardContent></Card>

      <Card><CardContent className="space-y-4 pt-6"><div><h2 className="text-lg font-semibold">2. Check what your website already covers</h2><p className="mt-1 text-sm text-muted-foreground">We review existing pages before suggesting another one—including pages without Google traffic.</p></div>
        {inventory && <div className="rounded-lg border p-4 text-sm"><p className="font-medium">{inventory.status === 'ready' ? 'Website review saved' : inventory.status === 'unavailable' ? 'Website review unavailable' : 'Website review is partial'}</p><p className="mt-1 text-muted-foreground">{inventoryPages.length} pages discovered{reviewed ? ` · ${reviewed} read` : ''}. {inventory.canContinue ? 'Continue reviewing before checking for gaps.' : 'This is a bounded review, not a complete list of every page.'}</p>{inventory.updatedAt && <p className="mt-1 text-xs text-muted-foreground">Checked {displayDate(inventory.updatedAt)}</p>}
          {inventory.coverage?.limitations?.length > 0 && <details className="mt-3"><summary className="cursor-pointer">What this review can tell us</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">{inventory.coverage.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>}
          {inventoryPages.length > 0 && <details className="mt-3"><summary className="cursor-pointer">View reviewed pages</summary><ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">{inventoryPages.map((page, index) => <li className="flex flex-wrap gap-2 break-all" key={`${page.url || page.pageUrl}-${index}`}>{safeLink(page.url || page.pageUrl) ? <a className="underline" target="_blank" rel="noopener noreferrer" href={safeLink(page.url || page.pageUrl)}>{page.title || page.url || page.pageUrl}</a> : <span>{page.url || page.pageUrl}</span>}<span className="text-muted-foreground">{page.status || 'Recorded'}</span></li>)}</ul></details>}
        </div>}
        <div className="flex flex-wrap gap-3"><Button variant={inventory ? 'outline' : 'default'} disabled={disabled} onClick={() => act('Reviewing your website…', '/inventory', inventory?.canContinue ? {} : { restart: Boolean(inventory) }, result => {
            setData(previous => ({ ...previous, inventory: result.inventory }));
            if (!services.trim() && !savedContext) {
              const observed = (result.inventory?.pages || []).filter(page => page.status === 'fetched' && /\/(?:services?|what-we-do)\//i.test(page.url)).map(page => page.content?.h1).filter(value => typeof value === 'string' && value.trim()).slice(0, 12);
              if (observed.length) { setServices([...new Set(observed)].join('\n')); setContextDirty(true); }
            }
          })}><Search className="size-4" />{inventory?.canContinue ? 'Continue website review' : inventory ? 'Refresh website review' : 'Review my website'}</Button>
          <Button disabled={generationDisabled || !savedContext?.confirmed || contextDirty || !inventory || Boolean(inventory.canContinue) || inventory.status === 'unavailable'} variant={assessment ? 'ghost' : 'default'} onClick={() => act(assessment ? 'Checking for useful updates…' : 'Checking for useful gaps…', '/analyze', {}, result => {
            if (result.assessment) setData(previous => ({ ...previous, assessments: [result.assessment, ...(previous.assessments || []).filter(item => item.id !== result.assessment.id)] }));
            if (result.unchanged) setNotice(result.message || 'Your saved assessment is unchanged. No draft was replaced.');
          })}>{assessment ? <RefreshCw className="size-4" /> : <ArrowRight className="size-4" />}{assessment ? 'Check for updates' : 'Find useful page ideas'}</Button></div>
        {contextDirty && <p className="text-sm text-muted-foreground">Save your area and services before continuing.</p>}
      </CardContent></Card>

      {assessment && <section className="space-y-4" aria-label="Page opportunity assessment"><div><h2 className="text-xl font-semibold">Ideas for {areaLabel(assessment.context?.area)}</h2><p className="mt-2 text-sm text-muted-foreground">{assessment.summary}</p></div>
        {assessment.outcome === 'no_opportunity' && <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-5"><CheckCircle2 className="mt-1 size-5 shrink-0 text-primary" /><div><h3 className="font-semibold">No new page needed right now</h3><p className="mt-1 text-sm text-muted-foreground">Your existing coverage does not justify another page from the evidence reviewed. You can work on an existing page or choose another area.</p><Link className="mt-3 inline-block text-sm underline" href="/low-ctr">Improve an existing page</Link></div></div>}
        {assessment.outcome === 'needs_information' && <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm"><p>We need more information before suggesting a page.</p>{assessment.questions?.length > 0 ? <ul className="mt-3 list-disc space-y-2 pl-5">{assessment.questions.map((question, index) => <li key={index}>{question}</li>)}</ul> : <p className="mt-2">Review the guidance below or add business facts above, then check again.</p>}</div>}
        {(assessment.ideas || []).map((idea, index) => {
          const saved = plans.find(plan => plan.idea?.id === idea.id && areaKey(plan.context?.area) === currentArea);
          return <article key={idea.id} aria-label={idea.topic} className="space-y-4 rounded-xl border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-primary">{idea.outcome === 'new_page' ? `Page idea ${index + 1}` : idea.outcome === 'improve_existing' ? 'Already covered' : 'More information needed'}</p><h3 className="mt-1 text-lg font-semibold">{idea.topic}</h3></div>{saved?.status === 'dismissed' && <span className="text-sm text-muted-foreground">Saved for later</span>}</div><p className="text-sm">{idea.purpose || idea.reason}</p>
            {idea.searchFocus?.phrase && <p className="text-sm"><span className="text-muted-foreground">{idea.searchFocus.source === 'observed' ? 'Observed search: ' : 'Suggested search topic: '}</span>{idea.searchFocus.phrase}</p>}
            <Evidence idea={idea} research={assessment.research} />
            {idea.outcome === 'new_page' && <Button disabled={disabled} variant={saved ? 'outline' : 'default'} onClick={() => saved ? (saved.status === 'dismissed' ? act('Restoring your plan…', '/plan', { planId: saved.id, revision: saved.revision, status: 'draft' }, result => { updatePlan(result); setSelectedPlan(result.plan.id); }, 'PATCH') : openSavedPlan(saved.id)) : act('Saving your page idea…', '/select', { assessmentId: assessment.id, ideaId: idea.id }, result => { updatePlan(result); setSelectedPlan(result.plan.id); })}>{saved ? 'Open saved plan' : 'Plan this page'}<ArrowRight className="size-4" /></Button>}
            {idea.outcome === 'improve_existing' && safeLink(idea.existingPageUrl) && <Button asChild variant="outline"><Link href={`/low-ctr?page=${encodeURIComponent(idea.existingPageUrl)}`}>Improve this existing page</Link></Button>}
            {idea.requiredFacts?.length > 0 && idea.outcome !== 'new_page' && <ul className="list-disc space-y-1 pl-5 text-sm">{idea.requiredFacts.map((fact, factIndex) => <li key={factIndex}>{fact}</li>)}</ul>}
          </article>;
        })}
      </section>}

      {currentPlans.length > 0 && !contextDirty && <section aria-label="Saved page plans" className="space-y-3"><h2 className="text-xl font-semibold">Your saved page plans</h2><div className="grid gap-3 sm:grid-cols-2">{currentPlans.map(plan => <button key={plan.id} disabled={disabled} onClick={() => openSavedPlan(plan.id)} className={`min-w-0 rounded-xl border p-4 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === plan.id ? 'border-primary bg-primary/5' : 'bg-card'}`}><span className="block font-medium">{plan.idea?.topic || plan.draft?.title || 'Page plan'}</span><span className="mt-1 block text-sm text-muted-foreground">{plan.status === 'published' ? 'Published · tracking' : plan.draft || plan.hasDraft ? 'Draft saved' : 'Ready to prepare'} · {displayDate(plan.updatedAt)}</span></button>)}</div></section>}
      {selected && !contextDirty && areaKey(selected.context?.area) === currentArea && <NewPagePlan key={`${selected.id}:${selected.revision}`} plan={selected} busy={Boolean(busy)} enabled={data.enabled !== false} act={act} updatePlan={updatePlan} onDismiss={() => setSelectedPlan('')} />}
      {(data.history?.length > 0 || plans.some(plan => plan.status === 'dismissed')) && <details className="rounded-xl border p-5 text-sm"><summary className="cursor-pointer">Previous and set-aside ideas</summary><p className="mt-3 text-muted-foreground">Older opportunity records are history. Their estimated metrics and success labels are not verified results.</p>{plans.filter(plan => plan.status === 'dismissed').map(plan => <div key={plan.id} className="mt-3 flex flex-wrap items-center justify-between gap-3"><span>{plan.idea?.topic} · {areaLabel(plan.context?.area)}</span><Button variant="outline" size="sm" disabled={disabled} onClick={() => act('Restoring your plan…', '/plan', { planId: plan.id, revision: plan.revision, status: 'draft' }, result => { updatePlan(result); if (areaKey(plan.context?.area) === currentArea) setSelectedPlan(plan.id); }, 'PATCH')}>Restore plan</Button></div>)}{data.history?.map((record, index) => <HistoryEntry record={record} act={act} disabled={disabled} key={`${record.historyType || 'history'}-${record.id || index}`} />)}</details>}
    </>}
  </main>;
}
