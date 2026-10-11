import { describe, expect, it } from 'vitest';
import { compareAnswerEnvelope, evidenceHash, preservationChanges } from '../scripts/verify-mentor-pilot-evidence.mjs';

describe('read-only mentor pilot verifier', () => {
  it('compares values independently of object key order but preserves dates and missing fields', () => {
    expect(evidenceHash({ clicks: 6, window: { endDate: '2026-10-07', startDate: '2026-09-10' } }))
      .toBe(evidenceHash({ window: { startDate: '2026-09-10', endDate: '2026-10-07' }, clicks: 6 }));
    expect(evidenceHash({ clicks: 0 })).not.toBe(evidenceHash({}));
    expect(evidenceHash({ observedAt: '2026-10-07' })).not.toBe(evidenceHash({ observedAt: '2026-10-08' }));
  });
  it('detects added, removed and changed preserved documents without returning their contents or identifiers', () => {
    expect(preservationChanges([{ key: 'private-a', hash: 'a', collection: 'pageProgressCycles' },
      { key: 'private-b', hash: 'b', collection: 'businessProfiles' }],
    [{ key: 'private-a', hash: 'changed', collection: 'pageProgressCycles' }, { key: 'private-c', hash: 'new', collection: 'newPagePublications' }]))
      .toEqual([{ collection: 'pageProgressCycles', change: 'changed' }, { collection: 'businessProfiles', change: 'removed' },
        { collection: 'newPagePublications', change: 'added' }]);
  });
  it('rejects fabricated metrics or a different action target and emits no conversation text', () => {
    const metric = { id: 'metric', clicks: 6, impressions: 142, observedAt: '2026-10-11', window: { startDate: '2026-09-10', endDate: '2026-10-07' } };
    const action = { id: 'action', href: '/low-ctr?page=homepage', label: 'Improve this page' };
    const evidence = { metricCards: [evidenceHash(metric)], actions: [evidenceHash(action)] };
    expect(compareAnswerEnvelope({ content: 'PRIVATE CONVERSATION', metricCards: [metric], actions: [action] }, evidence))
      .toEqual({ metricCards: { checked: 1, matching: 1 }, actions: { checked: 1, matching: 1 } });
    expect(compareAnswerEnvelope({ content: 'PRIVATE CONVERSATION', metricCards: [{ ...metric, clicks: 600 }], actions: [{ ...action, href: '/settings' }] }, evidence))
      .toEqual({ metricCards: { checked: 1, matching: 0 }, actions: { checked: 1, matching: 0 } });
  });
});
