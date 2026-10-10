// Verify only this existing deployment and exact account; never log credentials.
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const [origin, uid, property] = process.argv.slice(2);
if (origin !== 'https://simplseo-io.vercel.app' || !uid || !property || process.env.FIREBASE_PROJECT_ID !== 'simpleseo-90570') throw new Error('Provide verified production origin, UID and property.');
admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
(async () => {
  const setup = (await admin.firestore().doc(`onboarding/${uid}`).get()).data();
  if (setup.gscProperty !== property || setup.revampStatus !== 'complete') throw new Error('Account mismatch.');
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
  if (!response.ok || progress.source !== 'google_search_console' || progress.automaticOutcomesEnabled !== false || progress.notificationsEnabled !== false) throw new Error('Progress verification failed.');
  const history = await fetch(`${origin}/api/revamp/history`, { headers });
  if (!history.ok || !(await history.json()).runs?.length) throw new Error('History verification failed.');
  const metrics = await fetch(`${origin}/api/gsc/page-metrics`, { method: 'POST', headers, body: JSON.stringify({ pageUrl: property }) });
  const observation = await metrics.json();
  if (!metrics.ok || observation.source !== 'google_search_console' || observation.property !== property || !observation.startDate || !observation.endDate) throw new Error(`Google observation failed: ${metrics.status}`);
  const refresh = await fetch(`${origin}/api/progress`, { method: 'POST', headers });
  const refreshed = await refresh.json();
  if (!refresh.ok) throw new Error(`Progress refresh failed: ${refresh.status}`);
  console.log(JSON.stringify({ unauthorizedRoutesBlocked: blocked, progressStatus: response.status, paused: progress.paused, activeChanges: progress.records.length, automaticOutcomesEnabled: progress.automaticOutcomesEnabled, notificationsEnabled: progress.notificationsEnabled,
    observationStatus: metrics.status, observationWindow: { startDate: observation.startDate, endDate: observation.endDate }, searchDataStatus: observation.status, progressRefreshStatus: refresh.status, checked: refreshed.checked, historyAvailable: true }));
  await admin.app().delete();
})().catch(error => { console.error(error.message); process.exit(1); });
