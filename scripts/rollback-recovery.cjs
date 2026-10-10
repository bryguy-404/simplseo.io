const fs = require('node:fs');
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const [filename, mode] = process.argv.slice(2);
if (!filename) throw new Error('Provide the protected recovery backup path. Dry-run by default; --apply to restore.');
const backup = JSON.parse(fs.readFileSync(filename));
if (backup.project !== 'simpleseo-90570' || process.env.FIREBASE_PROJECT_ID !== backup.project) throw new Error('Unexpected project.');
admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
(async () => {
  const ref = admin.firestore().collection('onboarding').doc(backup.uid);
  const fields = Object.keys(backup.patch).filter(k => k !== 'progressReviewRequired');
  await admin.firestore().runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    for (const key of fields) if (JSON.stringify(current[key]) !== JSON.stringify(backup.patch[key])) throw new Error(`Newer change to ${key}; automatic rollback stopped.`);
    const restore = Object.fromEntries(fields.map(key => [key, backup.before[key] === undefined ? admin.firestore.FieldValue.delete() : backup.before[key]]));
    restore.progressReviewRequired = true;
    if (mode === '--apply') tx.update(ref, restore);
  });
  console.log(JSON.stringify({ uid: backup.uid, mode: mode === '--apply' ? 'applied' : 'dry-run', fields, outcomeProcessingRemainsPaused: true }));
  await admin.app().delete();
})().catch(e => { console.error(e.message); process.exit(1); });
