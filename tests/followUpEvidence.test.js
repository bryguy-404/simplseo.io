import { describe, expect, it } from 'vitest';
import data from './fixtures/follow-up-reviews.cjs';
import { followUpEvidence } from '../app/lib/followUpEvidence';

const now = new Date('2026-10-11T12:00:00Z');
describe('follow-up checkpoint evidence', () => {
  it('uses immutable compared-period totals and queries without external reads', () => {
    const ctx = data.context('roofing'), result = followUpEvidence(ctx.cycle, ctx.currentPage, now);
    expect(result.current.totals).toEqual(ctx.evidence.current.totals);
    expect(result.previous.totals).toEqual(ctx.evidence.previous.totals);
    expect(result.window).toEqual(ctx.cycle.latestCheckpoint.windows.post);
    expect(result.previousWindow).toEqual(ctx.cycle.latestCheckpoint.windows.baseline);
    expect(result.facts.map(fact => fact.id)).toEqual(expect.arrayContaining(['S1', 'S2', 'Q1', 'B1']));
  });
  it.each(['scope', 'dates', 'future', 'filters', 'metrics'])('rejects inconsistent %s before sending evidence to AI', mutation => {
    const ctx = data.context('roofing'), point = ctx.cycle.latestCheckpoint;
    if (mutation === 'scope') point.post.pageUrl = 'https://another.example/';
    if (mutation === 'dates') point.post.startDate = '2026-09-09';
    if (mutation === 'future') point.windows.post = { startDate: '2026-10-01', endDate: '2026-10-28' };
    if (mutation === 'filters') point.post.dataState = 'all';
    if (mutation === 'metrics') point.post.impressions = -1;
    expect(() => followUpEvidence(ctx.cycle, ctx.currentPage, now)).toThrow();
  });
  it('keeps query absence and provider failure distinct from zero traffic or indexing', () => {
    const ctx = data.context('plumbing', { queriesUnavailable: true });
    const result = followUpEvidence(ctx.cycle, ctx.currentPage, now);
    expect(result.current.queriesStatus).toBe('unavailable'); expect(result.current.queries).toEqual([]);
    expect(result.current.totals).not.toBeNull();
    ctx.cycle.latestCheckpoint.baseline = { status: 'unavailable', reason: 'outside_google_history' };
    expect(followUpEvidence(ctx.cycle, ctx.currentPage, now).previous).toMatchObject({ totals: null, totalsStatus: 'unavailable' });
  });
  it('rejects invented duplicate query rows and invalid row metrics', () => {
    for (const duplicate of [true, false]) {
      const ctx = data.context('roofing');
      if (duplicate) ctx.cycle.latestCheckpoint.post.queries.push(ctx.cycle.latestCheckpoint.post.queries[0]);
      else ctx.cycle.latestCheckpoint.post.queries[0].clicks = 90000;
      expect(() => followUpEvidence(ctx.cycle, ctx.currentPage, now)).toThrow();
    }
  });
});
