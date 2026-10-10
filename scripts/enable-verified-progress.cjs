// Enable only the sourced comparison collector after the Phase 2 release.
// No legacy work is reactivated; automated outcomes remain disabled in code.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const [uid, property, runId, ...flags] = process.argv.slice(2);
if (!uid || !property || !runId || process.env.FIREBASE_PROJECT_ID !== 'simpleseo-90570') throw new Error('Provide verified UID, property and recovery run for the existing production project.');
admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
(async () => {
  const db = admin.firestore();
  const user = await admin.auth().getUser(uid);
  if (user.disabled) throw new Error('Account is disabled.');
  const ref = db.collection('onboarding').doc(uid);
  const snapshot = await ref.get();
  const before = snapshot.data();
  const historyRef = db.collection('users').doc(uid).collection('revampHistory').doc(runId);
  const history = await historyRef.get();
  const connection = (await db.collection('users').doc(uid).get()).data();
  function verify(data, historical, credentials) {
    if (!data?.isComplete || data.revampStatus !== 'complete' || data.revampArchivePending || data.revampRunId !== runId
      || data.gscProperty !== property || credentials?.gscSiteUrl !== property || historical?.complete !== true) throw new Error('Account/property/run/history no longer match the verified recovery.');
  }
  verify(before, history.data(), connection);
  if (!before.progressReviewRequired) { console.log(JSON.stringify({ alreadyEnabled: true, accountChanged: false })); await admin.app().delete(); return; }
  const patch = { progressReviewRequired: false };
  console.log(JSON.stringify({ mode: flags.includes('--apply') ? 'apply' : 'dry-run', patch, automaticOutcomesEnabled: false }));
  if (!flags.includes('--apply')) { await admin.app().delete(); return; }
  const backupDir = process.env.PROGRESS_BACKUP_DIR;
  if (!backupDir || !path.isAbsolute(backupDir) || path.resolve(backupDir).startsWith(process.cwd() + path.sep)) throw new Error('Set PROGRESS_BACKUP_DIR outside the repository.');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupDir, 0o700);
  const backupPath = path.join(backupDir, `${uid}-progress-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ project: process.env.FIREBASE_PROJECT_ID, uid, property, runId, before, patch, updateTime: snapshot.updateTime.toDate().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' });
  if (JSON.parse(fs.readFileSync(backupPath)).before.progressReviewRequired !== true) throw new Error('Backup verification failed.');
  await db.runTransaction(async tx => {
    const [current, savedHistory, currentConnection] = await Promise.all([tx.get(ref), tx.get(historyRef), tx.get(db.collection('users').doc(uid))]);
    verify(current.data(), savedHistory.data(), currentConnection.data());
    if (!current.updateTime.isEqual(snapshot.updateTime)) throw new Error('Account changed since backup. Retry with a fresh backup.');
    tx.update(ref, patch);
  });
  console.log(JSON.stringify({ enabled: true, backupPath, automaticOutcomesEnabled: false }));
  await admin.app().delete();
})().catch(error => { console.error(error.message); process.exit(1); });
