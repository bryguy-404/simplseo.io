"use client";

function when(value) { if (!value) return 'Date unavailable'; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Date unavailable'; }
function Observation({ result, kind }) {
  if (!result) return <p className="text-muted-foreground">No successful observation is available yet.</p>;
  if (kind === 'activity') {
    const activity = result.value || result.evidence || result;
    const period = activity.window;
    const totals = activity.current?.totals;
    const status = activity.current?.totalsStatus;
    return <>
      {period ? <p className="text-xs text-muted-foreground">{period.startDate} – {period.endDate} · Google Search Console</p> : null}
      {status === 'available' && totals ? <p className="mt-2"><strong>{totals.clicks}</strong> clicks · <strong>{totals.impressions}</strong> appearances{totals.impressions > 0 && typeof totals.position === 'number' ? ` · ${totals.position.toFixed(1)} average position` : ''}</p> : <p className="mt-2 text-muted-foreground">{status === 'no_data' ? 'Google returned no reported search activity for this period.' : 'Current search activity is unavailable. This does not mean zero traffic.'}</p>}
    </>;
  }
  if (kind === 'technical' || kind === 'page') {
    const index = result.indexing?.indexStatusResult;
    return <dl className="space-y-3">
      <div><dt className="font-medium">Your public page</dt><dd className="text-muted-foreground">{result.website?.status === 'available' ? 'Page content was readable.' : result.website?.message || 'We couldn’t finish reading this page.'}</dd></div>
      {(result.website?.technical?.noindex === true || result.website?.technical?.noindex?.googlebot) ? <div className="rounded-lg border border-amber-500/30 p-3"><dt className="font-medium">Indexing directive found</dt><dd>The page includes a noindex instruction. If you want this page in Google, review that setting in your website builder.</dd></div> : null}
      {result.website?.technical?.redirected ? <div><dt className="font-medium">This address redirects</dt><dd className="break-all text-muted-foreground">{result.website.finalUrl}</dd></div> : null}
      <div><dt className="font-medium">Google’s stored indexing status</dt><dd className="text-muted-foreground">{result.indexing?.status === 'available' && index ? index.coverageState || index.verdict || 'Google returned an observation; ask the mentor to explain it.' : 'The indexing check was unavailable. This does not mean the page is not indexed.'}</dd>{index?.lastCrawlTime ? <dd className="text-xs text-muted-foreground mt-1">Google’s reported last crawl: {when(index.lastCrawlTime)}</dd> : null}</div>
      <p className="text-xs text-muted-foreground">This is Google’s saved information, not a live indexing test or an indexing request.</p>
    </dl>;
  }
  return <p>Progress observations checked. Open Page progress for the dated comparison.</p>;
}
export default function MentorCheckResult({ check }) {
  return <article aria-label="Requested check result" className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm">
    <h3 className="font-semibold">{check.kind === 'activity' ? 'Search data check' : 'Page check'}</h3>
    <p className="break-all text-xs text-muted-foreground mt-1">{check.pageUrl}</p>
    {check.lastError ? <p role="alert" className="my-3">{check.lastError}</p> : null}
    {check.lastSuccessAt ? <p className="text-xs text-muted-foreground my-3">Last successful check: {when(check.lastSuccessAt)}</p> : check.lastAttemptAt ? <p className="text-xs text-muted-foreground my-3">Attempted: {when(check.lastAttemptAt)}</p> : null}
    <Observation kind={check.kind} result={check.result} />
    {check.failedObservation && check.lastSuccessAt ? <details className="mt-3"><summary className="cursor-pointer text-muted-foreground">Details from the incomplete check</summary><div className="mt-3"><Observation kind={check.kind} result={check.failedObservation} /></div></details> : null}
  </article>;
}
