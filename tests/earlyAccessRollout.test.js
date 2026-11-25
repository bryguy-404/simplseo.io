import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import rollout from '../config/early-access-rollout.json';

vi.mock('../app/lib/firebaseAdmin', async () => ({
  ...(await import('./fakeFirestore')).fakeFirestore(),
  auth: { getUser: vi.fn(), verifyIdToken: vi.fn(async uid => {
    if (!/^(?:photographer-\d+|outsider|admin)$/.test(uid)) throw Error('Invalid test identity');
    return { uid };
  }) },
}));
import { auth, records, reset } from '../app/lib/firebaseAdmin';
import { issueInvitation, invitationToken, acceptInvitation } from '../app/lib/server/earlyAccess';
import { requireUser } from '../app/lib/server/requestAuth';
import { ongoingReviewEnabled } from '../app/lib/server/ongoingReviewFeature';
import { pageMonitoringEnabled } from '../app/lib/server/pageMonitoringFeature';
import { reserveMentorTurn, MENTOR_TURN_RESERVE } from '../app/lib/server/mentorBudget';
import { GET as dashboard } from '../app/api/dashboard/config/route';
import { GET as conversations } from '../app/api/conversations/route';
import { GET as preferences } from '../app/api/notifications/preferences/route';
import { GET as setup, POST as saveSetup } from '../app/api/onboarding/workspace/route';

const hash = text => createHash('sha256').update(text).digest('hex');
const request = (path, uid, body) => new Request(`https://app.example.test${path}`, {
  method: body ? 'POST' : 'GET', headers: { ...(uid ? { Authorization: `Bearer ${uid}` } : {}), 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const account = uid => ({ uid, email: `${uid}@example.test`, emailVerified: true, disabled: false,
  metadata: { creationTime: '2026-11-25T00:00:00Z' } });
const photographProfile = number => ({ businessName: `Studio ${number}`, businessType: 'Wedding and portrait photographer',
  services: ['Wedding photography', 'Family portraits'], baseLocation: { city: 'South Bend', region: 'Indiana', country: 'United States' },
  serviceAreas: ['South Bend, Indiana'], goal: 'inquiries', cmsPlatform: 'Squarespace', customerTypes: [], differentiators: '' });

beforeEach(() => {
  reset(); vi.clearAllMocks();
  Object.entries(rollout).forEach(([key, value]) => vi.stubEnv(key, value));
  vi.stubEnv('EARLY_ACCESS_EXISTING_BEFORE', '2026-10-13T17:32:00.000Z');
  vi.stubEnv('ADMIN_UIDS', 'admin');
  vi.stubEnv('NOTIFICATION_UNSUBSCRIBE_SECRET', 'isolated-test-only-secret-123456789');
  vi.stubEnv('NOTIFICATION_PUBLIC_ORIGIN', 'https://app.example.test');
  vi.stubEnv('RESEND_API_KEY', 'test-only');
  vi.stubEnv('RESEND_NOTIFICATION_FROM', 'SimplSEO <updates@example.test>');
  vi.stubEnv('RESEND_NOTIFICATION_REPLY_TO', 'help@example.test');
  vi.stubEnv('NOTIFICATION_TRACKING_DISABLED', 'true');
  vi.stubEnv('EARLY_ACCESS_EMAILS_ENABLED', 'true');
  auth.getUser.mockImplementation(async uid => account(uid));
  fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'isolated-mail-result' })));
});
afterEach(() => vi.unstubAllEnvs());

async function admit(uid) {
  records.delete('notificationJobs/resend-send-lane');
  await issueInvitation('admin', { email: `${uid}@example.test`, name: 'Photographer' });
  const invite = records.get(`accessRequests/${hash(`${uid}@example.test`)}`).invitationId;
  await acceptInvitation(uid, invitationToken(invite));
}

