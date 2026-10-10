import admin from 'firebase-admin';

const testing = process.env.SIMPLESEO_TEST_MODE === '1';
if (testing && (process.env.FIREBASE_PROJECT_ID !== 'demo-simpleseo' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099')) {
  throw new Error('Tests may only use the local demo Firebase emulators.');
}
if (!admin.apps.length) {
  admin.initializeApp(testing ? { projectId: 'demo-simpleseo' } : {
    credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }),
  });
}
const db = admin.firestore();
const auth = admin.auth();
export { db, admin, auth };
