require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
(async () => {
  if (admin.app().options.credential.projectId !== 'simpleseo-90570') throw new Error('Unexpected Firebase project.');
  const snapshots = await admin.firestore().collection('onboarding').get();
  for (const snapshot of snapshots.docs) {
    const data = snapshot.data();
    let host; try { host = new URL(/^https?:/.test(data.websiteUrl || "") ? data.websiteUrl : `https://${data.websiteUrl}`).hostname.replace(/^www\./, ''); } catch { continue; }
    if (!['bryandevelops.com', 'briandevelops.com'].includes(host)) continue;
    const user = await admin.auth().getUser(snapshot.id);
    const connection = (await admin.firestore().collection('users').doc(snapshot.id).get()).data() || {};
    const legacy = (await admin.firestore().collection('gscTokens').doc(snapshot.id).get()).data() || {};
    console.log(JSON.stringify({ uid: snapshot.id, authUserExists: !!user.uid, disabled: user.disabled, websiteUrl: data.websiteUrl, property: data.gscProperty, primaryProperty: connection.gscSiteUrl || null, legacyProperty: legacy.siteUrl || null, hasPrimaryRefresh: !!connection.gscRefreshToken, hasLegacyRefresh: !!legacy.refreshToken, revampStatus: data.revampStatus, revampStep: data.revampStep, pageCount: data.revampPages?.length || 0, onboardingComplete: data.isComplete }));
  }
  await admin.app().delete();
})().catch(e => { console.error(e.message); process.exit(1); });
