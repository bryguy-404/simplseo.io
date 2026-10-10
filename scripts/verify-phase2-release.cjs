// Verify only this existing deployment and exact account; never log credentials.
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const [origin, uid, property, expectedState, ...flags] = process.argv.slice(2);
if (origin !== 'https://simplseo-io.vercel.app' || !uid || !property || !['paused', 'active'].includes(expectedState) || process.env.FIREBASE_PROJECT_ID !== 'simpleseo-90570') throw new Error('Provide verified production origin, UID, property and expected state (paused or active).');
admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
(async () => {
  const setup = (await admin.firestore().doc(`onboarding/${uid}`).get()).data();
  if (setup.gscProperty !== property || setup.revampStatus !== 'complete') throw new Error('Account mismatch.');
  const implementations = await admin.firestore().collection('implementedSeoTips').where('userId', '==', uid).get();
  const activeIds = implementations.docs.filter(doc => !doc.data().preRevampArchived && doc.data().status === 'implemented').map(doc => doc.id).sort();
  const archived = implementations.docs.filter(doc => doc.data().preRevampArchived);
  function verifyProgress(data) {
    if (data.source !== 'google_search_console' || data.property !== property || data.paused !== (expectedState === 'paused')
      || data.automaticOutcomesEnabled !== false || data.notificationsEnabled !== false
      || JSON.stringify(data.records?.map(record => record.id).sort()) !== JSON.stringify(activeIds)) throw new Error('Progress identity, pause, ownership or outcome safeguards failed.');
  }
  const customToken = await admin.auth().createCustomToken(uid);
  const signin = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) });
  const session = await signin.json();
  if (!session.idToken || (await admin.auth().verifyIdToken(session.idToken)).uid !== uid) throw new Error('Verification login failed.');
  const headers = { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' };
  let blocked = 0;
  for (const endpoint of ['gsc/page-metrics','gsc/page-keywords','gsc/fetch-keywords','gsc/refresh-token','seo-assistant/meta-title','content-audit','conversations','progress']) {
    const response = await fetch(`${origin}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (response.status !== 401) throw new Error(`Anonymous ${endpoint}: ${response.status}`);
    blocked++;
  }
  const response = await fetch(`${origin}/api/progress`, { headers });
  const progress = await response.json();
  if (!response.ok) throw new Error('Progress verification failed.');
  verifyProgress(progress);
  const otherUser = await fetch(`${origin}/api/progress?userId=phase2-not-this-account`, { headers });
  if (otherUser.status !== 403) throw new Error('Cross-account progress request was not rejected.');
  const anonymousAdmin = await fetch(`${origin}/api/admin/approve`);
  const ownAdmin = await fetch(`${origin}/api/admin/approve`, { headers });
  if (anonymousAdmin.status !== 401 || ownAdmin.status !== 200) throw new Error('Administrator access verification failed.');
  const anonymousCron = await fetch(`${origin}/api/cron/check-success-stories`);
  if (anonymousCron.status !== 401) throw new Error('Anonymous cron request was not rejected.');
  const history = await fetch(`${origin}/api/revamp/history`, { headers });
  if (!history.ok || !(await history.json()).runs?.length) throw new Error('History verification failed.');
  const metrics = await fetch(`${origin}/api/gsc/page-metrics`, { method: 'POST', headers, body: JSON.stringify({ pageUrl: property }) });
  const observation = await metrics.json();
  if (!metrics.ok || observation.source !== 'google_search_console' || observation.property !== property || !observation.startDate || !observation.endDate) throw new Error(`Google observation failed: ${metrics.status}`);
  const refresh = await fetch(`${origin}/api/progress`, { method: 'POST', headers });
  const refreshed = await refresh.json();
  if (!refresh.ok) throw new Error(`Progress refresh failed: ${refresh.status}`);
  verifyProgress(refreshed);
  let cronResult;
  if (flags.includes('--cron')) {
    if (!process.env.CRON_SECRET) throw new Error('Cron verification secret is unavailable.');
    const cron = await fetch(`${origin}/api/cron/check-success-stories`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    cronResult = await cron.json();
    if (!cron.ok || cronResult.success !== true || cronResult.notificationsSent !== 0 || cronResult.strategiesSaved !== 0 || cronResult.automaticOutcomesEnabled !== false) throw new Error(`Cron safeguards failed: ${cron.status}`);
  }
  for (const prior of archived) {
    const after = await prior.ref.get();
    if (!after.exists || !after.updateTime.isEqual(prior.updateTime)) throw new Error('Archived implementation changed during verification.');
  }
  console.log(JSON.stringify({ unauthorizedRoutesBlocked: blocked, progressStatus: response.status, paused: progress.paused, activeChanges: progress.records.length, automaticOutcomesEnabled: progress.automaticOutcomesEnabled, notificationsEnabled: progress.notificationsEnabled,
    observationStatus: metrics.status, observationWindow: { startDate: observation.startDate, endDate: observation.endDate }, searchDataStatus: observation.status, progressRefreshStatus: refresh.status, checked: refreshed.checked, historyAvailable: true,
    crossAccountRejected: true, administratorVerified: true, cronAnonymousRejected: true, archivedImplementationsUnchanged: archived.length,
    ...(cronResult ? { manualCron: { checked: cronResult.checked, counts: cronResult.counts, notificationsSent: cronResult.notificationsSent, strategiesSaved: cronResult.strategiesSaved, automaticOutcomesEnabled: cronResult.automaticOutcomesEnabled } } : {}) }));
  await admin.app().delete();
})().catch(error => { console.error(error.message); process.exit(1); });
