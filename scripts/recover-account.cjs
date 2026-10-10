// Explicit identity, dry-run by default. Protected backups are mandatory before --apply.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: '.env.local', quiet: true });
const admin = require('firebase-admin');
const [uid, expectedProperty, ...flags] = process.argv.slice(2);
if (!uid || !expectedProperty) throw new Error('Usage: node scripts/recover-account.cjs UID PROPERTY [--apply]');
if (process.env.FIREBASE_PROJECT_ID !== 'simpleseo-90570') throw new Error('Unexpected project.');
admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
const db = admin.firestore();
const clean = value => {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object' || value.toDate) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|credential|password/i.test(key)).map(([k, v]) => [k, clean(v)]));
};
(async () => {
  const user = await admin.auth().getUser(uid);
  if (user.disabled) throw new Error('Account is disabled.');
  const ref = db.collection('onboarding').doc(uid);
  const onboarding = await ref.get();
  const before = onboarding.data();
  if (!before?.isComplete || before.gscProperty !== expectedProperty) throw new Error('Account/property did not match the verified recovery target.');
  const connection = (await db.collection('users').doc(uid).get()).data() || {};
  if (connection.gscSiteUrl && connection.gscSiteUrl !== expectedProperty) throw new Error('Connection property mismatch.');
  const runId = before.revampRunId || `recovery-${crypto.createHash('sha256').update(uid + (before.revampInitiatedAt || before.revampDate || '')).digest('hex').slice(0, 20)}`;
  const patch = { revampRunId: runId, revampSchemaVersion: 2, revampStatus: 'complete', revampStep: 'complete', postOnboardingStep: 'complete', revampMonitoringEnabled: true, progressReviewRequired: true };
  console.log(JSON.stringify({ project: process.env.FIREBASE_PROJECT_ID, uid, property: expectedProperty, mode: flags.includes('--apply') ? 'apply' : 'dry-run', patch }));
  if (!flags.includes('--apply')) { await admin.app().delete(); return; }
  const backupRoot = process.env.RECOVERY_BACKUP_DIR;
  if (!backupRoot || !path.isAbsolute(backupRoot) || backupRoot.startsWith(process.cwd() + path.sep)) throw new Error('Set RECOVERY_BACKUP_DIR to an absolute protected directory outside the repository.');
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(backupRoot, 0o700);
  const all = new Map();
  async function capture(doc) {
    if (!doc.exists || all.has(doc.ref.path)) return;
    all.set(doc.ref.path, { path: doc.ref.path, data: doc.data(), updateTime: doc.updateTime.toDate().toISOString() });
    for (const sub of await doc.ref.listCollections()) for (const nested of (await sub.get()).docs) await capture(nested);
  }
  for (const collection of ['onboarding','users','gscTokens','focusKeywords','siteCrawls','pageContentCache']) await capture(await db.collection(collection).doc(uid).get());
  const sources = [];
  for (const name of ['implementedSeoTips','contentAuditResults','aiSuggestions','pageContentCache']) {
    for (const doc of (await db.collection(name).where('userId','==',uid).get()).docs) {
      await capture(doc); if (name !== 'pageContentCache') sources.push({ name, doc });
    }
  }
  const focus = await db.collection('focusKeywords').doc(uid).get();
  if (focus.exists) sources.push({ name: 'focusKeywords', doc: focus });
  const backupPath = path.join(backupRoot, `${uid}-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ project: process.env.FIREBASE_PROJECT_ID, uid, capturedAt: new Date().toISOString(), before, patch, records: [...all.values()] }, null, 2), { mode: 0o600, flag: 'wx' });
  const verified = JSON.parse(fs.readFileSync(backupPath));
  if (verified.records.length !== all.size) throw new Error('Backup verification failed.');
  const historyRef = db.collection('users').doc(uid).collection('revampHistory').doc(runId);
  if (!(await historyRef.get()).data()?.complete) {
    await historyRef.set({ runId, complete: false, historicalMetrics: 'unverified' }, { merge: true });
    for (const { name, doc } of sources) {
      const target = historyRef.collection('records').doc(`${name}_${doc.id}`);
      await db.runTransaction(async tx => { if (!(await tx.get(target)).exists) tx.create(target, { collection: name, sourceId: doc.id, data: clean(doc.data()) }); });
    }
    await historyRef.set({ complete: true, completedAt: new Date().toISOString() }, { merge: true });
  }
  await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    if (!latest.updateTime.isEqual(onboarding.updateTime)) throw new Error('Account changed since backup. Re-run to preserve newer data.');
    tx.update(ref, patch);
  });
  console.log(JSON.stringify({ recovered: true, backupPath, preservedRecords: all.size, historyRecords: sources.length }));
  await admin.app().delete();
})().catch(e => { console.error(e.message); process.exit(1); });
