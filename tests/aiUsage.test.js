import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return fakeFirestore();
});
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { recordPageReviewResponse, responseUsage } from '../app/lib/server/aiUsage';

const context = { userId: 'alice', reviewRunId: 'review-fixture', stage: 'research', requestedModel: 'gpt-6.1-sol' };
const response = {
  id: 'resp_fixture', _request_id: 'req_fixture', model: 'gpt-6.1-sol-2026-10-01', service_tier: 'default', status: 'completed',
  usage: { input_tokens: 12000, input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 2000 },
    output_tokens: 1500, output_tokens_details: { reasoning_tokens: 900 }, total_tokens: 13500 },
  input: 'PRIVATE PROMPT', output: [{ type: 'web_search_call', action: { query: 'PRIVATE QUERY' } },
    { type: 'message', content: [{ text: 'PRIVATE RESULT' }] }, { type: 'web_search_call' }],
};
beforeEach(async () => {
  reset();
  await db.collection('users').doc('alice').set({});
  await db.collection('onboarding').doc('alice').set({});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('private page-review provider accounting', () => {
  it('records only usage counters and safe provider metadata, separately for each paid stage', async () => {
    const execute = vi.fn(async () => {
      expect(records.get('aiUsageEvents/review-fixture-research').providerOutcome).toBe('started');
      return response;
    });
    expect(await recordPageReviewResponse(context, execute)).toBe(response);
    const event = records.get('aiUsageEvents/review-fixture-research');
    expect(event).toMatchObject({ userId: 'alice', stage: 'research', feature: 'page_review', providerOutcome: 'completed',
      usageStatus: 'reported', inputTokens: 12000, cachedInputTokens: 1000, cacheWriteInputTokens: 2000,
      outputTokens: 1500, reasoningTokens: 900, totalTokens: 13500, webSearchCalls: 2,
      requestedModel: 'gpt-6.1-sol', model: response.model, serviceTier: 'default', responseId: 'resp_fixture', requestId: 'req_fixture' });
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.expiresAt.getTime() - Date.parse(event.startedAt)).toBe(90 * 86400000);
    expect(JSON.stringify(event)).not.toMatch(/PRIVATE|query|content|output_text/);
    await recordPageReviewResponse({ ...context, stage: 'assessment' }, async () => ({ ...response, output: [] }));
    expect([...records.keys()].filter(key => key.startsWith('aiUsageEvents/'))).toHaveLength(2);
  });

  it.each(['incomplete', 'failed', 'cancelled'])('captures usage returned for a %s model response', async status => {
    await recordPageReviewResponse(context, async () => ({ ...response, status }));
    expect(records.get('aiUsageEvents/review-fixture-research')).toMatchObject({ providerOutcome: status, usageStatus: 'reported', outputTokens: 1500 });
  });

  it.each([
    [{ name: 'APIConnectionTimeoutError', message: 'PRIVATE PROVIDER DETAILS' }, 'timeout'],
    [{ name: 'APIUserAbortError', message: 'PRIVATE PROVIDER DETAILS' }, 'cancelled'],
    [{ status: 429, message: 'PRIVATE PROVIDER DETAILS' }, 'rate_limited'],
    [{ status: 503, message: 'PRIVATE PROVIDER DETAILS' }, 'provider_error'],
    [new Error('PRIVATE PROVIDER DETAILS'), 'connection_or_unknown'],
  ])('records request failure with unknown spend and preserves the original error', async (error, category) => {
    await expect(recordPageReviewResponse(context, async () => { throw error; })).rejects.toBe(error);
    const event = records.get('aiUsageEvents/review-fixture-research');
    expect(event).toMatchObject({ providerOutcome: 'request_failed', failureCategory: category, usageStatus: 'unknown',
      inputTokens: null, outputTokens: null, webSearchCalls: null });
    expect(JSON.stringify(event)).not.toContain('PRIVATE');
  });

  it('keeps missing or malformed counts unknown rather than treating them as free usage', () => {
    expect(responseUsage({ usage: { input_tokens: -1, output_tokens: NaN, total_tokens: '50', input_tokens_details: { cached_tokens: 0.1 } },
      model: 'private domain https://example.test', service_tier: 'another private string' })).toMatchObject({
      usageStatus: 'unknown', inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null,
      cacheWriteInputTokens: null, reasoningTokens: null, webSearchCalls: null, model: null, serviceTier: null,
    });
    expect(responseUsage({ usage: { input_tokens: 0, output_tokens: 0 }, output: [] })).toMatchObject({ usageStatus: 'reported', inputTokens: 0, outputTokens: 0, webSearchCalls: 0 });
  });

  it('keeps the successful review available when telemetry storage fails, with a sanitized log fallback', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(db, 'runTransaction').mockRejectedValue(new Error('PRIVATE DATABASE DETAILS'));
    expect(await recordPageReviewResponse(context, async () => response)).toBe(response);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/PRIVATE|alice/);
    expect(JSON.parse(warning.mock.calls[1][0])).toMatchObject({ event: 'ai_usage_telemetry_write_failed', inputTokens: 12000, webSearchCalls: 2 });
  });

  it('does not recreate an event removed during account deletion', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await recordPageReviewResponse(context, async () => {
      await db.collection('aiUsageEvents').doc('review-fixture-research').delete();
      return response;
    });
    expect([...records.keys()].filter(key => key.startsWith('aiUsageEvents/'))).toHaveLength(0);
  });

  it.each(['set', 'update'])('bounds a never-settling accounting %s without blocking the provider result', async operation => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const update = vi.fn().mockImplementation(() => new Promise(() => {}));
    if (operation === 'set') vi.spyOn(db, 'runTransaction').mockImplementation(() => new Promise(() => {}));
    else {
      const original = db.collection;
      vi.spyOn(db, 'collection').mockImplementation(name => name === 'aiUsageEvents'
        ? { doc: id => ({ ...original(name).doc(id), update }) } : original(name));
    }
    const execute = vi.fn().mockResolvedValue(response);
    const result = recordPageReviewResponse(context, execute);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toBe(response);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/PRIVATE|alice/);
    expect(JSON.parse(warning.mock.calls.at(-1)[0])).toMatchObject({ inputTokens: 12000, outputTokens: 1500 });
    if (operation === 'set') expect(update).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create accounting or start the provider after account deletion', async () => {
    await db.collection('users').doc('alice').delete();
    const execute = vi.fn().mockResolvedValue(response);
    await expect(recordPageReviewResponse(context, execute)).rejects.toMatchObject({ status: 409 });
    expect(execute).not.toHaveBeenCalled();
    expect([...records.keys()].filter(key => key.startsWith('aiUsageEvents/'))).toHaveLength(0);
  });
});