it('gives 15 newly invited photographers the same complete feature access and resumable setup', async () => {
  for (let i = 1; i <= 15; i++) {
    const uid = `photographer-${i}`;
    expect((await dashboard(request('/api/dashboard/config', uid))).status).toBe(403);
    await admit(uid);
    const config = await dashboard(request('/api/dashboard/config', uid));
    expect(config.status).toBe(200); expect(await config.json()).toEqual({ enabled: true });
    const start = await saveSetup(request('/api/onboarding/workspace', uid, { action: 'begin', requestId: `begin-setup-${i}` }));
    expect(start.status).toBe(200);
    const started = await start.json();
    expect(started).toMatchObject({ eligible: true, pinned: true, session: { mode: 'new', revision: 1 } });
    const saved = await saveSetup(request('/api/onboarding/workspace', uid, { action: 'save', requestId: `save-profile-${i}`,
      expectedRevision: 1, websiteUrl: `https://studio-${i}.example.test/`, profileDraft: photographProfile(i), currentStep: 'business' }));
    expect(saved.status).toBe(200);
    expect(await (await setup(request('/api/onboarding/workspace', uid))).json()).toMatchObject({
      session: { revision: 2, profileDraft: photographProfile(i), google: { status: 'not_connected' } },
    });
    const mentor = await conversations(request('/api/conversations', uid));
    expect(mentor.status).toBe(200);
    expect(await mentor.json()).toMatchObject({ enabled: true, generationEnabled: true, researchEnabled: true, conversations: [] });
    expect(ongoingReviewEnabled(uid)).toBe(true); expect(pageMonitoringEnabled(uid)).toBe(true);
    const notifications = await preferences(request('/api/notifications/preferences', uid));
    expect(notifications.status).toBe(200);
    expect(await notifications.json()).toMatchObject({ enabled: true, emailEnabled: false, emailState: 'off' });
    expect(records.has(`notificationPreferences/${uid}`)).toBe(false);
    expect(records.get(`onboarding/${uid}`).isComplete).toBe(false);
  }
  expect(fetch).toHaveBeenCalledTimes(15); // Only the mocked invitation deliveries; no AI or Google requests.
  expect([...records.keys()].filter(key => key.startsWith('earlyAccessGrants/'))).toHaveLength(15);
});

it('does not turn open feature eligibility into public access or cross-account access', async () => {
  await admit('photographer-1');
  for (const [path, handler] of [['/api/dashboard/config', dashboard], ['/api/conversations', conversations],
    ['/api/onboarding/workspace', setup], ['/api/notifications/preferences', preferences]]) {
    expect((await handler(request(path))).status).toBe(401);
    expect((await handler(request(path, 'outsider'))).status).toBe(403);
  }
  expect((await dashboard(request('/api/dashboard/config?userId=photographer-2', 'photographer-1'))).status).toBe(403);
  expect((await conversations(request('/api/conversations?userId=photographer-2', 'photographer-1'))).status).toBe(403);
  records.get('earlyAccessGrants/photographer-1').revokedAt = new Date().toISOString();
  await expect(requireUser(request('/api/dashboard/config', 'photographer-1'))).rejects.toMatchObject({ status: 403 });
});

it('retains the per-feature rollback controls and existing saved work', async () => {
  await admit('photographer-1');
  const before = structuredClone([...records]);
  vi.stubEnv('VISUAL_DASHBOARD_ENABLED', 'false');
  expect(await (await dashboard(request('/api/dashboard/config', 'photographer-1'))).json()).toEqual({ enabled: false });
  vi.stubEnv('ONGOING_PAGE_REVIEWS_ENABLED', 'false'); expect(pageMonitoringEnabled('photographer-1')).toBe(false);
  vi.stubEnv('MENTOR_GENERATION_ENABLED', 'false');
  expect(await (await conversations(request('/api/conversations', 'photographer-1'))).json()).toMatchObject({ enabled: true, generationEnabled: false });
  expect([...records]).toEqual(before);
});

it('can reserve an initial mentor turn for each of 15 users without removing the shared spending cap', async () => {
  for (let i = 1; i <= 15; i++) records.set(`users/photographer-${i}`, {});
  // Sequential reservations exercise the shared ledger deterministically; real transaction races have separate tests.
  for (let i = 1; i <= 15; i++) await reserveMentorTurn(`photographer-${i}`, `first-question-${i}`);
  const month = records.get(`mentorBudgetMonths/${new Date().toISOString().slice(0, 7)}`);
  expect(month.reservedUsd).toBeCloseTo(15 * MENTOR_TURN_RESERVE, 5);
  records.set(`mentorBudgetMonths/${new Date().toISOString().slice(0, 7)}`, { spentUsd: 25, reservedUsd: 0 });
  await expect(reserveMentorTurn('photographer-1', 'after-limit')).rejects.toMatchObject({ status: 429 });
});
