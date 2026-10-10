"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const stateLabels = { ready: 'Comparison available', collecting: 'Collecting data', insufficient_data: 'Not enough data', error: 'Check unavailable', paused: 'Review paused' };
const reasons = {
  account_review_required: 'Progress reviews are paused for this website update. Search monitoring and dashboard access remain available.',
  awaiting_verified_observations: 'A dated comparison has not been collected yet.',
  waiting_for_complete_post_window: 'Waiting for 28 complete days after your change, plus time for Google to finalize reporting.',
  not_enough_search_activity: 'There is not enough search activity to draw a useful comparison yet. This is not a poor performance score.',
  baseline_outside_available_history: 'The earlier period is outside the available Search Console history.',
  implementation_date_or_page_missing: 'The saved change is missing its page or confirmation date.',
  reconnect_required: 'Reconnect Google from website setup to resume checks.',
  search_data_unavailable: 'Google data could not be loaded. Previous observations are preserved with their original dates.',
};
const metric = (value, percent = false) => value == null ? '—' : percent ? `${(value * 100).toFixed(2)}%` : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PageProgress({ onResult }) {
  const { user } = useAuth();
  const { data } = useOnboarding();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const invalidateRequests = useCallback(() => { sequence.current++; }, []);
  const load = useCallback(async (refresh = false) => {
    if (!user?.id) return;
    const attempt = ++sequence.current;
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch('/api/progress', { method: refresh ? 'POST' : 'GET' });
      const body = await response.json();
      if (attempt !== sequence.current) return;
      if (!response.ok) throw new Error(body.error || 'Unable to load progress. Please try again.');
      setResult(body);
    } catch (failure) { if (attempt === sequence.current) setError(failure.message); }
    finally { if (attempt === sequence.current) setBusy(false); }
  }, [user?.id]);
  useEffect(() => { setResult(null); load(); return invalidateRequests; }, [load, invalidateRequests, data.gscProperty, data.revampRunId]);
  useEffect(() => { onResult?.(result); }, [result, onResult]);
  useEffect(() => {
    const reload = () => load();
    window.addEventListener('seo-implementation-changed', reload);
    return () => window.removeEventListener('seo-implementation-changed', reload);
  }, [load]);

  return <Card id="page-progress" className="mb-6 scroll-mt-6">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle role="heading" aria-level={2}>Page progress</CardTitle>
        <Button variant="outline" onClick={() => load(true)} disabled={busy || result?.paused || !result?.records?.length}>
          {busy ? 'Checking…' : 'Check progress'}
        </Button>
      </div>
      <CardDescription>See what happens after the changes you make to your current website.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!result && !error && <p role="status">Loading progress…</p>}
      {result?.paused && <p role="status">{reasons.account_review_required}</p>}
      {result && !result.records?.length && <div className="rounded-lg border border-dashed p-5 space-y-2"><p className="font-medium">Ready for your first change</p><p className="text-sm text-muted-foreground">No current changes are being tracked. After editing a page on your website, confirm it in the page review to start tracking. Previous website work stays separate.</p><Link className="inline-block underline text-sm" href="/low-ctr">Choose a page to review</Link></div>}
      {(result?.records || []).map(record => {
        const assessment = record.assessment || {};
        const { baseline, post, windows, comparison } = assessment;
        return <div key={record.id} className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2">
            <a className="underline break-all" href={record.pageUrl} target="_blank" rel="noopener noreferrer">{record.pageUrl}</a>
            <span className="text-sm font-medium">{stateLabels[assessment.state] || 'Not checked yet'}</span>
          </div>
          {record.implementedAt && <p className="text-sm text-muted-foreground">Change confirmed {record.implementedAt.length === 10 ? record.implementedAt : new Date(record.implementedAt).toLocaleDateString()}.</p>}
          {reasons[assessment.reason] && <p className="text-sm text-muted-foreground">{reasons[assessment.reason]}</p>}
          {windows && <p className="text-sm text-muted-foreground">Before: {windows.baseline.startDate} – {windows.baseline.endDate}<br />After: {windows.post.startDate} – {windows.post.endDate} · Dates use Pacific time.</p>}
          {baseline && post && <div className="overflow-x-auto"><table className="w-full text-sm">
            <caption className="text-left text-muted-foreground pb-2">Reported search activity{assessment.state === 'error' ? ' · last successful observations' : ''}</caption>
            <thead><tr className="border-b"><th scope="col" className="text-left py-2">Metric</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{[['Impressions', 'impressions'], ['Clicks', 'clicks'], ['Click-through rate', 'ctr'], ['Average position', 'position']].map(([label, key]) => <tr key={key} className="border-b"><th scope="row" className="text-left py-2 font-normal">{label}</th><td className="text-center">{metric(baseline[key], key === 'ctr')}</td><td className="text-center">{metric(post[key], key === 'ctr')}</td></tr>)}</tbody>
          </table></div>}
          {assessment.state === 'ready' && comparison && <p className="text-sm">Click change: {comparison.clicksDelta > 0 ? '+' : ''}{metric(comparison.clicksDelta)}{comparison.clicksPercent == null ? ' · Percentage change unavailable because the earlier period had zero clicks.' : ` (${comparison.clicksPercent > 0 ? '+' : ''}${comparison.clicksPercent.toFixed(1)}%)`}</p>}
          {(baseline?.fetchedAt || post?.fetchedAt) && <p className="text-xs text-muted-foreground">Observed {new Date(post?.fetchedAt || baseline.fetchedAt).toLocaleString()} · {assessment.property}</p>}
        </div>;
      })}
      {result && <details className="text-sm border-t pt-3"><summary className="cursor-pointer text-muted-foreground">How progress is measured</summary><div className="mt-3 space-y-2 text-muted-foreground"><p>We compare Google Search Console observations from 28 days before and 28 days after a confirmed change. The day of the change is excluded, and recent reporting needs time to settle.</p><p>A comparison needs at least {result.policy?.minImpressionsPerWindow || 100} impressions in each period and {result.policy?.minCombinedClicks || 10} clicks combined. Low activity can leave this fixed comparison inconclusive even after more time passes.</p><p>These are display thresholds, not a statistical test. Changes in traffic do not prove that your edits caused them. Automatic success, pivot and audit decisions remain off.</p><Link className="underline" href="/revamp/history">Previous website work</Link></div></details>}
    </CardContent>
  </Card>;
}
