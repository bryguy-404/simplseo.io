"use client";

import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Eye, Minus, MousePointer2, Search } from 'lucide-react';
import { progressTimeline, resultMetrics } from '../../lib/progressPresentation';

export const progressDate = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unavailable';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(day ? `${value}T12:00:00Z` : value).toLocaleDateString(undefined, { timeZone: day ? 'UTC' : 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' });
};
const format = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
const plural = (value, singular) => `${format(value)} ${singular}${value === 1 ? '' : 's'}`;
const appearance = {
  positive: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20',
  negative: 'border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20',
  neutral: 'border-border bg-background/40',
  unavailable: 'border-border bg-background/40',
};
const movementColor = {
  positive: 'text-emerald-800 dark:text-emerald-300',
  negative: 'text-amber-800 dark:text-amber-300',
  neutral: 'text-muted-foreground',
  unavailable: 'text-muted-foreground',
};
const metricIcons = { clicks: MousePointer2, impressions: Eye, position: Search };

function changeLabel(metric) {
  if (metric.tone === 'unavailable') return 'Comparison unavailable';
  if (metric.tone === 'neutral') return 'No change';
  const amount = Math.abs(metric.delta);
  if (metric.key === 'position') return `${plural(amount, 'position')} ${metric.tone === 'positive' ? 'better' : 'worse'}`;
  return `${format(amount)} ${metric.tone === 'positive' ? 'more' : 'fewer'} ${metric.key === 'clicks' ? (amount === 1 ? 'click' : 'clicks') : (amount === 1 ? 'appearance' : 'appearances')}`;
}

export function ElapsedProgress({ cycle }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const timeline = progressTimeline(cycle, now);
  if (!timeline) return <p className="text-sm text-muted-foreground">The tracking dates could not be displayed. Reload saved progress to check them.</p>;
  const elapsed = `${plural(timeline.elapsedDays, 'day')} since your changes`;
  const waiting = timeline.due;
  const remaining = waiting ? 'Waiting for the latest search data' : `${plural(timeline.daysRemaining, 'day')} until the ${cycle.latestCheckpoint ? 'next' : 'first'} comparison`;
  return <div className="space-y-3 rounded-xl border bg-background/40 p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><p className="text-lg font-semibold tabular-nums">{elapsed}</p><p className="text-sm text-muted-foreground">{remaining}</p></div>
    <div role="progressbar" aria-label="Time until next comparison" aria-valuemin={0} aria-valuemax={100} aria-valuenow={timeline.percent} aria-valuetext={`${elapsed}. ${remaining}.`} className="h-2.5 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${waiting ? 'bg-sky-500' : 'bg-emerald-500'}`} style={{ width: `${timeline.percent}%` }} />
    </div>
    <p className="text-xs text-muted-foreground">{waiting ? 'Your changes remain tracked. The comparison will appear after collection finishes.' : 'We’re collecting search activity. You can work on another page while you wait.'}</p>
  </div>;
}

function ResultsSummary({ metrics, previous }) {
  if (previous) return <p className="text-sm text-muted-foreground">Last saved comparison. A newer check could not finish.</p>;
  const [clicks, impressions] = metrics;
  const complete = metrics.filter(metric => metric.key !== 'position').every(metric => metric.tone !== 'unavailable');
  if (!complete) return <p className="text-sm text-muted-foreground">Some numbers aren’t available yet. Missing data doesn’t mean zero traffic.</p>;
  const mixed = metrics.some(metric => metric.tone === 'positive') && metrics.some(metric => metric.tone === 'negative');
  if (mixed) return <p className="text-sm">Some numbers improved and others moved down. Review them together.</p>;
  if (clicks.tone === 'positive') return <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Your page received {format(clicks.delta)} more {clicks.delta === 1 ? 'click' : 'clicks'} this period.</p>;
  if (impressions.tone === 'positive') return <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Your page appeared in search more often this period.</p>;
  if (metrics.some(metric => metric.tone === 'negative')) return <p className="text-sm">Some numbers moved down this period. Review the evidence before deciding on another change.</p>;
  if (metrics[2]?.tone === 'positive') return <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Your average position moved closer to the top of search results.</p>;
  return <p className="text-sm text-muted-foreground">These numbers stayed the same across the two periods.</p>;
}

export function SearchResultCards({ checkpoint, previous = false }) {
  if (!checkpoint) return null;
  const metrics = resultMetrics(checkpoint);
  const totalsAvailable = metrics.filter(metric => metric.key !== 'position').every(metric => metric.tone !== 'unavailable');
  const before = checkpoint.windows?.baseline || checkpoint.baseline;
  const after = checkpoint.windows?.post || checkpoint.post;
  return <div className="space-y-3" aria-label="Search activity comparison">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{previous ? 'Previous saved results' : 'Your search results'}</p><p className="text-xs text-muted-foreground">Comparing two 28-day periods</p></div>
    <div className="grid gap-3 sm:grid-cols-3">{metrics.map(metric => {
      const Icon = metricIcons[metric.key];
      const Movement = metric.tone === 'positive' ? ArrowUpRight : metric.tone === 'negative' ? ArrowDownRight : Minus;
      return <article key={metric.key} aria-label={metric.label} className={`min-w-0 rounded-xl border p-4 ${appearance[metric.tone]}`}>
        <h4 className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{metric.label}</h4>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums"><span className="text-3xl font-semibold tracking-tight">{format(metric.after)}</span><span className="text-xs text-muted-foreground">previously {format(metric.before)}</span></div>
        <p className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${movementColor[metric.tone]}`}><Movement className="h-4 w-4 shrink-0" aria-hidden="true" />{changeLabel(metric)}</p>
        {metric.key === 'position' && <p className="mt-1 text-xs text-muted-foreground">Closer to 1 is better.</p>}
      </article>;
    })}</div>
    <ResultsSummary metrics={metrics} previous={previous} />
    {checkpoint.lowVolume && totalsAvailable && <p className="text-xs text-muted-foreground">A small amount of activity so far. More time will help confirm the direction.</p>}
    <p className="text-xs text-muted-foreground">Before: {progressDate(before?.startDate)}–{progressDate(before?.endDate)} · After: {progressDate(after?.startDate)}–{progressDate(after?.endDate)}</p>
    {previous && (checkpoint.post?.fetchedAt || checkpoint.observedAt || checkpoint.createdAt) && <p className="text-xs text-muted-foreground">Last observed {progressDate(checkpoint.post?.fetchedAt || checkpoint.observedAt || checkpoint.createdAt)}.</p>}
  </div>;
}
