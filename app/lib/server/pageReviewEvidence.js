import { propertyContainsUrl } from '../revampState';
import { searchWindow } from '../searchWindow';
import { getGscConnection } from './gscConnection';
import { RequestError } from './requestAuth';

const QUERY_LIMIT = 1000;
const MODEL_QUERY_LIMIT = 40;
const RELATED_PAGE_LIMIT = 5;
const HISTORY_WINDOW_COUNT = 6;
const invalid = () => { throw new Error('Invalid Search Console evidence.'); };

function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function isScopedPage(property, pageUrl) {
  if (typeof pageUrl !== 'string' || pageUrl.length > 2048 || !propertyContainsUrl(property, pageUrl)) return false;
  const url = new URL(pageUrl);
  return !url.username && !url.password && !url.hash;
}

function readRows(result, limit) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.error
    || (result.rows !== undefined && !Array.isArray(result.rows))) invalid();
  const rows = result.rows || [];
  if (rows.length > limit) invalid();
  return rows;
}

function readMetrics(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || ![row.clicks, row.impressions, row.ctr, row.position].every(Number.isFinite)
    || row.clicks < 0 || row.impressions < 0 || row.clicks > row.impressions
    || row.ctr < 0 || row.ctr > 1 || row.position < 0
    || (row.impressions > 0 && row.position < 1)) invalid();
  return {
    clicks: row.clicks, impressions: row.impressions,
    ctr: row.impressions > 0 ? row.ctr : null,
    position: row.impressions > 0 ? row.position : null,
  };
}

function readTotals(result) {
  const rows = readRows(result, 1);
  const row = rows[0];
  if (!row) return null;
  if (row.keys !== undefined && (!Array.isArray(row.keys) || row.keys.length)) invalid();
  return readMetrics(row);
}

function readDimension(result, { limit, field, property }) {
  const seen = new Set();
  return readRows(result, limit).map(row => {
    if (!row || !Array.isArray(row.keys) || row.keys.length !== 1
      || typeof row.keys[0] !== 'string' || !row.keys[0].trim()) invalid();
    const key = row.keys[0];
    if (seen.has(key) || (field === 'query' && key.length > 1024)
      || (field === 'pageUrl' && !isScopedPage(property, key))) invalid();
    seen.add(key);
    return { [field]: key, ...readMetrics(row) };
  });
}

function firstPhrase(focusKeywords) {
  if (!Array.isArray(focusKeywords) || focusKeywords.length > 5
    || focusKeywords.some(value => typeof value !== 'string' || value.length > 120)) {
    throw new RequestError('Use at most five short focus keywords.');
  }
  return focusKeywords.map(value => value.trim()).find(Boolean) || '';
}

const shortText = (value, limit) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const metricText = value => `${value.impressions} appearances, ${value.clicks} clicks, ${value.ctr === null ? 'unknown click-through rate' : `${(value.ctr * 100).toFixed(2)}% click-through rate`}, ${value.position === null ? 'unknown average position' : `average position ${value.position}`}`;
const dates = window => `${window.startDate} through ${window.endDate}`;

