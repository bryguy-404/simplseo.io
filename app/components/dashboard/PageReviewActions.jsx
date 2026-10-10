"use client";

import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { propertyContainsUrl } from '../../lib/revampState';

const types = { heading: 'Heading', content: 'Page content', internal_link: 'Internal link', technical: 'Technical check', metadata: 'Title and description', check: 'Investigation' };
const bases = { observed_issue: 'Issue found in the evidence', opportunity: 'Opportunity to improve', needs_check: 'Needs your check' };

export function knownActionTarget(review, target) {
  if (!target || !propertyContainsUrl(review.evidence?.property, target)) return false;
  return [...(review.evidence.relatedPages || []), ...(review.diagnostics?.relatedPages || [])].some(page => page.pageUrl === target) ||
    (review.currentPage?.internalLinks || []).some(link => link.url === target);
}

export function usableRecommendations(review, knownIds) {
  const recommendations = review.analysis?.recommendations;
  if (typeof review.analysis?.pageGoal !== 'string' || !review.analysis.pageGoal.trim() || !Array.isArray(recommendations) || recommendations.length > 3 ||
    (!recommendations.length && !['keep_current', 'collect_data'].includes(review.analysis.action))) return false;
  return recommendations.every((item, index) => item && item.id === `action-${index + 1}` && Object.hasOwn(types, item.type) && Object.hasOwn(bases, item.basis) &&
    ['label', 'location', 'reason', 'instruction'].every(key => typeof item[key] === 'string' && item[key].trim()) &&
    ['currentQuote', 'supportingQuote'].every(key => typeof item[key] === 'string') &&
    (item.proposedText === null || typeof item.proposedText === 'string') &&
    (item.targetUrl === null || (item.type === 'internal_link' && knownActionTarget(review, item.targetUrl))) &&
    Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0 && item.evidenceIds.every(id => knownIds.has(id)));
}

function ActionBody({ item, facts, sources }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(item.proposedText); toast.success('Suggested wording copied'); }
    catch { toast.error('Copy failed. You can select and copy the wording yourself.'); }
  };
  const citedFacts = facts.filter(fact => item.evidenceIds.includes(fact.id));
  const citedSources = sources.filter(source => item.evidenceIds.includes(source.id));
  return <div className="space-y-4">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where on this page</p><p className="mt-1 text-sm leading-relaxed">{item.location}</p></div>
    <p className="text-sm leading-relaxed">{item.instruction}</p>
    {(item.currentQuote || item.proposedText) && <div className={`grid gap-3 ${item.currentQuote && item.proposedText ? 'md:grid-cols-2' : ''}`}>
      {item.currentQuote && <div className="min-w-0 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/30"><p className="mb-2 text-xs font-semibold text-sky-900 dark:text-sky-200">Observed on your page</p><blockquote className="whitespace-pre-wrap break-words text-sm leading-relaxed text-sky-950 dark:text-sky-100">{item.currentQuote}</blockquote></div>}
      {item.proposedText && <div className="min-w-0 rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30"><div className="mb-2 flex items-start justify-between gap-2"><p className="text-xs font-semibold text-violet-900 dark:text-violet-200">Suggested wording · review before using</p><Button size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label={`Copy wording for ${item.label}`} onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" /></Button></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-violet-950 dark:text-violet-100">{item.proposedText}</p></div>}
    </div>}
    {item.targetUrl && <p className="text-sm">Link to this existing page: <a href={item.targetUrl} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4">{item.targetUrl}<ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></p>}
    <details className="border-t pt-3 text-sm"><summary className="cursor-pointer font-medium">Why this action?</summary><div className="mt-3 space-y-3"><p className="leading-relaxed">{item.reason}</p>
      {citedFacts.map(fact => <div key={fact.id} className="rounded-lg border bg-background/50 p-3"><p className="text-xs font-medium text-muted-foreground">{fact.label}</p><p className="mt-1 text-xs leading-relaxed">{fact.text}</p></div>)}
      {citedSources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className="block break-words text-xs underline underline-offset-4">{source.title}<span className="sr-only"> (opens in a new tab)</span></a>)}
    </div></details>
  </div>;
}

export default function PageReviewActions({ recommendations, facts, sources }) {
  if (!recommendations.length) return null;
  return <div className="space-y-3" aria-label="Prioritized page actions">
    <p className="text-xs text-muted-foreground">Start with the first action. All changes below apply to the selected page; publish them in your website editor.</p>
    {recommendations.map((item, index) => <article key={item.id} className={`overflow-hidden rounded-xl border bg-background/80 ${index === 0 ? 'border-violet-300 dark:border-violet-700' : ''}`} aria-label={item.label}>
      {index === 0 ? <div className="space-y-4 p-4 md:p-5"><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">Start here · {types[item.type]}</p><h3 className="mt-2 text-lg font-semibold">{item.label}</h3><p className="mt-2 text-xs text-muted-foreground">{bases[item.basis]}</p></div><ActionBody item={item} facts={facts} sources={sources} /></div>
        : <details className="p-4 md:p-5"><summary className="cursor-pointer font-semibold">{index + 1}. {item.label}<span className="mt-1 block text-xs font-normal text-muted-foreground">{types[item.type]} · {bases[item.basis]}</span></summary><div className="mt-4"><ActionBody item={item} facts={facts} sources={sources} /></div></details>}
    </article>)}
  </div>;
}
