import { createHash, randomUUID } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { db } from '../firebaseAdmin';
import { propertyContainsUrl } from '../revampState';
import { searchWindow } from '../searchWindow';
import { RequestError } from './requestAuth';
import { publicFetch } from './publicFetch';
import { fetchCurrentPageContent } from './scrapeContent';
import { getGscConnection } from './gscConnection';
import { readNewPageScope, assertSameNewPageScope, newPageScopeKey } from './newPageScope';

export const INVENTORY_LIMITS = Object.freeze({ sitemaps: 20, urls: 500, htmlPages: 100, concurrency: 3, batchMs: 45000 });
const hash = value => createHash('sha256').update(value).digest('hex');
const iso = () => new Date().toISOString();
const plain = value => JSON.parse(JSON.stringify(value));
const MAX_LIMITATIONS = 30;
const nonHtml = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|mp[34]|webm|mov|avi|zip|gz|tar|tgz|bz2|tbz2|xz|txz|zst|7z|rar|dmg|pkg|exe|msi|msix|appx|apk|aab|deb|rpm|iso|img|bin|jar|war|css|js|json|xml|woff2?|ttf|eot|csv|docx?|xlsx?)(?:$|\?)/i;
const generalLimitations = [
  'This inventory reviews discovered pages, not every possible URL. A sitemap, internal links and Search Console may each omit pages.',
  'Downloaded HTML is not a browser rendering. Content excerpts and links are bounded; missing excerpt text does not prove it is absent.',
  'Search Console observations are partial and do not establish indexing status. Pages without observations are still inspected.',
];
const isMissingResponse = (response, url) => [404, 410].includes(response.status)
  && !(response.redirectChain || []).length && (!response.url || response.url === url);

function addLimitation(state, text) {
  if (!state.limitations.includes(text) && state.limitations.length < MAX_LIMITATIONS) state.limitations.push(text);
}
function pageUrl(raw, scope, base = scope.websiteUrl) {
  try {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return null;
    const url = new URL(raw, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return null;
    url.hash = '';
    if (url.hostname !== new URL(scope.websiteUrl).hostname || !propertyContainsUrl(scope.property, url.href)) return null;
    return url.href;
  } catch { return null; }
}

// Validate first: the XML parser's permissive recovery must never turn malformed
// documents or external entities into an apparently complete sitemap inventory.
export function parseInventorySitemap(xml) {
  if (typeof xml !== 'string' || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new RequestError('Sitemap document types and entities are unsupported.', 422);
  if (XMLValidator.validate(xml) !== true) throw new RequestError('The sitemap XML is malformed.', 422);
  const parsed = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true,
    isArray: name => ['url', 'sitemap'].includes(name) }).parse(xml);
  const roots = Object.keys(parsed).filter(key => !key.startsWith('?'));
  if (roots.length !== 1 || !['urlset', 'sitemapindex'].includes(roots[0])) throw new RequestError('This sitemap format is unsupported.', 422);
  const kind = roots[0] === 'sitemapindex' ? 'sitemaps' : 'pages';
  const entries = parsed[roots[0]]?.[kind === 'sitemaps' ? 'sitemap' : 'url'] || [];
  if (!Array.isArray(entries)) throw new RequestError('The sitemap entries are malformed.', 422);
  let invalid = 0;
  const urls = [];
  for (const entry of entries) {
    if (typeof entry?.loc !== 'string' || !entry.loc || entry.loc.length > 2048) { invalid += 1; continue; }
    try { new URL(entry.loc); urls.push(entry.loc); } catch { invalid += 1; }
  }
  return { kind, urls, invalid };
}

