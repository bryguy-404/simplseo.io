import { createHash, randomUUID } from 'node:crypto';
import * as cheerio from 'cheerio';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { pacificDay, recentObservationWindow, shiftDay } from '../progressAssessment';
import { RequestError } from './requestAuth';
import { readNewPageScope, assertSameNewPageScope, newPageScopeKey } from './newPageScope';
import { publicFetch } from './publicFetch';
import { getGscConnection } from './gscConnection';
import { fetchPageObservation } from './pageObservation';

const DAY = 86400000;
const clean = (value, maximum = 1000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);
const planRef = id => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new RequestError('Choose a saved page plan.');
  return db.collection('newPagePlans').doc(id);
};
function assertPlan(scope, data) {
  if (!data || data.userId !== scope.userId) throw new RequestError('Page plan not found.', 404);
  assertSameNewPageScope(scope, data);
}
function validateUrl(scope, input) {
  let url;
  try { url = new URL(input); } catch { throw new RequestError('Enter the full published page URL.'); }
  if (typeof input !== 'string' || input.length > 2048 || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.hash || (url.port && !['80', '443'].includes(url.port))
    || url.hostname !== new URL(scope.websiteUrl).hostname || !propertyContainsUrl(scope.property, url.href)) {
    throw new RequestError('Use a public page on your selected website and Search Console property.', 403);
  }
  return url.href;
}
function publicationId(scope, url) {
  return createHash('sha256').update(`${newPageScopeKey(scope)}\0${url}`).digest('hex');
}

/** A modest relevance guard, not an SEO quality score. Human-edited copy need
 * not match the draft, but a homepage, login screen or unrelated page must not
 * accidentally start this new-page plan's clock. */