function evidenceFacts(currentPage, evidence) {
  const headings = Array.isArray(currentPage?.headings) ? currentPage.headings.map(item => shortText(item?.text, 200)).filter(Boolean).slice(0, 8) : [];
  const facts = currentPage ? [
    { id: 'P1', kind: 'page', label: 'Current page title', text: shortText(currentPage?.htmlTitle, 500) || 'No HTML title was found in the fetched page.' },
    { id: 'P2', kind: 'page', label: 'Current page description', text: shortText(currentPage?.seoMetaDescription, 1000) || 'No meta description was found in the fetched page.' },
    { id: 'P3', kind: 'page', label: 'Current page content excerpt', text: shortText([
      shortText(currentPage?.h1, 300), ...headings, shortText(currentPage?.textContent, 1200),
    ].filter(Boolean).join(' | '), 2200) || 'No readable content was found in the fetched page.' },
  ] : [];
  for (const [key, id, label, window] of [
    ['current', 'S1', 'Recent page search activity', evidence.window],
    ['previous', 'S2', 'Previous page search activity', evidence.previousWindow],
  ]) {
    const period = evidence[key];
    if (period.totalsStatus === 'unavailable') continue;
    facts.push({ id, kind: 'search', label, text: period.totals
      ? `Exact page ${evidence.pageUrl}; ${dates(window)}: ${metricText(period.totals)}.`
      : `Search Console returned no total rows for exact page ${evidence.pageUrl} during ${dates(window)}. This does not establish indexing status.` });
  }
  evidence.current.queries.slice(0, MODEL_QUERY_LIMIT).forEach((row, index) => facts.push({
    id: `Q${index + 1}`, kind: 'search', label: 'Observed search query',
    text: `Query ${JSON.stringify(row.query)} for exact page ${evidence.pageUrl}; ${dates(evidence.window)}: ${metricText(row)}.`,
  }));
  evidence.relatedPages.forEach((row, index) => facts.push({
    id: `R${index + 1}`, kind: 'search', label: 'Another page appearing for the selected phrase',
    text: `Exact query ${JSON.stringify(evidence.selectedPhrase.value)}; ${dates(evidence.window)}; page ${row.pageUrl}: ${metricText(row)}. This is search activity, not a recommendation to move content.`,
  }));
  evidence.history.forEach((period, index) => {
    if (period.totalsStatus === 'unavailable') return;
    facts.push({
      id: `H${index + 1}`, kind: 'search', label: 'Historical activity for this exact URL',
      text: period.totals
        ? `Exact page ${evidence.pageUrl}; ${dates(period.window)}: ${metricText(period.totals)}. This URL may have had different content or wording during this period.`
        : `Search Console returned no total rows for exact page ${evidence.pageUrl} during ${dates(period.window)}. This does not establish indexing status or the age or performance of the current wording.`,
    });
  });
  return facts;
}

