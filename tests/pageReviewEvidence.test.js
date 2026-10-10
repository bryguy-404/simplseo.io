import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', () => ({ auth: {}, db: {} }));
vi.mock('../app/lib/server/gscConnection', () => ({ getGscConnection: vi.fn() }));

import { getGscConnection } from '../app/lib/server/gscConnection';
import { collectPageReviewEvidence } from '../app/lib/server/pageReviewEvidence';

const property = 'https://example.test/';
const pageUrl = `${property}Services/?Topic=Web&Area=SouthBend`;
const now = new Date('2026-10-10T16:00:00.000Z');
const window = { startDate: '2026-09-10', endDate: '2026-10-07' };
const previousWindow = { startDate: '2026-08-13', endDate: '2026-09-09' };
const phrase = 'Web Design South Bend';
const currentPage = {
  htmlTitle: 'Example Studio | Custom Websites',
  seoMetaDescription: 'Custom websites and maintenance for small businesses in South Bend.',
  h1: 'Websites for small businesses',
  headings: [{ level: 2, text: 'Our design process' }],
  textContent: 'Example Studio plans and builds websites for small businesses. Our design process starts with understanding your services and your customers.',
};
const metrics = { clicks: 12, impressions: 200, ctr: 0.06, position: 8.25 };
const queryMetrics = { clicks: 2, impressions: 30, ctr: 2 / 30, position: 14.5 };
const collect = overrides => collectPageReviewEvidence('alice', { property, pageUrl, currentPage, now, ...overrides });
let query;

beforeEach(() => {
  query = vi.fn(async body => body.dimensions?.[0] === 'query'
    ? { rows: [{ keys: [phrase], ...queryMetrics }] }
    : body.dimensions?.[0] === 'page'
      ? { rows: [{ keys: [`${property}WebDesign?Audience=Business`], ...queryMetrics }] }
      : { rows: [metrics] });
  getGscConnection.mockReset().mockResolvedValue({ siteUrl: property, query });
});

describe('exact-page evidence scope and dates', () => {
  it('requests separate exact-page totals and bounded query rows in adjacent finalized windows', async () => {
    const result = await collect();
    expect(getGscConnection).toHaveBeenCalledExactlyOnceWith('alice');
    expect(query).toHaveBeenCalledTimes(8);
    const requests = query.mock.calls.map(([body]) => body);
    for (const [index, body] of requests.slice(0, 4).entries()) {
      expect(body).toMatchObject({ ...(index < 2 ? window : previousWindow), type: 'web', dataState: 'final', aggregationType: 'auto' });
      expect(body.dimensionFilterGroups).toEqual([{ groupType: 'and', filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] }]);
      if (index % 2) expect(body).toMatchObject({ dimensions: ['query'], rowLimit: 20 });
      else { expect(body.rowLimit).toBe(1); expect(body).not.toHaveProperty('dimensions'); }
    }
    for (const [index, body] of requests.slice(4).entries()) {
      expect(body).toEqual({ ...result.history[index + 2].window, type: 'web', dataState: 'final', aggregationType: 'auto', rowLimit: 1,
        dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] }] });
    }
    expect(result).toMatchObject({ source: 'google_search_console', property, pageUrl, window, previousWindow, fetchedAt: now.toISOString(), status: 'available' });
    expect(result.current.totals).toEqual(metrics);
    expect(result.current.queries).toEqual([{ query: phrase, ...queryMetrics }]);
    expect(result.current.totals.clicks).not.toBe(result.current.queries.reduce((sum, row) => sum + row.clicks, 0));
    expect(result.relatedPagesStatus).toBe('not_requested');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('uses Pacific calendar dates even while UTC is already on the next day', async () => {
    const result = await collect({ now: new Date('2026-10-10T02:00:00Z') });
    expect(result.window).toEqual({ startDate: '2026-09-09', endDate: '2026-10-06' });
    expect(result.previousWindow).toEqual({ startDate: '2026-08-12', endDate: '2026-09-08' });
  });

  it('rejects a changed account property before querying Google', async () => {
    getGscConnection.mockResolvedValue({ siteUrl: 'https://another.test/', query });
    await expect(collect()).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['https://another.test/', 'https://user:secret@example.test/', `${pageUrl}#content`, 'javascript:alert(1)'])('rejects unsafe or out-of-property page %s', async value => {
    await expect(collect({ pageUrl: value })).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
    expect(getGscConnection).not.toHaveBeenCalled();
  });

  it('supports a domain property without altering exact page URL or query capitalization', async () => {
    const domain = 'sc-domain:example.test';
    const exactPage = 'https://www.example.test/CasePath?Key=Value';
    getGscConnection.mockResolvedValue({ siteUrl: domain, query });
    const result = await collect({ property: domain, pageUrl: exactPage });
    expect(result.pageUrl).toBe(exactPage);
    expect(query.mock.calls[0][0].dimensionFilterGroups[0].filters[0].expression).toBe(exactPage);
  });
});

