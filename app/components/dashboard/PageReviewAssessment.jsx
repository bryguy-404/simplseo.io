"use client";

import { ClipboardCheck, ExternalLink, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { propertyContainsUrl } from '../../lib/revampState';
import { usableSuggestion } from '../../lib/pageTaskFlow';
import { Button } from '@/components/ui/button';
import { pageIdentity } from './PageSearchActivity';
import PageReviewActions, { usableRecommendations } from './PageReviewActions';
import PageReviewDiagnostics, { googleInspectionLink } from './PageReviewDiagnostics';

const actions = {
  revise_metadata: 'Review a wording change',
  keep_current: 'Keep your current wording',
  improve_content: 'Improve the page content first',
  review_page: 'Review another page',
  collect_data: 'Gather more evidence',
  investigate_visibility: 'Check this page’s search visibility',
};
const metadataVerdicts = { keep: 'Keep your current title and description', revise: 'Review a title or description change', uncertain: 'More evidence is needed to judge the wording' };
const checkAreas = { indexing: 'Google access and indexing', search_intent: 'Match to customer searches', content: 'Useful page content', headings: 'Page headings', metadata: 'Search title and description', internal_links: 'Links within your website' };
const checkStates = { issue: 'Issue supported by evidence', opportunity: 'Opportunity to test', suitable: 'Looks suitable in this review', unknown: 'Not enough evidence' };
const findingHeadings = { supported_issue: 'Fix this issue first', opportunity_to_test: 'Main improvement to test', limited_findings: 'Only small improvements found', insufficient_evidence: 'We need more evidence to choose the main improvement' };

function webUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}

function normalizedSourceUrl(value) {
  return webUrl(value) ? new URL(value).href : null;
}

const markdownElements = ['p', 'a', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'br'];
const markdownHeading = ({ children }) => <h4 className="font-semibold">{children}</h4>;
const markdownComponents = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  h1: markdownHeading, h2: markdownHeading, h3: markdownHeading, h4: markdownHeading, h5: markdownHeading, h6: markdownHeading,
  ul: ({ children }) => <ul className="list-disc space-y-2 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-2 pl-5">{children}</ol>,
  li: ({ children }) => <li className="space-y-2 leading-relaxed">{children}</li>,
  blockquote: ({ children }) => <blockquote className="space-y-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  pre: ({ children }) => <pre className="max-w-full overflow-x-auto rounded bg-muted p-3 text-xs">{children}</pre>,
};

function ResearchSummary({ summary, sources }) {
  const allowedUrls = new Set(sources.map(source => normalizedSourceUrl(source.url)).filter(Boolean));
  return <div className="space-y-3 break-words" aria-label="Web research summary"><ReactMarkdown skipHtml allowedElements={markdownElements} components={{ ...markdownComponents,
    a: ({ href, children }) => {
      const url = normalizedSourceUrl(href);
      return url && allowedUrls.has(url)
        ? <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">{children}<span className="sr-only"> (opens in a new tab)</span></a>
        : <span>{children}</span>;
    },
  }}>{summary}</ReactMarkdown></div>;
}

export function recommendedReviewPage(review) {
  const target = review.analysis?.targetPageUrl;
  const relatedPages = [review.evidence?.relatedPages, review.diagnostics?.relatedPages].flatMap(pages => Array.isArray(pages) ? pages : []);
  if (!target || target === review.evidence?.pageUrl || !propertyContainsUrl(review.evidence?.property, target) || !relatedPages.some(page => page?.pageUrl === target)) return null;
  try {
    const url = new URL(target);
    return webUrl(target) && !url.hash && url.origin === new URL(review.evidence.pageUrl).origin ? target : null;
  } catch { return null; }
}

function reviewFacts(review) {
  return [...new Map([...(review.evidence?.facts || []), ...(review.diagnostics?.facts || [])].map(fact => [fact.id, fact])).values()];
}

