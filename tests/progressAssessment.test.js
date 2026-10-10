import { describe, it, expect } from 'vitest';
import { comparisonWindows, compareObservations, assessObservations, recentObservationWindow } from '../app/lib/progressAssessment';

describe('dated progress comparisons', () => {
  it('uses equal nonoverlapping 28-day Pacific windows and excludes implementation day', () => {
    const windows = comparisonWindows('2026-08-02T02:00:00.000Z', new Date('2026-09-01T12:00:00Z'));
    expect(windows).toEqual({ implementationDay: '2026-08-01', baseline: { startDate: '2026-07-04', endDate: '2026-07-31' }, post: { startDate: '2026-08-02', endDate: '2026-08-29' }, completeThrough: '2026-08-29', ready: true });
  });
  it('does not compare partially reported periods and handles Pacific DST boundaries', () => {
    expect(comparisonWindows('2026-08-01', new Date('2026-09-01T02:00:00Z')).ready).toBe(false);
    expect(recentObservationWindow(new Date('2026-03-10T06:30:00Z'))).toEqual({ startDate: '2026-02-07', endDate: '2026-03-06' });
    expect(comparisonWindows('2026-02-30')).toBeNull();
    expect(comparisonWindows('invalid')).toBeNull();
    expect(comparisonWindows(null)).toBeNull();
  });
  it('represents a zero denominator and missing position as unknown rather than a fake 100% increase', () => {
    const baseline = { clicks: 0, impressions: 0, ctr: null, position: null };
    const post = { clicks: 10, impressions: 100, ctr: 0.1, position: 4 };
    expect(compareObservations(baseline, post)).toEqual({ clicksDelta: 10, clicksPercent: null, impressionsDelta: 100, impressionsPercent: null, ctrPercentagePoints: null, positionDelta: null });
    expect(assessObservations(baseline, post)).toMatchObject({ state: 'insufficient_data', comparison: null });
  });
  it('exposes measured decline without manufacturing success/pivot classifications', () => {
    const assessment = assessObservations({ clicks: 20, impressions: 100, ctr: 0.2, position: 4 }, { clicks: 0, impressions: 100, ctr: 0, position: 8 });
    expect(assessment.state).toBe('ready');
    expect(assessment.comparison).toMatchObject({ clicksDelta: -20, clicksPercent: -100, ctrPercentagePoints: -20, positionDelta: -4 });
    expect(assessment).not.toHaveProperty('cardType');
  });
});