describe('missing, zero and unavailable evidence remain distinct', () => {
  it('keeps absent provider totals null and empty query rows distinct from an outage', async () => {
    query.mockResolvedValue({});
    const result = await collect();
    expect(result.status).toBe('available');
    expect(result.current).toEqual({ totals: null, queries: [], totalsStatus: 'no_data', queriesStatus: 'no_data' });
    expect(result.previous).toEqual(result.current);
    expect(result.facts.find(fact => fact.id === 'S1').text).toContain('returned no total rows');
    expect(result.facts.find(fact => fact.id === 'S1').text).not.toContain('0 clicks');
    expect(result.limitations.join(' ')).toContain('not a statistical confidence test');
  });

  it('retains explicit zero counts while leaving rates and position unknown', async () => {
    query.mockImplementation(async body => body.dimensions ? { rows: [] } : { rows: [{ clicks: 0, impressions: 0, ctr: 0, position: 0 }] });
    const result = await collect();
    expect(result.current.totals).toEqual({ clicks: 0, impressions: 0, ctr: null, position: null });
    expect(result.current.totalsStatus).toBe('no_data');
    expect(result.status).toBe('available');
    expect(result.facts.find(fact => fact.id === 'S1').text).toContain('0 clicks');
  });

  it('returns only page facts when all eight Google requests fail without leaking errors', async () => {
    query.mockRejectedValue(new Error('private-token provider diagnostics'));
    const result = await collect();
    expect(result.status).toBe('unavailable');
    expect(result.current).toEqual({ totals: null, queries: [], totalsStatus: 'unavailable', queriesStatus: 'unavailable' });
    expect(result.facts.map(fact => fact.id)).toEqual(['P1', 'P2', 'P3']);
    expect(result.facts[0].text).toBe(currentPage.htmlTitle);
    expect(result.facts[2].text).toContain('Our design process');
    expect(JSON.stringify(result)).not.toMatch(/private-token|provider diagnostics/);
    expect(query).toHaveBeenCalledTimes(8);
  });

  it('retains page facts and safely reports an unavailable connection without querying', async () => {
    getGscConnection.mockRejectedValue(new Error('refresh token hidden-secret'));
    const result = await collect();
    expect(result.status).toBe('unavailable');
    expect(result.facts.map(fact => fact.id)).toEqual(['P1', 'P2', 'P3']);
    expect(result.facts[1].text).toBe(currentPage.seoMetaDescription);
    expect(query).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/token|hidden-secret/);
  });

  it('preserves successful observations when the previous query sample fails', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async body => {
      if (body.startDate === previousWindow.startDate && body.dimensions) throw new Error('outage');
      return original(body);
    });
    const result = await collect();
    expect(result.status).toBe('partial');
    expect(result.current).toMatchObject({ totals: metrics, queriesStatus: 'available' });
    expect(result.previous).toEqual({ totals: metrics, queries: [], totalsStatus: 'available', queriesStatus: 'unavailable' });
    expect(result.facts.map(fact => fact.id)).toEqual(['P1', 'P2', 'P3', 'S1', 'S2', 'Q1', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  });

  it('treats a synchronous provider exception as a failed query without skipping the remaining requests', async () => {
    query.mockImplementation(body => { if (!body.dimensions) throw new Error('failure'); return { rows: [] }; });
    const result = await collect();
    expect(query).toHaveBeenCalledTimes(8);
    expect(result.status).toBe('partial');
    expect(result.current).toMatchObject({ totalsStatus: 'unavailable', queriesStatus: 'no_data' });
  });
});