function usableStrategy(strategy, knownIds) {
  const bounded = (value, limit) => typeof value === 'string' && Boolean(value.trim()) && value.length <= limit;
  return strategy && bounded(strategy.searchGoal, 220) && bounded(strategy.priorityReason, 400) && bounded(strategy.limitation, 320) &&
    (Object.hasOwn(checkAreas, strategy.focusArea) || strategy.focusArea === 'none') && Object.hasOwn(findingHeadings, strategy.finding) &&
    Array.isArray(strategy.checks) && strategy.checks.length === 6 && new Set(strategy.checks.map(check => check?.area)).size === 6 &&
    strategy.checks.every(check => check && Object.hasOwn(checkAreas, check.area) && Object.hasOwn(checkStates, check.status) && bounded(check.finding, 260) &&
      Array.isArray(check.evidenceIds) && check.evidenceIds.length <= 5 && (check.status === 'unknown' || check.evidenceIds.length > 0) && check.evidenceIds.every(id => typeof id === 'string' && knownIds.has(id)));
}

function usableSearchFocus(focus, knownIds) {
  const bounded = (value, limit) => typeof value === 'string' && Boolean(value.trim()) && value.length <= limit;
  return focus && ['observed', 'proposed', 'needs_input'].includes(focus.source) &&
    (focus.source === 'needs_input' ? focus.phrase === null && bounded(focus.question, 180) : bounded(focus.phrase, 120) && focus.question === null) &&
    bounded(focus.intent, 200) && bounded(focus.reason, 320) && typeof focus.supportingQuote === 'string' && focus.supportingQuote.length <= 500 &&
    Array.isArray(focus.relatedPhrases) && focus.relatedPhrases.length <= 3 && focus.relatedPhrases.every(phrase => bounded(phrase, 120)) &&
    Array.isArray(focus.evidenceIds) && focus.evidenceIds.length > 0 && focus.evidenceIds.length <= 5 && focus.evidenceIds.some(id => /^P\d+$/.test(id)) && focus.evidenceIds.every(id => knownIds.has(id));
}

export function SearchFocus({ focus }) {
  return <section aria-label="Automatically selected search focus" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/25">
    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">{focus.source === 'needs_input' ? 'One business detail to clarify' : 'Your recommended search focus'}</p>
    <h3 className="mt-2 text-lg font-semibold">{focus.phrase || focus.question}</h3>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{focus.source === 'observed' ? 'Reported in your Google search data.' : focus.source === 'proposed' ? 'A suggested topic to test, not measured search demand.' : 'Add this detail under “Tell us more about this page,” then analyze again.'}</p>
    <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Why this search focus?</summary><div className="mt-2 space-y-2 text-sm leading-relaxed"><p>{focus.reason}</p><p>{focus.intent}</p>{focus.relatedPhrases.length > 0 && <p>Related ways people might search: {focus.relatedPhrases.join(' · ')}</p>}{focus.supportingQuote && <blockquote className="border-l-2 border-emerald-300 pl-3 dark:border-emerald-700">{focus.supportingQuote}</blockquote>}<p className="text-xs text-muted-foreground">This is a supported topic for this page, not a promise of traffic or rankings.</p></div></details>
  </section>;
}

