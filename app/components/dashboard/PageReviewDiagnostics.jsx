"use client";

import { ExternalLink } from 'lucide-react';

export function googleInspectionLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'search.google.com' && url.pathname === '/search-console/inspect' && !url.username && !url.password && !url.port && !url.hash ? url.href : null; }
  catch { return null; }
}

function dateLabel(value) {
  if (!value) return 'Not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not reported' : date.toLocaleString();
}

const periodLabel = window => window?.startDate && window?.endDate ? `${window.startDate}–${window.endDate}` : 'Dates unavailable';
const count = (value, position = false) => typeof value === 'number' && Number.isFinite(value) && value >= (position ? 1 : 0) ? value.toLocaleString(undefined, { maximumFractionDigits: position ? 1 : 0 }) : 'Unavailable';

function RelatedSearchPeriod({ label, window, period, phrases }) {
  return <div className="min-w-0 rounded-lg border bg-background/50 p-3"><h5 className="font-medium">{label}</h5><p className="mt-1 text-muted-foreground">{periodLabel(window)}</p>
    {!['available', 'no_data'].includes(period?.status) ? <p className="mt-3 text-muted-foreground">Search comparison unavailable for this period.</p> : <ul className="mt-3 space-y-3">{phrases.map(phrase => {
      const row = period.status === 'available' ? period.queries?.find(item => item.query === phrase) : null;
      return <li key={phrase} className="border-t pt-3"><p className="break-words font-medium">{phrase}</p>{row ? <dl className="mt-2 grid grid-cols-3 gap-2"><div><dt className="text-muted-foreground">Clicks</dt><dd className="mt-1">{count(row.clicks)}</dd></div><div><dt className="text-muted-foreground">Appearances</dt><dd className="mt-1">{count(row.impressions)}</dd></div><div><dt className="text-muted-foreground">Average position</dt><dd className="mt-1">{count(row.position, true)}</dd></div></dl> : <p className="mt-2 text-muted-foreground">Not reported for this page and period.</p>}</li>;
    })}</ul>}
  </div>;
}

function RelatedSearchComparison({ comparison, pageUrl }) {
  if (!comparison) return null;
  const phrases = [...new Set((comparison.phrases || []).filter(phrase => typeof phrase === 'string' && phrase.trim()))].slice(0, 3);
  return <section className="mt-3 space-y-3" aria-label={`Search comparison for ${pageUrl}`}><h5 className="font-medium">The same search phrases on this related page</h5>
    {phrases.length ? <div className="grid gap-3 md:grid-cols-2"><RelatedSearchPeriod label="Recent period" window={comparison.window} period={comparison.current} phrases={phrases} /><RelatedSearchPeriod label="Previous period" window={comparison.previousWindow} period={comparison.previous} phrases={phrases} /></div> : <p className="text-muted-foreground">No search phrases were selected for this comparison.</p>}
    <p className="leading-relaxed text-muted-foreground">Missing rows mean Google did not report that phrase, not zero activity. Average position is an average across searches, not a fixed ranking.</p>
    {comparison.limitation && <p className="leading-relaxed text-muted-foreground">{comparison.limitation}</p>}
  </section>;
}

export default function PageReviewDiagnostics({ diagnostics, pageUrl, currentPage }) {
  const inspection = diagnostics?.inspection;
  const available = inspection?.status === 'available' && inspection.url === pageUrl;
  const inspectionUrl = available ? googleInspectionLink(inspection.inspectionUrl) : null;
  const relatedPages = diagnostics?.relatedPages || [];
  const limitations = [...new Set([...(currentPage?.structuralLimitations || []), ...(diagnostics?.limitations || [])])];
  return <section aria-label="Google index check" className="rounded-lg border bg-background/60 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Google index check</h3><p className="mt-1 text-sm">{available ? inspection.coverageState || 'Google returned an index inspection result.' : inspection?.status === 'unavailable' ? 'Google’s index result was unavailable.' : 'Google’s index result was not checked.'}</p></div>
      {inspectionUrl && <a href={inspectionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4">Open Google’s inspection<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>}
    </div>
    <p className="mt-2 break-all text-xs text-muted-foreground">Exact URL: {pageUrl}</p>
    {available ? <p className="mt-2 text-xs text-muted-foreground">Last crawl reported by Google: {dateLabel(inspection.lastCrawlTime)}. This is Google’s stored result, not a live crawl.</p>
      : <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Search appearances alone do not establish indexing status. You can inspect this exact URL in your Google Search Console account.</p>}
    <details className="mt-3 border-t pt-3 text-sm"><summary className="cursor-pointer font-medium">Index and page-read details</summary><div className="mt-3 space-y-4">
      {available && <dl className="grid gap-3 sm:grid-cols-2">{[['Google verdict', inspection.verdict], ['Indexing state', inspection.indexingState], ['Robots state', inspection.robotsTxtState], ['Google page fetch', inspection.pageFetchState], ['Canonical chosen by Google', inspection.googleCanonical], ['Canonical declared by your page', inspection.userCanonical]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-xs">{value || 'Not reported'}</dd></div>)}</dl>}
      {inspection?.checkedAt && <p className="text-xs text-muted-foreground">Inspection requested {dateLabel(inspection.checkedAt)}. This request time is different from Google’s last crawl.</p>}
      {inspection?.limitation && <p className="text-xs leading-relaxed text-muted-foreground">{inspection.limitation}</p>}
      <div><h4 className="font-medium">What we could read</h4><p className="mt-2 text-xs leading-relaxed text-muted-foreground">We read downloaded HTML and bounded excerpts, not a browser-rendered page. JavaScript content and visual layout may be missing. An omitted section is a reason to check, not proof it is absent.</p></div>
      {relatedPages.length > 0 && <div><h4 className="mb-2 font-medium">Related pages checked</h4><ul className="space-y-4 text-xs">{relatedPages.map(page => <li key={page.pageUrl} className="break-words"><span className="break-all">{page.pageUrl}</span><span className="mt-1 block text-muted-foreground">{page.status === 'available' ? 'Downloaded page content was available.' : page.status === 'not_checked' ? 'Page content was not checked.' : 'Page content could not be read.'}</span><RelatedSearchComparison comparison={page.comparison} pageUrl={page.pageUrl} /></li>)}</ul></div>}
      {limitations.length > 0 && <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">{limitations.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}</ul>}
    </div></details>
  </section>;
}
