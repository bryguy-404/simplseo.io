// Default is stored-read verification only. --investigate=activity (or
// --investigate=technical) explicitly authorizes ONE real homepage check, with
// no AI generation, publication, task edit, or fabricated observation.
require('dotenv').config({ path: '.env.local', quiet: true });
const fs = require('node:fs');
// This installed Firestore SDK emits listCollections debug arguments through
// console.log, including document paths. Print only our sanitized final report.
console.log = () => {};
const admin = require('firebase-admin');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const positionals = args.filter(value => !value.startsWith('--'));
const [identityFile, origin = 'https://simplseo-io.vercel.app'] = positionals;
const flags = args.filter(value => value.startsWith('--'));
const investigationFlag = flags.find(value => /^--investigate(?:=(?:activity|technical))?$/.test(value));
let stage = 'configuration';
const ownedCollections = [
  'pageReviewPlans', 'implementedSeoTips', 'pageProgressCycles', 'newPagePlans', 'newPagePublications',
  'newPageWorkspaces', 'newPageInventories', 'newPageAssessments', 'onboardingInventories', 'onboardingExtractions',
  'onboardingUsageEvents', 'aiUsageEvents', 'conversations', 'requestLimits', 'mentorWorkspaces', 'mentorOperations',
  'mentorActivitySnapshots', 'mentorCheckOperations', 'mentorBudgetReservations', 'mentorRequestLimits',
];
const oauthFields = new Set(['gscAccessToken', 'gscRefreshToken', 'gscExpiresAt', 'gscConnectedAt']);
const expectedGeneration = process.env.MENTOR_VERIFY_EXPECT_GENERATION !== 'false';
const safeKeys = value => {
  if (Array.isArray(value)) value.forEach(safeKeys);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    assert(!/^(?:gscAccessToken|gscRefreshToken|access_token|refresh_token|idToken|refreshToken|accessToken|privateKey|client_secret|apiKey|api_key|pilotUids)$/i.test(key), 'An API response included a private credential field.');
    safeKeys(child);
  }
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const omitOAuth = data => Object.fromEntries(Object.entries(data).filter(([key]) => !oauthFields.has(key)));

