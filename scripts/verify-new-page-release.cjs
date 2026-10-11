// Production release check. No AI, area confirmations, drafts or publications.
// --inventory explicitly performs bounded public website discovery only.
// --restart-inventory rebuilds that evidence without altering owner plans.
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const ORIGIN = 'https://simplseo-io.vercel.app';
const PROJECT = 'simpleseo-90570';
const [uid, property, ...flags] = process.argv.slice(2);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
let stage = 'configuration';
async function main() {
  assert(/^[\w-]{1,128}$/.test(uid || '') && property && flags.every(flag => ['--inventory', '--restart-inventory'].includes(flag))
    && new Set(flags).size === flags.length && (!flags.includes('--restart-inventory') || flags.includes('--inventory')), 'Provide exact account/property and optional inventory flags.');
  assert(process.env.FIREBASE_PROJECT_ID === PROJECT && !process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Use only existing production config.');
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: PROJECT, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  try {
    stage = 'account identity and saved work';
    const setup = (await db.doc(`onboarding/${uid}`).get()).data();
    assert(setup?.gscProperty === property && setup.isComplete === true, 'Account scope differs.');
    const preserved = (await db.collection('pageReviewPlans').where('userId', '==', uid).get()).docs;
    const work = (await db.collection('implementedSeoTips').where('userId', '==', uid).get()).docs;
    const history = (await db.collection('users').doc(uid).collection('revampHistory').get()).docs;
    const snapshots = [...preserved, ...work, ...history];
    for (const record of history) snapshots.push(...(await record.ref.collection('records').get()).docs);
    const beforePublications = (await db.collection('newPagePublications').where('userId', '==', uid).get()).docs;
    const beforeUsage = (await db.collection('aiUsageEvents').where('userId', '==', uid).get()).docs;
    stage = 'authorized API session';
    const customToken = await app.auth().createCustomToken(uid);
    const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(15000) });
    const authentication = await authResponse.json();
    assert(authResponse.ok && authentication.idToken, 'Could not establish owner verification session.');
    const request = async (path = '', method = 'GET', body, authorized = true) => {
      const response = await fetch(`${ORIGIN}${path.startsWith('/api/') ? path : `/api/new-page-plans${path}`}`, { method,
        headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${authentication.idToken}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(65000) });
      return { status: response.status, cache: response.headers.get('cache-control'), data: await response.json() };
    };
    stage = 'authentication boundaries';
    const protectedPaths = ['', '/context', '/inventory', '/areas', '/analyze', '/select', '/draft', '/plan', '/publish', '/tracking'];
    for (const path of protectedPaths) {
      const method = path === '' ? 'GET' : path === '/plan' ? 'PATCH' : 'POST';
      assert((await request(path, method, method === 'GET' ? undefined : {}, false)).status === 401, 'Anonymous API access was not blocked.');
      const other = method === 'GET' ? await request('?userId=release-other-owner') : await request(path, method, { userId: 'release-other-owner' });
      assert(other.status === 403, 'Cross-account access was not blocked.');
    }
    for (const path of ['/api/generic-keywords/analyze', '/api/generic-keywords/content-outline', '/api/generic-keywords/keyword-analysis', '/api/content-opportunities/mark-created', '/api/content-opportunities/skip']) {
      assert((await request(path, 'POST', {})).status === 410, 'Legacy write route still active.');
    }
    stage = 'saved workspace and optional inventory';
    const first = await request(); assert(first.status === 200 && /no-store/.test(first.cache || ''), 'Saved workspace unavailable or cacheable.');
    assert(first.data.enabled === true, 'New-page generation is unexpectedly paused.');
    const initialContext = JSON.stringify(first.data.context), initialPlans = JSON.stringify(first.data.plans);
    let batches = 0, inventory = first.data.inventory;
    if (flags.includes('--inventory')) {
      do {
        const result = await request('/inventory', 'POST', { restart: flags.includes('--restart-inventory') && batches === 0 }); assert(result.status === 200, 'Inventory continuation failed.');
        inventory = result.data.inventory; batches++;
        assert(inventory.coverage.discovered <= 500 && inventory.coverage.fetched <= 100, 'Inventory bounds exceeded.');
        if (!inventory.canContinue) break;
      } while (batches < 8);
      assert(!inventory.canContinue, 'Inventory still requires continuation.');
    }
    const reloaded = await request(); assert(reloaded.status === 200, 'Saved workspace reload failed.');
    assert(JSON.stringify(reloaded.data.context) === initialContext && JSON.stringify(reloaded.data.plans) === initialPlans, 'Discovery altered owner planning work.');
    for (const snapshot of snapshots) {
      const after = await snapshot.ref.get(); assert(after.exists && after.updateTime.isEqual(snapshot.updateTime), 'Existing-page work or archive changed.');
    }
    const afterPublications = (await db.collection('newPagePublications').where('userId', '==', uid).get()).docs;
    const afterUsage = (await db.collection('aiUsageEvents').where('userId', '==', uid).get()).docs;
    assert(beforePublications.length === afterPublications.length, 'Publication count changed.');
    assert(beforeUsage.length === afterUsage.length, 'AI was called during saved read/discovery.');
    console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), origin: ORIGIN, authChecks: protectedPaths.length, crossAccountChecks: protectedPaths.length,
      retiredWrites: 5, savedPlansPreserved: preserved.length, existingRecordsPreserved: snapshots.length,
      newPublicationsCreated: 0, aiCallsDuringCheck: 0, generationEnabled: first.data.enabled, ownerContextConfirmed: Boolean(reloaded.data.context?.confirmed), inventoryBatches: batches,
      suggestedServices: reloaded.data.business?.services || [],
      inventory: inventory && { status: inventory.status, coverage: inventory.coverage, pages: inventory.pages.map(page => ({ url: page.url, status: page.status, reason: page.reason || null })) },
      nextCheckpoint: 'Owner reviews actual service/area and coverage; do not confirm publication.' }, null, 2));
  } finally { await app.delete(); }
}
main().catch(() => { console.error(`New-page release verification failed during ${stage}. Provider details and credentials are not printed.`); process.exit(1); });
