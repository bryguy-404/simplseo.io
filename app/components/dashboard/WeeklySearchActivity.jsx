"use client";

import { useMemo, useState } from 'react';
import { activityDayLabel, dashboardActivityWeeks } from '../../lib/dashboardActivityPresentation';

const count = value => Number.isFinite(value) ? value.toLocaleString() : '—';

export default function WeeklySearchActivity({ overview }) {
  const [metric, setMetric] = useState('impressions');
  const weeks = useMemo(() => dashboardActivityWeeks(overview?.window, overview?.daily), [overview]);
  const maximum = Math.max(1, ...weeks.map(week => week[metric] ?? 0));
  const partial = weeks.some(week => !week.complete);
  const metricLabel = metric === 'clicks' ? 'clicks' : 'appearances';
  const daily = overview?.daily || [];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-medium">Your last four weeks</h3><p className="mt-1 text-xs text-muted-foreground">{partial ? 'Reported daily activity · some days were not returned' : 'Reported daily activity, grouped by week'}</p></div>
      <div className="inline-flex rounded-lg border bg-background/50 p-1" role="group" aria-label="Chart metric">
        {[['impressions', 'Appearances'], ['clicks', 'Clicks']].map(([value, label]) => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)} className={`min-h-10 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${metric === value ? 'bg-primary/10 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
      </div>
    </div>
    {weeks.length > 0 ? <>
      <div className="relative rounded-xl border bg-background/30 px-3 pb-4 pt-5 sm:px-6" role="img" aria-label={`Weekly reported ${metricLabel}. ${weeks.map(week => `${activityDayLabel(week.startDate)} to ${activityDayLabel(week.endDate)}: ${week[metric] === null ? 'unavailable' : count(week[metric])}, ${week.reportedDays} of 7 days returned`).join('. ')}.`}>
        <div className="pointer-events-none absolute inset-x-3 top-14 h-28 border-y border-dashed border-border/70 sm:inset-x-6" aria-hidden="true" />
        <div className="relative grid grid-cols-4 gap-3 sm:gap-8" aria-hidden="true">
          {weeks.map(week => <div key={week.startDate} className="min-w-0 text-center">
            <div className="flex h-40 flex-col justify-end">
              <span className="mb-2 text-lg font-semibold tabular-nums sm:text-xl">{count(week[metric])}</span>
              {week[metric] === null ? <div className="mx-auto h-1 w-full max-w-24 rounded border border-dashed border-muted-foreground/60" /> : <div className={`mx-auto w-full max-w-24 rounded-t-lg ${metric === 'clicks' ? 'bg-sky-600 dark:bg-sky-400' : 'bg-emerald-600 dark:bg-emerald-400'} ${week.complete ? '' : 'opacity-65'}`} style={{ height: week[metric] === 0 ? '2px' : `${Math.max(3, week[metric] / maximum * 110)}px` }} />}
            </div>
            <p className="mt-3 text-xs font-medium leading-relaxed sm:text-sm"><span className="block">{activityDayLabel(week.startDate)}</span><span className="block text-muted-foreground">– {activityDayLabel(week.endDate)}</span></p>
            <p className="mt-1 text-[11px] text-muted-foreground">{week.complete ? '7 days reported' : week.reportedDays ? `${week.reportedDays}/7 days · partial` : 'No days reported'}</p>
          </div>)}
        </div>
      </div>
      {partial && <p className="text-xs leading-relaxed text-muted-foreground">Partial bars include only the days Google returned. Missing days are unknown, so these bars may not add up to the website totals.</p>}
    </> : <p className="text-sm text-muted-foreground">Weekly activity is unavailable for this reporting period.</p>}
    <details className="border-t pt-3">
      <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">View daily numbers and reporting details</summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs text-muted-foreground">Google Search Console · Pacific dates. The most recent three days are excluded while reporting settles. Website totals are reported separately from the daily and page lists.</p>
        {daily.length > 0 ? <div className="max-h-64 overflow-auto"><table className="w-full text-sm"><caption className="sr-only">Reported daily search activity, Pacific dates</caption><thead><tr className="border-b"><th scope="col" className="py-2 text-left">Date</th><th scope="col" className="text-right">Appearances</th><th scope="col" className="text-right">Clicks</th></tr></thead><tbody>{daily.map(row => <tr key={row.date} className="border-b last:border-0"><th scope="row" className="py-2 text-left font-normal">{row.date}</th><td className="text-right tabular-nums">{count(row.impressions)}</td><td className="text-right tabular-nums">{count(row.clicks)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No daily rows were returned. This is different from a reported zero.</p>}
      </div>
    </details>
  </div>;
}
