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
const nonHtml = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|mp[34]|webm|mov|avi|zip|gz|css|js|json|xml|woff2?|ttf|eot|csv|docx?|xlsx?)(?:$|\?)/i;
const generalLimitations = [
  'This inventory reviews discovered pages, not every possible URL. A sitemap, internal links and Search Console may each omit pages.',
  'Downloaded HTML is not a browser rendering. Content excerpts and links are bounded; missing excerpt text does not prove it is absent.',
  'Search Console observations are partial and do not establish indexing status. Pages without observations are still inspected.',
];

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
  const count = status => pages.filter(page => page.status === status).length;
  const fetched = count('fetched'), failed = count('failed'), excluded = count('excluded'), pending = count('pending');
  const fetchedAttempts = fetched + failed + pages.filter(page => page.reason === 'non_html_response').length;
  const canContinue = !state.initialized || state.robotsStatus === 'pending' || state.googleStatus === 'pending'
    || state.sitemaps.some(item => item.status === 'pending') || (pending > 0 && fetchedAttempts < INVENTORY_LIMITS.htmlPages);
  const limitations = [...generalLimitations, ...state.limitations];
  if (pending && fetchedAttempts >= INVENTORY_LIMITS.htmlPages) limitations.push('The 100-page HTML review limit was reached. Remaining discovered pages are unreviewed, not missing.');
  const incomplete = failed > 0 || pending > 0 || pages.some(page => page.reason === 'robots_disallowed') || state.truncated || state.limitations.length > 0;
  return { id, scope: state.scope, revision: state.revision, status: canContinue ? 'running' : !fetched ? 'unavailable' : incomplete ? 'partial' : 'ready',
    updatedAt: state.updatedAt, pages: pages.map(({ generation: _generation, ...page }) => page),
    coverage: { discovered: pages.length, fetched, failed, excluded, pending, truncated: Boolean(state.truncated || (pending && fetchedAttempts >= INVENTORY_LIMITS.htmlPages)),
      limitations, sitemapsChecked: state.sitemaps.filter(item => item.status !== 'pending').length, sitemaps: state.sitemaps,
      googleStatus: state.googleStatus, robotsStatus: state.robotsStatus }, canContinue };
}

async function readPages(ref, generation) {
  const snapshot = await ref.collection('pages').where('generation', '==', generation).limit(INVENTORY_LIMITS.urls).get();
  return snapshot.docs.map(doc => doc.data()).sort((a, b) => a.url.localeCompare(b.url));
}
export async function readNewPageInventory(userId) {
  const scope = await readNewPageScope(userId);
  const id = newPageScopeKey(scope), ref = db.collection('newPageInventories').doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const state = snapshot.data();
  assertSameNewPageScope(scope, state.scope);
  const pages = await readPages(ref, state.generation);
  assertSameNewPageScope(scope, await readNewPageScope(userId));
  return view(id, state, pages);
}

