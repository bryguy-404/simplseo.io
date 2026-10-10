import { describe, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', () => ({ auth: { verifyIdToken: vi.fn(async token => { if (token !== 'valid') throw Error(); return { uid: 'alice' }; }) } }));
import { requireUser, requireCron } from '../app/lib/server/requestAuth';
const req = token => new Request('http://localhost/test', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
describe('identity boundaries', () => {
  it('rejects absent and invalid credentials', async () => {
    await expect(requireUser(req())).rejects.toMatchObject({ status: 401 });
    await expect(requireUser(req('bad'))).rejects.toMatchObject({ status: 401 });
  });
  it('derives identity from the verified token and rejects another user', async () => {
    expect(await requireUser(req('valid'))).toBe('alice');
    await expect(requireUser(req('valid'), 'bob')).rejects.toMatchObject({ status: 403 });
  });
  it('cron is fail-closed when no secret is configured', () => {
    delete process.env.CRON_SECRET;
    expect(() => requireCron(req())).toThrow('Unauthorized');
    expect(() => requireCron(req('undefined'))).toThrow('Unauthorized');
    process.env.CRON_SECRET = 'configured';
    expect(() => requireCron(req('configured'))).not.toThrow();
  });
});
