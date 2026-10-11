// Read-only production verification. No collector, AI, confirmation or save calls.
require('dotenv').config({ path: '.env.local', quiet: true });
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const admin = require('firebase-admin');
console.log = () => {}; // Avoid SDK diagnostic paths; only emit the final report.
const [uid, property, origin = 'https://simplseo-io.vercel.app'] = process.argv.slice(2);
const roots = ['pageReviewPlans', 'implementedSeoTips', 'pageProgressCycles', 'newPagePlans', 'newPagePublications', 'newPageWorkspaces', 'newPageAssessments', 'aiUsageEvents'];
let stage = 'configuration';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = value => value?.toDate ? value.toDate().toISOString() : value || null;
async function main() {
  assert.equal(process.argv.slice(2).length >= 2 && process.argv.slice(2).length <= 3, true);
  assert(uid && !uid.includes('/')); assert.equal(property, 'https://bryandevelops.com/');
  assert(/^https:\/\/simplseo-[a-z0-9-]+\.vercel\.app$/.test(origin));
  assert.equal(process.env.FIREBASE_PROJECT_ID, 'simpleseo-90570');
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  try {
    stage = 'capture saved account work';
    const capture = async () => {
      const records = new Map();
      const visit = async doc => {
        if (!doc.exists || records.has(doc.ref.path)) return;
        assert(records.size < 5000);
        records.set(doc.ref.path, { data: doc.data(), version: doc.updateTime.toDate().toISOString() });
        for (const child of await doc.ref.listCollections()) {
          const list = await child.limit(501).get(); assert(list.size <= 500);
          for (const item of list.docs) await visit(item);
        }
      };
      for (const root of roots) {
        const docs = await db.collection(root).where('userId', '==', uid).limit(501).get(); assert(docs.size <= 500);
        for (const doc of docs.docs) await visit(doc);
      }
      for (const root of ['users', 'onboarding', 'gscTokens']) await visit(await db.doc(`${root}/${uid}`).get());
      return records;
    };
    const before = await capture();
    const setup = before.get(`onboarding/${uid}`).data;
    assert(setup.isComplete && setup.gscProperty === property);
    assert(before.has(`users/${uid}`) && !before.get(`users/${uid}`).data.deletionInProgress);
    stage = 'owner authentication';
    const customToken = await app.auth().createCustomToken(uid);
    const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(15000) });
    const authentication = await authResponse.json(); assert(authResponse.ok && authentication.idToken);
    let requestCount = 0;
    const request = async (path, authorized = true) => {
      requestCount++;
      let result;
      if (process.env.VERCEL_VERIFY_CLI) {
        const config = ['request = "GET"', ...(authorized ? [`header = ${JSON.stringify(`Authorization: Bearer ${authentication.idToken}`)}`] : [])].join('\n');
        const output = await new Promise((resolve, reject) => {
          const child = spawn(process.env.VERCEL_VERIFY_CLI, ['curl', `${origin}${path}`, '--scope', 'bryan-arambulas-projects', '--', '--silent', '--show-error', '--max-time', '60', '--dump-header', '-', '--config', '-', '--write-out', '\nVERIFY_STATUS:%{http_code}'], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 75000 });
          let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 3000000) { child.kill(); reject(Error('Response too large')); } });
          child.stderr.resume(); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(stdout) : reject(Error('Protected request failed'))); child.stdin.end(config);
        });
        const status = Number(output.match(/\nVERIFY_STATUS:(\d+)\s*$/)?.[1]);
        const content = output.replace(/\nVERIFY_STATUS:\d+\s*$/, ''), start = content.lastIndexOf('\r\n\r\n');
        assert(start >= 0 && Number.isInteger(status));
        result = { status, cache: content.slice(0, start).match(/cache-control:\s*([^\r\n]+)/i)?.[1], body: JSON.parse(content.slice(start + 4)) };
      } else {
        const response = await fetch(`${origin}${path}`, { headers: authorized ? { Authorization: `Bearer ${authentication.idToken}` } : {}, signal: AbortSignal.timeout(60000) });
        result = { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
      }
      const checkKeys = value => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) {
        assert(!/^(gscAccessToken|gscRefreshToken|access_token|refresh_token|idToken|refreshToken|accessToken|privateKey|client_secret|apiKey|api_key|pilotUids)$/i.test(key)); checkKeys(child);
      } }; checkKeys(result.body); return result;
    };
    stage = 'anonymous and forged account boundaries';
    for (const path of ['/api/dashboard/config', '/api/dashboard/work']) assert.equal((await request(path, false)).status, 401);
    assert.equal((await request('/api/dashboard/work?userId=not-this-owner')).status, 403);
    assert.equal((await request('/api/dashboard/work?property=https%3A%2F%2Fexample.com')).status, 400);
    stage = 'pilot configuration';
    const config = await request('/api/dashboard/config'); assert.equal(config.status, 200); assert.equal(config.body.enabled, true); assert(/no-store/.test(config.cache));
    stage = 'bounded saved work listing';
    const fragments = [], cursors = new Set(); let cursor, batches = 0;
    do {
      const response = await request(`/api/dashboard/work${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(response.status, 200); assert(/no-store/.test(response.cache));
      const body = response.body;
      assert.equal(body.scope.property, property); assert.equal(body.scope.websiteRunId, setup.revampRunId || null); assert.equal(body.scope.websiteUrl, setup.websiteUrl);
      assert(Object.values(body.sources).every(source => !source.error && source.scanned <= 10));
      assert.equal(body.coverage.batchSize, 10);
      fragments.push(...body.items); cursor = body.nextCursor; batches++;
      assert(batches <= 20 && (!cursor || !cursors.has(cursor))); if (cursor) cursors.add(cursor);
    } while (cursor);
    const collections = { plan: 'pageReviewPlans', cycle: 'pageProgressCycles', legacy: 'implementedSeoTips', new_page: 'newPagePlans' };
    stage = 'agreement with authoritative saved records';
    for (const item of fragments) {
      const original = before.get(`${collections[item.kind]}/${item.id}`)?.data; assert(original);
      if (item.kind === 'plan') {
        assert.equal(item.pageUrl, original.pageUrl); assert.equal(item.revision, original.revision);
        for (const state of ['todo', 'needs_review', 'done', 'dismissed']) assert.equal(item.taskCounts[state], original.tasks.filter(task => task.status === state).length);
      } else if (item.kind === 'cycle') {
        assert.equal(item.confirmedAt, iso(original.confirmedAt)); assert.equal(item.nextReviewAt, iso(original.nextReviewAt));
        for (const side of ['baseline', 'post']) for (const metric of ['clicks', 'impressions', 'position']) {
          if (original.latestCheckpoint?.[side]?.[metric] != null) assert.equal(item.latestCheckpoint[side][metric], original.latestCheckpoint[side][metric]);
        }
      } else if (item.kind === 'new_page') {
        assert.equal(item.revision, original.revision); assert.equal(item.status, original.status);
        if (item.publication) assert.equal(item.publication.verifiedAt, iso(before.get(`newPagePublications/${item.publication.id}`).data.verifiedAt));
      }
    }
    stage = 'repeat reads and preserved saved work';
    assert.equal((await request('/api/dashboard/work')).status, 200);
    const after = await capture();
    const fingerprint = records => hash([...records].map(([path, record]) => [path, record.version, hash(record.data)]).sort(([a], [b]) => a.localeCompare(b)));
    assert.equal(fingerprint(after), fingerprint(before), 'A protected account record changed during saved reads.');
    process.stdout.write(JSON.stringify({ verifiedAt: new Date().toISOString(), origin, passed: true, requests: requestCount, batches,
      savedRecordsPreserved: before.size, fragmentCounts: Object.fromEntries(Object.keys(collections).map(kind => [kind, fragments.filter(item => item.kind === kind).length])),
      accountIdentityPreserved: true, noSavedWorkOrUsageWrites: true, noGenerationOrPublication: true }, null, 2) + '\n');
  } finally { await app.delete(); }
}
main().catch(error => { process.stderr.write(JSON.stringify({ passed: false, stage, error: error.code || error.name || 'verification_failed' }) + '\n'); process.exitCode = 1; });
