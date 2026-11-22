// Read-only pilot verification. Never enrolls a page, generates advice, sends a
// message, invokes a collector, or declares an edit on the owner's behalf.
require('dotenv').config({ path: '.env.local', quiet: true });
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const admin = require('firebase-admin');
const origin = process.argv[2] || 'https://simpl-seo.com';
const snapshotOnly = process.argv.includes('--snapshot-only');
const uid = 'ncfmFPQHLtfI815IKsFlzAZelgC3', property = 'https://bryandevelops.com/';
const collections = ['pageReviewPlans', 'implementedSeoTips', 'pageProgressCycles', 'pageTrackingStates', 'newPagePlans', 'newPagePublications',
  'aiUsageEvents', 'requestLimits', 'notificationEvents', 'notificationDeliveries', 'notificationPreferences'];
let stage = 'configuration';
console.log = () => {}; // Keep SDK diagnostics and private document IDs out of output.
// Firestore maps have no guaranteed key order across separate reads.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');

async function main() {
  assert(origin === 'https://simpl-seo.com' || /^https:\/\/simplseo-[a-z0-9-]+\.vercel\.app$/.test(origin));
  assert.equal(process.env.FIREBASE_PROJECT_ID, 'simpleseo-90570');
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  try {
    const db = app.firestore();
    const capture = async () => {
      const records = [];
      const visit = async doc => {
        if (!doc.exists) return;
        assert(records.length < 5000);
        records.push([doc.ref.path, doc.updateTime.toDate().toISOString(), hash(doc.data())]);
        for (const collection of await doc.ref.listCollections()) {
          const children = await collection.limit(501).get(); assert(children.size <= 500);
          for (const child of children.docs) await visit(child);
        }
      };
      for (const name of collections) {
        const snapshot = await db.collection(name).where('userId', '==', uid).limit(501).get(); assert(snapshot.size <= 500);
        for (const doc of snapshot.docs) await visit(doc);
      }
      for (const name of ['users', 'onboarding', 'gscTokens']) await visit(await db.doc(`${name}/${uid}`).get());
      return records.sort(([a], [b]) => a.localeCompare(b));
    };
    stage = 'pilot scope and saved work';
    const setup = (await db.doc(`onboarding/${uid}`).get()).data();
    assert(setup?.isComplete && setup.gscProperty === property && !setup.revampArchivePending);
    const before = await capture();
    if (snapshotOnly) {
      assert.deepEqual(await capture(), before);
      process.stdout.write(JSON.stringify({ capturedAt: new Date().toISOString(), savedRecords: before.length, fingerprint: hash(before), readOnly: true, unchangedDuringVerification: true }, null, 2) + '\n');
      return;
    }
    stage = 'owner session';
    const customToken = await app.auth().createCustomToken(uid);
    const authentication = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(15000) });
    const auth = await authentication.json(); assert(authentication.ok && auth.idToken);
    const call = async (path, { method = 'GET', body, authorized = true } = {}) => {
      const response = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${auth.idToken}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
      const result = await response.json();
      assert(!/"(?:gscAccessToken|gscRefreshToken|privateKey|pilotUids|followUpLease|leaseId)"/.test(JSON.stringify(result)));
      return { status: response.status, body: result, cache: response.headers.get('cache-control') };
    };
    stage = 'authentication boundaries';
    assert.equal((await call('/api/page-review/monitor', { method: 'POST', authorized: false, body: { action: 'start', pageUrl: property } })).status, 401);
    assert.equal((await call('/api/page-review/monitor', { method: 'POST', body: { action: 'start', userId: 'not-the-pilot', pageUrl: property } })).status, 403);
    stage = 'saved page reads';
    const progress = await call(`/api/progress?pageUrl=${encodeURIComponent(property)}`);
    assert.equal(progress.status, 200); assert(/no-store/.test(progress.cache));
    assert.equal(progress.body.ongoing.monitoringEnabled, true); assert(!progress.body.ongoing.error);
    for (const cycle of progress.body.ongoing.records) {
      assert.equal(cycle.pageUrl, property); assert.equal(cycle.property, property);
      if (cycle.mode === 'monitoring') assert(!cycle.confirmedAt && !cycle.confirmation?.source);
    }
    const plan = await call(`/api/page-review/plan?pageUrl=${encodeURIComponent(property)}`);
    assert.equal(plan.status, 200); assert(/no-store/.test(plan.cache));
    stage = 'saved-work preservation';
    assert.deepEqual(await capture(), before);
    stage = 'scheduler evidence';
    const runs = await db.collection('cronRuns').orderBy('startedAt', 'desc').limit(12).get();
    const scheduler = runs.docs.map(doc => doc.data()).map(run => ({ job: run.job || run.jobName || null, trigger: run.trigger,
      startedAt: run.startedAt, finishedAt: run.finishedAt || null, status: run.status || null }));
    process.stdout.write(JSON.stringify({ verifiedAt: new Date().toISOString(), origin, monitoringEnabled: true,
      savedRecordsPreserved: before.length, fingerprint: hash(before), authenticatedReads: 2, rejectedWrites: 2,
      pagesEnrolled: 0, reviewsGenerated: 0, publicationsRecorded: 0, schedulerInvoked: false, scheduler,
      limitation: 'A scheduled run after a real enrollment and a later completed period are still needed to verify live monitoring and its monthly reminder.' }, null, 2) + '\n');
  } finally { await app.delete(); }
}
main().catch(() => { process.stderr.write(`Monitoring verification failed during ${stage}. Private data and credentials are omitted.\n`); process.exitCode = 1; });
