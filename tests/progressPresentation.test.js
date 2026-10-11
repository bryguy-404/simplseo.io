import { describe, expect, it } from 'vitest';
import { progressTimeline, resultMetrics } from '../app/lib/progressPresentation';

const observation = (values = {}) => ({ status: 'has_data', clicks: 6, impressions: 142, position: 12, ...values });
const checkpoint = (baseline = {}, post = {}, extra = {}) => ({
  state: 'available', day: 28, baseline: observation(baseline), post: observation(post), ...extra,
});
const metricsByKey = value => Object.fromEntries(resultMetrics(value).map(metric => [metric.key, metric]));

describe('progress timeline presentation', () => {
  it('shows the actual first review date including the reporting buffer', () => {
    expect(progressTimeline({ confirmedAt: '2026-08-01', nextReviewAt: '2026-09-01' }, '2026-08-16')).toEqual({
      elapsedDays: 15, daysRemaining: 16, durationDays: 31, percent: 15 / 31 * 100,
      due: false, startDay: '2026-08-01', targetDay: '2026-09-01',
    });
  });

  it('keeps date-only dates intact and uses Pacific calendar dates for timestamps', () => {
    const result = progressTimeline({ confirmedAt: '2026-08-02T02:00:00Z', nextReviewAt: '2026-09-01' }, '2026-09-01T02:00:00Z');
    expect(result).toMatchObject({ elapsedDays: 30, daysRemaining: 1, startDay: '2026-08-01', due: false });
    expect(progressTimeline({ confirmedAt: '2026-08-01', nextReviewAt: '2026-09-01' }, '2026-08-01')).toMatchObject({ elapsedDays: 0, percent: 0 });
  });

  it.each([
    ['2026-03-07T20:00:00Z', '2026-03-09T19:00:00Z', '2026-04-07'],
    ['2026-10-31T19:00:00Z', '2026-11-02T20:00:00Z', '2026-12-01'],
  ])('counts calendar days across Pacific DST changes (%s)', (confirmedAt, now, nextReviewAt) => {
    expect(progressTimeline({ confirmedAt, nextReviewAt }, now)).toMatchObject({ elapsedDays: 2, daysRemaining: 29, durationDays: 31 });
  });

  it('fills later 28-day intervals while keeping total days since the original changes', () => {
    const result = progressTimeline({ confirmedAt: '2026-08-01', nextReviewAt: '2026-09-29', latestCheckpoint: { day: 28 } }, '2026-09-15');
    expect(result).toEqual({ elapsedDays: 45, daysRemaining: 14, durationDays: 28, percent: 50,
      due: false, startDay: '2026-09-01', targetDay: '2026-09-29' });
  });

  it('caps elapsed fill without inventing a ready state or moving a delayed review date', () => {
    const cycle = { confirmedAt: '2026-08-01', nextReviewAt: '2026-09-01' };
    expect(progressTimeline(cycle, '2026-09-01')).toMatchObject({ elapsedDays: 31, daysRemaining: 0, percent: 100, due: true });
    const delayed = progressTimeline(cycle, '2026-10-10');
    expect(delayed).toMatchObject({ elapsedDays: 70, daysRemaining: 0, percent: 100, due: true, targetDay: '2026-09-01' });
    expect(delayed).not.toHaveProperty('ready');
  });

  it('clamps the fill before a later interval begins without resetting the confirmation date', () => {
    expect(progressTimeline({ confirmedAt: '2026-08-01', nextReviewAt: '2026-09-29', latestCheckpoint: { day: 28 } }, '2026-08-30'))
      .toMatchObject({ elapsedDays: 29, percent: 0, daysRemaining: 30 });
  });

  it('accepts stored Date and Firestore timestamp values without mutating them', () => {
    const confirmedAt = new Date('2026-08-01T20:00:00Z');
    expect(progressTimeline({ confirmedAt: { toDate: () => confirmedAt }, nextReviewAt: '2026-09-01' }, new Date('2026-08-02T20:00:00Z')))
      .toMatchObject({ elapsedDays: 1, startDay: '2026-08-01' });
    expect(confirmedAt.toISOString()).toBe('2026-08-01T20:00:00.000Z');
  });

  it.each([null, '', 'invalid', '2026-02-30', '2026-02-30T12:00:00Z', '2026-08-01T12:00:00', new Date('invalid')])
    ('does not manufacture a confirmation date from %s', confirmedAt => {
      expect(progressTimeline({ confirmedAt, nextReviewAt: '2026-09-01' }, '2026-08-16')).toBeNull();
    });

  it('rejects missing/invalid targets, invalid current dates and future confirmations', () => {
    for (const nextReviewAt of [null, '', '2026-02-30', '2026-08-01', '2026-07-31']) {
      expect(progressTimeline({ confirmedAt: '2026-08-01', nextReviewAt }, '2026-08-16')).toBeNull();
    }
    expect(progressTimeline({ confirmedAt: '2026-08-01', nextReviewAt: '2026-09-01' }, '2026-02-30')).toBeNull();
    expect(progressTimeline({ confirmedAt: '2026-08-02', nextReviewAt: '2026-09-01' }, '2026-08-01')).toBeNull();
    expect(progressTimeline({ confirmedAt: '2026-08-01T21:00:00Z', nextReviewAt: '2026-09-01' }, '2026-08-01T20:00:00Z')).toBeNull();
  });
});

