import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: {} };
});
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { runTrackedCron } from '../app/lib/server/cronRun';

const now = new Date('2026-10-10T02:00:00Z');
const request = (token = 'test-secret', userAgent) => new Request('https://example.test/api/cron/job', {
  headers: { authorization: `Bearer ${token}`, ...(userAgent ? { 'user-agent': userAgent } : {}) },
});
const runRecords = () => [...records.entries()].filter(([path]) => path.startsWith('cronRuns/')).map(([, record]) => record);
beforeEach(() => { reset(); process.env.CRON_SECRET = 'test-secret'; });

it('fails closed before work or telemetry for missing and incorrect cron credentials', async () => {
  const collect = vi.fn();
  await expect(runTrackedCron(request('wrong', 'vercel-cron/1.0'), 'progress', collect, now)).rejects.toMatchObject({ status: 401 });
  delete process.env.CRON_SECRET;
  await expect(runTrackedCron(request(), 'progress', collect, now)).rejects.toMatchObject({ status: 401 });
  expect(collect).not.toHaveBeenCalled();
  expect(runRecords()).toEqual([]);
});

it('records an authenticated empty run without implying a publication or scheduler invocation', async () => {
  const collect = vi.fn(async () => {
    expect(runRecords()[0]).toMatchObject({ status: 'running', checked: null, finishedAt: null });
    return { checked: 0, counts: {}, notificationsSent: 0 };
  });
  const result = await runTrackedCron(request(), 'progress', collect, now);
  expect(result.collectionRun).toMatchObject({ status: 'completed', trigger: 'authenticated_request' });
  expect(runRecords()[0]).toMatchObject({ checked: 0, status: 'completed', counts: {}, notificationsSent: 0, invocationCount: 1 });
  expect(runRecords()[0].lastSuccessfulAt).toBeTruthy();
});

it('keeps scheduler-header and manual evidence separate, sanitizes counts and records partial failures', async () => {
  await runTrackedCron(request(), 'website-monitoring', async () => ({ checked: 1, counts: { usable: 1 } }), now);
  await runTrackedCron(request('test-secret', 'vercel-cron/1.0'), 'website-monitoring', async () => ({
    checked: 3, counts: { usable: 2, reconnect_required: 1, 'private-user-id': 1 },
    results: [{ userId: 'private-user-id', secret: 'private-token' }],
  }), now);
  expect(runRecords()).toHaveLength(2);
  expect(runRecords().find(run => run.trigger === 'vercel_cron_header')).toMatchObject({
    status: 'partial', checked: 3, counts: { usable: 2, reconnect_required: 1 }, lastSuccessfulAt: null,
  });
  expect(JSON.stringify(runRecords())).not.toMatch(/private-user-id|private-token/);
});

it('stores failures without provider payloads and preserves the last successful check of the day', async () => {
  await runTrackedCron(request(), 'progress', async () => ({ checked: 1, counts: { ready: 1 } }), now);
  const successful = runRecords()[0].lastSuccessfulAt;
  await expect(runTrackedCron(request(), 'progress', async () => { throw new Error('Bearer private-token at private-url'); }, now)).rejects.toThrow();
  expect(runRecords()[0]).toMatchObject({ status: 'failed', errorCode: 'collection_failed', invocationCount: 2, lastSuccessfulAt: successful });
  expect(JSON.stringify(runRecords())).not.toMatch(/private-token|private-url/);
});

it('records a busy collector as deferred, not a completed check', async () => {
  await expect(runTrackedCron(request(), 'progress', async () => { throw Object.assign(new Error('busy'), { status: 429 }); }, now)).rejects.toMatchObject({ status: 429 });
  expect(runRecords()[0]).toMatchObject({ status: 'deferred', errorCode: 'collection_busy', checked: null, lastSuccessfulAt: null });
});

it('bounds retained records and does not inherit a previous month’s successful timestamp', async () => {
  for (let day = 0; day < 33; day++) {
    await runTrackedCron(request(), 'progress', async () => ({ checked: 0 }), new Date(now.getTime() + day * 86400000));
  }
  expect(runRecords()).toHaveLength(32);
  const last = runRecords().find(run => run.startedAt === '2026-11-11T02:00:00.000Z');
  expect(last.invocationCount).toBe(1);
});

it('does not let an older completion overwrite a later request in the same day slot', async () => {
  let release;
  const old = runTrackedCron(request(), 'progress', () => new Promise(resolve => { release = resolve; }), now);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const newer = await runTrackedCron(request(), 'progress', async () => ({ checked: 2, counts: { ready: 2 } }), new Date(now.getTime() + 1000));
  release({ checked: 1, counts: { error: 1 } });
  await old;
  expect(runRecords()[0]).toMatchObject({ runId: newer.collectionRun.id, status: 'completed', checked: 2, counts: { ready: 2 } });
  expect(runRecords()[0].lastCompletedRun.runId).toBe(newer.collectionRun.id);
});

it('retains the real completed run when a later duplicate was deferred by the collector lease', async () => {
  let release;
  const original = runTrackedCron(request(), 'progress', () => new Promise(resolve => { release = resolve; }), now);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await expect(runTrackedCron(request(), 'progress', async () => { throw Object.assign(new Error('busy'), { status: 429 }); },
    new Date(now.getTime() + 1000))).rejects.toMatchObject({ status: 429 });
  release({ checked: 10, counts: { ready: 10 } });
  const result = await original;
  expect(runRecords()[0]).toMatchObject({ status: 'deferred', checked: null,
    lastCompletedRun: { runId: result.collectionRun.id, status: 'completed', checked: 10, counts: { ready: 10 } },
    lastSuccessfulRun: { runId: result.collectionRun.id, checked: 10 },
  });
  expect(runRecords()[0].lastSuccessfulAt).toBeTruthy();
});

it('does not start the collector if durable start evidence cannot be written', async () => {
  const collect = vi.fn();
  vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('offline'));
  await expect(runTrackedCron(request(), 'progress', collect, now)).rejects.toThrow('offline');
  expect(collect).not.toHaveBeenCalled();
});

it('records notification health separately from a successful Google collection', async () => {
  await runTrackedCron(request(), 'progress', async () => ({ checked: 3, counts: { ready: 3 }, notificationsSent: 0,
    notifications: { reconciliation: { checked: 3, counts: {}, moreRecords: false },
      delivery: { checked: 2, attempts: 2, accepted: 0, counts: { error: 1, privateEmail: 1 }, moreRecords: true } } }), now);
  expect(runRecords()[0]).toMatchObject({ status: 'completed', checked: 3,
    notifications: { delivery: { attempts: 2, accepted: 0, counts: { error: 1 }, moreRecords: true } } });
  expect(JSON.stringify(runRecords())).not.toContain('privateEmail');
});
