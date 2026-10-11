// Read-only Phase 11 release verification for the existing Bryan pilot.
// The only POST establishes a normal Firebase owner session. Every application
// request is GET: no mark-read, preferences save, email, collector or publication.
require('dotenv').config({ path: '.env.local', quiet: true });
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const admin = require('firebase-admin');
console.log = () => {}; // SDK diagnostics must not expose private document paths.
const [uid, property, origin = 'https://simplseo-io.vercel.app'] = process.argv.slice(2);
const ownedCollections = [
  'pageReviewPlans', 'implementedSeoTips', 'pageProgressCycles', 'newPagePlans', 'newPagePublications',
  'newPageWorkspaces', 'newPageInventories', 'newPageAssessments', 'onboardingInventories', 'onboardingExtractions',
  'onboardingUsageEvents', 'aiUsageEvents', 'mentorWorkspaces', 'mentorOperations', 'mentorActivitySnapshots',
  'mentorCheckOperations', 'mentorBudgetReservations', 'mentorRequestLimits', 'conversations', 'requestLimits',
  'notificationPreferences', 'notificationEvents', 'notificationDeliveries', 'notificationIssueEpisodes',
  'notificationConnectionObservations', 'notificationTestLimits',
];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = snapshot => hash([...snapshot].map(([path, record]) => [path, record.version, hash(record.data)]).sort(([a], [b]) => a.localeCompare(b)));
const expectedEnabled = process.env.NOTIFICATION_VERIFY_EXPECT_ENABLED !== 'false';
const expectedSending = process.env.NOTIFICATION_VERIFY_EXPECT_EMAILS === 'true';
let stage = 'configuration';
function safeKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!/^(gscAccessToken|gscRefreshToken|access_token|refresh_token|idToken|refreshToken|accessToken|privateKey|client_secret|apiKey|api_key|pilotUids|payload|idempotencyKey)$/i.test(key), 'Private delivery or credential field returned.');
    safeKeys(child);
  }
}
async function main() {
  assert(process.argv.slice(2).length >= 2 && process.argv.slice(2).length <= 3);
  assert.equal(uid, 'ncfmFPQHLtfI815IKsFlzAZelgC3');
  assert.equal(property, 'https://bryandevelops.com/');
  assert(/^https:\/\/simplseo-[a-z0-9-]+\.vercel\.app$/.test(origin));
  assert.equal(process.env.FIREBASE_PROJECT_ID, 'simpleseo-90570');
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  try {
    stage = 'saved account snapshot';
    const capture = async () => {
      const records = new Map();
      const visit = async document => {
        if (!document.exists || records.has(document.ref.path)) return;
        assert(records.size < 5000, 'Account exceeds bounded release verification.');
        records.set(document.ref.path, { data: document.data(), version: document.updateTime.toDate().toISOString() });
        for (const collection of await document.ref.listCollections()) {
          const children = await collection.limit(501).get(); assert(children.size <= 500);
          for (const child of children.docs) await visit(child);
        }
      };
      for (const collection of ownedCollections) {
        const rows = await db.collection(collection).where('userId', '==', uid).limit(501).get(); assert(rows.size <= 500);
        for (const row of rows.docs) await visit(row);
      }
      for (const collection of ['users', 'onboarding', 'gscTokens', 'notificationPreferences', 'notificationConnectionObservations']) {
        await visit(await db.doc(`${collection}/${uid}`).get());
      }
      return records;
    };
    const before = await capture(), setup = before.get(`onboarding/${uid}`)?.data, user = before.get(`users/${uid}`)?.data;
    assert(setup?.isComplete && setup.gscProperty === property && user && !user.deletionInProgress);
    if (process.env.NOTIFICATION_VERIFY_SNAPSHOT_ONLY === 'true') {
      process.stdout.write(JSON.stringify({ capturedAt: new Date().toISOString(), savedRecords: before.size, savedWorkFingerprint: fingerprint(before), readOnly: true }, null, 2) + '\n');
      return;
    }
    const secrets = [process.env.OPENAI_API_KEY, process.env.RESEND_API_KEY, process.env.RESEND_WEBHOOK_SECRET,
      process.env.NOTIFICATION_UNSUBSCRIBE_SECRET, process.env.FIREBASE_PRIVATE_KEY,
      ...Object.entries(user).filter(([key]) => /token|secret|privatekey/i.test(key)).map(([, value]) => value)]
      .filter(value => typeof value === 'string' && value.length > 15);
    stage = 'owner authentication';
    const customToken = await app.auth().createCustomToken(uid);
    const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(15000) });
    const authentication = await authResponse.json(); assert(authResponse.ok && authentication.idToken);
    secrets.push(authentication.idToken, authentication.refreshToken);
    let requests = 0;
    const get = async (path, authorized = true) => {
      requests++;
      let result;
      if (process.env.VERCEL_VERIFY_CLI) {
        const config = ['request = "GET"', ...(authorized ? [`header = ${JSON.stringify(`Authorization: Bearer ${authentication.idToken}`)}`] : [])].join('\n');
        const output = await new Promise((resolve, reject) => {
          const cli = process.env.VERCEL_VERIFY_CLI, nodeEntrypoint = cli.endsWith('.js');
          const child = spawn(nodeEntrypoint ? process.execPath : cli, [...(nodeEntrypoint ? [cli] : []), 'curl', `${origin}${path}`, '--scope', 'bryan-arambulas-projects', '--',
            '--silent', '--show-error', '--max-time', '60', '--dump-header', '-', '--config', '-', '--write-out', '\nVERIFY_STATUS:%{http_code}'],
          { stdio: ['pipe', 'pipe', 'pipe'], timeout: 75000 });
          let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 3000000) { child.kill(); reject(Error('Response too large')); } });
          child.stderr.resume(); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(stdout) : reject(Error('Protected request failed'))); child.stdin.end(config);
        });
        const status = Number(output.match(/\nVERIFY_STATUS:(\d+)\s*$/)?.[1]);
        const content = output.replace(/\nVERIFY_STATUS:\d+\s*$/, ''), start = content.lastIndexOf('\r\n\r\n');
        assert(start >= 0 && Number.isInteger(status));
        result = { status, cache: [...content.slice(0, start).matchAll(/^cache-control:\s*(.*)$/gim)].at(-1)?.[1] || '', body: JSON.parse(content.slice(start + 4)) };
      } else {
        const response = await fetch(`${origin}${path}`, { headers: authorized ? { Authorization: `Bearer ${authentication.idToken}` } : {}, signal: AbortSignal.timeout(60000) });
        result = { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
      }
      safeKeys(result.body);
      const encoded = JSON.stringify(result.body); assert(secrets.every(value => !value || !encoded.includes(value)), 'Private credential returned.');
      return result;
    };
    stage = 'authentication boundaries';
    for (const path of ['/api/notifications', '/api/notifications/preferences', '/api/notifications/phase11-release-missing']) assert.equal((await get(path, false)).status, 401);
    assert.equal((await get('/api/notifications?userId=not-the-owner')).status, 403);
    assert.equal((await get('/api/notifications/phase11-release-missing')).status, 404);
    assert.equal((await get('/api/notifications/unsubscribe?token=invalid-release-token', false)).status, 400);
    stage = 'saved preferences';
    const preferences = await get('/api/notifications/preferences'); assert.equal(preferences.status, 200); assert(/no-store/.test(preferences.cache));
    assert.equal(preferences.body.enabled, expectedEnabled); assert.equal(preferences.body.sendingEnabled, expectedSending);
    const existingPreferences = before.get(`notificationPreferences/${uid}`)?.data;
    assert.equal(preferences.body.revision, existingPreferences?.revision || 0);
    assert.equal(preferences.body.chosenAt, existingPreferences?.chosenAt || null);
    stage = 'saved notification listing';
    const notices = [], cursors = new Set(); let cursor = null, batches = 0;
    do {
      const response = await get(`/api/notifications?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(response.status, 200); assert(/no-store/.test(response.cache)); assert.equal(response.body.enabled, expectedEnabled);
      assert(Array.isArray(response.body.items) && response.body.items.length <= 5);
      assert(Number.isInteger(response.body.unreadCount) && response.body.unreadCount >= 0);
      notices.push(...response.body.items); cursor = response.body.nextCursor; batches++;
      assert(batches <= 100 && (!cursor || !cursors.has(cursor))); if (cursor) cursors.add(cursor);
    } while (cursor);
    const unique = new Set(notices.map(notice => notice.id)); assert.equal(unique.size, notices.length);
    for (const notice of notices) {
      const record = before.get(`notificationEvents/${notice.id}`)?.data; assert(record && record.userId === uid);
      assert.equal(notice.title, record.title); assert.equal(notice.message, record.message); assert.equal(notice.readAt, record.readAt || null);
      assert.equal(notice.href, `/notifications/${notice.id}`);
    }
    stage = 'read-only destinations';
    for (const notice of notices.slice(0, 5)) {
      const detail = await get(`/api/notifications/${notice.id}`); assert.equal(detail.status, 200); assert(/no-store/.test(detail.cache));
      assert.equal(detail.body.event.id, notice.id);
      const destination = detail.body.destination?.href;
      if (destination) assert(destination.startsWith('/') && !destination.startsWith('//') && !destination.includes('\\'));
    }
    stage = 'preserved saved work and notification records';
    assert.equal((await get('/api/notifications')).status, 200);
    const after = await capture();
    assert.equal(fingerprint(after), fingerprint(before), 'A protected record changed during saved GET requests.');
    const collectionCount = name => [...before].filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2).length;
    const confirmed = [...before].filter(([path, record]) => path.startsWith('pageProgressCycles/') && path.split('/').length === 2 && record.data.lifecycle === 'active').length;
    const publications = [...before].filter(([path, record]) => path.startsWith('newPagePublications/') && path.split('/').length === 2 && record.data.verifiedAt).length;
    process.stdout.write(JSON.stringify({ verifiedAt: new Date().toISOString(), origin, passed: true, requests, batches,
      savedRecordsPreserved: before.size, savedPagePlans: collectionCount('pageReviewPlans'), savedNewPagePlans: collectionCount('newPagePlans'),
      savedWorkFingerprint: fingerprint(after),
      activeConfirmedCycles: confirmed, verifiedPublications: publications, notificationCount: notices.length,
      notificationDeliveries: collectionCount('notificationDeliveries'), pilotEnabled: preferences.body.enabled,
      sendingEnabled: preferences.body.sendingEnabled, preferencesUnchanged: true, publicationAndMeasurementDatesUnchanged: true,
      noSavedWorkOrUsageWrites: true, noEmailOrProviderCollection: true,
      liveLimitations: ['No real email was sent.', 'No scheduled execution was invoked or verified.', 'No publication or progress result was fabricated.'] }, null, 2) + '\n');
  } finally { await db.terminate(); await app.delete(); }
}
main().catch(error => { process.stderr.write(JSON.stringify({ passed: false, stage, error: error.code || error.name || 'verification_failed' }) + '\n'); process.exitCode = 1; });
