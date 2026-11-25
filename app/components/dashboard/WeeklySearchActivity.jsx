"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { activityDayLabel, dashboardActivityWeeks } from '../../lib/dashboardActivityPresentation';

const count = value => Number.isFinite(value) ? value.toLocaleString() : '—';

// Each metric keeps its own colour wherever it appears. The values were checked
// for contrast and colour-blind separation against the light and dark card.
const METRICS = [
  { key: 'impressions', label: 'Appearances', noun: 'appearances', one: 'appearance', color: '[--bar:#059669] dark:[--bar:#0fae62]', dot: 'bg-[#059669] dark:bg-[#0fae62]' },
  { key: 'clicks', label: 'Clicks', noun: 'clicks', one: 'click', color: '[--bar:#0284c7] dark:[--bar:#2b93e3]', dot: 'bg-[#0284c7] dark:bg-[#2b93e3]' },
];

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Smallest round number at or above the busiest day, so the top gridline is easy to read. */
function roundCeiling(value) {
  if (value <= 2) return 2;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 3, 4, 5, 6, 8, 10].map(step => step * power).find(step => step >= value);
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from the previous number to the new one when the metric changes. */
function AnimatedCount({ value }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (!Number.isFinite(value) || !Number.isFinite(from.current) || prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current, began = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - began) / 520);
      const current = Math.round(start + (value - start) * (1 - (1 - progress) ** 3));
      from.current = current;
      setShown(current);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return count(shown);
}

