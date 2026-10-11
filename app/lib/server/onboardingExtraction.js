import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { responseText } from '../pageReviewPolicy';
import { buildOnboardingEvidence, buildOnboardingExtractionRequest, validateOnboardingExtraction, ONBOARDING_EXTRACTION_VERSION } from '../onboardingExtractionPolicy';
import { readOnboardingInventory, onboardingInventoryScope, onboardingInventoryKey } from './onboardingInventory';
import { onboardingHash, readWorkSession, reserveOnboardingWork, finishOnboardingWork } from './onboardingWork';
import { recordPageReviewResponse } from './aiUsage';

const plain = value => JSON.parse(JSON.stringify(value));
const stableSources = bundle => bundle.sources.map(({ observedAt: _date, ...source }) => source);
const extractionRef = scope => db.collection('onboardingExtractions').doc(onboardingInventoryKey(scope));

export async function readOnboardingExtraction(uid, session) {
  const current = session || await readWorkSession(uid, { write: false });
  if (!current.websiteUrl) return null;
  const scope = await onboardingInventoryScope(uid, current);
  const saved = (await extractionRef(scope).get()).data();
  await readWorkSession(uid, { expectedSession: current, write: false });
  if (!saved || saved.userId !== uid || saved.scopeKey !== onboardingInventoryKey(scope)) return null;
  const { userId: _uid, scopeKey: _scope, ...result } = saved;
  return result;
}

export async function extractOnboardingBusiness(uid, { expectedRevision, requestId, signal, deadline = Date.now() + 110000 } = {}) {
  if (!Number.isInteger(expectedRevision)) throw new RequestError('Reload your website setup before extracting business details.', 409);
  const session = await readWorkSession(uid, { expectedRevision });
  const scope = await onboardingInventoryScope(uid, session, { write: true });
  const inventory = await readOnboardingInventory(uid, session, { full: true });
  if (!inventory) throw new RequestError('Review your website before extracting business details.', 409);
  const bundle = buildOnboardingEvidence(inventory);
  if (scope.preview && bundle.sources.length) throw new RequestError('Connect the matching Google Search Console property before extracting business suggestions. Your website preview is saved, and you can enter your business details manually.', 409);
  const fingerprint = onboardingHash([ONBOARDING_EXTRACTION_VERSION, onboardingInventoryKey(scope), stableSources(bundle)]);
  const previous = await readOnboardingExtraction(uid, session);
  if (previous?.fingerprint === fingerprint) return { extraction: previous, sessionRevision: session.revision, unchanged: true };
  if (process.env.ONBOARDING_EXTRACTION_ENABLED === 'false') throw new RequestError('Automatic business extraction is paused. Your saved observations remain available, and you can enter your business details manually.', 409);
  const reservation = await reserveOnboardingWork(uid, session, { kind: 'extraction', requestId, fingerprint, charge: bundle.sources.length > 0 });
  if (reservation.duplicate) return { extraction: await readOnboardingExtraction(uid, session), sessionRevision: session.revision, unchanged: true };
  try {
    let facts = { businessName: null, businessType: null, services: [], locations: [], faqs: [],
      questions: ['What is your business name, what services do you offer, and which places do you serve?'] };
    if (bundle.sources.length) {
      if (!process.env.OPENAI_API_KEY) throw new RequestError('Business extraction is unavailable. You can enter and confirm your business details manually.', 503);
      const remaining = Math.min(100000, deadline - Date.now());
      if (remaining < 1000) throw new RequestError('The website review took longer than expected. Your inventory is saved; try extracting details again.', 503);
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: remaining });
      const request = buildOnboardingExtractionRequest(bundle);
      const response = await recordPageReviewResponse({ userId: uid, reviewRunId: randomUUID(), stage: 'business_extraction',
        requestedModel: request.model, feature: 'onboarding_extraction' }, () => client.responses.create(request, { ...(signal ? { signal } : {}), timeout: remaining }));
      if (response.status !== 'completed') throw new Error('Extraction did not complete.');
      const raw = responseText(response);
      if (raw.length > 100000) throw new Error('Extraction exceeded its result limit.');
      facts = validateOnboardingExtraction(JSON.parse(raw), bundle);
    }
    const saved = { schemaVersion: 1, userId: uid, scopeKey: onboardingInventoryKey(scope), revision: (previous?.revision || 0) + 1,
      status: facts.businessName && facts.services.length && facts.locations.length ? 'ready' : 'needs_information',
      ...facts, fingerprint, inventoryId: inventory.id, inventoryRevision: inventory.revision, extractedAt: new Date().toISOString(),
      sources: bundle.sources.map(({ text: _text, ...source }) => source), provenance: 'website_observation', requiresOwnerConfirmation: true,
      limitations: bundle.limitations };
    await db.runTransaction(async tx => {
      await onboardingInventoryScope(uid, session, { tx, write: true });
      const [currentInventory, currentSaved] = await Promise.all([tx.get(db.collection('onboardingInventories').doc(inventory.id)), tx.get(extractionRef(scope))]);
      if (currentInventory.data()?.revision !== inventory.revision || (currentSaved.data()?.revision || 0) !== (previous?.revision || 0)) {
        throw new RequestError('The website evidence changed while details were being extracted. Reload to review the saved work.', 409);
      }
      tx.set(extractionRef(scope), plain(saved));
    });
    await finishOnboardingWork(uid, session, reservation, { id: onboardingInventoryKey(scope), revision: saved.revision });
    return { extraction: await readOnboardingExtraction(uid, session), sessionRevision: session.revision, unchanged: false };
  } catch (error) {
    await finishOnboardingWork(uid, session, reservation, null, true).catch(() => {});
    if (error instanceof RequestError) throw error;
    throw new RequestError('We could not verify new business details from this review. Previously saved details are unchanged; you can enter the facts yourself.', 502);
  }
}
