import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => { const { fakeFirestore } = await import('./fakeFirestore'); return { ...fakeFirestore(), auth: {} }; });
import { records, reset, db } from '../app/lib/firebaseAdmin';
import { readNewPageScope, assertSameNewPageScope, newPageScopeKey } from '../app/lib/server/newPageScope';
beforeEach(() => { reset(); records.set('users/alice', { gscSiteUrl: 'sc-domain:example.org', gscAccessToken: 'private' }); records.set('onboarding/alice', { websiteUrl: 'www.example.org', gscProperty: 'sc-domain:example.org', isComplete: true, revampRunId: 'v2' }); });
it('uses the selected website host within a domain property and performs no provider calls', async () => {
  const scope = await readNewPageScope('alice'); expect(scope).toMatchObject({ userId: 'alice', websiteUrl: 'https://www.example.org/', property: 'sc-domain:example.org', websiteRunId: 'v2' });
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['http://user:secret@example.org/', 'https://example.org.evil.org/', 'https://example.org:8000/', 'https://example.org/#fragment', 'file:///tmp/x'])('rejects website %s', async websiteUrl => {
  records.get('onboarding/alice').websiteUrl = websiteUrl; await expect(readNewPageScope('alice')).rejects.toMatchObject({ status: 409 });
});
it('requires both account roots and the current stored connection', async () => {
  records.delete('users/alice'); await expect(readNewPageScope('alice')).rejects.toMatchObject({ status: 409 });
  records.set('users/alice', { gscSiteUrl: 'https://other.org/', gscAccessToken: 'x' }); await expect(readNewPageScope('alice')).rejects.toMatchObject({ status: 409 });
});
it('blocks writes during a rebuild but allows saved historical read scope', async () => {
  records.get('onboarding/alice').revampStatus = 'in-progress'; await expect(readNewPageScope('alice', { write: true })).rejects.toMatchObject({ status: 409 });
  await expect(readNewPageScope('alice')).resolves.toHaveProperty('websiteRunId', 'v2');
});
it('scopes identity by account, property, selected host and website version, not display names', async () => {
  const scope = await db.runTransaction(tx => readNewPageScope('alice', { tx }));
  expect(newPageScopeKey(scope)).toBe(newPageScopeKey({ ...scope, businessName: 'Renamed' }));
  for (const delta of [{ userId: 'bob' }, { property: 'https://www.example.org/' }, { websiteRunId: 'v3' }, { websiteUrl: 'https://blog.example.org/' }]) {
    expect(newPageScopeKey(scope)).not.toBe(newPageScopeKey({ ...scope, ...delta })); expect(() => assertSameNewPageScope(scope, { ...scope, ...delta })).toThrow();
  }
});