export default function WeeklySearchActivity({ overview }) {
  const [metric, setMetric] = useState('impressions');
  const [active, setActive] = useState(null);
  const [grown, setGrown] = useState(false);
  const weeks = useMemo(() => dashboardActivityWeeks(overview?.window, overview?.daily), [overview]);
  const days = useMemo(() => weeks.flatMap(week => week.days), [weeks]);
  const current = METRICS.find(item => item.key === metric);
  const ceiling = roundCeiling(Math.max(1, ...days.map(day => day[metric] ?? 0)));
  const partial = weeks.some(week => !week.complete);
  const daily = overview?.daily || [];
  const activeDay = active === null ? null : days[active];

  // Bars rise from the baseline the first time the chart appears.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const dayText = day => {
    const date = activityDayLabel(day.date, { weekday: 'short' });
    if (!day.reported) return `${date}: not reported`;
    return `${date}: ${count(day[metric])} ${day[metric] === 1 ? current.one : current.noun}`;
  };

  const onKeyDown = event => {
    if (!days.length) return;
    const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (move) {
      event.preventDefault();
      setActive(index => Math.min(days.length - 1, Math.max(0, (index ?? (move > 0 ? -1 : days.length)) + move)));
    } else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(days.length - 1); }
    else if (event.key === 'Escape') setActive(null);
  };

  // Hover shows a day's number with a mouse; on touch screens a tap does (tap again, or elsewhere, to hide).
  const columns = 'grid grid-cols-4 gap-3 sm:gap-6';

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-medium">Your last four weeks</h3><p className="mt-1 text-xs text-muted-foreground">{partial ? 'Reported daily activity · some days were not returned' : 'Reported daily activity, grouped by week'}</p></div>
      <div className="relative grid grid-cols-2 rounded-lg border bg-background/50 p-1" role="group" aria-label="Chart metric">
        <span aria-hidden="true" className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-primary/10 shadow-sm transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `translateX(${metric === 'clicks' ? '100%' : '0'})`, transitionTimingFunction: EASE }} />
        {METRICS.map(item => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => setMetric(item.key)} className={`relative inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${metric === item.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}><span aria-hidden="true" className={`h-2 w-2 rounded-full ${item.dot} transition-opacity ${metric === item.key ? '' : 'opacity-40'}`} />{item.label}</button>)}
      </div>
    </div>
    {weeks.length > 0 ? <>
      <div
        className={`rounded-xl border bg-background/30 px-3 pb-4 pt-5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 ${current.color}`}
        role="img"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        aria-label={`Weekly reported ${current.noun}. ${weeks.map(week => `${activityDayLabel(week.startDate)} to ${activityDayLabel(week.endDate)}: ${week[metric] === null ? 'unavailable' : count(week[metric])}, ${week.reportedDays} of 7 days returned`).join('. ')}. Use the left and right arrow keys to read each day.`}
      >
        <div aria-hidden="true">
          {/* Weekly totals */}
          <div className={columns}>
            {weeks.map(week => <p key={week.startDate} className="min-w-0 text-center text-xl font-semibold tabular-nums tracking-tight sm:text-2xl"><AnimatedCount value={week[metric]} /></p>)}
          </div>

          {/* Daily bars, seven per week, on one shared scale */}
          <div className="relative mt-5 h-32 sm:h-36" onPointerLeave={event => { if (event.pointerType === 'mouse') setActive(null); }}>
            {[1, 0.5].map(level => <div key={level} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: `${(1 - level) * 100}%` }}>
              {Number.isInteger(ceiling * level) && <span className={`absolute -top-4 right-0 text-[10px] tabular-nums text-muted-foreground ${level === 1 ? '' : 'hidden sm:block'}`}>{count(ceiling * level)}{level === 1 ? ' a day' : ''}</span>}
            </div>)}
            <div className={`${columns} h-full border-b border-border`}>
              {weeks.map((week, weekIndex) => <div key={week.startDate} className="flex h-full min-w-0 items-end justify-center gap-[2px] sm:gap-1.5">
                {week.days.map((day, dayIndex) => {
                  const index = weekIndex * 7 + dayIndex;
                  const value = day[metric];
                  const isActive = active === index;
                  const height = !day.reported ? 0 : value === 0 ? 2 : Math.max(3, value / ceiling * 100);
                  const edge = index < 4 ? 'left-0' : index > days.length - 5 ? 'right-0' : 'left-1/2 -translate-x-1/2';
                  return <div key={day.date} className="relative flex h-full min-w-0 max-w-6 flex-1 items-end" onPointerEnter={event => { if (event.pointerType === 'mouse') setActive(index); }} onPointerDown={event => { if (event.pointerType !== 'mouse') setActive(now => now === index ? null : index); }}>
                    {day.reported
                      ? <div
                          className={`w-full rounded-t-[4px] bg-[var(--bar)] transition-[height,background-color,opacity] duration-500 motion-reduce:transition-none ${active !== null && !isActive ? 'opacity-40' : value === 0 ? 'opacity-50' : ''}`}
                          style={{ height: !grown ? 0 : value === 0 ? '2px' : `${height}%`, transitionTimingFunction: EASE, transitionDelay: active === null ? `${index * 12}ms` : '0ms' }}
                        />
                      : <div className={`h-1.5 w-full rounded-sm border border-dashed border-muted-foreground/60 transition-opacity ${active !== null && !isActive ? 'opacity-40' : ''}`} />}
                    {isActive && <div className={`pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border bg-popover px-3 py-2 text-left text-popover-foreground shadow-lg ${edge}`} style={{ bottom: `calc(${day.reported && value > 0 ? height : 0}% + 10px)` }}>
                      <p className="text-sm font-semibold tabular-nums">{day.reported ? <>{count(value)} <span className="font-normal text-muted-foreground">{value === 1 ? current.one : current.noun}</span></> : 'Not reported'}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{activityDayLabel(day.date, { weekday: 'short' })}</p>
                    </div>}
                  </div>;
                })}
              </div>)}
            </div>
          </div>

          {/* Week labels */}
          <div className={`${columns} mt-3`}>
            {weeks.map(week => <div key={week.startDate} className="min-w-0 text-center">
              <p className="text-xs font-medium leading-relaxed sm:text-sm"><span className="block sm:inline">{activityDayLabel(week.startDate)}</span><span className="block text-muted-foreground sm:inline"> – {activityDayLabel(week.endDate)}</span></p>
              <p className="mt-1 text-[11px] text-muted-foreground">{week.complete ? '7 days reported' : week.reportedDays ? `${week.reportedDays}/7 days · partial` : 'No days reported'}</p>
            </div>)}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{activeDay ? dayText(activeDay) : ''}</p>
      {partial && <p className="text-xs leading-relaxed text-muted-foreground">Dashed marks are days Google did not return. Those days are unknown, so the weekly numbers may not add up to the website totals.</p>}
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
