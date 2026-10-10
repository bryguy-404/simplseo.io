require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const [origin, uid, property] = process.argv.slice(2);
if (origin !== 'https://simplseo-io.vercel.app' || !uid || !property) throw new Error('Provide the verified production origin, UID and property.');
if (process.env.FIREBASE_PROJECT_ID !== 'simpleseo-90570') throw new Error('Unexpected Firebase project.');
admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
(async () => {
  const onboarding = (await admin.firestore().collection('onboarding').doc(uid).get()).data();
  if (onboarding.gscProperty !== property) throw new Error('Property mismatch.');
  const customToken = await admin.auth().createCustomToken(uid);
  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) });
  const session = await signIn.json();
  if (!session.idToken || session.localId !== uid) throw new Error('Could not create the temporary verification session.');
  const headers = { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' };
  for (const endpoint of ['revamp/complete', 'revamp/check-gsc', 'account/delete', 'focus-keywords']) {
    const res = await fetch(`${origin}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid }) });
    if (res.status !== 401) throw new Error(`Unauthorized ${endpoint} returned ${res.status}`);
  }
  const history = await fetch(`${origin}/api/revamp/history`, { headers });
  const histories = await history.json();
  if (!history.ok || !histories.runs?.length) throw new Error('Recovery history verification failed.');
  const check = await fetch(`${origin}/api/revamp/check-gsc`, { method: 'POST', headers, body: JSON.stringify({ userId: uid }) });
  const result = await check.json();
  if (!check.ok) throw new Error(`Monitoring request failed with ${check.status}`);
  const after = (await admin.firestore().collection('onboarding').doc(uid).get()).data();
  console.log(JSON.stringify({ authenticatedCheck: check.status, connectionStatus: result.connectionStatus, monitoredPages: result.pages?.length, pagesWithSearchData: result.pages?.filter(p => p.searchDataStatus === 'has_data').length, pagesWithoutData: result.pages?.filter(p => p.searchDataStatus === 'no_data').length, pageErrors: result.pages?.filter(p => p.lastError).length, historySnapshots: histories.runs.length, revampStatus: after.revampStatus, monitoringEnabled: after.revampMonitoringEnabled, progressPaused: after.progressReviewRequired, lastCheckedAt: after.revampLastCheckedAt }));
  const cron = await fetch(`${origin}/api/cron/check-revamp-gsc`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  const cronResult = await cron.json();
  console.log(JSON.stringify({ cronStatus: cron.status, usersChecked: cronResult.results?.length, recoveryAccountChecked: cronResult.results?.some(r => r.userId === uid && !r.error) || false }));
  if (!cron.ok) throw new Error('Scheduled-route verification failed.');
  await admin.app().delete();
})().catch(e => { console.error(e.message); process.exit(1); });
