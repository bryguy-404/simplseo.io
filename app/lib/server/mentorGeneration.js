import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { RequestError } from './requestAuth';
import { recordPageReviewResponse } from './aiUsage';
import { reserveMentorTurn, reserveMentorResearch, settleMentorTurn } from './mentorBudget';
import { assertMentorAccountScope, assertMentorEvidenceRevisions, MENTOR_EVIDENCE_TOOLS, executeMentorEvidenceTool } from './mentorEvidence';
import { lookupGoogleGuidance, documentationResearchRequest, researchedDocumentationUrls, readGoogleDocumentation, selectMentorDocumentationExcerpt } from './mentorDocumentation';
import { GOOGLE_GUIDANCE_TOOL } from '../mentorDocumentationPolicy';
import { MENTOR_MODEL, MENTOR_POLICY_VERSION, MENTOR_LIMITS, MENTOR_PRICING, MENTOR_SYSTEM,
  MENTOR_ANSWER_FORMAT, mentorInputBound, mentorResponseText, validateMentorAnswer, estimatedMentorCost } from '../mentorPolicy';

const plain = value => JSON.parse(JSON.stringify(value ?? null));
const unavailable = (category, counts = {}) => Object.assign(new RequestError('The mentor could not finish this answer. Your question and conversation are saved. Please try again.', 503),
  category ? { mentorFailure: { category, ...counts } } : {});
const unique = items => [...new Map(items.filter(item => item?.id).map(item => [item.id, item])).values()];
// Only documented counting fields; generation options such as store,
// service_tier, include and max_output_tokens are not sent to this endpoint.
const inputCountBody = request => Object.fromEntries(['model', 'input', 'instructions', 'tools', 'tool_choice',
  'parallel_tool_calls', 'reasoning', 'text', 'truncation'].filter(key => request[key] !== undefined).map(key => [key, request[key]]));

/** A bounded tool loop. Injectable dependencies support isolated full-flow tests
 * and the explicit quality evaluation; they cannot be supplied by the browser. */
