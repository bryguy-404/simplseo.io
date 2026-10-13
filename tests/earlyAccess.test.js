import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { getUser: vi.fn(), verifyIdToken: vi.fn(async token => { if (!['alice', 'bob', 'admin'].includes(token)) throw Error(); return { uid: token }; }) } };
});
import { db, records, reset, auth } from '../app/lib/firebaseAdmin';
import { requestEarlyAccess, issueInvitation, invitationToken, inspectInvitation, acceptInvitation, rejectAccessRequest, sendAccessMail } from '../app/lib/server/earlyAccess';
import { readEarlyAccess } from '../app/lib/server/earlyAccessPolicy';
import { requireUser } from '../app/lib/server/requestAuth';
import { GET as status } from '../app/api/access/status/route';
import { POST as redeem } from '../app/api/access/invitation/route';
import { POST as adminPost } from '../app/api/admin/approve/route';
const hash = value => createHash('sha256').update(value).digest('hex');
const email = 'invited@example.test', uid = 'alice';
const account = id => ({ uid: id, email: `${id}@different.test`, emailVerified: true, disabled: false, metadata: { creationTime: '2026-10-14T00:00:00Z' } });
const request = (path, token, data) => new Request(`https://app.example.test${path}`, { method: data ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
const invitation = () => [...records.entries()].find(([path]) => path.startsWith('earlyAccessInvitations/'));
const pace = () => records.delete('earlyAccessLimits/pace');
const issue = async () => { pace(); await issueInvitation('admin', { email, name: 'Owner' }); return invitation()[0].split('/')[1]; };
beforeEach(() => {
  reset(); vi.clearAllMocks();
  vi.stubEnv('EARLY_ACCESS_ENABLED', 'true'); vi.stubEnv('EARLY_ACCESS_EXISTING_BEFORE', '2026-10-13T12:00:00Z');
  vi.stubEnv('ADMIN_UIDS', 'admin'); vi.stubEnv('NOTIFICATION_UNSUBSCRIBE_SECRET', 'test-only-not-a-real-secret-123456789');
  vi.stubEnv('NOTIFICATION_PUBLIC_ORIGIN', 'https://app.example.test'); vi.stubEnv('RESEND_API_KEY', 'test-only');
  vi.stubEnv('RESEND_NOTIFICATION_FROM', 'SimplSEO <updates@example.test>'); vi.stubEnv('RESEND_NOTIFICATION_REPLY_TO', 'help@example.test');
  vi.stubEnv('NOTIFICATION_TRACKING_DISABLED', 'true'); vi.stubEnv('EARLY_ACCESS_EMAILS_ENABLED', 'true');
  auth.getUser.mockImplementation(async id => account(id));
  fetch.mockImplementation(async () => new Response(JSON.stringify({ id: 'provider-test-id' })));
});
afterEach(() => { vi.unstubAllEnvs(); });
it('request saves once and notifies the admin without granting access or disclosing membership', async () => {
  const result = await requestEarlyAccess({ email, name: '<script>alert(1)</script>' });
  expect(result.success).toBe(true);
  expect((await requestEarlyAccess({ email })).success).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(fetch.mock.calls[0][1].body);
  expect(payload.to).toEqual(['simplseoai@gmail.com']); expect(payload.html).toContain('&lt;script&gt;');
  expect(records.has(`approvedUsers/${email}`)).toBe(false);
});
it('a delivery error preserves the request for admin review', async () => {
  fetch.mockRejectedValue(new Error('timeout'));
  expect((await requestEarlyAccess({ email })).success).toBe(true);
  expect(records.get(`accessRequests/${hash(email)}`).status).toBe('pending');
  expect(records.get(`earlyAccessMail/${records.get(`accessRequests/${hash(email)}`).adminMailId}`).status).toBe('unknown');
});
it('an email link invites without preapproving an email and inspection cannot consume it', async () => {
  const id = await issue(), token = invitationToken(id);
  expect((await inspectInvitation(token)).status).toBe('pending');
  expect((await inspectInvitation(token)).status).toBe('pending');
  expect(records.get(`earlyAccessInvitations/${id}`).userId).toBe(null);
  expect((await readEarlyAccess(uid)).approved).toBe(false);
  expect(JSON.parse(fetch.mock.calls[0][1].body).html).toContain('/accept-invite#token=');
  expect(JSON.parse(fetch.mock.calls[0][1].body).text).toContain('different Google account');
  expect([...records.keys()].filter(key => key.startsWith('approvedUsers/'))).toHaveLength(0);
});
it('accepts a different verified sign-in email once, binding access to UID for later regular sign-in', async () => {
  const id = await issue(), token = invitationToken(id);
  await acceptInvitation(uid, token);
  expect((await readEarlyAccess(uid)).approved).toBe(true);
  expect(records.get(`earlyAccessInvitations/${id}`).userId).toBe(uid);
  expect(records.get(`users/${uid}`)).toEqual({ earlyAccessSetupVersion: 2 });
  expect(await acceptInvitation(uid, token)).toEqual({ success: true });
  await expect(acceptInvitation('bob', token)).rejects.toMatchObject({ status: 410 });
  auth.getUser.mockImplementation(async id => ({ ...account(id), email: 'changed@example.test' }));
  expect((await readEarlyAccess(uid)).approved).toBe(true);
});
it('blocks tampered, expired, revoked and unverified redemptions', async () => {
  const id = await issue(), token = invitationToken(id);
  await expect(inspectInvitation(`${id}.${'a'.repeat(43)}`)).rejects.toMatchObject({ status: 400 });
  auth.getUser.mockResolvedValue({ ...account(uid), emailVerified: false });
  await expect(acceptInvitation(uid, token)).rejects.toMatchObject({ status: 403 });
  auth.getUser.mockResolvedValue(account(uid));
  records.get(`earlyAccessInvitations/${id}`).expiresAt = '2020-01-01';
  await expect(acceptInvitation(uid, token)).rejects.toMatchObject({ status: 410 });
  await rejectAccessRequest(hash(email));
  await expect(inspectInvitation(token)).rejects.toMatchObject({ status: 410 });
});
it('does not recreate a deleted identity while an acceptance is in flight', async () => {
  const id = await issue();
  auth.getUser.mockImplementation(async id => { records.set(`accountDeletionGuards/${hash(id)}`, { blocked: true }); return account(id); });
  await expect(acceptInvitation(uid, invitationToken(id))).rejects.toMatchObject({ status: 403 });
  expect(records.has(`users/${uid}`)).toBe(false);
  expect(records.get(`earlyAccessInvitations/${id}`).status).toBe('pending');
});
it('preserves website identity, saved work, completion and historical dates', async () => {
  const id = await issue();
  const user = { websiteUrl: 'https://site.test/', gscSiteUrl: 'sc-domain:site.test', gscRefreshToken: 'test-only' };
  records.set('users/alice', user); records.set('onboarding/alice', { isComplete: true, revampRunId: 'original' });
  records.set('pageReviewPlans/real', { confirmedAt: '2026-10-01', ownerEdits: 'keep' });
  await acceptInvitation(uid, invitationToken(id));
  expect(records.get('users/alice')).toEqual({ ...user, earlyAccessSetupVersion: 2 });
  expect(records.get('onboarding/alice')).toEqual({ isComplete: true, revampRunId: 'original' });
  expect(records.get('pageReviewPlans/real')).toEqual({ confirmedAt: '2026-10-01', ownerEdits: 'keep' });
  const response = await status(request('/api/access/status', uid)); expect((await response.json()).nextPath).toBe('/dashboard');
});
it('grandfathers existing Firebase accounts and respects earlier approvals, without trusting browser input', async () => {
  auth.getUser.mockResolvedValue({ ...account(uid), metadata: { creationTime: '2026-10-01T00:00:00Z' } });
  expect((await readEarlyAccess(uid)).approved).toBe(true);
  auth.getUser.mockResolvedValue(account(uid));
  records.set(`approvedUsers/${account(uid).email}`, { email: account(uid).email });
  expect((await readEarlyAccess(uid)).approved).toBe(true);
  records.clear(); records.set('onboarding/alice', { isComplete: true });
  expect((await readEarlyAccess(uid)).approved).toBe(false);
  expect((await status(request('/api/access/status?email=approved@example.test', uid))).status).toBe(200);
});
it('blocks protected APIs for uninvited users and requires an admin to invite', async () => {
  await expect(requireUser(request('/api/work', uid))).rejects.toMatchObject({ status: 403 });
  expect((await adminPost(request('/api/admin/approve', uid, { action: 'invite', email }))).status).toBe(403);
  expect((await status(request('/api/access/status'))).status).toBe(401);
  const id = await issue();
  expect((await redeem(request('/api/access/invitation', null, { action: 'accept', token: invitationToken(id) }))).status).toBe(401);
  expect((await readEarlyAccess(uid)).approved).toBe(false);
});
it('reuses a completed email without paying or sending again', async () => {
  await issue(); pace(); await issueInvitation('admin', { email }); expect(fetch).toHaveBeenCalledTimes(1);
});
it('retries uncertain email with the immutable payload/key, then refuses outside 23 hours', async () => {
  fetch.mockRejectedValue(new Error('network'));
  const id = await issue(); pace();
  await sendAccessMail(id);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetch.mock.calls[1][1].headers['Idempotency-Key']);
  records.get(`earlyAccessMail/${id}`).firstAttemptAt = Date.now() - 24 * 3600000; pace();
  expect(await sendAccessMail(id)).toBe('unknown'); expect(fetch).toHaveBeenCalledTimes(2);
});
it('reserves attempt limits before provider work and preserves the invitation at the limit', async () => {
  records.set(`earlyAccessLimits/day-${new Date().toISOString().slice(0, 10)}`, { attempts: 50 });
  await expect(issue()).rejects.toMatchObject({ status: 429 }); expect(fetch).not.toHaveBeenCalled();
  expect(invitation()[1].status).toBe('pending');
});
it('cannot resend a cancelled or already accepted invitation', async () => {
  const id = await issue(); records.get(`earlyAccessMail/${id}`).status = 'unknown';
  await rejectAccessRequest(hash(email)); pace();
  expect(await sendAccessMail(id)).toBe('cancelled'); expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not recreate a deleted mail record after a provider response', async () => {
  fetch.mockImplementation(async () => { for (const key of records.keys()) if (key.startsWith('earlyAccessMail/')) records.delete(key); return new Response(JSON.stringify({ id: 'provider' })); });
  await issue(); expect([...records.keys()].some(key => key.startsWith('earlyAccessMail/'))).toBe(false);
});
it('replacement explicitly invalidates the older link', async () => {
  const old = await issue(); records.get(`earlyAccessInvitations/${old}`).createdAt -= 61000; pace();
  await issueInvitation('admin', { email, replace: true });
  await expect(inspectInvitation(invitationToken(old))).rejects.toMatchObject({ status: 410 });
  expect([...records.entries()].filter(([key, r]) => key.startsWith('earlyAccessInvitations/') && r.status === 'pending')).toHaveLength(1);
});
it('saved status checks do not send email or contact Google', async () => {
  const result = await status(request('/api/access/status', 'admin'));
  expect((await result.json()).isAdmin).toBe(true); expect(fetch).not.toHaveBeenCalled();
});
it('keeps cross-origin invitation requests blocked even behind a Next host alias', async () => {
  const id = await issue(), token = invitationToken(id);
  const invoke = origin => redeem(new Request('http://localhost:3100/api/access/invitation', { method: 'POST', headers: { Host: '127.0.0.1:3100', Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inspect', token }) }));
  expect((await invoke('https://untrusted.example')).status).toBe(403);
  expect((await invoke('http://127.0.0.1:3100')).status).toBe(200);
});
it('a fresh request can recover an expired invitation without silently issuing a new grant', async () => {
  const id = await issue();
  records.get(`earlyAccessInvitations/${id}`).expiresAt = '2020-01-01';
  records.get(`accessRequests/${hash(email)}`).requestedAt = '2020-01-01'; pace();
  await requestEarlyAccess({ email, name: 'Owner again' });
  expect(records.get(`accessRequests/${hash(email)}`).status).toBe('pending');
  expect(records.get(`earlyAccessInvitations/${id}`).status).toBe('revoked');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect((await readEarlyAccess(uid)).approved).toBe(false);
});
