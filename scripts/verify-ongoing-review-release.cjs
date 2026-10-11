// Read-only live pilot verification. Never generates guidance, confirms a
// publication, advances a cycle, or submits anything to Google.
require('dotenv').config({ path: '.env.local', quiet: true });
const fs = require('node:fs');
const admin = require('firebase-admin');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const [identityFile, origin = 'https://simplseo-io.vercel.app'] = process.argv.slice(2);
let stage = 'configuration';
async function main() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, 'simpleseo-90570');
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  assert(/^https:\/\/simplseo-[a-z0-9-]+\.vercel\.app$/.test(origin));
  const identities = fs.readFileSync(identityFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(identities.length, 1);
  const { uid, property } = identities[0];
  assert.equal(property, 'https://bryandevelops.com/');
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  try {
    stage = 'saved work snapshot';
    const setup = (await db.doc(`onboarding/${uid}`).get()).data();
    assert(setup?.isComplete && setup.gscProperty === property);
    const snapshots = [];
    for (const collection of ['pageReviewPlans', 'implementedSeoTips', 'pageProgressCycles', 'newPagePlans', 'newPagePublications', 'aiUsageEvents']) {
      snapshots.push(...(await db.collection(collection).where('userId', '==', uid).get()).docs);
    }
    stage = 'owner session';
    const customToken = await app.auth().createCustomToken(uid);
    const signin = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(15000) });
    const authentication = await signin.json(); assert(signin.ok && authentication.idToken);
    const request = async (path, method = 'GET', data, authorized = true) => {
      if (process.env.VERCEL_VERIFY_CLI) {
        // The CLI supplies deployment protection access. App credentials travel
        // only through stdin, never command arguments, files or printed logs.
        const config = [`request = ${JSON.stringify(method)}`, 'header = "Content-Type: application/json"',
          ...(authorized ? [`header = ${JSON.stringify(`Authorization: Bearer ${authentication.idToken}`)}`] : []),
          ...(data === undefined ? [] : [`data = ${JSON.stringify(JSON.stringify(data))}`])].join('\n');
        const output = await new Promise((resolve, reject) => {
          const child = spawn(process.env.VERCEL_VERIFY_CLI, ['curl', `${origin}${path}`, '--scope', 'bryan-arambulas-projects', '--',
            '--silent', '--show-error', '--max-time', '25', '--dump-header', '-', '--config', '-', '--write-out', '\nVERIFY_STATUS:%{http_code}'],
          { stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000 });
          let stdout = ''; child.stdout.on('data', value => { stdout += value.toString(); });
          child.stderr.resume(); child.on('error', reject);
          child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error('Protected deployment request failed.')));
          child.stdin.end(config);
        });
        const status = Number(output.match(/\nVERIFY_STATUS:(\d+)\s*$/)?.[1]);
        const content = output.replace(/\nVERIFY_STATUS:\d+\s*$/, '');
        const bodyStart = content.lastIndexOf('\r\n\r\n');
        assert(bodyStart >= 0 && Number.isInteger(status));
        const headers = content.slice(0, bodyStart);
        return { status, cache: [...headers.matchAll(/^cache-control:\s*(.*)$/gim)].at(-1)?.[1] || '', body: JSON.parse(content.slice(bodyStart + 4)) };
      }
      const response = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json',
        ...(authorized ? { Authorization: `Bearer ${authentication.idToken}` } : {}) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(25000) });
      return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
    };
    stage = 'anonymous and cross-account boundaries';
    const paths = ['/api/progress', '/api/page-review/follow-up', '/api/page-review/cycle', '/api/page-review/confirm', '/api/page-review/plan'];
    for (const path of paths) {
      const method = ['/api/page-review/cycle', '/api/page-review/confirm'].includes(path) ? 'POST' : 'GET';
      assert.equal((await request(path, method, method === 'POST' ? {} : undefined, false)).status, 401);
      assert.equal((await request(method === 'GET' ? `${path}?userId=phase7-other-owner` : path, method, method === 'POST' ? { userId: 'phase7-other-owner' } : undefined)).status, 403);
    }
    assert.equal((await request('/api/page-review/follow-up', 'POST', {}, false)).status, 401);
    assert.equal((await request('/api/page-review/follow-up', 'POST', { userId: 'phase7-other-owner' })).status, 403);
    stage = 'stored progress and current plan';
    const progress = await request(`/api/progress?pageUrl=${encodeURIComponent(property)}`);
    assert.equal(progress.status, 200); assert(/no-store/.test(progress.cache)); assert.equal(progress.body.ongoing.enabled, true);
    assert(Array.isArray(progress.body.ongoing.records) && !progress.body.ongoing.error);
    const plan = await request(`/api/page-review/plan?pageUrl=${encodeURIComponent(property)}`);
    assert.equal(plan.status, 200); assert(/no-store/.test(plan.cache));
    const missing = await request(`/api/page-review/follow-up?cycleId=${'0'.repeat(64)}`);
    assert.equal(missing.status, 404); assert(/no-store/.test(missing.cache));
    assert.equal((await request('/api/reset-page-implementation', 'POST', {})).status, 410);
    stage = 'preservation';
    for (const before of snapshots) {
      const after = await before.ref.get(); assert(after.exists && after.updateTime.isEqual(before.updateTime));
    }
    for (const collection of ['pageProgressCycles', 'aiUsageEvents']) {
      const after = (await db.collection(collection).where('userId', '==', uid).get()).docs;
      assert.equal(after.length, snapshots.filter(item => item.ref.parent.id === collection).length);
    }
    console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), origin, pilotEnabled: true,
      anonymousChecks: 6, crossAccountChecks: 6, retainedDocuments: snapshots.length,
      activeHomepageCycles: progress.body.ongoing.records.length, savedReadsUsedAI: false,
      publicationsConfirmed: 0, writesDuringVerification: 0, legacyResetStatus: 410,
      realPublicationCheckpoint: 'Owner must publish and explicitly confirm a real edit.' }, null, 2));
  } finally { await app.delete(); }
}
main().catch(() => { console.error(`Ongoing-review release verification failed during ${stage}. Credentials and provider payloads are omitted.`); process.exit(1); });
