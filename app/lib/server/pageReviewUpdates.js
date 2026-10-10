import { createHash } from 'node:crypto';
import { PAGE_REVIEW_MODEL } from '../pageReviewPolicy';

export const PAGE_REVIEW_VERSION = 6;
const BASELINE_VERSION = 1;
const volatile = new Set(['fetchedAt', 'checkedAt', 'facts', 'limitations', 'limitation', 'inspectionUrl', 'savedRows', 'savedSample']);

// Observation times and generated fact prose change on every read. Compare the
// underlying observations instead; preserve dates that actually define evidence
// (search windows and Google's last crawl), plus all source-content structure.
function canonical(value, key = '', queryLimit = Infinity) {
  if (Array.isArray(value)) {
    let rows = value;
    if (key === 'queries') rows = [...rows].sort((a, b) => (b.impressions || 0) - (a.impressions || 0)
      || (b.clicks || 0) - (a.clicks || 0) || String(a.query).localeCompare(String(b.query))).slice(0, queryLimit);
    if (key === 'relatedPages') rows = [...rows].sort((a, b) => String(a.pageUrl).localeCompare(String(b.pageUrl)));
    return rows.map(item => canonical(item, '', queryLimit));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(name => !volatile.has(name) && value[name] !== undefined)
    .map(name => [name, canonical(value[name], name, queryLimit)]));
}

function fingerprint(context, queryLimit = Infinity) {
  const { currentPage, evidence, diagnostics, ownerGoal = '', focusKeywords = [], provenance } = context;
  return createHash('sha256').update(JSON.stringify(canonical({
    currentPage, evidence, diagnostics, ownerGoal, focusKeywords,
    property: provenance.property, websiteRunId: provenance.websiteRunId, pageUrl: provenance.pageUrl,
    model: PAGE_REVIEW_MODEL, reviewVersion: PAGE_REVIEW_VERSION,
  }, '', queryLimit))).digest('hex');
}

export function pageReviewUpdateBaseline(context) {
  return { version: BASELINE_VERSION, fingerprint: fingerprint(context), focusKeywords: context.focusKeywords || [] };
}

function diagnosticsDegraded(previous, current) {
  if (previous?.inspection?.status === 'available' && current?.inspection?.status !== 'available') return true;
  return (current?.relatedPages || []).some(page => {
    const old = previous?.relatedPages?.find(item => item.pageUrl === page.pageUrl);
    // A confirmed HTTP failure is new evidence, unlike a failed attempt to read.
    const readFailed = page.status === 'unavailable' && !(page.httpStatus >= 400 && page.httpStatus < 500);
    if (readFailed && old?.status !== 'unavailable') return true;
    if (old?.inspection?.status === 'available' && page.inspection?.status !== 'available') return true;
    return ['current', 'previous'].some(period => page.comparison?.[period]?.status === 'unavailable'
      && old?.comparison?.[period]?.status !== 'unavailable');
  });
}

export function comparePageReviewUpdate(savedReview, context) {
  if (!savedReview) return 'updated';
  if (context.evidence.status !== 'available' || diagnosticsDegraded(savedReview.diagnostics, context.diagnostics)) return 'incomplete';
  if (savedReview.provenance?.reviewVersion !== PAGE_REVIEW_VERSION || savedReview.provenance?.model !== PAGE_REVIEW_MODEL) return 'updated';
  const baseline = savedReview.updateBaseline;
  if (baseline) return baseline.version === BASELINE_VERSION && baseline.fingerprint === fingerprint(context) ? 'unchanged' : 'updated';
  // Existing version-six reviews already contain a bounded evidence snapshot.
  // They can be reused without a migration or an otherwise unnecessary AI call.
  // Older reviews did not retain all optional input phrases, so do not guess.
  if (context.focusKeywords.length || savedReview.evidence?.selectedPhrase?.value) return 'updated';
  if (!savedReview.currentPage || !savedReview.evidence || !savedReview.diagnostics) return 'updated';
  return fingerprint({ ...savedReview, focusKeywords: [] }, 40) === fingerprint(context, 40) ? 'unchanged' : 'updated';
}

export function pageReviewUpdateLimitation(diagnostics) {
  return diagnostics?.inspection?.status !== 'available'
    || diagnostics?.relatedPages?.some(page => page.status !== 'available' || page.inspection?.status !== 'available'
      || ['current', 'previous'].some(period => page.comparison?.[period]?.status === 'unavailable'))
    ? 'No new changes were found in the evidence we could check. Some Google index or linked-page checks remain unavailable; saved research keeps its original date.'
    : 'Saved web research keeps its original date; a new review runs when your page, goal or search evidence changes.';
}