function ReviewChecks({ strategy, facts, sources }) {
  return <details className="rounded-lg border bg-background/50 p-4 text-sm"><summary className="cursor-pointer font-medium">What we checked</summary><p className="mt-3 text-xs leading-relaxed text-muted-foreground">Six areas, using the evidence available for this review. “Not enough evidence” means we could not reach a supported conclusion.</p><ul className="mt-4 grid gap-3 md:grid-cols-2">{strategy.checks.map(check => <li key={check.area} className="min-w-0 space-y-2 rounded-lg border bg-background/60 p-3"><div><h3 className="font-semibold">{checkAreas[check.area]}</h3><p className="mt-1 text-xs text-muted-foreground">{checkStates[check.status]}</p></div><p className="text-xs leading-relaxed">{check.finding}</p>
    {check.evidenceIds.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-medium">Sources for {checkAreas[check.area].toLowerCase()}</summary><div className="mt-2 space-y-3">{facts.filter(fact => check.evidenceIds.includes(fact.id)).map(fact => <div key={fact.id}><p className="font-medium">{fact.label}</p><p className="mt-1 break-words leading-relaxed text-muted-foreground">{fact.text}</p></div>)}{sources.filter(source => check.evidenceIds.includes(source.id)).map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className="block break-words underline underline-offset-4">{source.title}<span className="sr-only"> (opens in a new tab)</span></a>)}</div></details>}
  </li>)}</ul></details>;
}

// A partial or older API response must never enable a publish confirmation.
export function usablePageAssessment(review) {
  const analysis = review?.analysis;
  if (!analysis || ![5, 6, 'follow_up_1'].includes(review.provenance?.reviewVersion) || !Object.hasOwn(actions, analysis.action) ||
    !Object.hasOwn(metadataVerdicts, analysis.metadataVerdict) || typeof analysis.metadataReason !== 'string' || !analysis.metadataReason.trim() ||
    !['summary', 'reason', 'nextStep'].every(key => typeof analysis[key] === 'string' && analysis[key].trim()) ||
    !Array.isArray(analysis.evidenceIds) || !Array.isArray(review.evidence?.facts) ||
    !['available', 'partial', 'unavailable'].includes(review.evidence.status) ||
    !['not_requested', 'available', 'unavailable', 'no_sources'].includes(review.research?.status) ||
    !Array.isArray(review.research?.sources)) return false;
  if (!review.evidence.facts.every(fact => fact && ['id', 'label', 'text'].every(key => typeof fact[key] === 'string') && ['page', 'search'].includes(fact.kind)) ||
    !review.research.sources.every(source => source && typeof source.id === 'string' && typeof source.title === 'string' && webUrl(source.url))) return false;
  if (!Array.isArray(review.diagnostics?.facts) || !review.diagnostics.facts.every(fact => fact && ['id', 'label', 'text'].every(key => typeof fact[key] === 'string') && ['page', 'search'].includes(fact.kind)) ||
    !['available', 'unavailable'].includes(review.diagnostics.inspection?.status) || review.diagnostics.inspection.url !== review.evidence.pageUrl ||
    (review.diagnostics.inspection.inspectionUrl && !googleInspectionLink(review.diagnostics.inspection.inspectionUrl)) ||
    !Array.isArray(review.timeline) || review.timeline.length !== 3 || !review.timeline.every(item => item && ['label', 'when', 'description'].every(key => typeof item[key] === 'string' && item[key].trim()))) return false;
  const knownIds = new Set([
    ...reviewFacts(review).map(fact => fact.id),
    ...(review.research.status === 'available' ? review.research.sources.filter(source => webUrl(source.url)).map(source => source.id) : []),
  ]);
  if (analysis.evidenceIds.some(id => typeof id !== 'string' || !knownIds.has(id)) || !usableStrategy(analysis.strategy, knownIds) || !usableRecommendations(review, knownIds)) return false;
  if ((review.provenance.reviewVersion >= 6 || review.provenance.reviewVersion === 'follow_up_1') && !usableSearchFocus(analysis.searchFocus, knownIds)) return false;
  if ((analysis.action === 'revise_metadata') !== (analysis.metadataVerdict === 'revise') ||
    (analysis.action === 'keep_current' && analysis.metadataVerdict !== 'keep') ||
    (analysis.action === 'investigate_visibility' && !analysis.evidenceIds.some(id => /^(?:S|Q|H|I)\d+$/.test(id) || id === 'P4'))) return false;
  if (analysis.action === 'review_page' && !recommendedReviewPage(review)) return false;
  if (analysis.action !== 'revise_metadata') return !review.title && !review.description;
  return analysis.metadataVerdict === 'revise' && usableSuggestion(review.title) && usableSuggestion(review.description) && Boolean(review.provenance) &&
    Array.isArray(analysis.changedFields) && analysis.changedFields.length > 0 &&
    analysis.changedFields.every(field => ['title', 'description'].includes(field)) &&
    analysis.changedFields.every(field => typeof analysis.fieldReasons?.[field] === 'string' && analysis.fieldReasons[field].trim());
}

function periodLabel(window) {
  return window?.startDate && window?.endDate ? `${window.startDate}–${window.endDate}` : 'Dates unavailable';
}

function observedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function metric(value, decimal = false) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: decimal ? 1 : 0 }) : 'Unavailable';
}