/** Read-only, bounded evidence for one authenticated account's exact current page. */
export async function collectPageReviewEvidence(userId, { pageUrl, property, currentPage, focusKeywords = [], now = new Date() }) {
  if (typeof property !== 'string' || !property || !isScopedPage(property, pageUrl)) {
    throw new RequestError('Page must belong to your connected Search Console property.', 403);
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RequestError('A valid observation time is required.');
  const phrase = firstPhrase(focusKeywords);
  const window = searchWindow('28', now);
  const previousWindow = { startDate: shiftDay(window.startDate, -28), endDate: shiftDay(window.startDate, -1) };
  const history = Array.from({ length: HISTORY_WINDOW_COUNT }, (_, index) => ({
    window: { startDate: shiftDay(window.startDate, -28 * index), endDate: shiftDay(window.endDate, -28 * index) },
    totals: null, totalsStatus: 'unavailable',
  }));
  const emptyPeriod = () => ({ totals: null, queries: [], totalsStatus: 'unavailable', queriesStatus: 'unavailable',
    queryCoverage: { coverage: 'reported_queries', mayBeIncomplete: true, requestedLimit: QUERY_LIMIT,
      returnedRows: null, selectedForReview: null, hitRowLimit: null, order: 'impressions_descending' } });
  const evidence = {
    source: 'google_search_console', property, pageUrl, window, previousWindow, fetchedAt: now.toISOString(),
    status: 'unavailable', current: emptyPeriod(), previous: emptyPeriod(), relatedPages: [], history,
    relatedPagesStatus: phrase ? 'unavailable' : 'not_requested',
    selectedPhrase: { value: phrase, source: phrase ? 'provided' : 'none' },
    limitations: [
      'Search Console query and page rows are limited samples and may omit searches for privacy. Page totals are requested separately, never summed from query rows.',
      'Each recent period requests up to 1,000 query rows. Google returns top rows by clicks; the returned rows are then ordered by appearances, and at most 40 current queries become individual review facts. Even a response below the limit is not a complete list of searches.',
      'History covers six adjacent 28-day windows (168 days) of finalized web-search data, newest first. The newest three days are excluded. These are not a before-and-after test of a confirmed edit.',
      'Historical activity belongs to this exact URL and may span earlier website versions. The age of the current title, description and page content is unknown; this history does not measure how long the current wording has been in use.',
      'Search activity does not establish whether a page is indexed, explain a ranking cause, or predict improvement from a proposed change.',
    ],
    facts: [],
  };
  let connection;
  try { connection = await getGscConnection(userId); }
  catch {
    evidence.limitations.push('Search Console could not be read for this review. No missing metrics have been treated as zero.');
    evidence.facts = evidenceFacts(currentPage, evidence);
    return evidence;
  }
  if (connection.siteUrl !== property) throw new RequestError('Search Console property does not match your connection.', 403);

  const pageFilter = [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] }];
  const common = period => ({ ...period, type: 'web', dataState: 'final', aggregationType: 'auto' });
  const plans = [window, previousWindow].flatMap(period => [
    { ...common(period), dimensionFilterGroups: pageFilter, rowLimit: 1 },
    { ...common(period), dimensionFilterGroups: pageFilter, dimensions: ['query'], rowLimit: QUERY_LIMIT },
  ]);
  // Reuse the first two total observations above; only four older total reads
  // are added. Older query lists are not needed for this bounded history view.
  plans.push(...history.slice(2).map(period => ({ ...common(period.window), dimensionFilterGroups: pageFilter, rowLimit: 1 })));
  if (phrase) plans.push({
    ...common(window), dimensions: ['page'], rowLimit: RELATED_PAGE_LIMIT,
    dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'query', operator: 'equals', expression: phrase }] }],
  });
  const results = await Promise.allSettled(plans.map(plan => Promise.resolve().then(() => connection.query(plan))));
  let successfulQueries = 0;
  for (const [index, key, field] of [
    [0, 'current', 'totals'], [1, 'current', 'queries'], [2, 'previous', 'totals'], [3, 'previous', 'queries'],
  ]) {
    try {
      if (results[index].status !== 'fulfilled') invalid();
      const value = field === 'totals' ? readTotals(results[index].value)
        : readDimension(results[index].value, { limit: QUERY_LIMIT, field: 'query' });
      evidence[key][field] = field === 'queries'
        ? value.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query)) : value;
      if (field === 'queries') evidence[key].queryCoverage = {
        ...evidence[key].queryCoverage, returnedRows: value.length,
        selectedForReview: Math.min(value.length, MODEL_QUERY_LIMIT), hitRowLimit: value.length === QUERY_LIMIT,
      };
      evidence[key][`${field}Status`] = field === 'totals'
        ? (value && value.impressions > 0 ? 'available' : 'no_data')
        : (value.length ? 'available' : 'no_data');
      successfulQueries += 1;
    } catch {
      evidence.limitations.push(`${key === 'current' ? 'Recent' : 'Previous'} page ${field === 'totals' ? 'totals' : 'query rows'} could not be read or validated. Missing metrics have not been treated as zero.`);
    }
  }
  for (const [index, key] of [[0, 'current'], [1, 'previous']]) {
    history[index].totals = evidence[key].totals;
    history[index].totalsStatus = evidence[key].totalsStatus;
  }
  for (let index = 2; index < HISTORY_WINDOW_COUNT; index += 1) {
    try {
      const result = results[index + 2];
      if (result.status !== 'fulfilled') invalid();
      const value = readTotals(result.value);
      history[index].totals = value;
      history[index].totalsStatus = value && value.impressions > 0 ? 'available' : 'no_data';
      successfulQueries += 1;
    } catch {
      evidence.limitations.push(`Historical page totals for ${dates(history[index].window)} could not be read or validated. Missing metrics have not been treated as zero.`);
    }
  }
  if (phrase) {
    try {
      if (results[8].status !== 'fulfilled') invalid();
      evidence.relatedPages = readDimension(results[8].value, { limit: RELATED_PAGE_LIMIT, field: 'pageUrl', property }).filter(row => row.pageUrl !== pageUrl);
      evidence.relatedPagesStatus = evidence.relatedPages.length ? 'available' : 'no_data';
      successfulQueries += 1;
    } catch { evidence.limitations.push('Other pages for the selected search phrase could not be read or validated.'); }
    // Only an exact query returned for this page establishes this provenance.
    // A provided phrase, or a query observed solely on another page, does not.
    if (evidence.current.queries.some(row => row.query === phrase) || evidence.previous.queries.some(row => row.query === phrase)) {
      evidence.selectedPhrase.source = 'observed';
    }
    evidence.limitations.push('The related-page lookup is limited to five returned pages for the first selected phrase. It does not prove which page best serves that search.');
  }
  evidence.status = successfulQueries === plans.length ? 'available' : successfulQueries ? 'partial' : 'unavailable';
  if (history.some(period => period.totalsStatus === 'no_data'
    || (period.totals && (period.totals.impressions < 100 || period.totals.clicks < 10)))) {
    evidence.limitations.push('At least one period has no reported totals, fewer than 100 appearances, or fewer than 10 clicks. Treat patterns as tentative; these are review heuristics, not a statistical confidence test.');
  }
  evidence.facts = evidenceFacts(currentPage, evidence);
  return evidence;
}
