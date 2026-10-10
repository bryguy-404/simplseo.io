import { describe, it, expect } from 'vitest';
import { observationWindow, observePage, normalizeRevampPage, completeRevampPatch, propertyContainsUrl } from '../app/lib/revampState';
describe('recovery rules', () => {
  it('uses a 28-day inclusive Pacific window with a 3-day delay', () => {
    expect(observationWindow(null, new Date('2026-10-10T01:00:00Z'))).toEqual({ startDate: '2026-09-09', endDate: '2026-10-06' });
    expect(observationWindow('2026-10-02', new Date('2026-10-10T01:00:00Z'))).toEqual({ startDate: '2026-10-02', endDate: '2026-10-06' });
    expect(observationWindow('2026-10-09', new Date('2026-10-10T01:00:00Z'))).toBeNull();
  });
  it.each([1, 9, 10])('recognizes %i impressions without a discovery threshold', impressions => {
    expect(observePage({ url: 'https://example.com/Service?a=1' }, [{ impressions, clicks: 0 }], {}, 'now').searchDataStatus).toBe('has_data');
  });
  it('does not mislabel legacy discovery flags as verified observations', () => {
    expect(normalizeRevampPage({ url: 'x', discovered: true, impressions: 20 }).searchDataStatus).toBe('not_checked');
    expect(observePage({ url: 'x' }, [], {}, 'now').searchDataStatus).toBe('no_data');
  });
  it('finishes setup while keeping monitoring enabled and outcomes paused', () => {
    expect(completeRevampPatch()).toMatchObject({ revampStatus: 'complete', revampMonitoringEnabled: true, progressReviewRequired: true });
  });
  it('rejects other properties without changing path case or query strings', () => {
    expect(propertyContainsUrl('sc-domain:example.com', 'https://www.example.com/Case?x=2')).toBe(true);
    expect(propertyContainsUrl('sc-domain:example.com', 'https://example.com.evil.test')).toBe(false);
    expect(propertyContainsUrl('https://example.com/Service/', 'https://example.com/service/a')).toBe(false);
  });
});