export async function continueNewPageInventory(userId, { restart = false, signal } = {}) {
  const started = Date.now(), deadline = started + INVENTORY_LIMITS.batchMs - 5000;
  const scope = await readNewPageScope(userId, { write: true });
  const id = newPageScopeKey(scope), ref = db.collection('newPageInventories').doc(id), attempt = randomUUID();
  let state = await db.runTransaction(async tx => {
    assertSameNewPageScope(scope, await readNewPageScope(userId, { write: true, tx }));
    const previous = (await tx.get(ref)).data();
    if (previous?.leaseUntil && Date.parse(previous.leaseUntil) > Date.now()) throw new RequestError('Your website review is already running. Try again shortly.', 429);
    const current = !previous || restart ? { scope, userId, property: scope.property, websiteRunId: scope.websiteRunId,
      generation: randomUUID(), revision: (previous?.revision || 0) + 1, initialized: false, sitemaps: [],
      robotsStatus: 'pending', robotsRules: [], googleStatus: 'pending', limitations: [], truncated: false, updatedAt: iso() } : previous;
    assertSameNewPageScope(scope, current.scope);
    tx.set(ref, { ...current, attempt, leaseUntil: new Date(started + 70000).toISOString() });
    return { ...current, attempt };
  });
  const pages = new Map((await readPages(ref, state.generation)).map(page => [page.url, page]));
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
    if (pages.size >= INVENTORY_LIMITS.urls) { state.truncated = true; addLimitation(state, 'The 500-URL discovery limit was reached. Additional URLs may exist.'); return; }
    const excluded = nonHtml.test(new URL(url).pathname) || robotsExcluded(url, state.robotsRules);
    pages.set(url, { url, status: excluded ? 'excluded' : 'pending', reason: excluded ? (nonHtml.test(new URL(url).pathname) ? 'non_html_resource' : 'robots_disallowed') : null,
      sources: [source], discoveredAt: iso(), generation: state.generation });
    dirty.add(url);
  };
  const addSitemap = (raw, source) => {
    const url = pageUrl(raw, scope);
    if (!url) { addLimitation(state, 'A sitemap URL was invalid or outside the selected website/property and was not fetched.'); return; }
    if (state.sitemaps.some(item => item.url === url)) return;
    if (state.sitemaps.length >= INVENTORY_LIMITS.sitemaps) { state.truncated = true; addLimitation(state, 'The 20-sitemap document limit was reached. Additional sitemap documents were not reviewed.'); return; }
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
        assertSameNewPageScope(scope, await readNewPageScope(userId, { write: true, tx }));
        const latest = (await tx.get(ref)).data();
        if (latest?.attempt !== attempt || latest.generation !== state.generation) throw new RequestError('Website review changed. Reload before continuing.', 409);
        for (const url of urls) tx.set(ref.collection('pages').doc(hash(url)), plain(pages.get(url)));
      });
      urls.forEach(url => dirty.delete(url));
    }
    await db.runTransaction(async tx => {
      assertSameNewPageScope(scope, await readNewPageScope(userId, { write: true, tx }));
      const latest = (await tx.get(ref)).data();
      if (latest?.attempt !== attempt || latest.generation !== state.generation) throw new RequestError('Website review changed. Reload before continuing.', 409);
      state.revision = (latest.revision || 0) + 1;
      tx.set(ref, plain({ ...state, leaseUntil: release ? null : new Date(started + 70000).toISOString() }));
    });
  };
  try {
    if (!state.initialized) {
      addPage(scope.websiteUrl, 'selected_website');
      const [onboarding, legacy] = await Promise.all([db.collection('onboarding').doc(userId).get(), db.collection('siteCrawls').doc(userId).get()]);
      for (const page of (onboarding.data()?.revampPages || []).slice(0, 500)) addPage(typeof page === 'string' ? page : page.url, 'saved_website_record');
      const old = legacy.data() || {};
      // Unversioned legacy crawls may describe the site before a rebuild. They
      // remain history, not current discovery evidence for the new website run.
      if (!scope.websiteRunId || (old.websiteRunId || old.revampRunId) === scope.websiteRunId) {
        for (const url of [...(old.approvedUrls || []), ...(old.manualUrls || []), ...(old.lastCrawlUrls || [])].slice(0, 500)) addPage(url, 'previous_crawl_record');
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
      const attempted = [...pages.values()].filter(page => ['fetched', 'failed'].includes(page.status) || page.reason === 'non_html_response').length;
      const selected = [...pages.values()].filter(page => page.status === 'pending').slice(0, Math.min(INVENTORY_LIMITS.concurrency, INVENTORY_LIMITS.htmlPages - attempted));
      if (!selected.length) break;
      await Promise.all(selected.map(async page => {
        try {
          const content = await fetchCurrentPageContent(page.url, options);
          if (!pageUrl(content.finalUrl || page.url, scope)) throw new RequestError('Page redirects outside selected website.', 403);
          page.status = 'fetched'; page.content = content; page.reason = null; page.observedAt = iso(); dirty.add(page.url);
          if (content.structureCoverage?.internalLinksTruncated) addLimitation(state, 'Links were truncated on at least one page. Other linked pages may not have been discovered.');
          for (const link of content.internalLinks || []) addPage(link.url, 'internal_link', content.finalUrl || page.url);
        } catch (error) {
          if (!available()) return; // Deadline/cancellation is resumable, not a permanent URL failure.
          page.status = error.status === 422 ? 'excluded' : 'failed';
          page.reason = error.status === 422 ? 'non_html_response' : error.status === 403 ? 'redirect_outside_scope' : error.httpStatus ? `http_${error.httpStatus}` : 'unreadable';
          page.observedAt = iso(); dirty.add(page.url);
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
