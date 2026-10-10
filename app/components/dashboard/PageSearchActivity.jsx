"use client";

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function pageIdentity(url) {
  try { const parsed = new URL(url); return parsed.pathname === '/' && !parsed.search ? 'Homepage' : `${parsed.pathname}${parsed.search}`; }
  catch { return url; }
}

export function activityCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : 'Unavailable';
}

function averagePosition(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'Unavailable';
}

export function pageOptionLabel(page) {
  const identity = pageIdentity(page.url) === 'Homepage' ? `Homepage — ${page.url}` : page.url;
  const metrics = page.metrics;
  if (page.activityStatus === 'unavailable') return `${identity} — Activity unavailable`;
  return metrics && [metrics.clicks, metrics.impressions].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    ? `${identity} — ${activityCount(metrics.clicks)} ${metrics.clicks === 1 ? 'click' : 'clicks'} · ${activityCount(metrics.impressions)} appearances`
    : `${identity} — No reported data`;
}

const dayValue = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? Date.parse(`${value}T00:00:00Z`) : NaN;
const validWindow = window => Number.isFinite(dayValue(window?.startDate)) && dayValue(window.endDate) - dayValue(window.startDate) === 27 * 86400000;
const validMetrics = totals => totals === null || (totals && [totals.clicks, totals.impressions].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) && totals.clicks <= totals.impressions);
const validStatus = status => ['available', 'no_data', 'unavailable'].includes(status);
const validTotals = period => validStatus(period?.totalsStatus) && validMetrics(period.totals) &&
  (period.totalsStatus === 'available' ? period.totals?.impressions > 0 : period.totalsStatus === 'unavailable' ? period.totals === null : period.totals === null || period.totals.impressions === 0);

export function usablePageActivity(result, { property, pageUrl, websiteRunId }) {
  const { evidence, provenance } = result || {};
  return result?.success === true && evidence?.property === property && evidence.pageUrl === pageUrl &&
    provenance?.property === property && provenance.pageUrl === pageUrl && (provenance.websiteRunId || null) === (websiteRunId || null) &&
    validWindow(evidence.window) && validTotals(evidence.current) &&
    validStatus(evidence.current?.queriesStatus) && Array.isArray(evidence.current.queries) &&
    evidence.current.queries.length <= 1000 && evidence.current.queries.every(row => typeof row?.query === 'string' && validMetrics(row) && (row.position == null || (Number.isFinite(row.position) && row.position >= 1))) &&
    Array.isArray(evidence.history) && evidence.history.length === 6 &&
    evidence.history.every((period, index) => period && validWindow(period.window) && validTotals(period) &&
      (index === 0 ? period.window.startDate === evidence.window.startDate && period.window.endDate === evidence.window.endDate
        : dayValue(evidence.history[index - 1].window.startDate) - dayValue(period.window.endDate) === 86400000));
}

const periodLabel = window => window?.startDate && window?.endDate ? `${window.startDate}–${window.endDate}` : 'Dates unavailable';