async function main() {
  assert.equal(positionals.length <= 2 && positionals.length >= 1, true);
  assert.equal(flags.length, investigationFlag ? 1 : 0, 'Unknown or duplicate verification option.');
  assert.equal(process.env.FIREBASE_PROJECT_ID, 'simpleseo-90570');
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  assert(/^https:\/\/simplseo-[a-z0-9-]+\.vercel\.app$/.test(origin));
  const identities = fs.readFileSync(identityFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(identities.length, 1);
  const { uid, property } = identities[0];
  assert(typeof uid === 'string' && uid && !uid.includes('/'));
  assert.equal(property, 'https://bryandevelops.com/');
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  try {
    stage = 'saved work snapshot';
    const [setupDoc, userDoc] = await Promise.all([db.doc(`onboarding/${uid}`).get(), db.doc(`users/${uid}`).get()]);
    const setup = setupDoc.data();
    assert(setup?.isComplete && setup.gscProperty === property);
    assert(userDoc.exists && !userDoc.data().deletionInProgress);
    const secretValues = [process.env.OPENAI_API_KEY, process.env.GOOGLE_CLIENT_SECRET, process.env.FIREBASE_PRIVATE_KEY,
      ...Object.entries(userDoc.data()).filter(([key]) => /(?:token|secret|privatekey)/i.test(key)).map(([, value]) => value)]
      .filter(value => typeof value === 'string' && value.length > 15);
    const capture = async () => {
      const saved = new Map();
      const visit = async snapshot => {
        if (!snapshot.exists || saved.has(snapshot.ref.path)) return;
        assert(saved.size < 5000, 'Account snapshot exceeds the bounded release verifier.');
        saved.set(snapshot.ref.path, { ref: snapshot.ref, data: snapshot.data(), updateTime: snapshot.updateTime });
        for (const child of await snapshot.ref.listCollections()) {
          const descendants = await child.limit(501).get();
          assert(descendants.size <= 500, 'A subcollection exceeds the bounded release verifier.');
          for (const doc of descendants.docs) await visit(doc);
        }
      };
      for (const collection of ownedCollections) {
        const list = await db.collection(collection).where('userId', '==', uid).limit(501).get();
        assert(list.size <= 500, 'An account collection exceeds the bounded release verifier.');
        for (const document of list.docs) await visit(document);
      }
      for (const collection of ['users', 'onboarding', 'gscTokens']) await visit(await db.doc(`${collection}/${uid}`).get());
      return saved;
    };
    const original = await capture();
    const unchanged = (before, after, { investigate = false } = {}) => {
      const permitted = path => investigate && (path.startsWith('mentorActivitySnapshots/') || path.startsWith('mentorCheckOperations/')
        || path.startsWith('requestLimits/mentor-check-'));
      for (const path of new Set([...before.keys(), ...after.keys()])) {
        if (permitted(path)) continue;
        const old = before.get(path), current = after.get(path);
        assert(old && current, 'A preserved account record was added or removed.');
        if (investigate && path === `users/${uid}`) assert.deepEqual(omitOAuth(current.data), omitOAuth(old.data), 'The check changed account data beyond credential refresh.');
        else assert(current.updateTime.isEqual(old.updateTime), 'A preserved account record changed.');
      }
    };

    stage = 'owner session';
    const customToken = await app.auth().createCustomToken(uid);
    const signin = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(15000) });
    const authentication = await signin.json(); assert(signin.ok && authentication.idToken);
    secretValues.push(authentication.idToken, authentication.refreshToken);
    let requests = 0;
    const request = async (path, method = 'GET', data, authorized = true, timeoutMs = 30000) => {
      requests++;
      let result;
      if (process.env.VERCEL_VERIFY_CLI) {
        // Credentials travel only in stdin. Never print a provider response,
        // authentication value, private account identifier or child stderr.
        const config = [`request = ${JSON.stringify(method)}`, 'header = "Content-Type: application/json"',
          ...(authorized ? [`header = ${JSON.stringify(`Authorization: Bearer ${authentication.idToken}`)}`] : []),
          ...(data === undefined ? [] : [`data = ${JSON.stringify(JSON.stringify(data))}`])].join('\n');
        const output = await new Promise((resolve, reject) => {
          const child = spawn(process.env.VERCEL_VERIFY_CLI, ['curl', `${origin}${path}`, '--scope', 'bryan-arambulas-projects', '--',
            '--silent', '--show-error', '--max-time', String(Math.ceil(timeoutMs / 1000)), '--dump-header', '-', '--config', '-', '--write-out', '\nVERIFY_STATUS:%{http_code}'],
          { stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs + 15000 });
          let stdout = ''; child.stdout.on('data', value => {
            stdout += value.toString();
            if (stdout.length > 5000000) {
              child.kill();
              reject(new Error('Protected deployment response exceeded the verification limit.'));
            }
          });
          child.stderr.resume(); child.on('error', reject);
          child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error('Protected deployment request failed.')));
          child.stdin.end(config);
        });
        const status = Number(output.match(/\nVERIFY_STATUS:(\d+)\s*$/)?.[1]);
        const content = output.replace(/\nVERIFY_STATUS:\d+\s*$/, '');
        const start = content.lastIndexOf('\r\n\r\n'); assert(start >= 0 && Number.isInteger(status));
        const headers = content.slice(0, start);
        result = { status, cache: [...headers.matchAll(/^cache-control:\s*(.*)$/gim)].at(-1)?.[1] || '', body: JSON.parse(content.slice(start + 4)) };
      } else {
        const response = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json',
          ...(authorized ? { Authorization: `Bearer ${authentication.idToken}` } : {}) },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(timeoutMs) });
        result = { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
      }
      safeKeys(result.body);
      const encoded = JSON.stringify(result.body);
      assert(secretValues.every(value => !value || !encoded.includes(value)), 'Private credential returned.');
      return result;
    };

    stage = 'authentication boundaries';
    const anonymous = [
      ['/api/mentor', 'GET'], ['/api/mentor?action=conversation&conversationId=release-check', 'GET'],
      ['/api/mentor', 'POST', { action: 'send' }], ['/api/mentor', 'POST', { action: 'check', kind: 'activity' }],
      ['/api/conversations', 'GET'], ['/api/conversations/release-check', 'GET'],
      ['/api/chatbot/chat', 'POST', {}], ['/api/seo-assistant/chat', 'POST', {}],
    ];
    for (const [path, method, data] of anonymous) assert.equal((await request(path, method, data, false)).status, 401);
    assert.equal((await request('/api/mentor?userId=phase9-not-owner')).status, 403);
    assert.equal((await request('/api/mentor', 'POST', { userId: 'phase9-not-owner', action: 'check', kind: 'activity', selection: { pageUrl: property } })).status, 403);

    stage = 'saved workspace and context';
    const workspace = await request('/api/mentor');
    assert.equal(workspace.status, 200); assert(/no-store/.test(workspace.cache));
    assert.equal(workspace.body.enabled, true); assert.equal(workspace.body.generationEnabled, expectedGeneration);
    assert.equal(workspace.body.scope.property, property);
    assert.equal(workspace.body.scope.websiteRunId, setup.revampRunId || null);
    assert.equal(workspace.body.scope.websiteUrl, setup.websiteUrl);
    assert(Array.isArray(workspace.body.pageOptions) && Array.isArray(workspace.body.conversations));
    const conversations = await request('/api/conversations');
    assert.equal(conversations.status, 200); assert(/no-store/.test(conversations.cache));
    assert.deepEqual(conversations.body.conversations.map(item => item.id), workspace.body.conversations.map(item => item.id));
    let histories = 0, turnReads = 0;
    for (const conversation of workspace.body.conversations.slice(0, 3)) {
      const history = await request(`/api/mentor?action=conversation&conversationId=${encodeURIComponent(conversation.id)}`);
      assert.equal(history.status, 200); assert(/no-store/.test(history.cache));
      assert.equal(history.body.conversation.id, conversation.id); assert(Array.isArray(history.body.messages)); histories++;
      const legacyHistory = await request(`/api/conversations/${encodeURIComponent(conversation.id)}`);
      assert.equal(legacyHistory.status, 200); assert.deepEqual(legacyHistory.body.messages, history.body.messages);
      const turn = history.body.messages.find(item => item.turnId);
      if (turn && turnReads === 0) {
        const saved = await request(`/api/mentor?action=turn&conversationId=${encodeURIComponent(conversation.id)}&turnId=${encodeURIComponent(turn.turnId)}`);
        assert.equal(saved.status, 200); assert.equal(saved.body.turn.id, turn.turnId); turnReads++;
      }
    }
    const progress = await request(`/api/progress?pageUrl=${encodeURIComponent(property)}`);
    assert.equal(progress.status, 200);
    const plan = await request(`/api/page-review/plan?pageUrl=${encodeURIComponent(property)}`); assert.equal(plan.status, 200);
    const profile = await request('/api/business-profile'); assert.equal(profile.status, 200);
    assert.equal(profile.body.profile.scope.property, property);
    assert.equal(profile.body.profile.scope.websiteRunId, setup.revampRunId || null);
    const onboarding = await request('/api/onboarding/workspace'); assert.equal(onboarding.status, 200);
    assert.equal(onboarding.body.legacyCompleted, true);
    const ideas = await request('/api/new-page-plans'); assert.equal(ideas.status, 200);

    stage = 'retired legacy writes';
    for (const path of ['/api/chatbot/chat', '/api/seo-assistant/chat']) assert.equal((await request(path, 'POST', {})).status, 410);
    assert.equal((await request('/api/conversations', 'POST', { messages: [] })).status, 410);
    const oldId = workspace.body.conversations[0]?.id || 'release-check';
    assert.equal((await request(`/api/conversations/${encodeURIComponent(oldId)}`, 'PUT', { messages: [] })).status, 410);

    stage = 'stored-read preservation';
    const afterReads = await capture(); unchanged(original, afterReads);
    let investigation = null;
    if (investigationFlag) {
      stage = 'explicit homepage investigation';
      const kind = investigationFlag.includes('=') ? investigationFlag.split('=')[1] : 'activity';
      const response = await request('/api/mentor', 'POST', { action: 'check', kind,
        requestId: randomUUID(), selection: { pageUrl: property } }, true, 75000);
      assert.equal(response.status, 200); assert(/no-store/.test(response.cache));
      const check = response.body.check; assert.equal(check.kind, kind); assert.equal(check.pageUrl, property);
      assert.equal(check.pending, false, 'Another page check is still running; do not claim completed investigation.');
      assert(Number.isFinite(Date.parse(check.lastAttemptAt)));
      const checkId = hash([workspace.body.scope.key, kind, property]);
      const persisted = (await db.doc(`mentorCheckOperations/${checkId}`).get()).data();
      assert(persisted?.userId === uid && persisted.pageUrl === property && persisted.scopeKey === workspace.body.scope.key);
      assert.equal(persisted.lastAttemptAt, check.lastAttemptAt);
      assert.deepEqual(persisted.result || null, check.result);
      if (!check.lastError) {
        assert(Number.isFinite(Date.parse(check.lastSuccessAt)));
        if (kind === 'activity') {
          assert.equal(check.result.value.pageUrl, property); assert.equal(check.result.value.property, setup.gscProperty);
          assert(Number.isFinite(Date.parse(check.result.value.fetchedAt)));
        } else {
          assert.equal(check.result.pageUrl, property); assert(Number.isFinite(Date.parse(check.result.checkedAt)));
        }
      }
      stage = 'investigation preservation';
      unchanged(afterReads, await capture(), { investigate: true });
      investigation = { kind, cached: Boolean(check.cached), observationPersisted: true,
        status: check.lastError ? 'unavailable_or_partial' : 'available', lastAttemptAt: check.lastAttemptAt,
        lastSuccessAt: check.lastSuccessAt, tasksAndPublicationDatesUnchanged: true, generatedAnswers: 0 };
    }
    process.stdout.write(JSON.stringify({ verifiedAt: new Date().toISOString(), origin, pilotEnabledForOwner: workspace.body.enabled,
      generationEnabled: workspace.body.generationEnabled, anonymousChecks: anonymous.length, crossAccountChecks: 2,
      requests, historiesRead: histories, savedTurnsRead: turnReads, preservedDocuments: original.size,
      savedReadDatabaseMutationsObserved: 0, savedReadUsageLedgerChangesObserved: 0,
      homepagePlanPresent: Boolean(plan.body.plan), activeHomepageCycles: progress.body.ongoing?.records?.length || 0,
      legacyWriteResponses: [410, 410, 410, 410], publicationsConfirmed: 0, generatedAnswers: 0,
      investigation, providerCallVerification: 'Stored-read provider-free behavior is covered by isolated tests; live account and usage records remained unchanged.' }, null, 2) + '\n');
  } finally { await app.delete(); }
}
main().catch(() => { console.error(`Mentor release verification failed during ${stage}. Credentials, private identities and provider payloads are omitted.`); process.exit(1); });
