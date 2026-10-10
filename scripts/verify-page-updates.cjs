// Explicit live check for the authorized account's existing homepage plan.
// May run one fresh review if its inputs changed, then one unchanged check.
// Never confirms work, changes task statuses, or prints credentials.
// Usage: node scripts/verify-page-updates.cjs <uid> <exact-homepage-property>
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');
const ORIGIN = 'https://simplseo-io.vercel.app';
class VerificationFailure extends Error {}
const assert = (condition, message) => { if (!condition) throw new VerificationFailure(message); };
const digest = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
let stage = 'configuration';

async function main() {
  const [uid, property, ...extra] = process.argv.slice(2);
  assert(/^[A-Za-z0-9_-]{1,128}$/.test(uid || '') && !extra.length, 'Provide one exact account and homepage property.');
  const url = new URL(property);
  assert(url.protocol === 'https:' && url.href === property && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && !url.port,
    'Use the exact HTTPS homepage URL-prefix property.');
  assert(process.env.FIREBASE_PROJECT_ID === 'simpleseo-90570' && !process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST,
    'Use only the existing production project for this explicit live check.');
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  let before;
  let planId;
  const outcomes = [];
  async function snapshot() {
    const [setup, plans, work, runs] = await Promise.all([
      db.doc(`onboarding/${uid}`).get(), db.collection('pageReviewPlans').where('userId', '==', uid).get(),
      db.collection('implementedSeoTips').where('userId', '==', uid).get(), db.collection('users').doc(uid).collection('revampHistory').get(),
    ]);
    const archived = await Promise.all(runs.docs.map(run => run.ref.collection('records').get()));
    const allWork = [...work.docs, ...runs.docs, ...archived.flatMap(result => result.docs)];
    return { setup: setup.data(), plans: new Map(plans.docs.map(doc => [doc.id, doc.data()])),
      work: allWork.map(doc => [doc.ref.path, digest(doc.data())]).sort(([a], [b]) => a.localeCompare(b)) };
  }
  async function quota(keys) {
    const rawKeys = keys || [{ name: 'page-review-minute', duration: 60000 }, { name: 'page-review-day', duration: 86400000 }]
      .flatMap(({ name, duration }) => [0, 1].map(offset => createHash('sha256').update(`${name}:${uid}:${Math.floor(Date.now() / duration) + offset}`).digest('hex')));
    return Promise.all(rawKeys.map(async id => { const doc = await db.doc(`requestLimits/${id}`).get(); return [id, doc.data()?.count || 0]; }));
  }
  try {
    before = await snapshot();
    assert(before.setup?.isComplete && before.setup.gscProperty === property && !before.setup.revampArchivePending && before.setup.revampStatus !== 'in-progress', 'The account is not ready in the expected website scope.');
    const entries = [...before.plans].filter(([, plan]) => plan.pageUrl === property && plan.property === property && plan.websiteRunId === (before.setup.revampRunId || null));
    assert(entries.length === 1, 'Load an existing saved homepage plan before this check.');
    [planId] = entries[0];
    const customToken = await app.auth().createCustomToken(uid);
    const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const session = await login.json();
    assert(login.ok && session.idToken && (await app.auth().verifyIdToken(session.idToken)).uid === uid, 'Verification sign-in failed.');
    for (let attempt = 0; attempt < 2; attempt++) {
      stage = `update check ${attempt + 1}`;
      const saved = (await db.doc(`pageReviewPlans/${planId}`).get()).data();
      const quotaBefore = await quota();
      const response = await fetch(`${ORIGIN}/api/page-review/suggestions`, { method: 'POST',
        headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl: property, goal: saved.review.ownerGoal || '', focusKeywords: saved.review.updateBaseline?.focusKeywords || [] }),
        signal: AbortSignal.timeout(175000), redirect: 'error' });
      assert(response.ok && response.headers.get('cache-control') === 'private, no-store', 'The live update check failed or returned cacheable private data.');
      const result = await response.json();
      assert(['unchanged', 'incomplete', 'updated'].includes(result.updateCheck?.status), 'The live response lacks a supported update status.');
      const afterPlan = (await db.doc(`pageReviewPlans/${planId}`).get()).data();
      assert(result.plan?.id === planId && result.plan.property === property && result.plan.pageUrl === property
        && result.plan.websiteRunId === saved.websiteRunId && result.plan.revision === afterPlan.revision
        && digest(result.plan.tasks) === digest(afterPlan.tasks), 'The response and saved plan do not agree.');
      if (result.updateCheck.status !== 'updated') {
        assert(digest(saved) === digest(afterPlan), 'A reuse response changed the saved plan.');
        const quotaAfter = new Map(await quota(quotaBefore.map(([id]) => id)));
        assert(quotaBefore.every(([key, count]) => !quotaAfter.has(key) || quotaAfter.get(key) === count), 'Reusing a plan consumed the paid review quota.');
      }
      outcomes.push({ status: result.updateCheck.status, savedPlanRevision: afterPlan.revision, taskCount: afterPlan.tasks.length,
        planUnchanged: digest(saved) === digest(afterPlan), generatedAtPreserved: saved.review.provenance.generatedAt === result.provenance.generatedAt });
      if (result.updateCheck.status !== 'updated') break;
      assert(attempt === 0, 'A second immediate check generated another review.');
    }
    assert(outcomes.at(-1)?.status === 'unchanged', 'The live check could not establish unchanged inputs; the saved plan remains available.');
  } finally {
    try {
      if (before) {
        const after = await snapshot();
        assert(after.setup.gscProperty === before.setup.gscProperty && after.setup.revampRunId === before.setup.revampRunId, 'Website scope changed during verification.');
        assert(digest(before.work) === digest(after.work), 'Published work or archived history changed.');
        for (const [id, plan] of before.plans) {
          if (id !== planId) assert(digest(plan) === digest(after.plans.get(id)), 'A different page plan changed.');
          else for (const task of plan.tasks.filter(item => ['done', 'dismissed'].includes(item.status))) {
            const retained = after.plans.get(id)?.tasks.find(item => item.id === task.id);
            assert(retained?.status === task.status && digest(retained.publication) === digest(task.publication), 'An existing task status or publication changed.');
          }
        }
      }
    } finally { await app.delete(); }
  }
  console.log(JSON.stringify({ outcomes, publishedWorkAndHistoryUnchanged: true, authorizedConfirmationAttempted: false }));
}
main().catch(error => {
  console.error(JSON.stringify({ verificationFailed: true, stage, error: error instanceof VerificationFailure ? error.message : 'Verification failed; credentials and response bodies were not logged.' }));
  process.exitCode = 1;
});
