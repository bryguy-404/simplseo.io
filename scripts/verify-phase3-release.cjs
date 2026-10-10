// Read-only release checks for one explicitly supplied production account.
// Usage: node scripts/verify-phase3-release.cjs <uid> <exact-property> [--draft] [--research]
// --draft makes one explicit review request, including automatic bounded web
// research and one assessment. --research is retained as a compatibility flag
// requiring --draft; research is already included in every current review.
// Neither flag confirms an edit; keeping current wording is a valid review.
// Login, OAuth refresh and the optional AI request may update their normal
// session/credential/quota metadata; website work and history must not change.
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

const ORIGIN = 'https://simplseo-io.vercel.app';
const PROJECT = 'simpleseo-90570';
class VerificationFailure extends Error {}
const assert = (condition, message) => { if (!condition) throw new VerificationFailure(message); };
let stage = 'configuration';
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const validDay = value => typeof value === 'string' && dayPattern.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const shiftDay = (day, offset) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
const expectedWindow = date => {
  const pacificDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const endDate = shiftDay(pacificDay, -3);
  return { startDate: shiftDay(endDate, -27), endDate };
};
const sameIds = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const validMetrics = row => row && Number.isFinite(row.clicks) && Number.isFinite(row.impressions)
  && row.clicks >= 0 && row.impressions >= 0 && row.clicks <= row.impressions
  && (row.impressions === 0 ? row.ctr === null && row.position === null
    : Number.isFinite(row.ctr) && row.ctr >= 0 && row.ctr <= 1 && Number.isFinite(row.position) && row.position >= 1);
const recentTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Math.abs(Date.now() - Date.parse(value)) < 5 * 60 * 1000;
const REVIEW_ACTIONS = ['revise_metadata', 'keep_current', 'improve_content', 'review_page', 'collect_data', 'investigate_visibility'];
const textWithin = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;