export async function generateMentorAnswer({ uid, scope, conversationId, turnId, message, history = [], selection = {}, signal,
  deadline = Date.now() + MENTOR_LIMITS.deadlineMs }, deps = {}) {
  const validateScope = deps.assertScope || assertMentorAccountScope;
  const validateEvidence = deps.assertEvidence || assertMentorEvidenceRevisions;
  const executeEvidence = deps.executeEvidence || executeMentorEvidenceTool;
  const docsLookup = deps.lookupDocs || lookupGoogleGuidance;
  const definitions = deps.toolDefinitions || MENTOR_EVIDENCE_TOOLS;
  const reserve = deps.reserve || reserveMentorTurn, settle = deps.settle || settleMentorTurn;
  const record = deps.record || recordPageReviewResponse;
  const researchAllowed = deps.researchEnabled ?? (process.env.MENTOR_RESEARCH_ENABLED === 'true');
  const requestResearchAllowance = deps.reserveResearch || reserveMentorResearch;
  const client = !deps.provider && process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 110000 }) : null;
  const provider = deps.provider || client?.responses;
  const countInput = deps.countInput || (client ? (body, options) => client.post('/responses/input_tokens', { body, ...options }) : null);
  if (!provider) throw new RequestError('The mentor is temporarily unavailable. Saved conversations remain available.', 503);
  await validateScope(uid, scope);
  const reservation = await reserve(uid, turnId, { evaluation: deps.evaluation === true });
  let costUsd = 0, unknown = false, attempts = 0, remainingInput = MENTOR_LIMITS.inputTokens,
    remainingOutput = MENTOR_LIMITS.outputTokens, reads = 0, researchUsed = false, documentationCalls = 0, phase = 'evidence',
    inputTokenChecks = 0, inputTokenCheckMs = 0;
  const sources = [], metricCards = [], actions = [], pages = new Set(), evidenceRevisions = new Map();
  const add = result => {
    for (const reference of result?.evidenceRevisions || []) {
      const key = `${reference.kind}:${reference.id}`, previous = evidenceRevisions.get(key);
      if (previous && previous.fingerprint !== reference.fingerprint) throw new RequestError('Your saved work changed during this answer. Ask again to use the latest evidence.', 409);
      evidenceRevisions.set(key, reference);
    }
    sources.push(...(result?.sources || [])); metricCards.push(...(result?.metricCards || [])); actions.push(...(result?.actions || []));
    const { evidenceRevisions: _privateReferences, ...visible } = result || {};
    return plain(visible);
  };
  const timeLeft = () => {
    if (signal?.aborted || deadline - Date.now() < 8000) throw unavailable('deadline');
    return Math.min(100000, deadline - Date.now() - 6000);
  };
  const exactInputCount = async (request, bound) => {
    // One count per controlled request, only after the byte estimate rejects.
    // Counting is not generation and must not create a billable-answer event.
    if (!countInput || remainingInput <= 0 || inputTokenChecks >= MENTOR_LIMITS.mainCalls + 1) {
      throw unavailable('input_budget', { inputBound: bound, remainingInput });
    }
    const timeout = Math.min(8000, timeLeft()), controller = new AbortController(), started = Date.now();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let timer;
    inputTokenChecks++;
    try {
      const stopped = new Promise((_, reject) => {
        const stop = () => reject(unavailable('deadline'));
        if (controller.signal.aborted) stop(); else controller.signal.addEventListener('abort', stop, { once: true });
        timer = setTimeout(abort, timeout);
      });
      const result = await Promise.race([Promise.resolve().then(() => {
        if (controller.signal.aborted) throw unavailable('deadline');
        return countInput(inputCountBody(request), { timeout, signal: controller.signal, maxRetries: 0 });
      }), stopped]);
      timeLeft();
      if (!Number.isSafeInteger(result?.input_tokens) || result.input_tokens < 0) throw unavailable('input_budget', { inputBound: bound, remainingInput });
      return result.input_tokens;
    } catch (error) {
      if (controller.signal.aborted || signal?.aborted || error.mentorFailure?.category === 'deadline') throw unavailable('deadline');
      throw unavailable('input_budget', { inputBound: bound, remainingInput });
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      inputTokenCheckMs += Math.max(0, Date.now() - started);
    }
  };
  const call = async (request, stage) => {
    phase = 'evidence';
    timeLeft(); await validateScope(uid, scope);
    if (remainingOutput < 256) throw unavailable('output_budget', { remainingOutput });
    let bound = mentorInputBound(request);
    if (bound > remainingInput) {
      bound = await exactInputCount(request, bound);
      timeLeft(); await validateScope(uid, scope); timeLeft();
    }
    if (bound > remainingInput) throw unavailable('input_budget', { inputBound: bound, remainingInput });
    remainingInput -= bound;
    request = { ...request, max_output_tokens: Math.min(request.max_output_tokens, remainingOutput) };
    const attempt = attempts++;
    phase = 'provider';
    try {
      // Turn IDs originate in a browser. Namespace their accounting by account
      // and conversation so another user's same ID cannot overwrite this ledger.
      const reviewRunId = createHash('sha256').update(JSON.stringify([uid, conversationId, turnId, attempt])).digest('hex');
      const response = await record({ userId: uid, reviewRunId, stage,
        requestedModel: MENTOR_MODEL, feature: 'seo_mentor' }, () => provider.create(request, { timeout: timeLeft(), ...(signal ? { signal } : {}) }));
      const usage = response.usage;
      if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0) {
        unknown = true; remainingOutput -= request.max_output_tokens;
      } else {
        // Reserve a conservative byte bound before the call, then charge the
        // reported input. Otherwise three small tool rounds falsely exhaust
        // the allowance merely because JSON bytes were counted as tokens.
        remainingInput += bound - usage.input_tokens;
        remainingOutput -= usage.output_tokens;
        costUsd += estimatedMentorCost({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
          cachedInputTokens: usage.input_tokens_details?.cached_tokens || 0, cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens || 0,
          searches: (response.output || []).filter(item => item.type === 'web_search_call').length });
      }
      if (response.status && response.status !== 'completed') throw unavailable('provider');
      return response;
    } catch (error) {
      unknown = true;
      error.mentorFailure ||= { category: signal?.aborted || ['AbortError', 'APIUserAbortError', 'APIConnectionTimeoutError'].includes(error.name) ? 'deadline' : 'provider',
        ...(Number.isInteger(error.status) ? { providerStatus: error.status } : {}) };
      throw error;
    }
  };
  const evidenceTool = async (name, args) => {
    if (reads >= MENTOR_LIMITS.accountReads) return { unavailable: 'Evidence read allowance reached. Answer using the evidence already read.' };
    reads += 1;
    if (args.pageUrl) {
      const pageKey = new URL(args.pageUrl).href;
      if (!pages.has(pageKey) && pages.size >= MENTOR_LIMITS.pages) return { unavailable: 'Choose at most three pages for one question.' };
      pages.add(pageKey);
    }
    await validateScope(uid, scope); timeLeft();
    return add(await executeEvidence(uid, scope, name, args, { deadline: deadline - 6000, signal }));
  };
  const guidanceTool = async args => {
    if (++documentationCalls > 2) return { unavailable: 'Use the Google guidance already retrieved.' };
    let result = await docsLookup(args.topic, { deadline: Math.min(deadline - 6000, Date.now() + 18000), signal, fresh: args.latest === true });
    if (args.latest && researchAllowed && !researchUsed && timeLeft() > 25000) {
      researchUsed = true;
      if (await requestResearchAllowance(uid)) {
        try {
          const response = await call(documentationResearchRequest(args.topic, MENTOR_MODEL, Math.min(1200, remainingOutput - 1200)), 'documentation_research');
          // Hosted search input is not independently itemized. Keep a conservative
          // allowance in the settled estimate rather than treating it as free.
          costUsd += estimatedMentorCost({ inputTokens: MENTOR_PRICING.searchInputReserve, cacheWriteTokens: MENTOR_PRICING.searchInputReserve });
          const extra = [];
          for (const url of researchedDocumentationUrls(response)) {
            if (result.documents.some(item => item.url === url)) continue;
            extra.push(await (deps.readDoc || readGoogleDocumentation)(url, { deadline: Math.min(deadline - 6000, Date.now() + 12000), signal }));
          }
          result = { ...result, documents: [...result.documents, ...extra], researchStatus: 'checked' };
        } catch { result = { ...result, researchStatus: 'unavailable', limitation: 'Public research could not finish. Retain the dated references and explain uncertainty.' }; }
      } else result = { ...result, researchStatus: 'allowance_used' };
    }
    const validDocs = result.documents.filter(item => item.excerpt);
    add({ sources: validDocs.map(({ id, title, url, observedAt, status }) => ({ id, title, url, observedAt, status, type: 'google_documentation' })) });
    return { ...result, documents: validDocs.map(item => ({ ...item, excerpt: selectMentorDocumentationExcerpt(item, args.topic) })) };
  };
  try {
    const business = await evidenceTool('read_business_context', {});
    const relevantHistory = history.filter(item => ['user', 'assistant'].includes(item.role)).slice(-8)
      .map(item => ({ role: item.role, content: String(item.content || item.text || item.answer || '').slice(0, 1600) }));
    const trimmableHistory = new Set(relevantHistory);
    let input = [{ role: 'developer', content: MENTOR_SYSTEM }, ...relevantHistory,
      { role: 'user', content: JSON.stringify({ question: String(message).slice(0, 6000), selection, savedBusiness: business }) }];
    let finalResponse;
    for (let index = 0; index < MENTOR_LIMITS.mainCalls; index++) {
      const final = index === MENTOR_LIMITS.mainCalls - 1;
      const request = { model: MENTOR_MODEL, store: false, service_tier: 'default', reasoning: { effort: 'low' },
        max_output_tokens: Math.min(final ? 2600 : 1800, remainingOutput), include: ['reasoning.encrypted_content'],
        text: { format: MENTOR_ANSWER_FORMAT }, input,
        ...(!final ? { tools: [...definitions, GOOGLE_GUIDANCE_TOOL], parallel_tool_calls: true } : {}) };
      // Older discussion stays saved, but does not crowd out this turn's evidence.
      while (mentorInputBound(request) > remainingInput && trimmableHistory.has(input[1])) input.splice(1, 1);
      phase = 'provider';
      const response = await call(request, `answer_${index + 1}`);
      if (remainingInput < 0) throw unavailable('input_budget', { inputBound: MENTOR_LIMITS.inputTokens - remainingInput, remainingInput });
      phase = 'validation';
      const toolCalls = (response.output || []).filter(item => item.type === 'function_call');
      if (!toolCalls.length) { finalResponse = response; break; }
      if (final) throw unavailable('validation');
      input.push(...(response.output || []));
      phase = 'evidence';
      for (const toolCall of toolCalls) {
        let result;
        try {
          const args = JSON.parse(toolCall.arguments || '{}');
          if (toolCall.name === 'read_google_guidance') result = await guidanceTool(args);
          else if (definitions.some(tool => tool.name === toolCall.name)) result = await evidenceTool(toolCall.name, args);
          else throw new Error('Unsupported tool.');
        } catch (error) {
          if ([401, 403, 409].includes(error.status)) throw error;
          result = { unavailable: 'This evidence could not be read. Do not infer zero activity or a technical fault. Explain the limitation.' };
        }
        input.push({ type: 'function_call_output', call_id: toolCall.call_id, output: JSON.stringify(result) });
      }
    }
    if (!finalResponse) throw unavailable('validation');
    phase = 'evidence';
    await validateScope(uid, scope);
    if (evidenceRevisions.size) await validateEvidence(uid, scope, [...evidenceRevisions.values()]);
    phase = 'validation';
    const answer = validateMentorAnswer(mentorResponseText(finalResponse), { sources: unique(sources), metricCards: unique(metricCards), actions: unique(actions) });
    return { ...answer, provenance: { model: MENTOR_MODEL, policyVersion: MENTOR_POLICY_VERSION,
      scope, conversationId, turnId, generatedAt: new Date().toISOString(), accountReads: reads,
      providerAttempts: attempts, documentationResearch: researchUsed, inputTokenChecks, inputTokenCheckMs,
      evidenceRevisions: [...evidenceRevisions.values()] } };
  } catch (error) {
    const failure = error instanceof RequestError ? error : unavailable();
    failure.mentorFailure = error.mentorFailure || { category: phase };
    throw failure;
  } finally {
    await settle(reservation, { costUsd, unknown, providerAttempts: attempts }).catch(() => {});
  }
}
