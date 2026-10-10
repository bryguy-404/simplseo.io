"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { authenticatedFetch } from '../lib/authenticatedFetch';
import { reconnectGsc } from '../lib/reconnectGsc';
import { Button } from '@/components/ui/button';
import WebsiteRebuildGuide from '../components/dashboard/WebsiteRebuildGuide';

export default function RevampPage() {
  const { user, isLoading } = useAuth();
  const { data, isLoaded, reloadData } = useOnboarding();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('');
  const [review, setReview] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [selected, setSelected] = useState({});
  const [manualUrl, setManualUrl] = useState('');
  useEffect(() => { if (!isLoading && !user) router.replace('/auth'); }, [isLoading, user, router]);
  useEffect(() => { if (user && isLoaded && !data.isComplete) router.replace('/onboarding'); }, [user, isLoaded, data.isComplete, router]);
  const request = async (path, body = {}) => {
    const res = await authenticatedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, ...body }) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Please try again.');
    return result;
  };
  const act = async action => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const finish = () => act(async () => {
    const choices = Object.entries(selected).filter(([, keyword]) => keyword).map(([pageUrl, keyword]) => ({ pageUrl, keyword, source: 'gsc-existing' }));
    await request('/api/revamp/complete', { runId: data.revampRunId, keywords: choices });
    await reloadData(); router.push('/dashboard');
  });
  if (isLoading || !isLoaded || !user) return <p className="p-8">Loading your website setup…</p>;
  return <main className="max-w-4xl mx-auto p-6 space-y-6">
    <Link className="underline" href="/dashboard">Back to dashboard</Link>
    <h1 className="text-3xl font-semibold">Website update</h1>
    <p>Your dashboard stays available while we watch for search data. You can finish setup without keywords or a Google connection.</p>
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy} onClick={finish}>{busy ? 'Working…' : 'Save and continue to dashboard'}</Button>
      <Link className="underline self-center" href="/revamp/history">Previous website work</Link>
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <WebsiteRebuildGuide pages={data.revampPages || []} property={data.gscProperty} />
    <section className="border rounded-lg p-5 space-y-4">
      <h2 className="text-xl font-semibold">Tracked pages</h2>
      <p>A limited scan may miss pages. Existing pages and preferences remain saved until you review changes.</p>
      <Button variant="outline" disabled={busy} onClick={() => act(async () => { const r = await request('/api/revamp/crawl'); setReview(r.pages); })}>Scan for pages</Button>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex-1">Add a page URL<input type="url" className="block w-full border rounded p-2 bg-background" value={manualUrl} onChange={event => setManualUrl(event.target.value)} placeholder="https://your-website.com/page" /></label>
        <Button variant="outline" disabled={busy || !manualUrl.trim()} onClick={() => act(async () => {
          const checked = await request('/api/revamp/validate-url', { url: manualUrl.trim() });
          if (!checked.valid) throw new Error(checked.reason);
          await request('/api/revamp/pages', { runId: data.revampRunId, pages: [{ url: checked.url, finalUrl: checked.finalUrl }] });
          await reloadData(); setManualUrl('');
        })}>Add page</Button>
      </div>
      {review && <div className="space-y-3">
        <h3 className="font-semibold">Review pages to add</h3>
        {review.length === 0 && <p>No pages were found. Your existing pages remain tracked.</p>}
        {review.map(page => <label key={page.url} className="block break-all"><input type="checkbox" checked={page.keep !== false} onChange={event => setReview(items => items.map(p => p.url === page.url ? { ...p, keep: event.target.checked } : p))} /> {page.url}</label>)}
        <Button disabled={busy || !review.some(p => p.keep !== false)} onClick={() => act(async () => { await request('/api/revamp/pages', { runId: data.revampRunId, pages: review.filter(p => p.keep !== false).map(p => p.url) }); await reloadData(); setReview(null); })}>Keep selected pages</Button>
      </div>}
      <ul className="space-y-3">{(data.revampPages || []).map(value => { const page = typeof value === 'string' ? { url: value } : value; return <li key={page.url} className="border-t pt-3">
        <a href={page.url} target="_blank" rel="noreferrer" className="underline break-all">{page.url}</a>
        <p>{page.searchDataStatus === 'has_data' ? `${page.impressions} impressions · ${page.clicks} clicks` : page.searchDataStatus === 'no_data' ? 'No search data in the checked period' : 'Not checked yet'}</p>
        {page.finalUrl && page.finalUrl !== page.url && <p className="text-sm break-all">Redirects to: {page.finalUrl}</p>}
        {page.observationWindow && <p className="text-sm text-muted-foreground">{page.observationWindow.startDate} – {page.observationWindow.endDate}</p>}
        {page.lastError && <p className="text-amber-700">Latest check unavailable. Previous results are retained.</p>}
      </li>; })}</ul>
      <p className="text-sm text-muted-foreground">Search data does not confirm whether a page is indexed. No impressions is not evidence of a penalty. Recent days may not be available yet.</p>
      <Button variant="outline" disabled={busy} onClick={() => act(async () => { const result = await request('/api/revamp/check-gsc'); setConnection(result.connectionStatus); await reloadData(); })}>Check search data</Button>
      {connection === 'reconnect_required' && <p>Reconnect Google to resume checks. You can keep using the dashboard.</p>}
      {connection === 'temporarily_unavailable' && <p>Google is temporarily unavailable. Try again later.</p>}
      <Button variant="outline" disabled={busy} onClick={() => act(async () => { await reconnectGsc(data.gscProperty); setConnection('usable'); })}>Reconnect Google</Button>
    </section>
    <section className="border rounded-lg p-5 space-y-4">
      <h2 className="text-xl font-semibold">Optional focus keywords</h2>
      <p>Choose available keywords now or come back later. Skipping preserves your saved selections.</p>
      <Button variant="outline" disabled={busy} onClick={() => act(async () => { const result = await request('/api/gsc/keywords'); setKeywords(result.keywords || []); if (!result.keywords?.length) setError('No keywords are available yet. You can still continue to your dashboard.'); })}>Load available keywords</Button>
      {[...new Set(keywords.map(k => k.page))].map(page => <label key={page} className="block break-all">{page}<select className="block border rounded p-2 bg-background" value={selected[page] || ''} onChange={event => setSelected(s => ({ ...s, [page]: event.target.value }))}><option value="">Keep current selection / skip</option>{keywords.filter(k => k.page === page).map(k => <option key={k.keyword} value={k.keyword}>{k.keyword}</option>)}</select></label>)}
    </section>
  </main>;
}
