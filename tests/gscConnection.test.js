import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: {} };
});
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { getGscConnection } from '../app/lib/server/gscConnection';
const property = 'https://example.test/';
beforeEach(async () => {
  reset();
  await db.collection('users').doc('alice').set({ gscAccessToken: 'alice-access', gscRefreshToken: 'alice-refresh', gscSiteUrl: property, gscExpiresAt: Date.now() + 3600000 });
  await db.collection('onboarding').doc('alice').set({ gscProperty: property });
});
it('uses the authenticated account’s property and bearer token for read-only exact URL inspection', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } })));
  const connection = await getGscConnection('alice');
  const url = `${property}Case?Topic=Exact`;
  await expect(connection.inspect(url)).resolves.toMatchObject({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [endpoint, options] = fetch.mock.calls[0];
  expect(endpoint).toBe('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect');
  expect(options.method).toBe('POST');
  expect(options.headers.Authorization).toBe('Bearer alice-access');
  expect(JSON.parse(options.body)).toEqual({ inspectionUrl: url, siteUrl: property, languageCode: 'en-US' });
  expect(options.signal).toBeInstanceOf(AbortSignal);
});
it('rejects unsafe and out-of-property inspection URLs before outbound Google requests', async () => {
  const connection = await getGscConnection('alice');
  for (const url of ['https://other.test/', 'https://example.test.evil.test/', 'https://user:secret@example.test/', `${property}#part`, 'https://example.test:8080/']) {
    await expect(connection.inspect(url)).rejects.toMatchObject({ status: expect.any(Number) });
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('refreshes once on an expired Google authorization response, then retries only the same inspection', async () => {
  fetch.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh-access', expires_in: 3600 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } })));
  const connection = await getGscConnection('alice');
  await connection.inspect(property);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/token');
  expect(fetch.mock.calls[1][1].body.get('refresh_token')).toBe('alice-refresh');
  expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-access');
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[2][1].body);
  expect(records.get('users/alice').gscRefreshToken).toBe('alice-refresh');
});
it.each([403, 429, 500])('does not retry Google inspection status %s or leak provider errors', async status => {
  fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'secret provider diagnostics' } }), { status }));
  const connection = await getGscConnection('alice');
  await expect(connection.inspect(property)).rejects.toThrow(status === 403 ? 'reconnect_required' : 'temporarily_unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('normalizes invalid JSON without provider detail and fails mismatched account properties before requests', async () => {
  fetch.mockResolvedValue(new Response('private invalid payload'));
  await expect((await getGscConnection('alice')).inspect(property)).rejects.toThrow('temporarily_unavailable');
  records.get('onboarding/alice').gscProperty = 'https://changed.test/';
  fetch.mockClear();
  await expect(getGscConnection('alice')).rejects.toThrow('reconnect_required');
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['account_deleted', 'onboarding_deleted', 'property_changed', 'website_rebuilt', 'credential_replaced'])('does not restore stale credentials when %s during OAuth refresh', async state => {
  records.get('users/alice').gscExpiresAt = 1;
  fetch.mockImplementation(async () => {
    if (state === 'account_deleted') records.delete('users/alice');
    if (state === 'onboarding_deleted') records.delete('onboarding/alice');
    if (state === 'property_changed') records.get('onboarding/alice').gscProperty = 'https://another.test/';
    if (state === 'website_rebuilt') records.get('onboarding/alice').revampRunId = 'new-website';
    if (state === 'credential_replaced') records.get('users/alice').gscRefreshToken = 'new-owner-connection';
    return new Response(JSON.stringify({ access_token: 'stale-new-token', expires_in: 3600 }));
  });
  await expect(getGscConnection('alice')).rejects.toThrow('reconnect_required');
  expect(records.get('users/alice')?.gscAccessToken).not.toBe('stale-new-token');
  if (state === 'account_deleted') expect(records.has('users/alice')).toBe(false);
});
it('honors shared deadlines and cancellation on both OAuth and Google requests', async () => {
  const expired = Date.now() - 1;
  const connection = await getGscConnection('alice', { deadline: expired });
  await expect(connection.inspect(property)).rejects.toThrow('temporarily_unavailable');
  const controller = new AbortController(); controller.abort();
  await expect((await getGscConnection('alice', { signal: controller.signal })).query({})).rejects.toThrow('temporarily_unavailable');
  records.get('users/alice').gscExpiresAt = 1;
  await expect(getGscConnection('alice', { deadline: expired })).rejects.toThrow('temporarily_unavailable');
  expect(fetch).not.toHaveBeenCalled();
});
it('never recreates credentials for an account missing before a connection starts', async () => {
  records.delete('users/alice');
  await expect(getGscConnection('alice')).rejects.toThrow('reconnect_required');
  expect(fetch).not.toHaveBeenCalled();
});