describe('six-window URL history', () => {
  it('returns six adjacent 28-day periods, newest first, with the first two sharing exact page totals', async () => {
    const result = await collect();
    expect(result.history.map(period => period.window)).toEqual([
      window, previousWindow,
      { startDate: '2026-07-16', endDate: '2026-08-12' },
      { startDate: '2026-06-18', endDate: '2026-07-15' },
      { startDate: '2026-05-21', endDate: '2026-06-17' },
      { startDate: '2026-04-23', endDate: '2026-05-20' },
    ]);
    expect(result.history[0]).toEqual({ window, totals: result.current.totals, totalsStatus: result.current.totalsStatus });
    expect(result.history[1]).toEqual({ window: previousWindow, totals: result.previous.totals, totalsStatus: result.previous.totalsStatus });
    expect(query.mock.calls.filter(([body]) => !body.dimensions)).toHaveLength(6);
    expect(query.mock.calls.filter(([body]) => body.dimensions?.[0] === 'query')).toHaveLength(2);
    expect(result.facts.filter(fact => fact.id.startsWith('H')).map(fact => fact.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    expect(result.limitations.join(' ')).toContain('may span earlier website versions');
    expect(result.limitations.join(' ')).toContain('age of the current title, description and page content is unknown');
  });

  it('distinguishes older explicit zero, absent data and failed windows without dropping successful recent data', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async body => {
      if (body.startDate === '2026-07-16') return { rows: [{ clicks: 0, impressions: 0, ctr: 0, position: 0 }] };
      if (body.startDate === '2026-06-18') return {};
      if (body.startDate === '2026-05-21') throw new Error('hidden historical failure');
      return original(body);
    });
    const result = await collect();
    expect(result.status).toBe('partial');
    expect(result.current.totals).toEqual(metrics);
    expect(result.history[2]).toMatchObject({ totals: { clicks: 0, impressions: 0, ctr: null, position: null }, totalsStatus: 'no_data' });
    expect(result.history[3]).toMatchObject({ totals: null, totalsStatus: 'no_data' });
    expect(result.history[4]).toMatchObject({ totals: null, totalsStatus: 'unavailable' });
    expect(result.history[5]).toMatchObject({ totals: metrics, totalsStatus: 'available' });
    expect(result.facts.find(fact => fact.id === 'H3').text).toContain('0 clicks');
    expect(result.facts.find(fact => fact.id === 'H4').text).toContain('no total rows');
    expect(result.facts.find(fact => fact.id === 'H5')).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('hidden historical failure');
  });

  it('keeps known history available even when both recent periods fail', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async body => {
      if ([window.startDate, previousWindow.startDate].includes(body.startDate)) throw new Error('recent failure');
      return original(body);
    });
    const result = await collect();
    expect(result.status).toBe('partial');
    expect(result.current.totalsStatus).toBe('unavailable');
    expect(result.history.slice(2).every(period => period.totalsStatus === 'available')).toBe(true);
    expect(result.facts.filter(fact => fact.id.startsWith('H')).map(fact => fact.id)).toEqual(['H3', 'H4', 'H5', 'H6']);
  });

  it('does not claim to inspect metadata when used for activity without scraped page content', async () => {
    const result = await collect({ currentPage: undefined });
    expect(result.facts.some(fact => fact.kind === 'page')).toBe(false);
    expect(result.facts.some(fact => fact.id === 'H6')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('No HTML title was found');
    getGscConnection.mockRejectedValue(new Error('offline'));
    const unavailable = await collect({ currentPage: undefined });
    expect(unavailable.history).toHaveLength(6);
    expect(unavailable.history.every(period => period.totals === null && period.totalsStatus === 'unavailable')).toBe(true);
    expect(unavailable.facts).toEqual([]);
  });
});

describe('malformed data cannot become recommendation evidence', () => {
  it.each([
    null, [], { rows: null }, { error: { message: 'private diagnostics' } },
    { rows: [metrics, metrics] }, { rows: [{ ...metrics, clicks: '12' }] },
    { rows: [{ ...metrics, impressions: NaN }] }, { rows: [{ ...metrics, clicks: 201 }] },
    { rows: [{ ...metrics, ctr: 1.5 }] }, { rows: [{ ...metrics, position: 0 }] },
    { rows: [{ ...metrics, position: -1 }] }, { rows: [{ ...metrics, keys: ['not-aggregate'] }] },
  ])('marks malformed totals unavailable instead of converting them to zero %#', async payload => {
    query.mockImplementation(async body => body.dimensions ? { rows: [] } : payload);
    const result = await collect();
    expect(result.status).toBe('partial');
    expect(result.current).toMatchObject({ totals: null, totalsStatus: 'unavailable', queriesStatus: 'no_data' });
    expect(result.facts.map(fact => fact.id)).toEqual(['P1', 'P2', 'P3']);
    expect(JSON.stringify(result)).not.toContain('private diagnostics');
  });

  it.each([
    [{ ...queryMetrics }], [{ keys: ['query', 'extra'], ...queryMetrics }],
    [{ keys: [''], ...queryMetrics }], [{ keys: ['query'], ...queryMetrics, clicks: -1 }],
    [{ keys: ['duplicate'], ...queryMetrics }, { keys: ['duplicate'], ...queryMetrics }],
    Array.from({ length: 21 }, (_, index) => ({ keys: [`query ${index}`], ...queryMetrics })),
  ])('discards malformed or oversized query samples without losing separate totals %#', async rows => {
    query.mockImplementation(async body => body.dimensions ? { rows } : { rows: [metrics] });
    const result = await collect();
    expect(result.status).toBe('partial');
    expect(result.current).toMatchObject({ totals: metrics, queries: [], queriesStatus: 'unavailable' });
    expect(result.facts.some(fact => fact.id.startsWith('Q'))).toBe(false);
  });

  it('marks sparse counts as tentative without declaring significance or a winning action', async () => {
    query.mockImplementation(async body => body.dimensions ? { rows: [] } : { rows: [{ ...metrics, clicks: 2 }] });
    const result = await collect();
    expect(result.limitations.join(' ')).toContain('fewer than 10 clicks');
    expect(result.limitations.join(' ')).toContain('not a statistical confidence test');
    expect(result).not.toHaveProperty('recommendation');
    expect(result).not.toHaveProperty('confidence');
  });
});

