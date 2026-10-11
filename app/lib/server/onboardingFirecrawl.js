import { randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { RequestError } from './requestAuth';
import { extractPageContent } from './scrapeContent';
import { onboardingHash, readWorkSession } from './onboardingWork';

const DAY = 86400000;
const LIMITATION = 'Rendered business content is a separate Firecrawl observation. Native HTTP, canonical and indexing evidence remains unchanged; provider rendering does not prove Google can render or index this page.';
export const firecrawlEnabled = () => process.env.ONBOARDING_FIRECRAWL_ENABLED === 'true'
  && process.env.ONBOARDING_FIRECRAWL_EVALUATION_PASSED === 'true' && !!process.env.FIRECRAWL_API_KEY;
export function firecrawlEligible(native, { robotsStatus, preview = false } = {}) {
  const text = native?.mainContent || native?.textContent || '';
  return !preview && native?.technical?.httpStatus === 200 && ['reviewed', 'not_found'].includes(robotsStatus)
    && typeof native.finalUrl === 'string' && text.trim().length < 120;
}
const compactNative = native => ({ url: native.url, finalUrl: native.finalUrl, title: native.htmlTitle, h1: native.h1,
  content: native.mainContent || native.textContent || '', canonical: native.canonicalUrl, robots: native.robotsMeta });

async function providerJson(response) {
  const maximum = 3 * 1024 * 1024;
  if (!response.ok || Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel(); throw new Error('render_unavailable');
  }
  if (!response.body) throw new Error('render_unavailable');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('render_unavailable'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

async function reserve(uid, session, scope, options, cacheKey) {
  const now = Date.now(), attempt = randomUUID(), month = new Date(now).toISOString().slice(0, 7);
  const ids = [onboardingHash(['render_inventory', options.inventoryId, options.generation]),
    onboardingHash(['render_day', uid, Math.floor(now / DAY)]), onboardingHash(['render_month', month]), 'onboarding-render-concurrency'];
  const refs = ids.map(id => db.collection('requestLimits').doc(id));
  const event = db.collection('onboardingUsageEvents').doc(attempt);
  await db.runTransaction(async tx => {
    await readWorkSession(uid, { expectedSession: session, tx });
    const values = await Promise.all(refs.map(ref => tx.get(ref)));
    const counts = values.slice(0, 3).map(doc => doc.data()?.count || 0);
    if (counts.some((count, index) => count >= [10, 20, 500][index])) throw new RequestError('The rendered-page review allowance has been reached.', 429);
    const leases = (values[3].data()?.leases || []).filter(item => Date.parse(item.until) > now);
    if (leases.length >= 2) throw new RequestError('Rendered-page reviews are busy. Native website evidence is still available.', 429);
    refs.slice(0, 3).forEach((ref, index) => tx.set(ref, { count: counts[index] + 1, feature: 'onboarding_render',
      ...(index < 2 ? { userId: uid } : {}), expiresAt: new Date(now + (index === 2 ? 62 : 3) * DAY) }));
    tx.set(refs[3], { leases: [...leases, { attempt, until: new Date(now + 60000).toISOString() }], expiresAt: new Date(now + DAY) });
    tx.set(event, { userId: uid, schemaVersion: 1, provider: 'firecrawl', feature: 'onboarding_render', stage: 'scrape',
      outcome: 'started', usageStatus: 'unknown', creditsUsed: null, startedAt: new Date(now).toISOString(),
      inventoryId: options.inventoryId, scopeKey: onboardingHash(scope), cacheKey, expiresAt: new Date(now + 90 * DAY) });
  });
  return { event, concurrency: refs[3], attempt };
}
async function finish(uid, session, reservation, outcome, creditsUsed = null) {
  await db.runTransaction(async tx => {
    const [event, user, concurrency] = await Promise.all([tx.get(reservation.event), tx.get(db.collection('users').doc(uid)), tx.get(reservation.concurrency)]);
    if (concurrency.exists) tx.update(reservation.concurrency, { leases: (concurrency.data().leases || []).filter(item => item.attempt !== reservation.attempt) });
    // No set/merge: a late provider response cannot recreate deleted accounting.
    if (event.exists && user.exists && !user.data()?.deletionInProgress) tx.update(reservation.event, { outcome,
      usageStatus: creditsUsed === null ? 'unknown' : 'reported', creditsUsed, completedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - Date.parse(event.data().startedAt)) });
  }).catch(() => {});
}

export async function supplementOnboardingPage(uid, session, scope, native, options = {}) {
  if (!firecrawlEnabled() || !firecrawlEligible(native, { ...options, preview: scope.preview })) return native;
  const cacheKey = onboardingHash([uid, scope.sessionKey, scope.property, scope.websiteUrl, scope.websiteRunId, compactNative(native)]);
  const cacheRef = db.collection('onboardingCrawlCache').doc(cacheKey);
  const cached = (await cacheRef.get()).data();
  if (cached && Date.parse(cached.expiresAt) > Date.now()) {
    await readWorkSession(uid, { expectedSession: session });
    return { ...native, renderedSupplement: { ...cached.supplement, cache: 'reused' } };
  }
  let reservation;
  try {
    if (!Number.isFinite(options.deadline) || options.deadline - Date.now() < 2000) return native;
    reservation = await reserve(uid, session, scope, options, cacheKey);
    const timeout = Math.max(1000, Math.min(25000, options.deadline - Date.now() - 500));
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    const response = await fetch('https://api.firecrawl.dev/v2/scrape', { method: 'POST', signal,
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: native.finalUrl, formats: ['html'], onlyMainContent: false, parsers: [], maxAge: 0,
        storeInCache: false, proxy: 'basic', skipTlsVerification: false, timeout }) });
    const payload = await providerJson(response), data = payload.data;
    if (payload.success !== true || !data || typeof data.html !== 'string' || data.html.length > 2 * 1024 * 1024
      || data.metadata?.statusCode !== 200) throw new Error('render_unavailable');
    // Provider redirect behavior is outside our protected fetcher. Require its
    // observed final address to match the native, publicly fetched destination.
    const finalUrl = data.metadata.url || data.metadata.sourceURL;
    if (typeof finalUrl !== 'string' || new URL(finalUrl).href !== new URL(native.finalUrl).href
      || new URL(finalUrl).hostname !== new URL(scope.websiteUrl).hostname || !propertyContainsUrl(scope.property, finalUrl)) throw new Error('render_scope_mismatch');
    const content = extractPageContent(data.html, { pageUrl: native.url, finalUrl, property: scope.property });
    if ((content.mainContent || content.textContent || '').trim().length < 120) throw new Error('render_no_readable_content');
    const supplement = { status: 'available', provider: 'firecrawl', source: 'provider_rendered_html', observedAt: new Date().toISOString(),
      content: { htmlTitle: content.htmlTitle, metaDescription: content.metaDescription, h1: content.h1, h2: content.h2 || [],
        mainContent: content.mainContent || content.textContent || '', structuredData: content.structuredData, internalLinks: content.internalLinks }, limitation: LIMITATION };
    await db.runTransaction(async tx => {
      await readWorkSession(uid, { expectedSession: session, tx });
      tx.set(cacheRef, { userId: uid, scopeKey: onboardingHash(scope), supplement, expiresAt: new Date(Date.now() + 7 * DAY).toISOString() });
    });
    const credits = Number.isSafeInteger(data.metadata?.creditsUsed) && data.metadata.creditsUsed >= 0 ? data.metadata.creditsUsed : null;
    await finish(uid, session, reservation, 'completed', credits);
    return { ...native, renderedSupplement: { ...supplement, cache: 'fresh' } };
  } catch (error) {
    if (reservation) await finish(uid, session, reservation, 'failed_or_unknown');
    return { ...native, renderedSupplement: { status: 'unavailable', provider: 'firecrawl',
      reason: error?.status === 429 ? 'allowance_or_concurrency' : 'render_unavailable', limitation: LIMITATION } };
  }
}
