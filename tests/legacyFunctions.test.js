import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { fakeFirestore } from './fakeFirestore';
function load(db) {
  const exported = {};
  const schedule = { schedule: () => schedule, timeZone: () => schedule, onRun: fn => fn };
  vm.runInNewContext(fs.readFileSync('functions/index.js', 'utf8'), {
    exports: exported, console: { log() {}, error() {} },
    require: name => {
      if (name === 'firebase-functions') return { https: { onRequest: fn => fn } };
      if (name.includes('pubsub')) return schedule;
      if (name === 'firebase-admin') return { initializeApp() {}, firestore: () => db };
      if (name === 'node-fetch') return () => { throw Error('Unexpected network request'); };
      throw Error(`Unexpected dependency ${name}`);
    },
  });
  return exported;
}
it('all retired maintenance functions return 410 without reading or changing records', async () => {
  const db = { collection: vi.fn(() => { throw Error('No data access allowed'); }) };
  const handlers = load(db);
  for (const name of ['updateAllMissingPostStats','updateDocumentWithGscData','listImplementedSeoTips','testPostStatsUpdate']) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handlers[name]({}, res);
    expect(res.status).toHaveBeenCalledWith(410);
  }
  expect(db.collection).not.toHaveBeenCalled();
});
it('scheduled progress skips archived and recovery-account work without replacing statistics', async () => {
  const { db, records } = fakeFirestore();
  await db.collection('onboarding').doc('alice').set({ progressReviewRequired: true });
  await db.collection('implementedSeoTips').doc('tip').set({ userId: 'alice', status: 'implemented', implementedAt: '2025-01-01', pageUrl: 'https://example.test', preStats: { clicks: 10 }, postStats: { clicks: 12 } });
  const before = structuredClone(records.get('implementedSeoTips/tip'));
  await load(db).checkSeoTipProgress({});
  expect(records.get('implementedSeoTips/tip')).toEqual(before);
});