function parseRobots(text) {
  const groups = [];
  let current = { agents: [], rules: [] }, startedRules = false;
  let truncated = text.length > 65536;
  const sitemaps = [];
  for (const line of text.slice(0, 65536).split(/\r?\n/)) {
    const match = line.replace(/#.*$/, '').trim().match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const name = match[1].toLowerCase().trim(), value = match[2].trim();
    if (name === 'sitemap' && value) { sitemaps.push(value); continue; }
    if (name === 'user-agent') {
      if (startedRules) { groups.push(current); current = { agents: [], rules: [] }; startedRules = false; }
      if (value) current.agents.push(value.toLowerCase());
    } else if (['allow', 'disallow'].includes(name) && current.agents.length) {
      startedRules = true;
      if (value && value.length <= 2048 && current.rules.length < 100) current.rules.push({ allow: name === 'allow', path: value });
      else if (value) truncated = true;
    }
  }
  groups.push(current);
  const specific = groups.filter(group => group.agents.some(agent => agent !== '*' && 'simpleseo'.startsWith(agent)));
  const rules = (specific.length ? specific : groups.filter(group => group.agents.includes('*'))).flatMap(group => group.rules);
  return { sitemaps, rules: rules.slice(0, 100), truncated: truncated || rules.length > 100 };
}
function robotsExcluded(rawUrl, rules) {
  const url = new URL(rawUrl), path = url.pathname + url.search;
  let selected = null;
  for (const rule of rules || []) {
    // Literal segments avoid evaluating website-controlled regular expressions
    // (many wildcard groups can otherwise cause catastrophic backtracking).
    const exact = rule.path.endsWith('$');
    const pattern = exact ? rule.path.slice(0, -1) : rule.path;
    const segments = pattern.split('*');
    let position = 0, matches = path.startsWith(segments[0]);
    if (matches) position = segments[0].length;
    for (let i = 1; matches && i < segments.length; i += 1) {
      const segment = segments[i];
      const found = exact && i === segments.length - 1 ? path.length - segment.length : path.indexOf(segment, position);
      if (found < position || !path.startsWith(segment, found)) matches = false;
      else position = found + segment.length;
    }
    if (exact && segments.length === 1 && position !== path.length) matches = false;
    if (matches && (!selected || rule.path.length > selected.path.length || (rule.path.length === selected.path.length && rule.allow))) selected = rule;
  }
  return selected && !selected.allow;
}

function view(id, state, pages) {
  const limits = state.limits || INVENTORY_LIMITS;
  const count = status => pages.filter(page => page.status === status).length;
  const fetched = count('fetched'), failed = count('failed'), excluded = count('excluded'), pending = count('pending'), retired = count('retired');
  const fetchedAttempts = fetched + failed + retired + pages.filter(page => page.reason === 'non_html_response').length;
  const canContinue = !state.initialized || state.robotsStatus === 'pending' || state.googleStatus === 'pending'
    || state.sitemaps.some(item => item.status === 'pending') || (pending > 0 && fetchedAttempts < limits.htmlPages);
  const limitations = [...generalLimitations, ...state.limitations];
  if (pending && fetchedAttempts >= limits.htmlPages) limitations.push(`The ${limits.htmlPages}-page HTML review limit was reached. Remaining discovered pages are unreviewed, not missing.`);
  const incomplete = failed > 0 || pending > 0 || pages.some(page => page.reason === 'robots_disallowed') || state.truncated || state.limitations.length > 0;
  return { id, scope: state.scope, revision: state.revision, status: canContinue ? 'running' : !fetched ? 'unavailable' : incomplete ? 'partial' : 'ready',
    updatedAt: state.updatedAt, pages: pages.map(({ generation: _generation, ...page }) => page),
    coverage: { discovered: pages.length, fetched, failed, excluded, pending, retired, truncated: Boolean(state.truncated || (pending && fetchedAttempts >= limits.htmlPages)),
      limitations, sitemapsChecked: state.sitemaps.filter(item => item.status !== 'pending').length, sitemaps: state.sitemaps,
      googleStatus: state.googleStatus, robotsStatus: state.robotsStatus }, canContinue };
}

async function readPages(ref, generation) {
  const snapshot = await ref.collection('pages').where('generation', '==', generation).limit(INVENTORY_LIMITS.urls).get();
  return snapshot.docs.map(doc => doc.data()).sort((a, b) => a.url.localeCompare(b.url));
}
export const readNewPageInventory = userId => readScopedWebsiteInventory(userId);

export async function readScopedWebsiteInventory(userId, adapter = {}) {
  const readScope = adapter.readScope || readNewPageScope, assertScope = adapter.assertScope || assertSameNewPageScope;
  const scope = await readScope(userId);
  const id = (adapter.scopeKey || newPageScopeKey)(scope), ref = db.collection(adapter.collection || 'newPageInventories').doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const state = snapshot.data();
  assertScope(scope, state.scope);
  const pages = await readPages(ref, state.generation);
  assertScope(scope, await readScope(userId));
  return view(id, state, pages);
}

export const continueNewPageInventory = (userId, options) => continueScopedWebsiteInventory(userId, options);

// Only trusted server callers provide adapters; no request body is spread here.
export async function continueScopedWebsiteInventory(userId, { restart = false, signal } = {}, adapter = {}) {
  const readScope = adapter.readScope || readNewPageScope, assertScope = adapter.assertScope || assertSameNewPageScope;
  const limits = { ...INVENTORY_LIMITS, ...(adapter.limits || {}) };
  const readPage = adapter.readPage || fetchCurrentPageContent;
  const started = Date.now(), deadline = started + limits.batchMs - 5000;
  const scope = await readScope(userId, { write: true });
  const id = (adapter.scopeKey || newPageScopeKey)(scope), ref = db.collection(adapter.collection || 'newPageInventories').doc(id), attempt = randomUUID();
  let state = await db.runTransaction(async tx => {
    assertScope(scope, await readScope(userId, { write: true, tx }));
    const previous = (await tx.get(ref)).data();
    if (previous?.leaseUntil && Date.parse(previous.leaseUntil) > Date.now()) throw new RequestError('Your website review is already running. Try again shortly.', 429);
    const current = !previous || restart ? { scope, userId, property: scope.property, websiteRunId: scope.websiteRunId,
      limits, generation: randomUUID(), revision: (previous?.revision || 0) + 1, initialized: false, sitemaps: [],
      robotsStatus: 'pending', robotsRules: [], googleStatus: adapter.skipGoogle ? 'not_requested' : 'pending', limitations: [], truncated: false, updatedAt: iso() } : previous;
    assertScope(scope, current.scope);
    tx.set(ref, { ...current, attempt, leaseUntil: new Date(started + 70000).toISOString() });
    return { ...current, attempt };
  });
  const pages = new Map((await readPages(ref, state.generation)).map(page => [page.url, page]));
  const retirementSnapshots = await ref.collection('retirements').where('active', '==', true).limit(limits.urls).get();
  const retirements = new Map(retirementSnapshots.docs.map(doc => ({ ...doc.data(), recordId: doc.id })).filter(record => {
    try { assertScope(scope, record.scope); return true; } catch { return false; }
  }).map(record => [record.url, record]));
  const retirementUpdates = new Map();
  const dirty = new Set();
  const available = () => !signal?.aborted && Date.now() < deadline;
  const options = { property: scope.property, allowedHostname: new URL(scope.websiteUrl).hostname, deadline, ...(signal ? { signal } : {}) };
  const addPage = (raw, source, base) => {
    const url = pageUrl(raw, scope, base);
    if (!url) return;
    if (pages.has(url)) {
      const page = pages.get(url);
      if (!page.sources.includes(source)) { page.sources.push(source); dirty.add(url); }
      return;
    }
    if (pages.size >= limits.urls) { state.truncated = true; addLimitation(state, `The ${limits.urls}-URL discovery limit was reached. Additional URLs may exist.`); return; }
    const excluded = nonHtml.test(new URL(url).pathname) || robotsExcluded(url, state.robotsRules);
    pages.set(url, { url, status: excluded ? 'excluded' : 'pending', reason: excluded ? (nonHtml.test(new URL(url).pathname) ? 'non_html_resource' : 'robots_disallowed') : null,
      sources: [source], discoveredAt: iso(), generation: state.generation });
    dirty.add(url);
  };
  const addSitemap = (raw, source) => {
    const url = pageUrl(raw, scope);
    if (!url) { addLimitation(state, 'A sitemap URL was invalid or outside the selected website/property and was not fetched.'); return; }
    if (state.sitemaps.some(item => item.url === url)) return;
    if (state.sitemaps.length >= limits.sitemaps) { state.truncated = true; addLimitation(state, `The ${limits.sitemaps}-sitemap document limit was reached. Additional sitemap documents were not reviewed.`); return; }
    state.sitemaps.push({ url, source, status: 'pending' });
  };
  const flush = async (release = false) => {
    state.updatedAt = iso();
    const allDirty = [...dirty];
    // Small transactions keep rich per-page content below Firestore request
    // limits. Metadata advances only after every page result is durable.
    for (let offset = 0; offset < allDirty.length; offset += 25) {
      const urls = allDirty.slice(offset, offset + 25);
      await db.runTransaction(async tx => {
        assertScope(scope, await readScope(userId, { write: true, tx }));
        const latest = (await tx.get(ref)).data();
        if (latest?.attempt !== attempt || latest.generation !== state.generation) throw new RequestError('Website review changed. Reload before continuing.', 409);
        const reactivated = await Promise.all(urls.filter(url => retirementUpdates.has(url)).map(async url => {
          const update = retirementUpdates.get(url), removalRef = ref.collection('retirements').doc(update.recordId);
          const removal = await tx.get(removalRef);
          if (removal.exists) assertScope(scope, removal.data().scope);
          return { removalRef, removal, at: update.at };
        }));
        for (const url of urls) tx.set(ref.collection('pages').doc(hash(url)), plain(pages.get(url)));
        for (const { removalRef, removal, at } of reactivated) if (removal.exists) tx.update(removalRef, {
          active: false, reactivatedAt: at, updatedAt: at, revision: (removal.data().revision || 0) + 1,
        });
      });
      urls.forEach(url => { dirty.delete(url); retirementUpdates.delete(url); });
    }
    await db.runTransaction(async tx => {
      assertScope(scope, await readScope(userId, { write: true, tx }));
      const latest = (await tx.get(ref)).data();
      if (latest?.attempt !== attempt || latest.generation !== state.generation) throw new RequestError('Website review changed. Reload before continuing.', 409);
      state.revision = (latest.revision || 0) + 1;
      tx.set(ref, plain({ ...state, leaseUntil: release ? null : new Date(started + 70000).toISOString() }));
    });
  };
  try {
    if (!state.initialized) {
      addPage(scope.websiteUrl, 'selected_website');
      // Keep owner declarations reviewable even after every discovery source
      // drops an old URL. They still receive a fresh bounded HTTP check.
      for (const url of retirements.keys()) addPage(url, 'owner_removal_record');
      if (adapter.savedSeeds !== false) {
      const [onboarding, legacy] = await Promise.all([db.collection('onboarding').doc(userId).get(), db.collection('siteCrawls').doc(userId).get()]);
      for (const page of (onboarding.data()?.revampPages || []).slice(0, 500)) addPage(typeof page === 'string' ? page : page.url, 'saved_website_record');
      const old = legacy.data() || {};
      // Unversioned legacy crawls may describe the site before a rebuild. They
      // remain history, not current discovery evidence for the new website run.
      if (!scope.websiteRunId || (old.websiteRunId || old.revampRunId) === scope.websiteRunId) {
        for (const url of [...(old.approvedUrls || []), ...(old.manualUrls || []), ...(old.lastCrawlUrls || [])].slice(0, 500)) addPage(url, 'previous_crawl_record');
      }
      }
      addSitemap(new URL('sitemap.xml', scope.websiteUrl).href, 'default');
      state.initialized = true;
    }
    if (state.robotsStatus === 'pending' && available()) {
      const robotsUrl = pageUrl(new URL('/robots.txt', scope.websiteUrl).href, scope);
      try {
        if (!robotsUrl) throw new RequestError('Robots URL is outside the selected property.', 403);
        const response = await publicFetch(robotsUrl, options);
        if (response.status === 404 || response.status === 410) state.robotsStatus = 'not_found';
        else if (!response.ok) throw new RequestError('Robots response unavailable.', 502);
        else {
          const body = await response.text(), parsed = parseRobots(body);
          state.robotsRules = parsed.rules; state.robotsStatus = 'reviewed';
          for (const url of parsed.sitemaps) addSitemap(url, 'robots');
          if (parsed.truncated) addLimitation(state, 'The robots.txt review was bounded to 64 KB and 100 matching rules. Additional rules or sitemap entries may exist.');
          for (const page of pages.values()) if (page.status === 'pending' && robotsExcluded(page.url, state.robotsRules)) {
            page.status = 'excluded'; page.reason = 'robots_disallowed'; dirty.add(page.url);
          }
        }
      } catch {
        if (available()) { state.robotsStatus = 'unavailable'; addLimitation(state, 'Robots.txt could not be inspected. Its missing information has not been treated as permission or proof of coverage.'); }
      }
    }
    if (state.googleStatus === 'pending' && available()) {
      try {
        const connection = await getGscConnection(userId, { deadline, signal });
        if (connection.siteUrl !== scope.property) throw new RequestError('The connected property changed.', 409);
        const result = await connection.query({ ...searchWindow('90'), dimensions: ['page'], rowLimit: 500, type: 'web', dataState: 'final' });
        if (result?.rows !== undefined && !Array.isArray(result.rows)) throw new Error('Invalid page observations.');
        for (const row of (result.rows || []).slice(0, 500)) if (Array.isArray(row.keys) && row.keys.length === 1) addPage(row.keys[0], 'google_search_observation');
        state.googleStatus = (result.rows || []).length ? 'observed_pages' : 'no_reported_pages';
        if ((result.rows || []).length >= 500) addLimitation(state, 'Google returned the 500-row page limit; this is a partial search report.');
      } catch {
        if (available()) { state.googleStatus = 'unavailable'; addLimitation(state, 'Google page observations could not be read. Website discovery continues without treating missing activity as zero.'); }
      }
    }
    while (available() && state.sitemaps.some(item => item.status === 'pending')) {
      const sitemap = state.sitemaps.find(item => item.status === 'pending');
      try {
        if (/\.gz(?:\?|$)/i.test(sitemap.url)) throw new RequestError('Compressed sitemap files are unsupported.', 422);
        const response = await publicFetch(sitemap.url, options);
        if (!response.ok) throw new RequestError('The sitemap could not be read.', 502);
        if (/gzip|zip/i.test(response.headers.get('content-type') || '') || /gzip/i.test(response.headers.get('content-encoding') || '')) throw new RequestError('Compressed sitemap files are unsupported.', 422);
        const parsed = parseInventorySitemap(await response.text());
        sitemap.status = 'reviewed'; sitemap.observedAt = iso();
        if (parsed.invalid) addLimitation(state, 'At least one sitemap entry was malformed and was not used.');
        for (const raw of parsed.urls) {
          if (parsed.kind === 'sitemaps') addSitemap(raw, 'sitemap_index');
          else addPage(raw, 'sitemap');
        }
      } catch (error) {
        if (!available()) break;
        sitemap.status = error.status === 422 ? 'unsupported' : 'failed'; sitemap.observedAt = iso();
        addLimitation(state, 'At least one sitemap could not be reviewed. Missing sitemap entries are not proof that pages do not exist.');
      }
      await flush();
    }
    while (available()) {
      const attempted = [...pages.values()].filter(page => ['fetched', 'failed', 'retired'].includes(page.status) || page.reason === 'non_html_response').length;
      const selected = [...pages.values()].filter(page => page.status === 'pending').slice(0, Math.min(limits.concurrency, limits.htmlPages - attempted));
      if (!selected.length) break;
      await Promise.all(selected.map(async page => {
        try {
          const content = await readPage(page.url, { ...options, inventoryId: id, generation: state.generation, robotsStatus: state.robotsStatus });
          if (!pageUrl(content.finalUrl || page.url, scope)) throw new RequestError('Page redirects outside selected website.', 403);
          page.status = 'fetched'; page.content = content; page.reason = null; page.observedAt = iso();
          delete page.retirementProof;
          if (retirements.has(page.url)) {
            retirementUpdates.set(page.url, { recordId: retirements.get(page.url).recordId, at: page.observedAt });
            retirements.delete(page.url);
          }
          dirty.add(page.url);
          if (content.structureCoverage?.internalLinksTruncated) addLimitation(state, 'Links were truncated on at least one page. Other linked pages may not have been discovered.');
          for (const link of content.internalLinks || []) addPage(link.url, 'internal_link', content.finalUrl || page.url);
        } catch (error) {
          if (!available()) return; // Deadline/cancellation is resumable, not a permanent URL failure.
          page.status = error.status === 422 ? 'excluded' : 'failed';
          page.reason = error.status === 422 ? 'non_html_response' : error.status === 403 ? 'redirect_outside_scope' : error.httpStatus ? `http_${error.httpStatus}` : 'unreadable';
          page.observedAt = iso();
          const retirement = retirements.get(page.url);
          // A declaration never hides a later server error or a live page. The
          // fresh HTTP result must still say this exact URL is unavailable.
          if (retirement && [404, 410].includes(error.httpStatus) && available()) {
            // The scraper's error contains the HTTP code but not a failed
            // redirect chain. Recheck to avoid retiring a moved URL by mistake.
            try {
              const response = await publicFetch(page.url, options);
              if (isMissingResponse(response, page.url)) {
                page.status = 'retired'; page.reason = 'owner_confirmed_removed'; page.observedAt = iso();
                page.retirementProof = { ownerConfirmedAt: retirement.ownerConfirmedAt, verifiedAt: page.observedAt, httpStatus: response.status };
              }
            } catch { /* Retain the failure as uncertainty. */ }
          }
          dirty.add(page.url);
        }
      }));
      await flush();
    }
    await flush(true);
    return view(id, state, [...pages.values()].sort((a, b) => a.url.localeCompare(b.url)));
  } catch (error) {
    // Release only our own lease. Scope/deletion races must never recreate data.
    await db.runTransaction(async tx => {
      const latest = (await tx.get(ref)).data();
      if (latest?.attempt === attempt) tx.update(ref, { leaseUntil: null });
    }).catch(() => {});
    throw error;
  }
}

export async function updateNewPageRetirements(userId, { urls, inventoryRevision, confirmed, action, signal } = {}) {
  if (confirmed !== true || !['retire', 'restore'].includes(action) || !Number.isInteger(inventoryRevision)
    || !Array.isArray(urls) || !urls.length || urls.length > 20 || urls.some(url => typeof url !== 'string')
    || new Set(urls).size !== urls.length) throw new RequestError('Confirm between one and twenty saved URLs and reload the current website review.');
  const scope = await readNewPageScope(userId, { write: true });
  if (urls.some(url => pageUrl(url, scope) !== url)) throw new RequestError('Choose exact saved URLs on the connected website.', 403);
  const id = newPageScopeKey(scope), ref = db.collection('newPageInventories').doc(id), attempt = randomUUID();
  const started = Date.now(), deadline = started + 40000;
  const state = await db.runTransaction(async tx => {
    assertSameNewPageScope(scope, await readNewPageScope(userId, { write: true, tx }));
    const current = (await tx.get(ref)).data();
    if (!current || current.revision !== inventoryRevision) throw new RequestError('Your website review changed. Reload before confirming these URLs.', 409);
    assertSameNewPageScope(scope, current.scope);
    if (Date.parse(current.leaseUntil) > Date.now()) throw new RequestError('Your website review is already running. Try again shortly.', 409);
    tx.update(ref, { attempt, leaseUntil: new Date(started + 70000).toISOString() });
    return current;
  });
  try {
    const pages = await readPages(ref, state.generation);
    const selected = urls.map(url => pages.find(page => page.url === url));
    const prior = await Promise.all(urls.map(url => ref.collection('retirements').doc(hash(url)).get()));
    if (selected.some((page, index) => !page || (action === 'retire'
      ? page.status !== 'failed' || !['http_404', 'http_410'].includes(page.reason)
      : !prior[index].exists || prior[index].data().active !== true))) {
      throw new RequestError(action === 'retire' ? 'Only saved pages currently returning 404 or 410 can be marked intentionally removed.' : 'Choose a URL with an active removal confirmation.', 409);
    }
    for (const record of prior) if (record.exists) assertSameNewPageScope(scope, record.data().scope);
    const checked = new Map();
    if (action === 'retire') {
      for (let offset = 0; offset < urls.length; offset += INVENTORY_LIMITS.concurrency) {
        await Promise.all(urls.slice(offset, offset + INVENTORY_LIMITS.concurrency).map(async url => {
          let response;
          try { response = await publicFetch(url, { property: scope.property, allowedHostname: new URL(scope.websiteUrl).hostname, deadline, ...(signal ? { signal } : {}) }); }
          catch { throw new RequestError('We could not verify all selected URLs as removed. Your saved review is unchanged. Refresh the website review and try again.', 409); }
          if (!isMissingResponse(response, url)) throw new RequestError('A selected URL is live, redirects, or no longer returns 404 or 410. Refresh the website review before confirming removal.', 409);
          checked.set(url, { httpStatus: response.status, verifiedAt: iso() });
        }));
      }
    }
    if (signal?.aborted || Date.now() >= deadline) throw new RequestError('This check took too long. Your saved review is unchanged. Try again.', 409);
    const timestamp = iso();
    await db.runTransaction(async tx => {
      assertSameNewPageScope(scope, await readNewPageScope(userId, { write: true, tx }));
      const latest = (await tx.get(ref)).data();
      if (!latest || latest.revision !== inventoryRevision || latest.generation !== state.generation || latest.attempt !== attempt
        || Date.parse(latest.leaseUntil) <= Date.now()) throw new RequestError('Your website review changed. Reload before confirming these URLs.', 409);
      assertSameNewPageScope(scope, latest.scope);
      const currentRecords = await Promise.all(urls.map(url => tx.get(ref.collection('retirements').doc(hash(url)))));
      for (let index = 0; index < urls.length; index += 1) {
        const url = urls[index], page = selected[index], old = currentRecords[index].data();
        if (old) assertSameNewPageScope(scope, old.scope);
        const check = checked.get(url);
        const record = { ...(old || {}), scope, userId, url, active: action === 'retire', revision: (old?.revision || 0) + 1,
          createdAt: old?.createdAt || timestamp, updatedAt: timestamp,
          ...(action === 'retire' ? { ownerConfirmedAt: timestamp, verifiedAt: check.verifiedAt, httpStatus: check.httpStatus, retiredAt: timestamp }
            : { restoredAt: timestamp }) };
        if (action === 'retire') {
          page.status = 'retired'; page.reason = 'owner_confirmed_removed'; page.observedAt = check.verifiedAt;
          page.retirementProof = { ownerConfirmedAt: timestamp, verifiedAt: check.verifiedAt, httpStatus: check.httpStatus };
        } else {
          page.status = 'pending'; page.reason = null;
          delete page.retirementProof;
        }
        tx.set(ref.collection('retirements').doc(hash(url)), plain(record));
        tx.set(ref.collection('pages').doc(hash(url)), plain(page));
      }
      tx.update(ref, { revision: inventoryRevision + 1, updatedAt: timestamp, leaseUntil: null });
    });
    return await readNewPageInventory(userId);
  } finally {
    await db.runTransaction(async tx => {
      const latest = (await tx.get(ref)).data();
      if (latest?.attempt === attempt && latest.leaseUntil) tx.update(ref, { leaseUntil: null });
    }).catch(() => {});
  }
}
