import { searchWindow } from './searchWindow';

const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const windowOK = value => value && day(value.startDate) && day(value.endDate)
  && Date.parse(value.endDate) - Date.parse(value.startDate) === 27 * 86400000;
const clean = (value, limit) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const metricsOK = value => value && Number.isFinite(value.clicks) && Number.isFinite(value.impressions)
  && value.clicks >= 0 && value.impressions >= value.clicks
  && (value.impressions === 0 ? value.ctr === null && value.position === null
    : Number.isFinite(value.ctr) && value.ctr >= 0 && value.ctr <= 1 && Number.isFinite(value.position) && value.position >= 1);
const metrics = value => ({ clicks: value.clicks, impressions: value.impressions, ctr: value.ctr, position: value.position });

// The comparison display and AI use the same immutable, scoped checkpoint.
// Never silently replace its historical totals with a later provider response.
export function followUpEvidence(cycle, currentPage, now = new Date()) {
  const checkpoint = cycle.latestCheckpoint, windows = checkpoint?.windows;
  if (checkpoint?.source !== 'google_search_console' || !windowOK(windows?.baseline) || !windowOK(windows?.post)
    || windows.baseline.endDate >= windows.post.startDate || windows.post.endDate > searchWindow('28', now).endDate) {
    throw new Error('A valid complete saved comparison is required.');
  }
  const read = (observation, window) => {
    if (observation?.status === 'unavailable') return { totals: null, totalsStatus: 'unavailable', queries: [], queriesStatus: 'unavailable', queryCoverage: { mayBeIncomplete: true } };
    if (!observation || observation.source !== 'google_search_console' || observation.property !== cycle.property
      || observation.pageUrl !== cycle.pageUrl || observation.startDate !== window.startDate || observation.endDate !== window.endDate
      || observation.dataState !== 'final' || observation.searchType !== 'web' || !metricsOK(observation)) throw new Error('The saved observations do not match this page comparison.');
    const queries = observation.queries || [];
    const available = ['available', 'not_reported', 'no_data'].includes(observation.queriesStatus);
    if (available && (!Array.isArray(queries) || queries.length > 100 || new Set(queries.map(row => row.query)).size !== queries.length
      || queries.some(row => typeof row.query !== 'string' || !row.query.trim() || row.query.length > 1024 || !metricsOK(row)))) throw new Error('The saved query observations are invalid.');
    return { totals: observation.impressions > 0 ? metrics(observation) : null,
      totalsStatus: observation.impressions > 0 ? 'available' : 'no_data',
      queries: available ? [...queries].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query)) : [],
      queriesStatus: available ? queries.length ? 'available' : 'no_data' : 'unavailable',
      queryCoverage: { ...(observation.queryCoverage || {}), mayBeIncomplete: true }, observedAt: observation.fetchedAt };
  };
  const current = read(checkpoint.post, windows.post), previous = read(checkpoint.baseline, windows.baseline);
  const facts = [
    { id: 'P1', kind: 'page', label: 'Current title', text: clean(currentPage.htmlTitle, 500) || 'No HTML title was found.' },
    { id: 'P2', kind: 'page', label: 'Current description', text: clean(currentPage.seoMetaDescription, 1000) || 'No meta description was found.' },
    { id: 'P3', kind: 'page', label: 'Current content excerpt', text: clean(currentPage.textContent, 2200) || 'No readable text was found.' },
  ];
  for (const [period, id, label, window] of [[current, 'S1', 'Later comparison period', windows.post], [previous, 'S2', 'Earlier comparison period', windows.baseline]]) {
    if (period.totalsStatus !== 'unavailable') facts.push({ id, kind: 'search', label,
      text: `Exact page ${cycle.pageUrl}; ${window.startDate} through ${window.endDate}; ${period.totals ? JSON.stringify(period.totals) : 'No page total rows were reported. This is not indexing evidence.'}` });
  }
  current.queries.slice(0, 40).forEach((row, index) => facts.push({ id: `Q${index + 1}`, kind: 'search', label: 'Reported later-period query',
    text: `Exact page ${cycle.pageUrl}; ${windows.post.startDate} through ${windows.post.endDate}; ${JSON.stringify(row)}. An omitted query is not measured zero.` }));
  previous.queries.slice(0, 40).forEach((row, index) => facts.push({ id: `B${index + 1}`, kind: 'search', label: 'Reported earlier-period query',
    text: `Exact page ${cycle.pageUrl}; ${windows.baseline.startDate} through ${windows.baseline.endDate}; ${JSON.stringify(row)}. An omitted query is not measured zero.` }));
  return { source: 'google_search_console', property: cycle.property, pageUrl: cycle.pageUrl,
    window: windows.post, previousWindow: windows.baseline, comparisonKind: 'confirmed_change',
    fetchedAt: checkpoint.observedAt, checkpointId: checkpoint.id, evidenceRevision: checkpoint.evidenceRevision || 1,
    status: [current, previous].every(period => period.totalsStatus !== 'unavailable' && period.queriesStatus !== 'unavailable') ? 'available' : 'partial',
    current, previous, history: [], relatedPages: [], relatedPagesStatus: 'not_requested',
    selectedPhrase: { value: cycle.confirmation?.searchFocus?.phrase || '', source: 'provided' }, facts,
    limitations: ['These are the same saved observations displayed in this confirmed-change checkpoint. They are not a controlled causal test.',
      'Queries were requested with the same page, web-search and final-data filters and the exact comparison dates. The returned query lists may differ and are incomplete.',
      'Google omits some queries. Missing rows are not zero, and sums of query rows need not equal page totals. Name-like phrases can be ambiguous.',
      'Average position is an aggregate over reported appearances, not a fixed Google results-page number. Sparse data supports only tentative interpretation.'],
  };
}
