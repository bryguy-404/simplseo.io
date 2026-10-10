// Shared fail-closed local configuration. No .env.local secrets are used for Firebase.
module.exports = {
  SIMPLESEO_TEST_MODE: '1', FIREBASE_PROJECT_ID: 'demo-simpleseo',
  GCLOUD_PROJECT: 'demo-simpleseo', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  NEXT_PUBLIC_SIMPLESEO_TEST_MODE: '1', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-simpleseo',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'localhost', NEXT_PUBLIC_FIREBASE_APP_ID: 'demo-app',
  NEXT_PUBLIC_BASE_URL: 'http://127.0.0.1:3100', GOOGLE_CLIENT_SECRET: 'test-only', OPENAI_API_KEY: 'test-only',
};