export default function PageSearchActivity({ pageUrl, evidence, busy, error, onRetry }) {
  const [showAllQueries, setShowAllQueries] = useState(false);
  const current = evidence?.current;
  const totals = current?.totals;
  const queries = [...(current?.queries || [])].sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
  const visibleQueries = showAllQueries ? queries : queries.slice(0, 5);

  return <section aria-label="Selected page and search activity" className="mb-6 rounded-xl border bg-card p-5 md:p-6">
    <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected page</p><h2 className="break-words text-xl font-semibold">{pageIdentity(pageUrl)}</h2>
      <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-2 text-sm underline underline-offset-4"><span className="break-all">{pageUrl}</span><ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="sr-only">Open website in a new tab</span></a>
    </div>
    {busy && <p className="mt-5 text-sm text-muted-foreground" role="status">Loading search activity for this page…</p>}
    {error && <div className="mt-5 space-y-3" role="alert"><p className="text-sm">{error}</p><Button variant="outline" size="sm" onClick={onRetry}>Retry page activity</Button></div>}
    {!busy && evidence && <div className="mt-5 space-y-5">
      <div><p className="mb-3 text-xs text-muted-foreground">Google Search Console · {periodLabel(evidence.window)} · 28 days</p>
        {totals ? <dl className="grid grid-cols-2 gap-3"><div className="rounded-lg border bg-background/50 p-4"><dt className="text-sm text-muted-foreground">Clicks from Google</dt><dd className="mt-1 text-2xl font-semibold">{activityCount(totals.clicks)}</dd></div><div className="rounded-lg border bg-background/50 p-4"><dt className="text-sm text-muted-foreground">Appearances in search</dt><dd className="mt-1 text-2xl font-semibold">{activityCount(totals.impressions)}</dd></div></dl>
          : <p className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">{current.totalsStatus === 'no_data' ? 'Google returned no page totals for this period. This does not tell us whether the page is indexed.' : 'Page totals are unavailable right now. You can still review the page content.'}</p>}
      </div>
      <div><h3 className="mb-2 font-semibold">What people searched for</h3><p className="mb-3 text-xs leading-relaxed text-muted-foreground">These searches brought up this exact page. Google leaves some searches out, so these rows may not add up to the page totals above.</p>
        {queries.length > 0 ? <><div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm" aria-label="Search phrases for the selected page"><thead className="bg-muted/30 text-left"><tr><th scope="col" className="p-3 font-medium">Search phrase</th><th scope="col" className="p-3 text-right font-medium">Clicks</th><th scope="col" className="p-3 text-right font-medium">Appearances</th><th scope="col" className="p-3 text-right font-medium" title="Average position across the reported searches. A lower number is closer to the top; it is not a fixed result position.">Average position</th></tr></thead><tbody>{visibleQueries.map(row => <tr className="border-t" key={row.query}><th scope="row" className="min-w-32 break-words p-3 text-left font-normal">{row.query}</th><td className="p-3 text-right">{activityCount(row.clicks)}</td><td className="p-3 text-right">{activityCount(row.impressions)}</td><td className="p-3 text-right">{averagePosition(row.position)}</td></tr>)}</tbody></table></div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Ordered by appearances · up to 1,000 reported searches for the dates above. Average position varies by search and visitor; a lower number is closer to the top. A few appearances or clicks can move these averages a lot.</p>
          {queries.length > 5 && <Button className="mt-3" variant="outline" size="sm" onClick={() => setShowAllQueries(value => !value)}>{showAllQueries ? 'Show fewer searches' : `Show all ${queries.length} searches`}</Button>}</>
          : <p className="text-sm text-muted-foreground">{current.queriesStatus === 'unavailable' ? 'Search phrases are unavailable for this period.' : 'Google returned no search phrases for this page during this period.'}</p>}
      </div>
      <details className="border-t pt-4 text-sm"><summary className="cursor-pointer font-medium">Search history · about six months</summary><div className="mt-3 space-y-3"><p className="text-xs leading-relaxed text-muted-foreground">Six 28-day periods for this exact URL. If you rebuilt or changed the page, older numbers may describe its previous version. This is not a test of your latest edit.</p>
        {evidence.history.length > 0 ? <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm" aria-label="Search history for the selected page"><thead className="bg-muted/30"><tr><th scope="col" className="p-3 text-left font-medium">Period</th><th scope="col" className="p-3 text-right font-medium">Clicks</th><th scope="col" className="p-3 text-right font-medium">Appearances</th></tr></thead><tbody>{evidence.history.map(period => <tr key={period.window.startDate} className="border-t"><th scope="row" className="p-3 text-left text-xs font-normal">{periodLabel(period.window)}</th>{period.totals ? <><td className="p-3 text-right">{activityCount(period.totals.clicks)}</td><td className="p-3 text-right">{activityCount(period.totals.impressions)}</td></> : <td colSpan={2} className="p-3 text-right text-xs text-muted-foreground">{period.totalsStatus === 'no_data' ? 'No totals returned' : 'Unavailable'}</td>}</tr>)}</tbody></table></div> : <p className="text-muted-foreground">Search history is unavailable.</p>}
        <p className="text-xs text-muted-foreground">Search activity alone cannot explain a ranking change or establish indexing status.</p>
      </div></details>
    </div>}
  </section>;
}
