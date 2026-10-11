import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => { const { fakeFirestore } = await import('./fakeFirestore'); return { ...fakeFirestore(), auth: {} }; });
import { records, reset } from '../app/lib/firebaseAdmin';
import { consumeNewPageQuota } from '../app/lib/server/requestQuota';
import { recordPageReviewResponse } from '../app/lib/server/aiUsage';
beforeEach(() => { reset(); records.set('users/alice', {}); records.set('onboarding/alice', {}); records.set('users/bob', {}); records.set('onboarding/bob', {}); });
it.each([['assessment', 3], ['draft', 5], ['nearby', 2]])('bounds %s attempts at %d per account per UTC day', async (kind, count) => {
  for (let i = 0; i < count; i++) await consumeNewPageQuota('alice', kind);
  await expect(consumeNewPageQuota('alice', kind)).rejects.toMatchObject({ status: 429 });
  await expect(consumeNewPageQuota('bob', kind)).resolves.toBeUndefined();
  const saved = [...records.values()].filter(record => record.userId === 'alice' && record.kind === kind); expect(saved[0].count).toBe(count);
});
it('does not create a quota document after account deletion', async () => {
  records.delete('users/alice'); await expect(consumeNewPageQuota('alice', 'assessment')).rejects.toMatchObject({ status: 409 });
  expect([...records.keys()].filter(key => key.startsWith('requestLimits/'))).toHaveLength(0);
});
it('records private provider accounting under new_page_planning without input or output text', async () => {
  const response = { id: 'resp_fixture', model: 'gpt-6.1-sol', status: 'completed', output_text: 'private synthetic text', usage: { input_tokens: 123, output_tokens: 45, total_tokens: 168 }, output: [{ type: 'web_search_call' }] };
  await recordPageReviewResponse({ userId: 'alice', reviewRunId: 'test', stage: 'assessment', feature: 'new_page_planning', requestedModel: 'gpt-6.1-sol' }, async () => response);
  const ledger = records.get('aiUsageEvents/test-assessment');
  expect(ledger).toMatchObject({ feature: 'new_page_planning', stage: 'assessment', providerOutcome: 'completed', inputTokens: 123, outputTokens: 45, webSearchCalls: 1 });
  expect(JSON.stringify(ledger)).not.toContain('private synthetic text');
});