async function main() {
  const [uid, property, ...flags] = process.argv.slice(2);
  assert(/^[A-Za-z0-9_-]{1,128}$/.test(uid || '') && property && flags.every(flag => ['--draft', '--research'].includes(flag))
    && new Set(flags).size === flags.length && (!flags.includes('--research') || flags.includes('--draft')),
  'Provide an exact UID and property; --research requires --draft, and no other or duplicate flags are accepted.');
  assert(process.env.FIREBASE_PROJECT_ID === PROJECT, 'The configured Firebase project must be the existing production project.');
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Remove emulator settings before production verification.');
  let homepage;
  try { homepage = new URL(property); } catch { throw new VerificationFailure('Provide the exact HTTPS homepage URL-prefix property.'); }
  assert(homepage.protocol === 'https:' && !homepage.username && !homepage.password && !homepage.port
    && homepage.pathname === '/' && !homepage.search && !homepage.hash && homepage.href === property, 'Provide the exact HTTPS homepage URL-prefix property.');
  assert(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY && process.env.NEXT_PUBLIC_FIREBASE_API_KEY, 'Required local verification credentials are unavailable.');
  const insideProperty = pageUrl => { try { const parsed = new URL(pageUrl); return parsed.origin === homepage.origin && parsed.pathname.startsWith(homepage.pathname) && !parsed.username && !parsed.password && !parsed.hash; } catch { return false; } };
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: PROJECT, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  let before;
  let summary;

  async function snapshotAccount() {
    const [setup, implementations, history] = await Promise.all([
      db.doc(`onboarding/${uid}`).get(),
      db.collection('implementedSeoTips').where('userId', '==', uid).get(),
      db.collection('users').doc(uid).collection('revampHistory').get(),
    ]);
    const historyRecords = await Promise.all(history.docs.map(run => run.ref.collection('records').get()));
    const archiveDocuments = [
      ...implementations.docs.filter(doc => doc.data().preRevampArchived),
      ...history.docs,
      ...historyRecords.flatMap(result => result.docs),
    ];
    return {
      setup: setup.data(),
      activeIds: implementations.docs.filter(doc => !doc.data().preRevampArchived && doc.data().status === 'implemented').map(doc => doc.id).sort(),
      historyRuns: history.docs.filter(doc => doc.data().complete).map(doc => doc.id),
      historyRecords: new Map(history.docs.map((run, index) => [run.id, historyRecords[index].docs.map(doc => doc.id)])),
      archives: new Map(archiveDocuments.map(doc => [doc.ref.path, doc.updateTime])),
    };
  }

  function verifySetup(setup, runId) {
    assert(setup?.isComplete === true && setup.revampStatus === 'complete' && setup.progressReviewRequired === false
      && setup.revampArchivePending !== true && setup.gscProperty === property && typeof setup.revampRunId === 'string'
      && /^[\w-]+$/.test(setup.revampRunId) && (!runId || setup.revampRunId === runId), 'Account setup, property, website run or progress state does not match the verified account.');
  }

  async function api(path, { method = 'GET', body, headers = {}, timeout = 90000 } = {}) {
    return fetch(`${ORIGIN}/api/${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(timeout),
    });
  }

  function verifyCurrentPage(page, provenance, runId, generated = false) {
    assert(page?.source === 'website-html' && page.url === property && page.finalUrl === property
      && typeof page.htmlTitle === 'string' && page.htmlTitle.length <= 500
      && typeof page.seoMetaDescription === 'string' && page.seoMetaDescription.length <= 1000
      && typeof page.h1 === 'string' && typeof page.textContent === 'string' && page.textContent.length <= 6000
      && Array.isArray(page.headings) && page.headings.length <= 10 && recentTimestamp(page.fetchedAt), 'The homepage HTML response or its current source metadata is invalid.');
    assert(provenance?.property === property && provenance.websiteRunId === runId && provenance.pageUrl === property
      && provenance.finalUrl === property && /^[a-f0-9]{64}$/.test(provenance.contentFingerprint)
      && (!generated || recentTimestamp(provenance.generatedAt)), 'The page review provenance does not match the exact current website.');
    const fingerprint = createHash('sha256').update(JSON.stringify({
      userId: uid, websiteRunId: runId, property, pageUrl: property, finalUrl: page.finalUrl,
      title: page.htmlTitle, description: page.seoMetaDescription,
      h1: page.h1, textContent: page.textContent, headings: page.headings,
    })).digest('hex');
    assert(provenance.contentFingerprint === fingerprint, 'The content fingerprint does not match the returned current website content.');
  }

  function verifyReviewEvidence(evidence, startedAt, hasPageContent = true) {
    const allowedWindows = [expectedWindow(startedAt), expectedWindow(new Date())];
    assert(evidence?.source === 'google_search_console' && evidence.property === property && evidence.pageUrl === property
      && recentTimestamp(evidence.fetchedAt) && ['available', 'partial', 'unavailable'].includes(evidence.status)
      && validDay(evidence.window?.startDate) && validDay(evidence.window?.endDate)
      && allowedWindows.some(window => window.startDate === evidence.window.startDate && window.endDate === evidence.window.endDate)
      && evidence.previousWindow?.startDate === shiftDay(evidence.window.startDate, -28)
      && evidence.previousWindow?.endDate === shiftDay(evidence.window.startDate, -1), 'Review evidence has an invalid property, page, timestamp or observation window.');
    const statuses = [];
    for (const period of [evidence.current, evidence.previous]) {
      assert(period && ['available', 'no_data', 'unavailable'].includes(period.totalsStatus)
        && ['available', 'no_data', 'unavailable'].includes(period.queriesStatus), 'Review evidence does not distinguish unavailable observations from missing data.');
      const totalsValid = period.totalsStatus === 'available' ? validMetrics(period.totals) && period.totals.impressions > 0
        : period.totalsStatus === 'no_data' ? period.totals === null || (validMetrics(period.totals) && period.totals.impressions === 0)
          : period.totals === null;
      assert(totalsValid && Array.isArray(period.queries) && period.queries.length <= 20
        && (period.queriesStatus === 'available' ? period.queries.length > 0 : period.queries.length === 0)
        && period.queries.every(row => textWithin(row.query, 1, 1024) && validMetrics(row))
        && new Set(period.queries.map(row => row.query)).size === period.queries.length, 'Review totals or query observations are invalid.');
      statuses.push(period.totalsStatus, period.queriesStatus);
    }
    assert(Array.isArray(evidence.history) && evidence.history.length === 6, 'The URL history does not contain six observation windows.');
    for (const [index, period] of evidence.history.entries()) {
      assert(period.window?.startDate === shiftDay(evidence.window.startDate, -28 * index)
        && period.window?.endDate === shiftDay(evidence.window.endDate, -28 * index)
        && ['available', 'no_data', 'unavailable'].includes(period.totalsStatus), 'The URL history windows are not adjacent, complete or newest first.');
      const totalsValid = period.totalsStatus === 'available' ? validMetrics(period.totals) && period.totals.impressions > 0
        : period.totalsStatus === 'no_data' ? period.totals === null || (validMetrics(period.totals) && period.totals.impressions === 0)
          : period.totals === null;
      assert(totalsValid, 'Historical URL metrics do not preserve missing data and unavailable reads.');
      if (index < 2) {
        const recent = index === 0 ? evidence.current : evidence.previous;
        assert(period.totalsStatus === recent.totalsStatus
          && JSON.stringify(period.totals) === JSON.stringify(recent.totals), 'Recent totals disagree with the same history window.');
      } else statuses.push(period.totalsStatus);
    }
    const successes = statuses.filter(status => status !== 'unavailable').length;
    assert(evidence.status === (successes === 8 ? 'available' : successes ? 'partial' : 'unavailable')
      && evidence.selectedPhrase?.value === '' && evidence.selectedPhrase?.source === 'none'
      && Array.isArray(evidence.relatedPages) && evidence.relatedPages.length === 0 && evidence.relatedPagesStatus === 'not_requested'
      && Array.isArray(evidence.limitations) && evidence.limitations.length > 0 && evidence.limitations.every(value => textWithin(value, 1, 1000)),
    'Review evidence availability or the no-keyword verification scope is invalid.');
    assert(Array.isArray(evidence.facts) && evidence.facts.length >= (hasPageContent ? 3 : 0) && evidence.facts.length <= 31
      && evidence.facts.every(fact => /^(?:P[1-3]|S[12]|H[1-6]|Q(?:[1-9]|1[0-9]|20))$/.test(fact.id)
        && fact.kind === (fact.id.startsWith('P') ? 'page' : 'search') && textWithin(fact.label, 1, 200) && textWithin(fact.text, 1, 5000))
      && new Set(evidence.facts.map(fact => fact.id)).size === evidence.facts.length
      && (hasPageContent ? ['P1', 'P2', 'P3'].every(id => evidence.facts.some(fact => fact.id === id)) : evidence.facts.every(fact => fact.kind === 'search')),
    'Review source facts are missing or invalid.');
    for (const [index, period] of evidence.history.entries()) {
      assert(evidence.facts.some(fact => fact.id === `H${index + 1}`) === (period.totalsStatus !== 'unavailable'),
        'A historical source fact misrepresents an unavailable observation.');
    }
  }

  function verifyResearch(research) {
    assert(research && textWithin(research.limitation, 1, 1000) && Array.isArray(research.sources)
      && ['available', 'unavailable'].includes(research.status),
    'The review did not report its automatic research attempt.');
    if (research.status === 'available') {
      assert(recentTimestamp(research.checkedAt) && textWithin(research.summary, 1, 3500)
        && research.sources.length > 0 && research.sources.length <= 5
        && research.sources.every((source, index) => {
          try {
            const url = new URL(source.url);
            return source.id === `W${index + 1}` && textWithin(source.title, 1, 180)
              && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.port
              && url.hostname.includes('.') && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':')
              && !/(?:^|\.)(?:localhost|local|internal|lan|test|invalid|example|home\.arpa)$/.test(url.hostname);
          } catch { return false; }
        }) && new Set(research.sources.map(source => source.url)).size === research.sources.length,
      'Web research did not return usable, dated public sources.');
    } else {
      assert(research.summary === '' && research.sources.length === 0
        && recentTimestamp(research.checkedAt),
      'Missing research was presented as sourced research.');
    }
  }

  function verifyAssessment(draft) {
    const analysis = draft.analysis;
    const sourceIds = new Set([...draft.evidence.facts, ...(draft.research.status === 'available' ? draft.research.sources : [])].map(source => source.id));
    assert(analysis && REVIEW_ACTIONS.includes(analysis.action) && textWithin(analysis.summary, 1, 120)
      && textWithin(analysis.reason, 1, 420) && textWithin(analysis.nextStep, 1, 260)
      && ['keep', 'revise', 'uncertain'].includes(analysis.metadataVerdict) && textWithin(analysis.metadataReason, 1, 260)
      && (analysis.action === 'revise_metadata') === (analysis.metadataVerdict === 'revise')
      && (analysis.action !== 'keep_current' || analysis.metadataVerdict === 'keep')
      && Array.isArray(analysis.evidenceIds) && analysis.evidenceIds.length >= 1 && analysis.evidenceIds.length <= 5
      && analysis.evidenceIds.every(id => sourceIds.has(id)) && analysis.evidenceIds.some(id => /^P[1-3]$/.test(id))
      && new Set(analysis.evidenceIds).size === analysis.evidenceIds.length && Array.isArray(analysis.changedFields)
      && ['title', 'description'].every(field => typeof analysis.fieldReasons?.[field] === 'string' && analysis.fieldReasons[field].length <= 220),
    'The assessment action, explanation or source references are invalid.');
    if (analysis.action === 'revise_metadata') {
      assert(typeof draft.title === 'string' && typeof draft.description === 'string', 'A metadata revision did not include both fields.');
      const changed = [];
      for (const field of ['title', 'description']) {
        const original = field === 'title' ? draft.currentPage.htmlTitle : draft.currentPage.seoMetaDescription;
        if (draft[field] === original) {
          assert(analysis.fieldReasons[field] === '', 'An unchanged field has a misleading change explanation.');
        } else {
          assert(textWithin(draft[field], field === 'title' ? 10 : 40, field === 'title' ? 90 : 220)
            && !/[\r\n]|<[^>]*>|\[[^\]]*\]|```|\b(?:lorem ipsum|placeholder)\b/i.test(draft[field])
            && textWithin(analysis.fieldReasons[field], 1, 220), 'A changed title or description is not usable or lacks its explanation.');
          changed.push(field);
        }
      }
      assert(changed.length > 0 && sameIds(changed, analysis.changedFields) && analysis.targetPageUrl === null,
        'The metadata revision does not match its declared changed fields.');
    } else {
      assert(draft.title === null && draft.description === null && analysis.changedFields.length === 0
        && analysis.fieldReasons.title === '' && analysis.fieldReasons.description === '', 'A non-revision decision incorrectly includes editable draft fields.');
      if (analysis.action === 'review_page') {
        assert(analysis.targetPageUrl !== property && draft.evidence.relatedPages.some(row => row.pageUrl === analysis.targetPageUrl)
          && insideProperty(analysis.targetPageUrl), 'The suggested alternative page is not supported by scoped evidence.');
      } else assert(analysis.targetPageUrl === null, 'The assessment includes an unexpected target page.');
    }
  }

  try {
    stage = 'account safeguards';
    before = await snapshotAccount();
    verifySetup(before.setup);
    assert(before.historyRuns.includes(before.setup.revampRunId), 'The current website archive is not complete.');
    const account = await app.auth().getUser(uid);
    assert(account.uid === uid && !account.disabled, 'The exact account is unavailable.');

    stage = 'temporary verification session';
    const customToken = await app.auth().createCustomToken(uid);
    const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }), redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const session = await signIn.json();
    assert(signIn.ok && session.idToken && (await app.auth().verifyIdToken(session.idToken)).uid === uid, 'Verification login failed.');
    const headers = { Authorization: `Bearer ${session.idToken}` };

    stage = 'new route authorization';
    const routes = [
      ['dashboard/overview', 'GET'], ['page-review/content', 'POST'], ['page-review/activity', 'POST'],
      ['page-review/suggestions', 'POST'], ['page-review/confirm', 'POST'],
    ];
    // Confirmation is probed only anonymously or with a mismatched supplied UID.
    // Never send a confirmation that the account could authorize successfully.
    for (const [path, method] of routes) {
      const anonymous = await api(path, { method, ...(method === 'POST' ? { body: {} } : {}) });
      assert(anonymous.status === 401, `Anonymous ${path} was not rejected with 401.`);
      const otherUid = `${uid}-phase3-cross-account-probe`;
      const crossAccount = await api(method === 'GET' ? `${path}?userId=${encodeURIComponent(otherUid)}` : path, {
        method, headers, ...(method === 'POST' ? { body: { userId: otherUid } } : {}),
      });
      assert(crossAccount.status === 403, `Cross-account ${path} was not rejected with 403.`);
    }

    stage = 'current Google overview';
    const startedAt = new Date();
    const overviewResponse = await api('dashboard/overview', { headers });
    assert(overviewResponse.ok, 'The current Google overview request failed.');
    const overview = await overviewResponse.json();
    const allowedWindows = [expectedWindow(startedAt), expectedWindow(new Date())];
    assert(overview.schemaVersion === 1 && overview.source === 'google_search_console' && overview.property === property
      && overview.dataState === 'final' && overview.searchType === 'web' && recentTimestamp(overview.fetchedAt)
      && validDay(overview.window?.startDate) && validDay(overview.window?.endDate)
      && allowedWindows.some(window => window.startDate === overview.window.startDate && window.endDate === overview.window.endDate)
      && validMetrics(overview.totals), 'The overview source, metrics or complete 28-day window is invalid.');
    assert(Array.isArray(overview.daily) && overview.daily.length <= 28 && overview.daily.every(row => validDay(row.date)
      && row.date >= overview.window.startDate && row.date <= overview.window.endDate && validMetrics(row))
      && new Set(overview.daily.map(row => row.date)).size === overview.daily.length, 'The dated overview observations are invalid.');
    assert(Array.isArray(overview.pages) && overview.pages.length <= 100 && overview.pages.every(row => insideProperty(row.pageUrl) && validMetrics(row))
      && new Set(overview.pages.map(row => row.pageUrl)).size === overview.pages.length
      && overview.coverage?.pages?.complete === false && overview.coverage.pages.limit === 100
      && overview.coverage.pages.returned === overview.pages.length && overview.coverage.isIndexingReport === false
      && overview.coverage.daily?.omitsDaysWithoutData === true, 'The overview page scope or coverage labels are invalid.');

    stage = 'current homepage HTML';
    const contentResponse = await api('page-review/content', { method: 'POST', headers, body: { pageUrl: property } });
    assert(contentResponse.ok, 'The current homepage HTML request failed.');
    const content = await contentResponse.json();
    assert(content.success === true, 'The current homepage could not be read.');
    verifyCurrentPage(content.data, content.provenance, before.setup.revampRunId);

    stage = 'read-only homepage search history';
    const activityStartedAt = new Date();
    const activityResponse = await api('page-review/activity', { method: 'POST', headers, body: { pageUrl: property } });
    assert(activityResponse.ok && activityResponse.headers.get('cache-control') === 'private, no-store', 'The homepage activity request failed or returned cacheable private data.');
    const activity = await activityResponse.json();
    assert(activity.success === true && activity.provenance?.property === property && activity.provenance.pageUrl === property
      && activity.provenance.websiteRunId === before.setup.revampRunId, 'The homepage activity belongs to a different property, URL or website version.');
    verifyReviewEvidence(activity.evidence, activityStartedAt, false);

    let draftMetadata = { requested: false };
    if (flags.includes('--draft')) {
      stage = 'one explicit current-page review';
      const reviewStartedAt = new Date();
      const draftResponse = await api('page-review/suggestions', { method: 'POST', headers, timeout: 175000,
        body: { pageUrl: property, focusKeywords: [] } });
      assert(draftResponse.ok, 'The one requested review did not return a usable response. No retry or confirmation was attempted.');
      const draft = await draftResponse.json();
      verifyCurrentPage(draft.currentPage, draft.provenance, before.setup.revampRunId, true);
      assert(draft.provenance.reviewVersion === 3 && /^gpt-[\w.-]{1,80}$/.test(draft.provenance.model), 'The assessment is not from the current review implementation.');
      verifyReviewEvidence(draft.evidence, reviewStartedAt);
      verifyResearch(draft.research);
      verifyAssessment(draft);
      draftMetadata = { requested: true, requests: 1, model: draft.provenance.model, action: draft.analysis.action, metadataVerdict: draft.analysis.metadataVerdict,
        ...(draft.analysis.action === 'revise_metadata' ? { titleLength: draft.title.length, descriptionLength: draft.description.length, changedFields: draft.analysis.changedFields } : {}),
        evidenceStatus: draft.evidence.status, evidenceSourceCount: draft.evidence.facts.length,
        historyWindows: draft.evidence.history.length, researchAutomatic: true, researchStatus: draft.research.status, researchSourceCount: draft.research.sources.length,
        generatedAt: draft.provenance.generatedAt };
    }

    stage = 'progress and history safeguards';
    const progressResponse = await api('progress', { headers });
    assert(progressResponse.ok, 'Progress is unavailable.');
    const progress = await progressResponse.json();
    assert(progress.source === 'google_search_console' && progress.property === property && progress.paused === false
      && progress.automaticOutcomesEnabled === false && progress.notificationsEnabled === false
      && Array.isArray(progress.records) && sameIds(progress.records.map(record => record.id), before.activeIds)
      && progress.records.every(record => insideProperty(record.pageUrl)), 'Progress ownership, active changes or automatic-outcome safeguards failed.');
    const historyResponse = await api('revamp/history', { headers });
    assert(historyResponse.ok, 'Previous website history is unavailable.');
    const history = await historyResponse.json();
    assert(Array.isArray(history.runs) && sameIds(history.runs.map(run => run.id), before.historyRuns), 'The history run list changed or is incomplete.');
    const recordResponse = await api(`revamp/history?runId=${encodeURIComponent(before.setup.revampRunId)}`, { headers });
    assert(recordResponse.ok, 'The current archived record list is unavailable.');
    const historyRecords = await recordResponse.json();
    assert(Array.isArray(historyRecords.records) && sameIds(historyRecords.records.map(record => record.id), before.historyRecords.get(before.setup.revampRunId)), 'Archived records are missing from the history response.');

    summary = {
      anonymousRoutesBlocked: routes.length, crossAccountRoutesBlocked: routes.length,
      overviewStatus: overviewResponse.status, window: overview.window, observedPagesReturned: overview.pages.length,
      dailyObservations: overview.daily.length, totals: { clicks: overview.totals.clicks, impressions: overview.totals.impressions },
      isIndexingReport: false, currentHtmlStatus: contentResponse.status,
      currentHtmlTitle: content.data.htmlTitle.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 180),
      htmlFetchedAt: content.data.fetchedAt, exactHomepageVerified: true,
      activityStatus: activity.evidence.status, activityWindows: activity.evidence.history.length,
      draft: draftMetadata, activeChanges: progress.records.length, automaticOutcomesEnabled: false, notificationsEnabled: false,
      historyRunsAvailable: history.runs.length, authorizedConfirmationAttempted: false,
    };
  } finally {
    try {
      if (before) {
        const after = await snapshotAccount();
        verifySetup(after.setup, before.setup.revampRunId);
        assert(sameIds(after.activeIds, before.activeIds), 'Active implementation IDs changed during verification.');
        assert(sameIds(after.archives.keys(), before.archives.keys()) && [...before.archives].every(([path, updateTime]) => after.archives.get(path)?.isEqual(updateTime)), 'An archived record or archive snapshot changed during verification.');
        if (summary) { summary.activeImplementationIdsUnchanged = true; summary.archiveSnapshotsUnchanged = before.archives.size; }
      }
    } finally { await app.delete(); }
  }
  console.log(JSON.stringify(summary));
}

main().catch(error => {
  // Provider, Firebase and fetch errors can contain sensitive request details.
  // Only our own fixed verification messages may reach logs.
  console.error(JSON.stringify({ verificationFailed: true, stage,
    error: error instanceof VerificationFailure ? error.message : 'The verification step failed. Credentials and response bodies were not logged.',
    authorizedConfirmationAttempted: false,
  }));
  process.exitCode = 1;
});