describe('selected-phrase provenance and alternative-page scope', () => {
  it('adds only one exact-phrase lookup and preserves the selected phrase and related URL', async () => {
    const result = await collect({ focusKeywords: [phrase, 'Another phrase'] });
    expect(query).toHaveBeenCalledTimes(9);
    expect(query.mock.calls[8][0]).toEqual({
      ...window, type: 'web', dataState: 'final', aggregationType: 'auto', dimensions: ['page'], rowLimit: 5,
      dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'query', operator: 'equals', expression: phrase }] }],
    });
    expect(result.selectedPhrase).toEqual({ value: phrase, source: 'observed' });
    expect(result.relatedPages).toEqual([{ pageUrl: `${property}WebDesign?Audience=Business`, ...queryMetrics }]);
    expect(result.facts.find(fact => fact.id === 'R1').text).toContain('WebDesign?Audience=Business');
    expect(result.facts.find(fact => fact.id === 'Q1').text).toContain(phrase);
  });

  it('does not label provided or differently capitalized phrases as observed for this page', async () => {
    for (const provided of ['Unobserved phrase', phrase.toLowerCase()]) {
      const result = await collect({ focusKeywords: [provided] });
      expect(result.selectedPhrase).toEqual({ value: provided, source: 'provided' });
      expect(result.relatedPages).toHaveLength(1);
    }
  });

  it('accepts an exact previous-window observation without implying it is current', async () => {
    query.mockImplementation(async body => body.dimensions?.[0] === 'query'
      ? { rows: body.startDate === previousWindow.startDate ? [{ keys: [phrase], ...queryMetrics }] : [] }
      : { rows: [] });
    const result = await collect({ focusKeywords: [phrase] });
    expect(result.selectedPhrase.source).toBe('observed');
    expect(result.current.queries).toEqual([]);
    expect(result.previous.queries[0].query).toBe(phrase);
    expect(result.facts.some(fact => fact.id === 'Q1')).toBe(false);
  });

  it('removes the selected page from related pages without altering other exact URLs', async () => {
    query.mockImplementation(async body => body.dimensions?.[0] === 'page'
      ? { rows: [{ keys: [pageUrl], ...metrics }, { keys: [`${property}services/?Topic=Web&Area=SouthBend`], ...queryMetrics }] }
      : { rows: [] });
    const result = await collect({ focusKeywords: [phrase] });
    expect(result.relatedPages).toEqual([{ pageUrl: `${property}services/?Topic=Web&Area=SouthBend`, ...queryMetrics }]);
    expect(result.selectedPhrase.source).toBe('provided');
  });

  it.each(['https://elsewhere.test/service', 'https://user:secret@example.test/service', `${property}service#part`])('rejects unsafe or out-of-property related URL %s', async relatedUrl => {
    const original = query.getMockImplementation();
    query.mockImplementation(async body => body.dimensions?.[0] === 'page' ? { rows: [{ keys: [relatedUrl], ...queryMetrics }] } : original(body));
    const result = await collect({ focusKeywords: [phrase] });
    expect(result.status).toBe('partial');
    expect(result.relatedPages).toEqual([]);
    expect(result.relatedPagesStatus).toBe('unavailable');
    expect(result.current.totals).toEqual(metrics);
    expect(result.facts.some(fact => fact.id === 'R1')).toBe(false);
  });

  it('skips optional lookup for empty input and rejects unbounded input before any connection', async () => {
    const result = await collect({ focusKeywords: ['  '] });
    expect(result.selectedPhrase).toEqual({ value: '', source: 'none' });
    expect(query).toHaveBeenCalledTimes(8);
    getGscConnection.mockClear();
    await expect(collect({ focusKeywords: ['x'.repeat(121)] })).rejects.toMatchObject({ status: 400 });
    await expect(collect({ focusKeywords: 'a phrase' })).rejects.toMatchObject({ status: 400 });
    expect(getGscConnection).not.toHaveBeenCalled();
  });
});
