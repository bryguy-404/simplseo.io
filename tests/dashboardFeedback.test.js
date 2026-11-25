import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { getUser: async () => ({ email: 'owner@example.test' }), verifyIdToken: vi.fn() } };
});
import { records, reset, db } from '../app/lib/firebaseAdmin';
import { submitDashboardFeedback, updateFeedbackPrompt, saveContactFeedback } from '../app/lib/server/dashboardFeedback';
import { POST } from '../app/api/dashboard/feedback/route';

const uid = 'member';
const state = 'users/member/dashboardFeedback/state';
const legacy = 'users/member/feedbackPrompt/data';
const day = 86400000;
const start = Date.parse('2026-01-01T00:00:00Z');
const event = (action, days, extra) => updateFeedbackPrompt(uid, { action, ...extra }, start + days * day);
beforeEach(() => {
  reset();
  vi.stubEnv('RESEND_API_KEY', 'test-only');
  vi.stubEnv('RESEND_NOTIFICATION_FROM', 'sender@example.test');
  fetch.mockResolvedValue(Response.json({ id: 'mail-id' }));
});
afterEach(() => vi.unstubAllEnvs());

it('starts the clock at the first overview and requires a feature visit before an automatic prompt', async () => {
  await event('feature', 0);
  expect(await event('visit', 10)).toEqual({});
  expect(await event('visit', 16.99)).toEqual({});
  const first = await event('visit', 17);
  expect(first.promptId).toBeTruthy();
  expect(await event('visit', 17)).toEqual({});
  expect(await event('visit', 47)).toEqual({});
  await event('feature', 47);
  expect((await event('visit', 47)).promptId).toBeTruthy();
});

it('preserves a recorded first visit, snoozes for 30 days and permanently stops after two distinct dismissals', async () => {
  records.set(legacy, { firstDashboardVisit: new Date(start).toISOString() });
  expect(await event('visit', 8)).toEqual({});
  await event('feature', 8);
  const first = await event('visit', 8);
  await event('dismiss', 8, first);
  await event('dismiss', 8, first);
  expect(records.get(state).dismissals).toBe(1);
  await event('feature', 9);
  expect(await event('visit', 37.99)).toEqual({});
  const second = await event('visit', 38);
  await event('dismiss', 38, second);
  await event('feature', 150);
  expect(await event('visit', 150)).toEqual({});
  await submitDashboardFeedback(uid, { submissionId: randomUUID(), rating: 'Okay' });
  expect(records.get(state).dismissals).toBe(2);
});

it('gives existing submitters without a dated response 90 days from migration', async () => {
  records.set(legacy, { firstDashboardVisit: new Date(start).toISOString(), hasSubmittedFeedback: true });
  await event('feature', 15);
  expect(await event('visit', 104.99)).toEqual({});
  expect((await event('visit', 105)).promptId).toBeTruthy();
});

it('saves and emails rating-only responses once, using the account email for replies', async () => {
  await event('visit', 0);
  records.set('onboarding/member', { businessName: 'Example Studio' });
  const data = { submissionId: randomUUID(), rating: 'Great' };
  const before = Date.now();
  await submitDashboardFeedback(uid, data);
  await submitDashboardFeedback(uid, data);
  expect(fetch).toHaveBeenCalledTimes(1);
  const mail = JSON.parse(fetch.mock.calls[0][1].body);
  expect(mail).toMatchObject({ to: ['simplseoai@gmail.com'], reply_to: 'owner@example.test' });
  expect(mail.text).toContain('Example Studio');
  expect(records.get(state).nextPrompt).toBeGreaterThanOrEqual(before + 90 * day);
  expect(records.get(state).nextPrompt).toBeLessThanOrEqual(Date.now() + 90 * day);
  expect([...records].find(([path]) => path.startsWith('contactMessages/'))[1].emailed).toBe(true);
});

it('retries a failed email with identical content and provider key, without duplicating the response', async () => {
  fetch.mockRejectedValueOnce(new Error('timeout'));
  fetch.mockResolvedValueOnce(Response.json({ id: 'mail-id' }));
  const data = { submissionId: randomUUID(), rating: 'Frustrating', comment: 'Help me choose a page.' };
  await expect(submitDashboardFeedback(uid, data)).rejects.toMatchObject({ status: 503 });
  records.delete('notificationJobs/resend-send-lane');
  await submitDashboardFeedback(uid, data);
  expect(fetch.mock.calls[0][1].headers).toEqual(fetch.mock.calls[1][1].headers);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  expect([...records.keys()].filter(path => path.startsWith('contactMessages/'))).toHaveLength(1);
  await expect(submitDashboardFeedback(uid, { ...data, rating: 'Okay' })).rejects.toMatchObject({ status: 409 });
});

it('counts a signed-in contact feedback message as a submission, and rejects invalid or unauthenticated card requests', async () => {
  await saveContactFeedback(uid, db.collection('contactMessages').doc('contact'), { subject: 'feedback' });
  expect(records.get(state).nextPrompt).toBeGreaterThan(Date.now() + 89 * day);
  await expect(submitDashboardFeedback(uid, { submissionId: randomUUID(), rating: 'Bad' })).rejects.toMatchObject({ status: 400 });
  expect((await POST(new Request('http://localhost/api/dashboard/feedback', { method: 'POST', body: '{}' }))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