describe('saved checkpoint metric presentation', () => {
  it('exposes three stable labels and shows growth and declining average position correctly', () => {
    const metrics = resultMetrics(checkpoint({ clicks: 6, impressions: 142, position: 12.36 }, { clicks: 9, impressions: 200, position: 8.24 }));
    expect(metrics).toEqual([
      { key: 'clicks', label: 'Clicks', before: 6, after: 9, delta: 3, tone: 'positive', direction: 'up' },
      { key: 'impressions', label: 'Appearances in search', before: 142, after: 200, delta: 58, tone: 'positive', direction: 'up' },
      { key: 'position', label: 'Average position', before: 12.4, after: 8.2, delta: -4.2, tone: 'positive', direction: 'down' },
    ]);
  });

  it('represents real zero counts without pretending a zero-impression period has a ranking', () => {
    const values = metricsByKey(checkpoint({ status: 'no_data', clicks: 0, impressions: 0, position: 3 }, { clicks: 0, impressions: 8, position: 3 }));
    expect(values.clicks).toMatchObject({ before: 0, after: 0, delta: 0, tone: 'neutral', direction: 'flat' });
    expect(values.impressions).toMatchObject({ before: 0, after: 8, delta: 8, tone: 'positive' });
    expect(values.position).toMatchObject({ before: null, after: 3, delta: null, tone: 'unavailable', direction: null });
  });

  it('shows declining clicks and impressions and rising position as worse numeric observations', () => {
    const values = metricsByKey(checkpoint({ clicks: 5, impressions: 100, position: 4 }, { clicks: 0, impressions: 50, position: 9 }));
    expect(values.clicks).toMatchObject({ delta: -5, tone: 'negative', direction: 'down' });
    expect(values.impressions).toMatchObject({ delta: -50, tone: 'negative', direction: 'down' });
    expect(values.position).toMatchObject({ delta: 5, tone: 'negative', direction: 'up' });
  });

  it.each(['unavailable', 'error', 'pending', undefined])('ignores numeric leftovers in a %s observation', status => {
    const values = metricsByKey(checkpoint({ status, clicks: 9, impressions: 500, position: 2 }, { clicks: 0, impressions: 0, position: null }, { state: 'incomplete' }));
    for (const metric of Object.values(values)) expect(metric).toMatchObject({ before: null, delta: null, tone: 'unavailable', direction: null });
    expect(values.clicks.after).toBe(0);
    expect(values.impressions.after).toBe(0);
  });

  it('retains the successful side of an incomplete comparison and does not invent missing totals', () => {
    const values = metricsByKey({ baseline: observation(), post: { status: 'unavailable', clicks: 99, impressions: 500, position: 1 }, state: 'incomplete' });
    expect(values.clicks).toMatchObject({ before: 6, after: null, delta: null });
    expect(values.position).toMatchObject({ before: 12, after: null, delta: null });
    for (const metric of resultMetrics(null)) expect(metric).toMatchObject({ before: null, after: null, delta: null, tone: 'unavailable' });
  });

  it.each([undefined, null, NaN, Infinity, -1, '6'])('does not turn an invalid count %s into zero', clicks => {
    expect(metricsByKey(checkpoint({ clicks })).clicks).toMatchObject({ before: null, after: 6, delta: null, tone: 'unavailable' });
  });

  it.each([
    { position: 0 }, { position: 0.9 }, { position: NaN }, { position: Infinity }, { position: '4' },
    { position: 4, impressions: null }, { position: 4, impressions: 0 }, { position: 4, impressions: Infinity },
  ])('requires positive measured impressions and a valid position (%j)', baseline => {
    expect(metricsByKey(checkpoint(baseline)).position).toMatchObject({ before: null, delta: null, tone: 'unavailable' });
  });

  it('uses the displayed precision for ranking arrows and eliminates negative zero', () => {
    const flat = metricsByKey(checkpoint({ position: 19.04 }, { position: 18.96 })).position;
    expect(flat).toMatchObject({ before: 19, after: 19, delta: 0, tone: 'neutral', direction: 'flat' });
    expect(Object.is(flat.delta, -0)).toBe(false);
    expect(metricsByKey(checkpoint({ position: 19.06 }, { position: 18.96 })).position)
      .toMatchObject({ before: 19.1, after: 19, delta: -0.1, tone: 'positive', direction: 'down' });
  });

  it.each(['ready', 'available', 'low_volume'])('keeps reported values in %s checkpoints, including low volume', state => {
    const values = metricsByKey(checkpoint({ status: 'available', clicks: 0, impressions: 1 }, { status: 'available', clicks: 1, impressions: 2 }, { state, lowVolume: true }));
    expect(values.clicks).toMatchObject({ before: 0, after: 1, delta: 1, tone: 'positive' });
    expect(values.impressions).toMatchObject({ before: 1, after: 2, delta: 1, tone: 'positive' });
  });

  it('keeps dated saved observations intact when the cycle reports a newer refresh failure', () => {
    const cycle = { state: 'error', lastError: { checkedAt: '2026-10-10', reason: 'google_unavailable' },
      latestCheckpoint: checkpoint({}, { clicks: 8 }, { observedAt: '2026-10-08T12:00:00Z' }) };
    const original = structuredClone(cycle);
    expect(metricsByKey(cycle.latestCheckpoint).clicks).toMatchObject({ before: 6, after: 8, delta: 2 });
    expect(cycle).toEqual(original);
  });
});
