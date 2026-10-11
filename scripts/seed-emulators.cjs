Object.assign(process.env, require('./emulator-env.cjs'));
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-simpleseo' });
(async () => {
  for (const uid of ['recovery-alice', 'other-bob']) {
    try { await admin.auth().createUser({ uid, email: `${uid}@example.test`, password: 'Test-only-pass123!' }); } catch (e) { if (e.code !== 'auth/uid-already-exists' && e.code !== 'auth/email-already-exists') throw e; }
    // Modern saved-work readers also require the authoritative account root.
    await admin.firestore().collection('users').doc(uid).set({ email: `${uid}@example.test`, gscSiteUrl: 'sc-domain:example.test' }, { merge: true });
    await admin.firestore().collection('onboarding').doc(uid).set({ name: uid, websiteUrl: 'https://example.test', gscProperty: 'sc-domain:example.test', isComplete: true, hasGSC: false, postOnboardingStep: 'complete', revampStatus: 'in-progress', revampStep: 'waiting', revampDate: '2026-01-01', revampRunId: 'fixture-run', revampMonitoringEnabled: true, progressReviewRequired: true, revampPages: [{ url: 'https://example.test/Service?city=A', discovered: false, impressions: 0 }] });
    await admin.firestore().collection('focusKeywords').doc(uid).set({ userId: uid, keywords: [{ keyword: 'old saved keyword', pageUrl: 'https://example.test/old' }], preRevampArchived: true });
    await admin.firestore().collection('implementedSeoTips').doc(`${uid}_old`).set({ userId: uid, pageUrl: 'https://example.test/old', title: 'Old website work', preRevampArchived: true, preStats: { impressions: 20 }, gscToken: 'must-not-appear-in-history' });
  }
  console.log('Seeded two demo accounts in local emulators.');
  await admin.app().delete();
})().catch(() => { console.error('Could not seed demo emulators.'); process.exit(1); });
