import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';

const RETENTION_DAYS = 90;
const WRITE_TIMEOUT_MS = 1000;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value) ? value : null;

// Only provider accounting fields are allowed into this private ledger. Never
// copy inputs, generated text, search queries/sources, headers, or error bodies.
export function responseUsage(response) {
  const usage = response?.usage;
  return {
    usageStatus: usage && count(usage.input_tokens) !== null && count(usage.output_tokens) !== null ? 'reported' : 'unknown',
    inputTokens: count(usage?.input_tokens),
    cachedInputTokens: count(usage?.input_tokens_details?.cached_tokens),
    cacheWriteInputTokens: count(usage?.input_tokens_details?.cache_write_tokens),
    outputTokens: count(usage?.output_tokens),
    reasoningTokens: count(usage?.output_tokens_details?.reasoning_tokens),
    totalTokens: count(usage?.total_tokens),
    // These are observed output items, not a claim about invoiced tool calls.
    webSearchCalls: Array.isArray(response?.output) ? response.output.filter(item => item?.type === 'web_search_call').length : null,
    model: label(response?.model),
    serviceTier: label(response?.service_tier),
    responseId: label(response?.id),
    requestId: label(response?._request_id),
  };
}

function failureCategory(error) {
  if (error?.name === 'AbortError' || error?.name === 'APIUserAbortError') return 'cancelled';
  if (error?.name === 'APIConnectionTimeoutError') return 'timeout';
  if (error?.status === 429) return 'rate_limited';
  if (Number.isInteger(error?.status)) return 'provider_error';
  return 'connection_or_unknown';
}

function logFallback(ref, data, operation) {
  // Logging remains useful if the database is unavailable. The sanitized
  // accounting record is never returned through a customer-facing API.
  const { userId: _userId, expiresAt: _expiresAt, ...safe } = data;
  console.warn(JSON.stringify({ event: 'ai_usage_telemetry_write_failed', eventId: ref.id, operation, ...safe }));
}

async function persist(ref, data, operation, execute = () => ref[operation](data)) {
  let timer;
  try {
    const result = await Promise.race([execute(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Accounting write timed out')), WRITE_TIMEOUT_MS);
    })]);
    return { saved: true, result };
  } catch {
    logFallback(ref, data, operation);
    return { saved: false };
  } finally {
    clearTimeout(timer);
  }
}

// A started record survives a process interruption as unknown usage. A failed
// or timed-out provider request may still be billable; absence is never zero.
// Each actual provider attempt gets one document, including invalid AI output.
export async function recordPageReviewResponse({ userId, reviewRunId, stage, requestedModel }, execute) {
  const started = Date.now();
  const ref = db.collection('aiUsageEvents').doc(`${reviewRunId}-${stage}`);
  const initial = {
    schemaVersion: 1, feature: 'page_review', userId, reviewRunId, stage,
    provider: 'openai', requestedModel, startedAt: new Date(started).toISOString(),
    expiresAt: new Date(started + RETENTION_DAYS * 86400000),
    providerOutcome: 'started', ...responseUsage(null),
  };
  const start = await persist(ref, initial, 'set', () => db.runTransaction(async tx => {
    const [user, setup] = await Promise.all([
      tx.get(db.collection('users').doc(userId)), tx.get(db.collection('onboarding').doc(userId)),
    ]);
    // This read participates in the write transaction. Account deletion removes
    // these roots before its final ledger sweep, so a late start cannot recreate
    // identifiable accounting after a successful deletion.
    if (!user.exists || !setup.exists) return 'account_unavailable';
    tx.set(ref, initial);
    return 'started';
  }));
  if (start.result === 'account_unavailable') throw new RequestError('Your account changed while this review was starting. Reload the page and try again.', 409);
  const finish = async data => {
    // A timed-out initial write may still finish later. Do not race it with an
    // update; log final accounting instead, leaving any late document unknown.
    if (start.saved) await persist(ref, data, 'update');
    else logFallback(ref, data, 'update');
  };
  try {
    const response = await execute();
    const providerOutcome = ['completed', 'incomplete', 'failed', 'cancelled'].includes(response?.status) ? response.status : 'returned';
    await finish({ providerOutcome, ...responseUsage(response),
      completedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - started) });
    return response;
  } catch (error) {
    await finish({ providerOutcome: 'request_failed', failureCategory: failureCategory(error),
      completedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - started) });
    throw error;
  }
}
