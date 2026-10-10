import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getUser: vi.fn(), deleteData: vi.fn() }));
vi.mock('../app/lib/server/requestAuth', () => ({
  requireUser: mocks.requireUser,
  errorResponse: error => Response.json({ error: error.status ? error.message : 'Unable to save or load data. Please try again.' }, { status: error.status || 500 }),
}));
vi.mock('../app/lib/firebaseAdmin', () => ({ db: {}, auth: { getUser: mocks.getUser } }));
vi.mock('../app/lib/server/accountDeletion', () => ({ deleteAccountFirestore: mocks.deleteData, deleteAccountBigQuery: vi.fn() }));
import { POST } from '../app/api/account/delete/route';
const request = values => new Request('http://localhost/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BIGQUERY_ENABLED;
  mocks.requireUser.mockResolvedValue('verified-user');
  mocks.getUser.mockResolvedValue({ email: 'verified@example.test' });
  mocks.deleteData.mockResolvedValue({ deletedRoots: 25 });
});
it('deletes only the authenticated identity and verified Auth email', async () => {
  const response = await POST(request({ email: 'attacker@example.test' }));
  expect(response.status).toBe(200);
  expect(mocks.getUser).toHaveBeenCalledWith('verified-user');
  expect(mocks.deleteData).toHaveBeenCalledWith({}, 'verified-user', 'verified@example.test');
});
it('rejects forbidden identities before any account data lookup or deletion', async () => {
  mocks.requireUser.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  expect((await POST(request({ userId: 'someone-else' }))).status).toBe(403);
  expect(mocks.getUser).not.toHaveBeenCalled();
  expect(mocks.deleteData).not.toHaveBeenCalled();
});
it('does not report success or leak provider details after a partial failure', async () => {
  mocks.deleteData.mockRejectedValue(new Error('refreshToken=must-not-escape'));
  const response = await POST(request({ userId: 'verified-user' }));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('must-not-escape');
});
it('fails before deletion if Auth identity metadata cannot be verified', async () => {
  mocks.getUser.mockRejectedValue(new Error('unavailable'));
  expect((await POST(request({}))).status).toBe(500);
  expect(mocks.deleteData).not.toHaveBeenCalled();
});
