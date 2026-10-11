// Read private operational evidence for the existing pilot account. The optional
// flag invokes the two normal collectors manually; it never impersonates cron,
// generates an AI review, publishes an edit, or confirms a task.
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const ORIGIN = 'https://simplseo-io.vercel.app';
const PROJECT = 'simpleseo-90570';
const [uid, property, ...flags] = process.argv.slice(2);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
let stage = 'configuration';

async function main() {
  assert(/^[\w-]{1,128}$/.test(uid || '') && property && flags.every(flag => flag === '--run-collectors') && flags.length <= 1, 'Provide UID, exact property and optional --run-collectors.');
  assert(process.env.FIREBASE_PROJECT_ID === PROJECT && !process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Existing production configuration is required.');
  const app = admin.initializeApp({ credential: admin.credential.cert({ projectId: PROJECT, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  const db = app.firestore();
  try {
    stage = 'account identity';
    const setup = (await db.doc(`onboarding/${uid}`).get()).data();
    assert(setup?.gscProperty === property && setup.isComplete === true && setup.revampStatus === 'complete' && setup.progressReviewRequired === false, 'Pilot identity or recovery state differs.');
    const plans = await db.collection('pageReviewPlans').where('userId', '==', uid).get();
    const work = await db.collection('implementedSeoTips').where('userId', '==', uid).get();
    const history = await db.collection('users').doc(uid).collection('revampHistory').get();
    const archives = [...work.docs.filter(doc => doc.data().preRevampArchived), ...history.docs];
    for (const run of history.docs) archives.push(...(await run.ref.collection('records').get()).docs);
    const activeIds = work.docs.filter(doc => !doc.data().preRevampArchived && doc.data().status === 'implemented').map(doc => doc.id).sort();
    const manualChecks = [];
    if (flags.includes('--run-collectors')) {
      assert(process.env.CRON_SECRET, 'Cron verification credential is unavailable.');
      for (const [job, path] of [['progress', 'check-success-stories'], ['website-monitoring', 'check-revamp-gsc']]) {
        stage = `${job} manual verification`;
        const anonymous = await fetch(`${ORIGIN}/api/cron/${path}`, { signal: AbortSignal.timeout(15000) });
        assert(anonymous.status === 401, 'Unauthenticated collector was not blocked.');
        const response = await fetch(`${ORIGIN}/api/cron/${path}`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(240000) });
        const result = await response.json();
        assert(response.ok && result.collectionRun?.trigger === 'authenticated_request' && result.notificationsSent === 0, 'Collector verification or safeguards failed.');
        if (job === 'progress') assert(result.automaticOutcomesEnabled === false && result.strategiesSaved === 0, 'Automatic outcomes must remain off.');
        manualChecks.push({ job, httpStatus: response.status, ...result.collectionRun, checked: result.checked, pagesChecked: result.pagesChecked, counts: result.counts, moreRecords: result.moreRecords, notificationsSent: result.notificationsSent });
      }
    }
    stage = 'saved work preservation';
    for (const previous of [...plans.docs, ...archives]) {
      const current = await previous.ref.get();
      assert(current.exists && current.updateTime.isEqual(previous.updateTime), 'Saved work or historical records changed during the check.');
    }
    const afterPlans = await db.collection('pageReviewPlans').where('userId', '==', uid).get();
    assert(JSON.stringify(afterPlans.docs.map(doc => doc.id).sort()) === JSON.stringify(plans.docs.map(doc => doc.id).sort()), 'Saved plan inventory changed.');
    const afterWork = await db.collection('implementedSeoTips').where('userId', '==', uid).get();
    assert(JSON.stringify(afterWork.docs.filter(doc => !doc.data().preRevampArchived && doc.data().status === 'implemented').map(doc => doc.id).sort()) === JSON.stringify(activeIds), 'Published change inventory changed.');
    const currentSetup = (await db.doc(`onboarding/${uid}`).get()).data();
    assert(currentSetup?.gscProperty === property && currentSetup.revampRunId === setup.revampRunId, 'Website identity changed during verification.');
    stage = 'operational evidence';
    const runs = await db.collection('cronRuns').get();
    const recentRuns = runs.docs.map(doc => doc.data()).filter(run => Date.parse(run.startedAt) >= Date.now() - 3 * 86400000).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const usage = await db.collection('aiUsageEvents').where('userId', '==', uid).limit(100).get();
    const safeUsage = usage.docs.map(doc => doc.data()).map(item => ({ startedAt: item.startedAt, stage: item.stage, providerOutcome: item.providerOutcome, usageStatus: item.usageStatus, inputTokens: item.inputTokens, outputTokens: item.outputTokens, cachedInputTokens: item.cachedInputTokens, webSearchCalls: item.webSearchCalls, model: item.model }));
    console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), activePublishedChanges: activeIds.length, savedPlansPreserved: plans.size, archivedDocumentsPreserved: archives.length, manualChecks, recentRuns, scheduledEvidenceNote: 'A cron user-agent record must be correlated with the provider execution log; a manual probe never proves scheduled execution.', usageSampleLimit: 100, usageEvents: safeUsage }, null, 2));
  } finally { await app.delete(); }
}
main().catch(() => { console.error(`Pilot verification failed during ${stage}. No credentials or provider payloads are printed.`); process.exit(1); });
