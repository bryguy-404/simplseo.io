import { afterEach, expect, it, vi } from 'vitest';
import { ongoingReviewEnabled } from '../app/lib/server/ongoingReviewFeature';
afterEach(() => vi.unstubAllEnvs());
it('fails closed and limits the enabled pilot to the explicit accounts', () => {
  vi.stubEnv('ONGOING_PAGE_REVIEWS_ENABLED', 'false');
  vi.stubEnv('ONGOING_PAGE_REVIEW_PILOT_UIDS', '*');
  expect(ongoingReviewEnabled('alice')).toBe(false);
  vi.stubEnv('ONGOING_PAGE_REVIEWS_ENABLED', 'true');
  vi.stubEnv('ONGOING_PAGE_REVIEW_PILOT_UIDS', 'alice, bob');
  expect(ongoingReviewEnabled('alice')).toBe(true);
  expect(ongoingReviewEnabled('bob')).toBe(true);
  expect(ongoingReviewEnabled('eve')).toBe(false);
  vi.stubEnv('ONGOING_PAGE_REVIEW_PILOT_UIDS', '');
  expect(ongoingReviewEnabled('alice')).toBe(false);
  vi.stubEnv('ONGOING_PAGE_REVIEW_PILOT_UIDS', '*');
  expect(ongoingReviewEnabled('eve')).toBe(true);
  expect(ongoingReviewEnabled('')).toBe(false);
});
