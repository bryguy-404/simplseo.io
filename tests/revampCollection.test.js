import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  const fake = fakeFirestore();
  const collection = fake.db.collection;
  function wrap(original, after = null, maximum = Infinity) {
    return { ...original,
      where: (...args) => wrap(original.where(...args), after, maximum),
      orderBy: () => wrap(original, after, maximum),
      limit: count => wrap(original, after, count),
      startAfter: cursor => wrap(original, cursor, maximum),
      get: async () => {
        const snapshot = await original.get();
        const docs = snapshot.docs.sort((a, b) => a.id.localeCompare(b.id)).filter(doc => !after || doc.id > after).slice(0, maximum);
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }
  fake.db.collection = name => wrap(collection(name));
  return { ...fake, auth: {} };
});
vi.mock('../app/lib/server/revampMonitor', () => ({ monitorRevamp: vi.fn() }));
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { monitorRevamp } from '../app/lib/server/revampMonitor';
import { runRevampCollection } from '../app/lib/server/revampCollection';
import { GET as cron } from '../app/api/cron/check-revamp-gsc/route';

const now = new Date('2026-10-10T03:00:00Z');
const jobPath = 'progressJobs/daily-website-monitoring';
const setup = async count => {
  for (let index = 0; index < count; index++) await db.collection('onboarding').doc(`user-${String(index).padStart(2, '0')}`).set({ revampMonitoringEnabled: true });
};
beforeEach(() => {
  reset(); monitorRevamp.mockReset().mockResolvedValue({ connectionStatus: 'usable', checked: 4, morePages: false });
  process.env.CRON_SECRET = 'test-secret';
});

it('rejects unauthenticated cron calls before any database or Google work', async () => {
  const response = await cron(new Request('https://example.test/api/cron/check-revamp-gsc'));
  expect(response.status).toBe(401);
  expect(records.size).toBe(0); expect(monitorRevamp).not.toHaveBeenCalled();
});

it('records an empty authenticated run and makes no page observations', async () => {
  const response = await cron(new Request('https://example.test/api/cron/check-revamp-gsc', { headers: { Authorization: 'Bearer test-secret' } }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ checked: 0, pagesChecked: 0, counts: {}, results: [], collectionRun: { status: 'completed', trigger: 'authenticated_request' } });
  expect(monitorRevamp).not.toHaveBeenCalled();
});

it('caps accounts, resumes the cursor and wraps only after reaching the end', async () => {
  await setup(23);
  const first = await runRevampCollection(now);
  expect(first).toMatchObject({ checked: 20, pagesChecked: 80, counts: { usable: 20 }, moreRecords: true, notificationsSent: 0 });
  expect(records.get(jobPath)).toMatchObject({ cursor: 'user-19', leaseUntil: null });
  expect(monitorRevamp.mock.calls[0][1]).toMatchObject({ maxPages: 40, scheduled: true });
  const second = await runRevampCollection(new Date(now.getTime() + 300000));
  expect(second).toMatchObject({ checked: 3, moreRecords: false });
  expect(second.results.map(result => result.userId)).toEqual(['user-20', 'user-21', 'user-22']);
  expect(records.get(jobPath).cursor).toBeNull();
  expect((await runRevampCollection(new Date(now.getTime() + 600000))).results[0].userId).toBe('user-00');
});

it('wraps a saved cursor when the later accounts have been removed', async () => {
  await setup(2);
  records.set(jobPath, { cursor: 'user-deleted' });
  expect((await runRevampCollection(now)).checked).toBe(2);
  expect(records.get(jobPath).cursor).toBeNull();
});

it('isolates errors and indicates partial work without exposing raw provider messages', async () => {
  await setup(3);
  monitorRevamp.mockRejectedValueOnce(new Error('private provider payload'))
    .mockResolvedValueOnce({ connectionStatus: 'reconnect_required', checked: 0 })
    .mockResolvedValueOnce({ connectionStatus: 'usable', checked: 40, morePages: true });
  const response = await cron(new Request('https://example.test/api/cron/check-revamp-gsc', { headers: { Authorization: 'Bearer test-secret', 'User-Agent': 'vercel-cron/1.0' } }));
  const body = await response.json();
  expect(body).toMatchObject({ checked: 3, pagesChecked: 40, moreRecords: true, counts: { error: 1, reconnect_required: 1, usable: 1 }, collectionRun: { status: 'partial' } });
  expect(JSON.stringify(body)).not.toContain('private provider payload');
});

it('refuses overlapping work and cooldown retries, then recovers an expired lease', async () => {
  await setup(1);
  records.set(jobPath, { leaseUntil: new Date(now.getTime() + 240000).toISOString(), lastStartedAt: now.toISOString(), attempt: 'stalled' });
  await expect(runRevampCollection(now)).rejects.toMatchObject({ status: 429 });
  expect(monitorRevamp).not.toHaveBeenCalled();
  expect((await runRevampCollection(new Date(now.getTime() + 300000))).checked).toBe(1);
  await expect(runRevampCollection(new Date(now.getTime() + 310000))).rejects.toMatchObject({ status: 429 });
});

it('leaves unfinished accounts for the next invocation when the time budget is reached', async () => {
  await setup(3);
  let clock = now.getTime();
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    monitorRevamp.mockImplementationOnce(async () => { clock += 130000; return { connectionStatus: 'usable', checked: 1 }; });
    const first = await runRevampCollection(now);
    expect(first).toMatchObject({ checked: 1, moreRecords: true });
    expect(records.get(jobPath).cursor).toBe('user-00');
    const second = await runRevampCollection(new Date(now.getTime() + 300000));
    expect(second.results.map(result => result.userId)).toEqual(['user-01', 'user-02']);
  } finally { spy.mockRestore(); }
});

it('releases its own lease on a query failure and does not overwrite a newer job', async () => {
  const collection = db.collection;
  const spy = vi.spyOn(db, 'collection').mockImplementation(name => name === 'onboarding'
    ? { where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => { throw new Error('offline'); } }) }) }) }
    : collection(name));
  await expect(runRevampCollection(now)).rejects.toThrow('offline');
  expect(records.get(jobPath)).toMatchObject({ leaseUntil: null });
  expect(records.get(jobPath).lastErrorAt).toBeTruthy();
  spy.mockRestore();
  await setup(1);
  monitorRevamp.mockImplementationOnce(async () => {
    records.set(jobPath, { attempt: 'newer', cursor: 'newer-cursor', leaseUntil: 'newer-lease' });
    return { connectionStatus: 'usable', checked: 1 };
  });
  await runRevampCollection(new Date(now.getTime() + 300000));
  expect(records.get(jobPath)).toEqual({ attempt: 'newer', cursor: 'newer-cursor', leaseUntil: 'newer-lease' });
});
