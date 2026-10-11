"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, LoaderCircle, MapPin, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import NewPagePlan from './NewPagePlan';
import { areaKey, areaLabel, contextKey, displayDate, fieldClass, safeLink } from './shared';

async function request(path = '', body, signal, method = 'POST') {
  const response = await authenticatedFetch(`/api/new-page-plans${path}`, body === undefined ? { signal } : {
    method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'We couldn’t finish this step. Your saved work is unchanged.');
    error.details = { ...result, status: response.status };
    throw error;
  }
  return result;
}

function websiteCheckLabel(page) {
  if (page.status === 'retired') return 'Marked as removed by you';
  if (page.reason === 'http_404') return 'Page not found (404)';
  if (page.reason === 'http_410') return 'Page removed (410)';
  if (page.reason === 'robots_disallowed') return 'Website rules block our review';
  if (page.reason === 'redirect_outside_scope') return 'Couldn’t follow this link within the connected website';
  if (page.reason === 'no_readable_html') return 'No readable page text found';
  if (['non_html_response', 'non_html_resource', 'file_extension'].includes(page.reason)) return 'Skipped — not a website page';
  if (['fetched', 'reviewed', 'available'].includes(page.status)) return 'Page read';
  if (['pending', 'unreviewed'].includes(page.status)) return 'Not reviewed yet';
  if (/^http_\d{3}$/.test(page.reason || '')) return `Website returned an error (${page.reason.slice(5)})`;
  return 'Couldn’t read this page — try again';
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
  const [resolution, setResolution] = useState(null);
  const [resolutionConfirmed, setResolutionConfirmed] = useState(false);
  const [resolutionError, setResolutionError] = useState('');
  const [resolutionConflict, setResolutionConflict] = useState(false);
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
    setBusy(''); setData(null); setError(''); setNotice(''); setNearby([]); setSelectedPlan(''); setResolution(null); setResolutionConfirmed(false); setResolutionError(''); setResolutionConflict(false);
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
      if (path === '/context' || path === '/inventory' || path === '/inventory/retire') result.workspace = await request('', undefined, current.signal);
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
    // A comma is valid business wording, not another service. The textarea's
    // visible lines are the entries the owner reviews and confirms.
    const seen = new Set();
    const serviceList = services.split(/\r\n?|\n/).map(value => value.trim()).filter(value => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (!confirmed) { setError('Check the box to confirm you offer these services in this area.'); return; }
    if (!serviceList.length) { setError('Add at least one service, with one service per line.'); return; }
    if (serviceList.length > 12) { setError('Choose up to 12 services for this area. Put each service on its own line; locations belong in the fields above.'); return; }
    if (serviceList.some(value => value.length > 120 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(value))) {
      setError('Use plain service names, up to 120 characters per line.'); return;
    }
    act('Saving your area…', '/context', { area, services: serviceList, facts, confirmed }, result => {
      setData(previous => ({ ...previous, ...result.workspace, context: result.context, contexts: [result.context,
        ...[...(result.workspace?.contexts || []), previous.context, ...(previous.contexts || [])].filter(context => context && areaKey(context.area) !== areaKey(result.context.area)),
      ] })); fillContext(result.context); setSelectedPlan('');
      setNotice('Area saved. Your other areas and plans are still available.');
    });
  };
  const applyInventoryWorkspace = workspace => setData(previous => ({ ...previous,
    inventory: workspace.inventory, business: workspace.business || previous.business, assessments: workspace.assessments || [],
  }));
  const openResolution = (page, action) => {
    setResolution({ urls: [page.url || page.pageUrl], action, inventoryRevision: data.inventory.revision });
    setResolutionConfirmed(false); setResolutionError(''); setResolutionConflict(false);
  };
  const confirmResolution = async () => {
    if (!resolution || !resolutionConfirmed) return;
    setResolutionError(''); setResolutionConflict(false);
    const restoring = resolution.action === 'restore';
    const result = await act(restoring ? 'Restoring this page for review…' : 'Saving your removed-page confirmation…', '/inventory/retire', { ...resolution, confirmed: true }, response => {
      applyInventoryWorkspace(response.workspace); setResolution(null); setResolutionConfirmed(false);
      setNotice(restoring ? 'Page restored for review. Continue website review to check it again.' : response.inventory?.canContinue ? 'Page marked as removed. Continue website review, then check for updates.' : 'Page marked as removed. Check for updates to assess your current pages.');
    });
    if (result?.failed) { setResolutionError(result.error || 'We couldn’t save this change. Your website has not changed.'); setResolutionConflict(result.status === 409); }
  };
  const changeArea = next => { setArea(next); setConfirmed(false); setContextDirty(true); setNotice(''); setError(''); };
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
  const activeInventoryPages = inventoryPages.filter(page => page.status !== 'retired');
  const retiredPages = inventoryPages.filter(page => page.status === 'retired');
  const reviewed = activeInventoryPages.filter(page => ['fetched', 'reviewed', 'available'].includes(page.status) || page.content).length;
  const pagesToCheck = activeInventoryPages.filter(page => !['fetched', 'reviewed', 'available'].includes(page.status)
    && !['non_html_response', 'non_html_resource', 'file_extension'].includes(page.reason));
  const hasMissingPages = pagesToCheck.some(page => ['http_404', 'http_410'].includes(page.reason));
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
          <label className="block space-y-2 text-sm"><span>Services offered here</span><textarea required disabled={disabled} className={fieldClass} rows={3} maxLength={1600} value={services} aria-describedby="service-list-help" onChange={event => { setServices(event.target.value); setConfirmed(false); setContextDirty(true); setError(''); }} placeholder="One service per line, such as website design" /></label>
          <p id="service-list-help" className="text-xs text-muted-foreground">Review these suggestions. Keep one service per line, up to 12. Locations go in the fields above.</p>
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Add helpful business facts (optional)</summary><label className="mt-3 block space-y-2"><span>What should we know about your work in this area?</span><textarea disabled={disabled} className={fieldClass} rows={3} maxLength={6000} value={facts} onChange={event => { setFacts(event.target.value); setContextDirty(true); setError(''); }} placeholder="Actual service availability, projects, process or other facts we can use." /></label></details>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={confirmed} disabled={disabled} onChange={event => { setConfirmed(event.target.checked); setContextDirty(true); setError(''); }} /><span>My business offers these services in this area.</span></label>
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={disabled || !confirmed || !services.trim()}><MapPin className="size-4" />{savedContext && !contextDirty ? 'Area saved' : 'Save this area'}</Button><Button type="button" variant="ghost" disabled={generationDisabled || !savedContext?.confirmed || contextDirty} onClick={() => act('Looking for nearby areas…', '/areas', {}, result => { setNearby(result.areas || []); if (!result.areas?.length) setNotice('No supported nearby areas found. You can enter an area you serve.'); })}>Suggest nearby areas</Button></div>
        </form>
        {nearby.length > 0 && <div className="space-y-3 border-t pt-4"><p className="text-sm text-muted-foreground">Choose only an area your business serves.</p>{nearby.map((candidate, index) => <div key={`${areaLabel(candidate)}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0 text-sm"><p className="font-medium">{areaLabel(candidate)}</p><p className="text-muted-foreground">{candidate.reason}</p>{safeLink(candidate.sourceUrl) && <a className="underline" href={safeLink(candidate.sourceUrl)} target="_blank" rel="noopener noreferrer">Source</a>}</div><Button size="sm" variant="outline" disabled={disabled} onClick={() => { changeArea({ name: candidate.name, region: candidate.region, country: candidate.country }); setNearby([]); setSelectedPlan(''); }}>Choose this area</Button></div>)}</div>}
      </CardContent></Card>

      <Card><CardContent className="space-y-4 pt-6"><div><h2 className="text-lg font-semibold">2. Check what your website already covers</h2><p className="mt-1 text-sm text-muted-foreground">We review existing pages before suggesting another one—including pages without Google traffic.</p></div>
        {inventory && <div className="rounded-lg border p-4 text-sm"><p className="font-medium">{inventory.status === 'ready' ? 'Website review saved' : inventory.status === 'unavailable' ? 'Website review unavailable' : 'Website review is partial'}</p><p className="mt-1 text-muted-foreground">{inventoryPages.length} links found · {reviewed} pages read{pagesToCheck.length ? ` · ${pagesToCheck.length} to check` : ''}{retiredPages.length ? ` · ${retiredPages.length} marked removed` : ''}. {inventory.canContinue ? 'Continue reviewing before checking for gaps.' : 'We may not have found every page on your website.'}</p>{inventory.updatedAt && <p className="mt-1 text-xs text-muted-foreground">Checked {displayDate(inventory.updatedAt)}</p>}
          {pagesToCheck.length > 0 && <section id="website-pages-to-check" aria-label="Pages to check" className="mt-4 space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <h3 className="font-medium">Check these links before adding a page</h3>
            <p>We couldn’t finish reading these pages. They may already cover a topic we would otherwise suggest.</p>
            <details><summary className="cursor-pointer font-medium">View {pagesToCheck.length} links to check</summary><ul className="mt-3 max-h-64 space-y-3 overflow-y-auto">{pagesToCheck.map((page, index) => <li key={`${page.url || page.pageUrl}-${index}`}>
              {safeLink(page.url || page.pageUrl) ? <a className="block break-all underline" target="_blank" rel="noopener noreferrer" href={safeLink(page.url || page.pageUrl)}>{page.url || page.pageUrl}</a> : <span className="break-all">{page.url || page.pageUrl}</span>}
              <span className="mt-1 block text-muted-foreground">{websiteCheckLabel(page)}</span>
              {page.status === 'failed' && ['http_404', 'http_410'].includes(page.reason) && <Button type="button" size="sm" variant="outline" className="mt-2" disabled={disabled} onClick={() => openResolution(page, 'retire')}>This page was removed</Button>}
            </li>)}</ul></details>
            {hasMissingPages && <p>For a “page not found” link: if the page should exist, check its address in your website builder. If you intentionally removed it, mark it as removed here and check for old links in your website and sitemap.</p>}
            <p>{inventory.canContinue ? 'Click Continue website review to read the next pages.' : `After checking the links, click Refresh website review, then ${assessment ? 'Check for updates' : 'Find useful page ideas'}. If a page opens for you but we still can’t read it, it needs further inspection.`}</p>
            <p className="text-xs text-muted-foreground">These are SimplSEO website checks, not Google indexing results.</p>
          </section>}
          {retiredPages.length > 0 && <details className="mt-3"><summary className="cursor-pointer">Removed pages ({retiredPages.length})</summary><p className="mt-3 text-muted-foreground">You confirmed these pages are no longer needed. They are left out of new-page planning.</p><ul className="mt-3 space-y-3">{retiredPages.map(page => <li key={page.url || page.pageUrl} className="rounded-lg border p-3">{safeLink(page.url || page.pageUrl) && <a className="block break-all underline" href={safeLink(page.url || page.pageUrl)} target="_blank" rel="noopener noreferrer">{page.url || page.pageUrl}</a>}<span className="mt-1 block text-muted-foreground">{websiteCheckLabel(page)}</span><Button type="button" size="sm" variant="ghost" className="mt-2" disabled={disabled} onClick={() => openResolution(page, 'restore')}>Restore for review</Button></li>)}</ul></details>}
          {inventory.coverage?.limitations?.length > 0 && <details className="mt-3"><summary className="cursor-pointer">What this review can tell us</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">{inventory.coverage.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>}
          {activeInventoryPages.length > 0 && <details className="mt-3"><summary className="cursor-pointer">View reviewed pages</summary><ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">{activeInventoryPages.map((page, index) => <li className="flex flex-wrap gap-2 break-all" key={`${page.url || page.pageUrl}-${index}`}>{safeLink(page.url || page.pageUrl) ? <a className="underline" target="_blank" rel="noopener noreferrer" href={safeLink(page.url || page.pageUrl)}>{page.title || page.url || page.pageUrl}</a> : <span>{page.url || page.pageUrl}</span>}<span className="text-muted-foreground">{websiteCheckLabel(page)}</span></li>)}</ul></details>}
        </div>}
        <div className="flex flex-wrap gap-3"><Button variant={inventory ? 'outline' : 'default'} disabled={disabled} onClick={() => act('Reviewing your website…', '/inventory', inventory?.canContinue ? {} : { restart: Boolean(inventory) }, result => {
            setData(previous => ({ ...previous, inventory: result.inventory, business: result.workspace?.business || previous.business, assessments: result.workspace?.assessments || previous.assessments }));
            if (!services.trim() && !savedContext) {
              const observed = result.workspace?.business?.services || [];
              if (observed.length) { setServices([...new Set(observed)].join('\n')); setContextDirty(true); }
            }
          })}><Search className="size-4" />{inventory?.canContinue ? 'Continue website review' : inventory ? 'Refresh website review' : 'Review my website'}</Button>
          <Button disabled={generationDisabled || !savedContext?.confirmed || contextDirty || !inventory || Boolean(inventory.canContinue) || inventory.status === 'unavailable'} variant={assessment ? 'ghost' : 'default'} onClick={() => act(assessment ? 'Checking for useful updates…' : 'Checking for useful gaps…', '/analyze', {}, result => {
            if (result.assessment) setData(previous => ({ ...previous, assessments: [result.assessment, ...(previous.assessments || []).filter(item => item.id !== result.assessment.id)] }));
            if (result.unchanged) setNotice(result.message || 'Your saved assessment is unchanged. No draft was replaced.');
          })}>{assessment ? <RefreshCw className="size-4" /> : <ArrowRight className="size-4" />}{assessment ? 'Check for updates' : 'Find useful page ideas'}</Button></div>
        {contextDirty && <p className="text-sm text-muted-foreground">Save your area and services before continuing.</p>}
      </CardContent></Card>

      {assessment?.coverageChanged && <section aria-label="Updated website review" className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-5"><h2 className="font-semibold">Website review updated</h2><p className="text-sm text-muted-foreground">{inventory?.canContinue ? 'Continue website review, then use Check for updates to assess your current pages.' : 'Use Check for updates above to assess your current pages.'} Your saved plans stay available.</p></section>}
      {assessment && !assessment.coverageChanged && <section className="space-y-4" aria-label="Page opportunity assessment"><div><h2 className="text-xl font-semibold">Ideas for {areaLabel(assessment.context?.area)}</h2><p className="mt-2 text-sm text-muted-foreground">{assessment.summary}</p></div>
        {assessment.outcome === 'no_opportunity' && <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-5"><CheckCircle2 className="mt-1 size-5 shrink-0 text-primary" /><div><h3 className="font-semibold">No new page needed right now</h3><p className="mt-1 text-sm text-muted-foreground">Your existing coverage does not justify another page from the evidence reviewed. You can work on an existing page or choose another area.</p><Link className="mt-3 inline-block text-sm underline" href="/low-ctr">Improve an existing page</Link></div></div>}
        {assessment.outcome === 'needs_information' && <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm"><p>{pagesToCheck.length ? 'Check the existing pages before we suggest another one.' : 'We need more information before suggesting a page.'}</p>{pagesToCheck.length > 0 && <a className="mt-2 inline-block underline" href="#website-pages-to-check">See the links to check</a>}{assessment.questions?.length > 0 ? <ul className="mt-3 list-disc space-y-2 pl-5">{assessment.questions.map((question, index) => <li key={index}>{question === 'Check the unreadable or unreviewed pages in Website coverage, then refresh the inventory.' ? 'Open the links listed in your website review above. After checking them, refresh the website review and check for updates.' : question}</li>)}</ul> : !pagesToCheck.length && <p className="mt-2">Review the guidance below or add business facts above, then check again.</p>}</div>}
        {(assessment.ideas || []).map((idea, index) => {
          const saved = plans.find(plan => plan.idea?.id === idea.id && areaKey(plan.context?.area) === currentArea);
          return <article key={idea.id} aria-label={idea.topic} className="space-y-4 rounded-xl border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-primary">{idea.outcome === 'new_page' ? `Page idea ${index + 1}` : idea.outcome === 'improve_existing' ? 'Already covered' : 'More information needed'}</p><h3 className="mt-1 text-lg font-semibold">{idea.topic}</h3></div>{saved?.status === 'dismissed' && <span className="text-sm text-muted-foreground">Saved for later</span>}</div>
            {idea.outcome === 'improve_existing' && <p className="text-sm text-muted-foreground">You already have a page about this topic. Review it for improvements instead of creating a similar page.</p>}
            <p className="text-sm">{idea.purpose || idea.reason}</p>
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
    <Dialog open={Boolean(resolution)} onOpenChange={open => { if (!busy && !open) setResolution(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{resolution?.action === 'restore' ? 'Review this page again?' : 'Mark this page as removed?'}</DialogTitle><DialogDescription>{resolution?.action === 'restore' ? 'Return this address to your website review. Continue the review afterward to check whether it is available again.' : 'Confirm only if you intentionally removed this page and no longer need it. SimplSEO will leave this address out of the pages that need checking.'} This changes your planning record only. It does not delete, edit or publish anything on your website.</DialogDescription></DialogHeader>{resolution?.urls.map(url => <p key={url} className="break-all text-sm">{url}</p>)}{resolutionError && <p role="alert" className="text-sm text-destructive">{resolutionError}</p>}<label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={resolutionConfirmed} disabled={disabled} onChange={event => setResolutionConfirmed(event.target.checked)} /><span>{resolution?.action === 'restore' ? 'Include this address in my website review again.' : 'I intentionally removed this page and no longer need it.'}</span></label>{resolutionConflict && <Button variant="outline" disabled={disabled} onClick={() => act('Loading the latest saved review…', '', undefined, workspace => { applyInventoryWorkspace(workspace); setResolution(null); setNotice('Latest website review loaded. Check the page before confirming again.'); })}>Reload saved review</Button>}<DialogFooter><Button variant="outline" disabled={disabled} onClick={() => setResolution(null)}>Cancel</Button><Button disabled={disabled || !resolutionConfirmed || resolutionConflict} onClick={confirmResolution}>{busy ? 'Saving…' : resolution?.action === 'restore' ? 'Restore page' : 'Mark as removed'}</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
