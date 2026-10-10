import { beforeEach, afterEach, vi } from 'vitest';
// Unit and API tests cannot make accidental paid/production requests.
process.env.SIMPLESEO_TEST_MODE = '1';
process.env.FIREBASE_PROJECT_ID = 'demo-simpleseo';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected outbound request in test'); })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