export function publicationMatchesPlan(plan, page) {
  if (new URL(page.url).pathname === '/' || page.text.length < 80 || /^(404|page not found|not found)(\b|\s)/i.test(page.title)) return false;
  const source = [plan.idea?.service, plan.idea?.topic, plan.idea?.purpose, plan.draft?.h1].filter(Boolean).join(' ');
  const generic = new Set(['with', 'from', 'your', 'about', 'that', 'this', 'have', 'will', 'more', 'page', 'service', 'services', 'local', 'help', 'home']);
  const tokens = [...new Set((source.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter(word => !generic.has(word)))];
  if (!tokens.length) return false;
  const haystack = `${page.title} ${page.h1} ${page.text}`.toLowerCase();
  const serviceTokens = (String(plan.idea?.service || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter(word => !generic.has(word));
  // Location names alone cannot make an unrelated service page appropriate.
  return (!serviceTokens.length || serviceTokens.some(word => haystack.includes(word.replace(/s$/, ''))))
    && tokens.filter(word => haystack.includes(word)).length >= Math.min(2, tokens.length);
}

export async function confirmNewPagePublication(userId, { planId, revision, pageUrl, confirmed, confirmRedirect = false, confirmedRedirectUrl = null }) {
  if (confirmed !== true) throw new RequestError('Confirm you published this page in your website builder first.');
  const scope = await readNewPageScope(userId, { write: true });
  const ref = planRef(planId);
  const snapshot = await ref.get();
  const saved = snapshot.data();
  assertPlan(scope, saved);
  if (saved.revision !== revision) throw new RequestError('This plan changed. Reload before confirming publication.', 409);
  if (!saved.draft || saved.status === 'dismissed') throw new RequestError('Prepare and review a draft before confirming publication.', 409);
  if (saved.status === 'published') {
    const result = await readNewPageTracking(userId, planId);
    if (result.publication?.pageUrl !== validateUrl(scope, pageUrl)) throw new RequestError('This plan already tracks another published URL.', 409);
    return { plan: { ...saved, id: planId }, ...result };
  }
  const requestedUrl = validateUrl(scope, pageUrl);
  const declaredAt = new Date().toISOString();
  const response = await publicFetch(requestedUrl, { property: scope.property, allowedHostname: new URL(scope.websiteUrl).hostname, deadline: Date.now() + 25000 });
  if (!response.ok) throw new RequestError('That page is not publicly available yet. Publish it, then try again.', 409);
  if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new RequestError('Use a public HTML page, not a file or download.', 409);
  const finalUrl = validateUrl(scope, response.url || requestedUrl);
  if (finalUrl !== requestedUrl && (confirmRedirect !== true || confirmedRedirectUrl !== finalUrl)) {
    // Controlled URL only; route includes the destination in its structured 409.
    const error = new RequestError(`This URL redirects to ${finalUrl}. Confirm the destination before tracking it.`, 409);
    error.code = 'confirm_redirect'; error.destination = finalUrl; throw error;
  }
  const $ = cheerio.load(await response.text());
  $('script, style, noscript, nav, footer').remove();
  const page = { url: finalUrl, title: clean($('title').first().text()), h1: clean($('h1').first().text()), text: clean($('body').text(), 30000) };
  if (!publicationMatchesPlan(saved, page)) throw new RequestError('The page does not appear to match this plan. Check the URL and the published service content.', 409);
  const robots = [$('meta[name="robots"]').attr('content'), $('meta[name="googlebot"]').attr('content'), response.headers.get('x-robots-tag')].filter(Boolean).join(', ');
  let canonical = null;
  const canonicalRaw = $('link[rel="canonical"]').first().attr('href');
  try { if (canonicalRaw) { const parsed = new URL(canonicalRaw, finalUrl); if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) canonical = parsed.href; } } catch { /* Invalid directive is a warning, not an invented canonical. */ }
  const warnings = [];
  if (/\b(noindex|none)\b/i.test(robots)) warnings.push('This page declares noindex. Google may exclude it until that directive is removed.');
  if (canonicalRaw && !canonical) warnings.push('The page has an invalid canonical URL. Review it in your website editor.');
  if (canonical && canonical !== finalUrl) warnings.push('The page declares a different canonical URL. Google may attribute search activity to that other URL.');
  const verifiedAt = new Date().toISOString();
  const id = publicationId(scope, finalUrl);
  const pubRef = db.collection('newPagePublications').doc(id);
  return db.runTransaction(async tx => {
    const [currentScope, current, previous] = await Promise.all([readNewPageScope(userId, { write: true, tx }), tx.get(ref), tx.get(pubRef)]);
    assertSameNewPageScope(scope, currentScope);
    assertPlan(scope, current.data());
    if (current.data().revision !== revision || current.data().status === 'published') throw new RequestError('This plan changed. Reload before confirming publication.', 409);
    if (previous.exists && previous.data().planId !== planId) throw new RequestError('This URL is already tracked by another page plan.', 409);
    // Scope values and observations are authored here, never accepted from the client.
    const publication = { schemaVersion: 1, id, userId, property: scope.property, websiteRunId: scope.websiteRunId || null,
      websiteUrl: scope.websiteUrl, planId, requestedUrl, pageUrl: finalUrl, ownerDeclaredAt: declaredAt,
      verifiedAt, publicPage: { status: 'available', title: page.title, h1: page.h1, canonical, robots: clean(robots), warnings, verifiedAt },
      trackingEnabled: true, nextCheckAt: verifiedAt, indexing: null, activity: null, preexistingActivity: null,
      lastAttemptAt: null, lastError: null, leaseUntil: null };
    const plan = { ...current.data(), id: planId, status: 'published', publicationId: id, revision: revision + 1, updatedAt: verifiedAt };
    tx.set(pubRef, publication); tx.update(ref, { status: plan.status, publicationId: id, revision: plan.revision, updatedAt: verifiedAt });
    return { plan, publication, tracking: trackingView(publication) };
  });
}

function trackingView(publication, now = new Date()) {
  if (!publication) return null;
  const elapsed = Math.max(0, Math.floor((now.getTime() - Date.parse(publication.verifiedAt)) / DAY));
  return { indexing: publication.indexing || null, activity: publication.activity || null, preexistingActivity: publication.preexistingActivity || null,
    lastAttemptAt: publication.lastAttemptAt || null, lastError: publication.lastError || null,
    nextCheckAt: publication.nextCheckAt, reviewDue: elapsed >= 84 ? '84_day_review' : elapsed >= 28 ? '28_day_review' : null,
    nextReviewAt: new Date(Date.parse(publication.verifiedAt) + (elapsed < 28 ? 28 : 84) * DAY).toISOString(),
    improvePageUrl: `/low-ctr?page=${encodeURIComponent(publication.pageUrl)}` };
}
function publicView(publication, now) {
  if (!publication) return { publication: null, tracking: null };
  // Leases and attempt tokens are operational internals, not browser state.
  const { leaseUntil: _lease, attempt: _attempt, ...visible } = publication;
  return { publication: visible, tracking: trackingView(publication, now) };
}
async function loadPublication(userId, planId) {
  const scope = await readNewPageScope(userId);
  const plan = (await planRef(planId).get()).data(); assertPlan(scope, plan);
  if (!plan.publicationId) return { scope, plan, publication: null };
  const publication = (await db.collection('newPagePublications').doc(plan.publicationId).get()).data();
  assertPlan(scope, publication);
  if (publication.planId !== planId) throw new RequestError('Publication not found.', 404);
  return { scope, plan, publication };
}
export async function readNewPageTracking(userId, planId) {
  const { publication } = await loadPublication(userId, planId);
  return publicView(publication);
}

export function newPageObservationWindows(verifiedAt, now = new Date()) {
  const rolling = recentObservationWindow(now);
  const verifiedDay = pacificDay(verifiedAt);
  // Daily Google reporting cannot separate pre/post events on the verification day.
  const sinceStart = shiftDay(verifiedDay, 1);
  return { rolling, sinceVerified: sinceStart <= rolling.endDate ? { startDate: sinceStart, endDate: rolling.endDate } : null,
    prior: { startDate: shiftDay(verifiedDay, -28), endDate: shiftDay(verifiedDay, -1) } };
}
function inspectionView(response, at) {
  const result = response?.inspectionResult;
  const index = result?.indexStatusResult;
  if (!index || typeof index !== 'object') throw new RequestError('temporarily_unavailable', 503);
  let inspectionUrl = null;
  try { const link = new URL(result.inspectionResultLink); if (link.protocol === 'https:' && link.hostname === 'search.google.com') inspectionUrl = link.href; } catch { /* optional */ }
  return { status: 'available', fetchedAt: at, source: 'google_url_inspection',
    verdict: clean(index.verdict), coverageState: clean(index.coverageState), robotsTxtState: clean(index.robotsTxtState),
    indexingState: clean(index.indexingState), pageFetchState: clean(index.pageFetchState), lastCrawlTime: clean(index.lastCrawlTime) || null,
    googleCanonical: clean(index.googleCanonical, 2048) || null, userCanonical: clean(index.userCanonical, 2048) || null, inspectionUrl,
    limitation: 'Google’s stored indexing view, not a live indexing test or a request to index this page.' };
}
const errorCode = error => error?.message === 'reconnect_required' ? 'reconnect_required' : 'temporarily_unavailable';

async function collectPublication(scope, publication, { now = new Date(), deadline = Date.now() + 45000, scheduled = false } = {}) {
  const ref = db.collection('newPagePublications').doc(publication.id);
  const attempt = randomUUID();
  const startedAt = now.toISOString();
  const acquired = await db.runTransaction(async tx => {
    const [currentScope, current] = await Promise.all([readNewPageScope(scope.userId, { write: true, tx }), tx.get(ref)]);
    assertSameNewPageScope(scope, currentScope); assertPlan(scope, current.data());
    const data = current.data();
    if (data.trackingEnabled !== true || Date.parse(data.leaseUntil) > now.getTime()
      || Date.parse(data.lastAttemptAt) + DAY > now.getTime() || (scheduled && Date.parse(data.nextCheckAt) > now.getTime())) return false;
    tx.update(ref, { attempt, leaseUntil: new Date(now.getTime() + 60000).toISOString(), lastAttemptAt: startedAt });
    return data;
  });
  if (!acquired) return { state: 'skipped', ...(await readNewPageTracking(scope.userId, publication.planId)) };
  const patch = {};
  const errors = {};
  try {
    const connection = await getGscConnection(scope.userId, { deadline });
    if (connection.siteUrl !== scope.property) throw new RequestError('reconnect_required', 409);
    const windows = newPageObservationWindows(publication.verifiedAt, now);
    const observe = window => fetchPageObservation(connection, publication.pageUrl, window, now);
    // Each observation fails independently: e.g. inspection quota exhaustion must
    // not replace successful analytics with zero or erase the last index result.
    await Promise.all([
      connection.inspect(publication.pageUrl).then(value => { patch.indexing = inspectionView(value, startedAt); }).catch(error => { errors.indexing = errorCode(error); }),
      observe(windows.rolling).then(value => { patch.rolling = value; }).catch(error => { errors.rolling = errorCode(error); }),
      windows.sinceVerified ? observe(windows.sinceVerified).then(value => { patch.sinceVerified = value; }).catch(error => { errors.sinceVerified = errorCode(error); }) : Promise.resolve(),
      acquired.preexistingActivity ? Promise.resolve() : observe(windows.prior).then(value => { patch.preexistingActivity = value; }).catch(error => { errors.preexistingActivity = errorCode(error); }),
    ]);
    if (!windows.sinceVerified) patch.sinceVerified = { status: 'collecting', reason: 'Reporting excludes the verification day and the most recent three days.', startDate: shiftDay(pacificDay(publication.verifiedAt), 1), endDate: windows.rolling.endDate };
  } catch (error) { errors.connection = errorCode(error); }
  const age = now.getTime() - Date.parse(publication.verifiedAt);
  const nextCheckAt = new Date(now.getTime() + (age < 90 * DAY ? DAY : 7 * DAY)).toISOString();
  const updated = await db.runTransaction(async tx => {
    const [currentScope, current] = await Promise.all([readNewPageScope(scope.userId, { write: true, tx }), tx.get(ref)]);
    assertSameNewPageScope(scope, currentScope); assertPlan(scope, current.data());
    const data = current.data();
    if (data.attempt !== attempt) return data;
    const activity = patch.rolling || patch.sinceVerified ? { ...(data.activity || {}), ...(patch.rolling ? { rolling: patch.rolling } : {}),
      ...(patch.sinceVerified ? { sinceVerified: patch.sinceVerified } : {}) } : data.activity || null;
    const next = { ...data, activity, indexing: patch.indexing || data.indexing || null, preexistingActivity: patch.preexistingActivity || data.preexistingActivity || null,
      lastError: Object.keys(errors).length ? errors : null, nextCheckAt, leaseUntil: null, lastAttemptAt: startedAt };
    tx.update(ref, next); return next;
  });
  return { state: Object.values(errors).includes('reconnect_required') ? 'reconnect_required' : Object.keys(errors).length ? 'temporarily_unavailable' : 'usable', ...publicView(updated, now) };
}
export async function refreshNewPageTracking(userId, planId, options = {}) {
  const { scope, publication } = await loadPublication(userId, planId);
  if (!publication) throw new RequestError('Publish and confirm the page before checking its activity.', 409);
  return collectPublication(scope, publication, options);
}

/** Oldest due first; advancing nextCheckAt on both successes and failures is the
 * persistent fair cursor. Manual refresh uses the same per-URL lease/cache. */
export async function runNewPageCollection({ now = new Date(), deadline = Date.now() + 110000 } = {}) {
  const job = db.collection('newPageJobs').doc('daily-new-page-monitoring');
  const attempt = randomUUID();
  await db.runTransaction(async tx => {
    const prior = (await tx.get(job)).data() || {};
    if (Date.parse(prior.leaseUntil) > now.getTime() || Date.parse(prior.lastStartedAt) + 60000 > now.getTime()) throw new RequestError('New-page monitoring is already running.', 429);
    tx.set(job, { attempt, lastStartedAt: now.toISOString(), leaseUntil: new Date(now.getTime() + 240000).toISOString() }, { merge: true });
  });
  const finish = patch => db.runTransaction(async tx => {
    if ((await tx.get(job)).data()?.attempt === attempt) tx.set(job, { ...patch, leaseUntil: null }, { merge: true });
  });
  try {
    const due = await db.collection('newPagePublications').where('trackingEnabled', '==', true).where('nextCheckAt', '<=', now.toISOString()).orderBy('nextCheckAt').limit(21).get();
    const selected = due.docs.slice(0, 20);
    const counts = {}; let next = 0, checked = 0;
    await Promise.all(Array.from({ length: Math.min(2, selected.length) }, async () => {
      while (next < selected.length && Date.now() < deadline) {
        const document = selected[next++]; const item = document.data();
        try {
          const scope = await readNewPageScope(item.userId);
          try { assertSameNewPageScope(scope, item); } catch {
            // Retain old-version history; stop scheduling it. Never create a
            // missing record after account deletion.
            await db.runTransaction(async tx => { const current = await tx.get(document.ref); if (current.exists && current.data().websiteRunId === item.websiteRunId && current.data().property === item.property) tx.update(document.ref, { trackingEnabled: false }); });
            counts.skipped = (counts.skipped || 0) + 1; checked++; continue;
          }
          const result = await collectPublication(scope, { ...item, id: document.id }, { now, deadline, scheduled: true });
          counts[result.state] = (counts[result.state] || 0) + 1;
        } catch {
          counts.error = (counts.error || 0) + 1;
          // Orphaned/deleting accounts cannot monopolize the oldest-due queue.
          await db.runTransaction(async tx => { const current = await tx.get(document.ref); if (current.exists) tx.update(document.ref, { nextCheckAt: new Date(now.getTime() + DAY).toISOString(), leaseUntil: null }); });
        }
        checked++;
      }
    }));
    const moreRecords = due.size > checked;
    const result = { checked, pagesChecked: checked, counts, moreRecords, notificationsSent: 0 };
    await finish({ ...result, lastFinishedAt: new Date().toISOString() }); return result;
  } catch (error) { await finish({ lastErrorAt: new Date().toISOString() }); throw error; }
}