function SearchPeriod({ label, window, period }) {
  const totals = period?.totals;
  return <div className="min-w-0 rounded-lg border bg-background/50 p-4">
    <h4 className="font-medium">{label}</h4><p className="mt-1 text-xs text-muted-foreground">{periodLabel(window)}</p>
    {totals ? <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
      <div><dt className="text-xs text-muted-foreground">Appearances</dt><dd className="font-medium">{metric(totals.impressions)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Clicks</dt><dd className="font-medium">{metric(totals.clicks)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Click-through rate</dt><dd className="font-medium">{typeof totals.ctr === 'number' && Number.isFinite(totals.ctr) ? `${metric(totals.ctr * 100, true)}%` : 'Unavailable'}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Average position</dt><dd className="font-medium">{metric(totals.position, true)}</dd></div>
    </dl> : <p className="mt-3 text-muted-foreground">{period?.totalsStatus === 'no_data' ? 'Google returned no search totals for this period.' : 'Search totals are unavailable for this period.'}</p>}
  </div>;
}

export default function PageReviewAssessment({ review, onReviewPage, hideActions = false }) {
  const { analysis, evidence, research } = review;
  const { strategy } = analysis;
  const facts = reviewFacts(review);
  const citedFacts = facts.filter(fact => analysis.evidenceIds.includes(fact.id));
  const sources = research.status === 'available' ? research.sources.filter(source => webUrl(source.url)) : [];
  const nextPage = analysis.action === 'review_page' ? recommendedReviewPage(review) : null;
  const researchedAt = observedAt(research.checkedAt);
  const checkedAt = observedAt(evidence.fetchedAt);
  const researchFailed = ['unavailable', 'no_sources'].includes(research.status);

  return <section aria-label="Page assessment" className="mb-6 overflow-hidden rounded-xl border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/20">
    <div className="space-y-4 p-5 md:p-6">
      <div className="border-b border-violet-200 pb-4 dark:border-violet-800"><p className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">Review for {pageIdentity(evidence.pageUrl)}</p><a href={evidence.pageUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block max-w-full break-all text-sm underline underline-offset-4">{evidence.pageUrl}<span className="sr-only"> (opens in a new tab)</span></a><p className="mt-2 text-xs text-muted-foreground">Analyzed {observedAt(review.provenance.generatedAt) || 'at an unavailable date'} · Reanalyze after changing the page to check whether these suggestions still fit.</p></div>
      {analysis.searchFocus && <SearchFocus focus={analysis.searchFocus} />}
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search goal for this page</p><p className="mt-1 text-sm leading-relaxed">{strategy.searchGoal}</p></div>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200"><ClipboardCheck className="h-4 w-4" aria-hidden="true" />What matters most</p>
      <div className="space-y-3"><h2 className="text-xl font-semibold">{strategy.finding === 'limited_findings' && !analysis.recommendations.length ? 'No clear change identified' : findingHeadings[strategy.finding]}</h2><p className="font-medium leading-relaxed">{analysis.summary}</p><div><p className="text-sm font-semibold">{['supported_issue', 'opportunity_to_test'].includes(strategy.finding) ? 'Why this is the priority' : 'Why this is our conclusion'}</p><p className="mt-1 text-sm leading-relaxed">{strategy.priorityReason}</p></div><p className="text-xs leading-relaxed text-muted-foreground">{strategy.limitation}</p></div>
      {!hideActions && <PageReviewActions recommendations={analysis.recommendations} facts={facts} sources={sources} finding={strategy.finding} />}
      <ReviewChecks strategy={strategy} facts={facts} sources={sources} />
      {(!analysis.recommendations.length || nextPage) && <div className="rounded-lg border border-violet-200 bg-background/70 p-4 dark:border-violet-800"><p className="mb-1 text-sm font-semibold">What to do next</p><p className="text-sm leading-relaxed">{analysis.nextStep}</p>
        {nextPage && <div className="mt-3 space-y-3"><p className="break-all text-xs text-muted-foreground">{nextPage}</p><Button variant="outline" onClick={() => onReviewPage?.(nextPage)}>Review recommended page</Button></div>}
      </div>}
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/30"><p className="text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">Title and description</p><h3 className="mt-2 font-semibold text-sky-950 dark:text-sky-50">{metadataVerdicts[analysis.metadataVerdict]}</h3><p className="mt-2 text-sm leading-relaxed text-sky-900 dark:text-sky-100">{analysis.metadataReason}</p></div>
      <PageReviewDiagnostics diagnostics={review.diagnostics} pageUrl={evidence.pageUrl} currentPage={review.currentPage} />
      {evidence.status !== 'available' && <p className="text-sm text-muted-foreground">{evidence.status === 'unavailable' ? 'Search data was unavailable for this review. The recommendation uses the page content and any available research.' : 'Some search data was unavailable. The evidence below shows what this review could use.'}</p>}
      {researchFailed && <p role="status" className="text-sm text-muted-foreground">Web research {research.status === 'no_sources' ? 'returned no usable sources' : 'was unavailable'}. This review continues without competitor evidence.</p>}
      {research.status === 'available' && <p className="text-xs text-muted-foreground">Web research included · {sources.length} {sources.length === 1 ? 'source' : 'sources'}. Open the evidence below to review them.</p>}
      {analysis.action === 'revise_metadata' && <div className="space-y-2 text-sm">
        {analysis.changedFields.map(field => <p key={field}><strong>{field === 'title' ? 'Why change the title:' : 'Why change the description:'}</strong> {analysis.fieldReasons[field]}</p>)}
      </div>}
      <details className="rounded-lg border bg-background/50 p-4 text-sm"><summary className="cursor-pointer font-medium">After publishing: when to check progress</summary><ol className="mt-4 space-y-4">{review.timeline.map((item, index) => <li key={item.label} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs" aria-hidden="true">{index + 1}</span><div><p className="font-medium">{item.when} · {item.label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p></div></li>)}</ol><p className="mt-4 text-xs text-muted-foreground">These are review checkpoints, not promised crawl dates or ranking results.</p></details>
      <details className="border-t border-violet-200 pt-4 text-sm dark:border-violet-800">
        <summary className="cursor-pointer rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Why this recommendation?</summary>
        <div className="mt-5 space-y-5">
          <p className="leading-relaxed">{analysis.reason}</p>
          <div><h3 className="mb-3 font-semibold">Evidence used</h3>{citedFacts.length ? <ul className="space-y-3">{citedFacts.map(fact => <li key={fact.id} className="rounded-lg border bg-background/50 p-4"><p className="text-xs font-medium text-muted-foreground">{fact.kind === 'search' ? 'Google Search Console' : 'Your live website'} · {fact.label}</p><p className="mt-1 leading-relaxed">{fact.text}</p></li>)}</ul> : <p className="text-muted-foreground">See the available sources and limitations below.</p>}</div>
          <div><h3 className="mb-3 flex items-center gap-2 font-semibold"><Search className="h-4 w-4" aria-hidden="true" />Search activity for this page</h3>
            <p className="mb-3 break-all text-xs text-muted-foreground">Google Search Console · {evidence.pageUrl}{checkedAt ? ` · Checked ${checkedAt}` : ''}</p>
            <div className="grid gap-3 md:grid-cols-2"><SearchPeriod label="Recent period" window={evidence.window} period={evidence.current} /><SearchPeriod label="Previous period" window={evidence.previousWindow} period={evidence.previous} /></div>
          </div>
          <div className="space-y-3"><h3 className="font-semibold">Web research</h3>
            {research.status === 'not_requested' ? <p className="text-muted-foreground">Not included in this review.</p> : <>
              {research.summary && <ResearchSummary summary={research.summary} sources={sources} />}
              {sources.length > 0 && <ul className="space-y-3">{sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-2 font-medium underline underline-offset-4"><span className="break-words">{source.title || source.url}</span><ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="sr-only">Opens in a new tab</span></a><p className="mt-1 break-all text-xs text-muted-foreground">{source.url}</p></li>)}</ul>}
              {researchedAt && <p className="text-xs text-muted-foreground">Research checked {researchedAt}.</p>}
              {research.limitation && <p className="text-xs leading-relaxed text-muted-foreground">{research.limitation}</p>}
            </>}
          </div>
          {evidence.limitations?.length > 0 && <div><h3 className="mb-2 font-semibold">What this review cannot tell us</h3><ul className="list-disc space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">{evidence.limitations.map((limitation, index) => <li key={`${index}-${limitation}`}>{limitation}</li>)}</ul></div>}
          <p className="text-xs leading-relaxed text-muted-foreground">This is an AI assessment of the available evidence, not a promise of better rankings. Confirm a wording change only after publishing it on your website.</p>
        </div>
      </details>
    </div>
  </section>;
}
