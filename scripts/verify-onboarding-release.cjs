// Read-only onboarding release verification: no setup confirmation, Google
// refresh, crawling, extraction, generation, or publication is performed.
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
    for (const collection of ['pageReviewPlans', 'implementedSeoTips', 'pageProgressCycles', 'newPagePlans', 'newPagePublications', 'aiUsageEvents', 'onboardingInventories', 'onboardingExtractions', 'onboardingUsageEvents']) {
      snapshots.push(...(await db.collection(collection).where('userId', '==', uid).get()).docs);
    }
    snapshots.push(await db.doc(`onboarding/${uid}`).get(), await db.doc(`users/${uid}`).get());
    const setupSessionBefore = await db.doc(`users/${uid}/onboardingSessions/current`).get();
    if (setupSessionBefore.exists) snapshots.push(setupSessionBefore);
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
    stage = 'onboarding authentication boundaries';
    for (const path of ['/api/onboarding/workspace', '/api/business-profile', '/api/gsc/properties']) {
      assert.equal((await request(path, 'GET', undefined, false)).status, 401);
    }
    assert.equal((await request('/api/onboarding/workspace', 'POST', { action: 'begin' }, false)).status, 401);
    assert.equal((await request('/api/gsc/select', 'POST', {}, false)).status, 401);
    assert.equal((await request('/api/business-profile', 'PATCH', {}, false)).status, 401);
    stage = 'saved onboarding and profile reads';
    const workspace = await request('/api/onboarding/workspace');
    assert.equal(workspace.status, 200); assert(/no-store/.test(workspace.cache));
    assert.equal(workspace.body.eligible, true); assert.equal(workspace.body.legacyCompleted, true);
    const profile = await request('/api/business-profile'); assert.equal(profile.status, 200);
    assert.equal(profile.body.profile.scope.property, property);
    assert.equal(profile.body.profile.scope.websiteRunId, setup.revampRunId || null);
    assert.equal(profile.body.profile.scope.websiteUrl, setup.websiteUrl);
    assert(!JSON.stringify(workspace.body).match(/gscAccessToken|gscRefreshToken|refresh_token|access_token/));
    assert.equal((await request('/api/gsc/store-tokens', 'POST', {})).status, 410);
    stage = 'stored current tools';
    const progress = await request(`/api/progress?pageUrl=${encodeURIComponent(property)}`);
    assert.equal(progress.status, 200); assert(Array.isArray(progress.body.ongoing.records));
    const plan = await request(`/api/page-review/plan?pageUrl=${encodeURIComponent(property)}`); assert.equal(plan.status, 200);
    const ideas = await request('/api/new-page-plans'); assert.equal(ideas.status, 200);
    stage = 'preservation';
    for (const before of snapshots) {
      const after = await before.ref.get(); assert(after.exists && after.updateTime.isEqual(before.updateTime));
    }
    for (const collection of ['pageReviewPlans', 'implementedSeoTips', 'pageProgressCycles', 'newPagePlans', 'newPagePublications', 'aiUsageEvents', 'onboardingInventories', 'onboardingExtractions', 'onboardingUsageEvents']) {
      const after = (await db.collection(collection).where('userId', '==', uid).get()).docs;
      assert.equal(after.length, snapshots.filter(item => item.ref.parent.id === collection).length);
    }
    assert.equal((await db.doc(`users/${uid}/onboardingSessions/current`).get()).exists, setupSessionBefore.exists,
      'Saved reads must not create a setup session.');
    console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), origin,
      pilotEnabled: workspace.body.eligible, profileStatus: profile.body.profile.status,
      anonymousChecks: 6, retainedDocuments: snapshots.length,
      setupSessionCreated: !setupSessionBefore.exists && (await db.doc(`users/${uid}/onboardingSessions/current`).get()).exists,
      currentHomepagePlan: Boolean(plan.body.plan), activeHomepageCycles: progress.body.ongoing.records.length,
      savedReadsUsedAI: false, publicationsConfirmed: 0, writesDuringVerification: 0, retiredTokenWriteStatus: 410,
      existingAccountCheckpoint: 'Owner optionally reviews and confirms real business facts in Settings.' }, null, 2));
  } finally { await app.delete(); }
}
main().catch(() => { console.error(`Onboarding release verification failed during ${stage}. Credentials and provider payloads are omitted.`); process.exit(1); });
