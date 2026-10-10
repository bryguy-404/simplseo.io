import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('../app/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
import { authenticatedFetch } from '../app/lib/authenticatedFetch';
import { reconnectGsc } from '../app/lib/reconnectGsc';
beforeEach(() => vi.clearAllMocks());
it('reports a blocked popup before touching the stored connection', async () => {
  vi.stubGlobal('window', { open: () => null });
  await expect(reconnectGsc('sc-domain:example.test')).rejects.toThrow('Allow popups');
  expect(authenticatedFetch).not.toHaveBeenCalled();
});
it('accepts only the matching popup, origin and one-time state', async () => {
  const popup = { location: {}, closed: false, close: vi.fn() };
  let handler;
  vi.stubGlobal('window', { open: () => popup, location: { origin: 'https://app.test' }, addEventListener: (_event, fn) => { handler = fn; }, removeEventListener: vi.fn() });
  authenticatedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'expected', url: 'https://accounts.google.com/auth' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'valid-result' }) });
  const pending = reconnectGsc('sc-domain:example.test');
  await vi.waitFor(() => expect(handler).toBeTypeOf('function'));
  const good = { origin: 'https://app.test', source: popup, data: { state: 'expected', type: 'GSC_AUTH_SUCCESS', code: 'code' } };
  handler({ ...good, origin: 'https://other.test' });
  handler({ ...good, source: {} });
  handler({ ...good, data: { ...good.data, state: 'wrong' } });
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  handler(good);
  await expect(pending).resolves.toEqual({ access_token: 'valid-result' });
  expect(popup.close).toHaveBeenCalled();
});
it('reports a declined connection without exchanging or clearing credentials', async () => {
  const popup = { location: {}, closed: false, close: vi.fn() };
  let handler;
  vi.stubGlobal('window', { open: () => popup, location: { origin: 'https://app.test' }, addEventListener: (_event, fn) => { handler = fn; }, removeEventListener: vi.fn() });
  authenticatedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'expected', url: 'https://accounts.google.com/auth' }) });
  const pending = reconnectGsc();
  const assertion = expect(pending).rejects.toThrow('cancelled or declined');
  await vi.waitFor(() => expect(handler).toBeTypeOf('function'));
  handler({ origin: 'https://app.test', source: popup, data: { state: 'expected', type: 'GSC_AUTH_ERROR' } });
  await assertion;
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
});
