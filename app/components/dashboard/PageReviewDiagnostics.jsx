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
      {relatedPages.length > 0 && <div><h4 className="mb-2 font-medium">Related pages checked</h4><ul className="space-y-2 text-xs">{relatedPages.map(page => <li key={page.pageUrl} className="break-words"><span className="break-all">{page.pageUrl}</span><span className="mt-1 block text-muted-foreground">{page.status === 'available' ? 'Downloaded page content was available.' : page.status === 'not_checked' ? 'Page content was not checked.' : 'Page content could not be read.'}</span></li>)}</ul></div>}
      {limitations.length > 0 && <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">{limitations.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}</ul>}
    </div></details>
  </section>;
}
