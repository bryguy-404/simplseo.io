import { describe, expect, it } from 'vitest';
import { activityDayLabel, dashboardActivityState, dashboardActivityWeeks } from '../app/lib/dashboardActivityPresentation';

const window = { startDate: '2026-10-17', endDate: '2026-11-13' };
const day = (date, impressions = 3, clicks = 1) => ({ date, impressions, clicks });

describe('dashboard reporting weeks', () => {
  it('uses four equal Pacific calendar-date groups across daylight saving changes', () => {
    const weeks = dashboardActivityWeeks(window, [day('2026-10-17'), day('2026-11-13')]);
    expect(weeks.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ['2026-10-17', '2026-10-23'], ['2026-10-24', '2026-10-30'],
      ['2026-10-31', '2026-11-06'], ['2026-11-07', '2026-11-13'],
    ]);
  });
  it('distinguishes partial sums, no returned days and a genuinely reported zero', () => {
    const weeks = dashboardActivityWeeks(window, [day('2026-10-17', 0, 0), day('2026-10-24', 8, 2), day('2026-10-25', 12, 1)]);
    expect(weeks[0]).toMatchObject({ reportedDays: 1, missingDays: 6, complete: false, clicks: 0, impressions: 0 });
    expect(weeks[1]).toMatchObject({ reportedDays: 2, complete: false, clicks: 3, impressions: 20 });
    expect(weeks[2]).toMatchObject({ reportedDays: 0, complete: false, clicks: null, impressions: null });
  });
  it('sums only valid rows inside the window and never duplicates a day', () => {
    const rows = [day('2026-10-16'), day('2026-11-14'), day('invalid'), day('2026-10-18', 2, 4), day('2026-10-19'), day('2026-10-19'), day('2026-10-20', 9, 3)];
    expect(dashboardActivityWeeks(window, rows)[0]).toMatchObject({ reportedDays: 1, impressions: 9, clicks: 3 });
  });
  it('marks all seven valid returned days as complete without using website totals', () => {
    const rows = Array.from({ length: 7 }, (_, index) => day(`2026-10-${17 + index}`, 10, 0));
    expect(dashboardActivityWeeks(window, rows)[0]).toMatchObject({ reportedDays: 7, missingDays: 0, complete: true, impressions: 70, clicks: 0 });
  });
  it.each([null, {}, { startDate: '2026-02-30', endDate: '2026-03-29' }, { startDate: '2026-10-17', endDate: '2026-11-14' }])('rejects a malformed or non-28-day window', value => {
    expect(dashboardActivityWeeks(value, [])).toEqual([]);
  });
  it('keeps date-only labels stable', () => {
    expect(activityDayLabel('2026-11-01')).toBe('Nov 1');
    expect(activityDayLabel('2026-02-30')).toBe('Date unavailable');
  });
});

describe('dashboard activity emphasis', () => {
  const overview = totals => ({ source: 'google_search_console', totals });
  it('distinguishes unknown, zero, impressions and clicks', () => {
    expect(dashboardActivityState(null)).toBe('unavailable');
    expect(dashboardActivityState(overview({ clicks: null, impressions: 0 }))).toBe('unavailable');
    expect(dashboardActivityState(overview({ clicks: 0, impressions: 0 }))).toBe('zero');
    expect(dashboardActivityState(overview({ clicks: 0, impressions: 17 }))).toBe('appearances');
    expect(dashboardActivityState(overview({ clicks: 2, impressions: 17 }))).toBe('clicks');
  });
  it('does not fabricate zeros from an incomplete/invalid response', () => {
    for (const totals of [{}, { clicks: -1, impressions: 5 }, { clicks: 5, impressions: 3 }, { clicks: '0', impressions: 0 }]) {
      expect(dashboardActivityState(overview(totals))).toBe('unavailable');
    }
  });
});
