"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { reconnectGsc } from '../../lib/reconnectGsc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import BusinessProfileForm, { emptyBusinessDraft } from './BusinessProfileForm';
import GoogleSetup from './GoogleSetup';
import SetupReadiness from './SetupReadiness';

const steps = [['website', 'Your website'], ['google', 'Connect Google'], ['business', 'Your business'], ['ready', 'Get started']];
const lines = text => [...new Map(text.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(value => [value.toLowerCase(), value])).values()];
const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
const dated = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };

async function post(body, signal, path = '/api/onboarding/workspace') {
  const response = await authenticatedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'This step could not be saved. Please retry.'); error.status = response.status; throw error; }
  return result;
}

export default function OnboardingWorkspace({ existing = false }) {
  const { user, logout } = useAuth();
  const { data: legacy, setupWorkspace, setupError, refreshSetup, applySetupWorkspace, reloadData } = useOnboarding();
  const [workspace, setWorkspace] = useState(setupWorkspace);
  const [step, setStep] = useState(existing ? 'business' : 'website');
  const [website, setWebsite] = useState('');
  const [draft, setDraft] = useState(emptyBusinessDraft);
  const [servicesText, setServicesText] = useState('');
  const [areasText, setAreasText] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(!existing);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [properties, setProperties] = useState([]);
  const [pendingId, setPendingId] = useState(null);
  const [property, setProperty] = useState('');
  const generation = useRef(0);
  const controller = useRef(null);
  const working = useRef(false);
  const pendingRequest = useRef(null);
  const hydrated = useRef(false);
  const heading = useRef(null);
  const session = workspace?.session;
  const inventory = workspace?.inventory;
  const extraction = workspace?.extraction;
  const existingMode = existing || session?.mode === 'existing';

  const hydrate = useCallback(result => {
    setWorkspace(result); applySetupWorkspace(result);
    const saved = result.session?.profileDraft || result.profile?.profile || {};
    const next = { ...emptyBusinessDraft(), ...saved, baseLocation: { ...emptyBusinessDraft().baseLocation, ...saved.baseLocation } };
    setDraft(next); setServicesText((next.services || []).join('\n')); setAreasText((next.serviceAreas || []).join('\n'));
    setWebsite(result.session?.websiteUrl || result.profile?.scope?.websiteUrl || legacy.websiteUrl || '');
    setPrivacy(Boolean(result.session?.privacyPolicyAccepted || legacy.privacyPolicyAccepted));
    setAcknowledged(Boolean(result.session?.profileConfirmed)); setDirty(false);
    setStep(existing ? 'business' : result.session?.currentStep || 'website');
    setPendingId(result.session?.google?.pendingId || null);
    setProperties(result.session?.google?.properties || []);
    setProperty(result.session?.google?.property || '');
  }, [applySetupWorkspace, existing, legacy.websiteUrl, legacy.privacyPolicyAccepted]);

  useEffect(() => {
    if (!hydrated.current && setupWorkspace) { hydrated.current = true; hydrate(setupWorkspace); }
  }, [setupWorkspace, hydrate]);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);

  const change = (field, value) => { setDraft(previous => ({ ...previous, [field]: value })); setDirty(true); setAcknowledged(false); setError(''); setNotice(''); };
  const payload = () => ({ ...(website.trim() ? { websiteUrl: website.trim() } : {}), profileDraft: { ...draft, services: lines(servicesText), serviceAreas: lines(areasText) }, privacyPolicyAccepted: privacy, currentStep: step });
  const act = async (label, action, values = {}, options = {}) => {
    if (working.current) return null;
    working.current = true; const token = generation.current;
    const current = new AbortController(); controller.current = current;
    setBusy(label); setError(''); setNotice('');
    const body = { action, expectedRevision: session?.revision ?? 0, ...values };
    const signature = JSON.stringify(body);
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, id: crypto.randomUUID() };
    try {
      let result = await post({ ...body, requestId: pendingRequest.current.id }, current.signal);
      if (result.workspace) result = result.workspace;
      if (typeof result.eligible !== 'boolean') result = await refreshSetup();
      if (token !== generation.current || !result) return null;
      if (options.hydrate) hydrate(result); else { setWorkspace(result); applySetupWorkspace(result); }
      pendingRequest.current = null; setConflict(false); return result;
    } catch (failure) { if (token === generation.current && failure.name !== 'AbortError') { setError(failure.message); setConflict(failure.status === 409); } return null; }
    finally { if (token === generation.current) { working.current = false; setBusy(''); } }
  };
  const save = async (nextStep = step) => {
    if (lines(servicesText).length > 12 || lines(areasText).length > 30) { setError('Keep up to 12 services and 30 service areas. Remove extra lines before saving.'); return null; }
    const result = await act('Saving your details…', 'save', { ...payload(), currentStep: nextStep });
    if (result) { setWebsite(result.session?.websiteUrl || website); setDirty(false); setStep(nextStep); setNotice('Your draft is saved. You can come back to it later.'); }
    return result;
  };
  const begin = async () => {
    const result = await act('Opening your saved setup…', 'begin', { legacyDraft: {
      businessName: legacy.businessName, businessType: legacy.customBusinessType || legacy.businessType, cmsPlatform: legacy.cmsPlatform,
      baseLocation: { city: legacy.baseLocation?.city || legacy.businessLocation || '', region: legacy.baseLocation?.region || '', country: legacy.baseLocation?.country || '' },
      services: legacy.services || [], serviceAreas: legacy.serviceAreas?.length ? legacy.serviceAreas : legacy.serviceCities || [], goal: legacy.goal || '',
    } }, { hydrate: true });
    if (result) setEditing(true);
  };
  const confirm = async () => {
    if (!acknowledged) return;
    if (lines(servicesText).length > 12 || lines(areasText).length > 30) { setError('Keep up to 12 services and 30 service areas. Remove extra lines before confirming.'); return; }
    const result = await act('Confirming your business details…', 'confirmProfile', { ...payload(), confirmed: true, currentStep: existingMode ? 'business' : 'ready' });
    if (result) { setDirty(false); setNotice('Your business details are confirmed.'); if (existingMode) { setEditing(false); await reloadData(); } else setStep('ready'); }
  };
  const connect = async () => {
    if (working.current) return;
    working.current = true; const token = generation.current;
    setBusy('Waiting for Google…'); setError(''); setNotice('');
    try {
      // The helper opens its popup synchronously from this click handler.
      const result = await reconnectGsc(undefined, { sessionRevision: session.revision });
      if (token !== generation.current) return;
      setPendingId(result.pendingId || null); setProperties(result.properties || []); setProperty('');
      const stored = await refreshSetup();
      if (token === generation.current && stored) { setWorkspace(stored); if (!result.properties?.length) setProperties(stored.session?.google?.properties || []); }
      if (!result.properties?.length) setNotice('No matching website was returned. Check the Google account and property access, then try again.');
    } catch (failure) { if (token === generation.current) setError(failure.message); }
    finally { if (token === generation.current) { working.current = false; setBusy(''); } }
  };
  const selectProperty = async () => {
    if (working.current) return;
    working.current = true; const token = generation.current; setBusy('Checking your website connection…'); setError('');
    const current = new AbortController(); controller.current = current;
    try {
      await post({ pendingId, property, sessionRevision: session.revision }, current.signal, '/api/gsc/select');
      const stored = await refreshSetup();
      if (token === generation.current && stored) { setWorkspace(stored); setProperties([]); setPendingId(null); setStep('business'); setNotice('Your website is selected. Confirm your business details next.'); }
    } catch (failure) { if (token === generation.current && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (token === generation.current) { working.current = false; setBusy(''); } }
  };
  const refreshProperties = async () => {
    const activePendingId = pendingId || session?.google?.pendingId;
    if (working.current || !activePendingId) return;
    working.current = true; const token = generation.current;
    const current = new AbortController(); controller.current = current;
    setBusy('Refreshing your Google websites…'); setError(''); setNotice('');
    try {
      const response = await authenticatedFetch(`/api/gsc/properties?pendingId=${encodeURIComponent(activePendingId)}`, { signal: current.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Your Google websites could not be refreshed. Please retry.');
      if (token !== generation.current) return;
      const nextProperties = result.properties || [];
      setProperties(nextProperties);
      setProperty(previous => nextProperties.some(item => (typeof item === 'string' ? item : item.siteUrl || item.property) === previous && item.matchesWebsite !== false) ? previous : '');
      const stored = await refreshSetup();
      if (token === generation.current && stored) { setWorkspace(stored); setNotice('Your Google website list is refreshed.'); }
    } catch (failure) { if (token === generation.current && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (token === generation.current) { working.current = false; setBusy(''); } }
  };
  const applySuggestions = () => {
    if (!extraction) return;
    // Fill empty fields only; observed evidence is never an owner confirmation.
    setDraft(previous => ({ ...previous, businessName: previous.businessName || extraction.businessName?.value || '', businessType: previous.businessType || extraction.businessType?.value || '' }));
    if (!servicesText.trim()) setServicesText((extraction.services || []).map(item => item.value).filter(Boolean).join('\n'));
    setDirty(true); setAcknowledged(false); setError(''); setNotice('Suggestions filled the empty fields. Review them before confirming.');
  };
  const complete = async () => {
    const saved = await save('ready');
    if (!saved) return;
    const result = await act('Finishing your website setup…', 'complete', { expectedRevision: saved.session.revision });
    if (result) await reloadData();
  };
  const reload = async () => {
    if (dirty && !window.confirm('Reload the saved setup and discard your unsaved edits?')) return;
    setBusy('Loading your saved setup…'); setError('');
    try { const result = await refreshSetup(); if (result) { hydrate(result); setConflict(false); } } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };

  if (!workspace) return <div className="space-y-3"><p role={setupError ? 'alert' : 'status'}>{setupError || 'Loading your saved setup…'}</p>{setupError && <Button onClick={reload}>Retry loading setup</Button>}</div>;
  if (!workspace.eligible && !workspace.pinned) return existing ? <p className="text-sm text-muted-foreground">Your current business details remain saved. Guided profile editing will be available here when enabled for your account.</p> : null;
  const profile = workspace.profile;
  const hasConfirmedProfile = Boolean(profile?.confirmedAt || profile?.status === 'confirmed' || session?.profileConfirmed);
  const googleReady = Boolean(session?.google?.property && ['selected', 'connected', 'validated', 'ready'].includes(session.google.status));
  const canFinish = Boolean(session?.profileConfirmed && googleReady && privacy && !dirty);
  const pages = inventory?.pages || [];
  const reviewed = inventory?.coverage?.fetched ?? pages.filter(page => page.status === 'fetched').length;

  return <div className="space-y-6" aria-busy={Boolean(busy)}>
    <header className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-primary font-semibold">{existingMode ? 'Business profile' : 'Welcome to SimplSEO'}</p><h1 className="text-2xl sm:text-3xl font-semibold mt-2">{existingMode ? 'Your business details' : 'Let’s get your website ready'}</h1><p className="text-muted-foreground mt-2 text-sm">{existingMode ? 'Keep the facts used for future recommendations accurate.' : 'Connect your website, confirm your business, then choose a page to improve.'}</p></div>{!existingMode && <Button variant="ghost" onClick={logout}>Sign out</Button>}</header>
    {(error || notice || busy) && <div className={`rounded-md border p-4 text-sm ${error ? 'border-amber-500/50' : ''}`}><p role={error ? 'alert' : 'status'}>{error || busy || notice}</p>{conflict && <Button className="mt-3" variant="outline" onClick={reload} disabled={Boolean(busy)}>Reload saved setup</Button>}</div>}
    {!session || (existingMode && !editing) ? <Card><CardContent className="space-y-4 pt-6">{hasConfirmedProfile ? <><p className="font-medium">{profile?.profile?.businessName || session?.profileDraft?.businessName || legacy.businessName}</p><p className="text-sm text-muted-foreground">Confirmed {dated(profile?.confirmedAt || session?.profileConfirmedAt)}. Your saved plans and tracking dates stay in place.</p></> : <p className="text-sm">Review the details we have and add anything that’s missing. You can save your draft and return later.</p>}<Button disabled={Boolean(busy)} onClick={begin}>{existingMode ? hasConfirmedProfile ? 'Edit business details' : 'Review business details' : 'Get started'}</Button></CardContent></Card> : <>
      {!existingMode && <nav aria-label="Website setup steps"><ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">{steps.map(([id, label], index) => <li key={id}><button type="button" disabled={Boolean(busy)} aria-label={`${index + 1}. ${label}`} aria-current={step === id ? 'step' : undefined} onClick={() => { setStep(id); setError(''); }} className={`w-full rounded-md border px-3 py-3 text-left text-sm ${step === id ? 'border-primary bg-primary/5 font-semibold' : 'text-muted-foreground'}`}><span className="mr-2">{index + 1}.</span>{label}</button></li>)}</ol></nav>}
      <Card><CardHeader><CardTitle><h2 ref={heading} tabIndex={-1} className="outline-none text-xl">{existingMode ? 'Confirm what your business offers' : steps.find(([id]) => id === step)?.[1]}</h2></CardTitle></CardHeader><CardContent className="space-y-5">
        {!existingMode && step === 'website' && <form className="space-y-4" onSubmit={event => { event.preventDefault(); save('google'); }}><div className="space-y-2"><Label htmlFor="setup-website">Website address</Label><Input id="setup-website" value={website} onChange={event => { setWebsite(event.target.value); setDirty(true); setError(''); }} required inputMode="url" placeholder="https://yourwebsite.com" autoComplete="url" /><p className="text-sm text-muted-foreground">Use the public website you want to improve.</p></div><Button disabled={Boolean(busy)}>Save website and continue</Button></form>}
        {!existingMode && step === 'google' && <GoogleSetup google={session.google} properties={properties} property={property} onPropertyChange={setProperty} onConnect={connect} onSelect={selectProperty} onRefresh={refreshProperties} canRefresh={Boolean(pendingId || session.google?.pendingId)} onContinue={() => setStep('business')} busy={Boolean(busy)} websiteSaved={Boolean(session.websiteUrl) && website.trim() === session.websiteUrl} />}
        {(existingMode || step === 'business') && <>
          <div className="rounded-md border p-4 space-y-3"><div><p className="font-medium text-sm">Start with your website’s information</p><p className="mt-1 text-sm text-muted-foreground">{inventory ? `${reviewed} pages reviewed${inventory.coverage?.partial || inventory.coverage?.status === 'partial' ? ' · some pages still need checking' : ''}. These are SimplSEO website checks, not Google indexing results.` : 'We can review your current website to help fill in these details.'}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(busy) || !session.websiteUrl} onClick={() => act('Reviewing your website…', 'review', { restart: Boolean(inventory && !inventory.canContinue) })}>{inventory?.canContinue ? 'Continue website review' : inventory ? 'Refresh website review' : 'Review website'}</Button>{reviewed > 0 && <Button variant="outline" disabled={Boolean(busy) || !googleReady || workspace.extractionEnabled === false} onClick={() => act('Finding business details…', 'extract')}>Find business details</Button>}</div>
            {!googleReady && <p className="text-sm text-muted-foreground">Connect Google to fill business details automatically. You can enter and save them below now.</p>}
            {workspace.extractionEnabled === false && <p className="text-sm text-muted-foreground">Automatic business suggestions are paused. You can still enter, save, and confirm your business details.</p>}
            {extraction && <div className="space-y-3 border-t pt-3"><p className="text-sm">Website suggestions need your review. Existing text in this form will stay as you wrote it.</p><Button variant="outline" disabled={Boolean(busy)} onClick={applySuggestions}>Fill empty fields from website</Button><details className="text-sm"><summary className="cursor-pointer">What we found and where</summary><ul className="space-y-2 mt-3">{[extraction.businessName, extraction.businessType, ...(extraction.services || []), ...(extraction.locations || [])].filter(Boolean).map((item, index) => <li key={index}><span>{item.value}</span>{item.evidence?.map((source, sourceIndex) => safeUrl(source.url) && <a key={sourceIndex} className="ml-2 underline break-all" href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer">Source {sourceIndex + 1}</a>)}</li>)}</ul>{(extraction.questions || []).map((question, index) => <p className="mt-2" key={index}>{typeof question === 'string' ? question : question.question}</p>)}</details></div>}
          </div>
          <BusinessProfileForm value={draft} servicesText={servicesText} areasText={areasText} onChange={change} onServicesChange={value => { setServicesText(value); setDirty(true); setAcknowledged(false); setError(''); }} onAreasChange={value => { setAreasText(value); setDirty(true); setAcknowledged(false); setError(''); }} confirmed={acknowledged} onConfirmedChange={setAcknowledged} onSave={() => save()} onConfirm={confirm} busy={Boolean(busy)} />
          {existingMode && <p className="text-sm text-muted-foreground">Website: {session.websiteUrl}. To change the website itself, use Website setup instead of editing these business details.</p>}
        </>}
        {!existingMode && step === 'ready' && <SetupReadiness readiness={workspace.readiness} session={session} inventory={inventory} reviewed={reviewed} googleReady={googleReady} privacy={privacy} onPrivacyChange={value => { setPrivacy(value); setError(''); }} busy={Boolean(busy)} canFinish={canFinish} onCheck={() => act('Checking your website setup…', 'readiness')} onComplete={complete} onStep={setStep} />}
      </CardContent></Card>
    </>}
    {!existingMode && session && <p className="text-xs text-muted-foreground">Saved details stay with your account. Publishing website changes and requesting Google indexing remain your choice.</p>}
  </div>;
}
