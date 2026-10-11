import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', () => ({ db: { collection: vi.fn() }, auth: { verifyIdToken: vi.fn() } }));
vi.mock('../app/lib/server/newPagePlanning', () => ({ readNewPageWorkspace: vi.fn(), readNewPagePlan: vi.fn(), saveNewPageContext: vi.fn(), assessNewPageIdeas: vi.fn(), suggestNearbyAreas: vi.fn(), selectNewPageIdea: vi.fn(), generateNewPageDraft: vi.fn(), editNewPagePlan: vi.fn() }));
vi.mock('../app/lib/server/newPageInventory', () => ({ continueNewPageInventory: vi.fn() }));
vi.mock('../app/lib/server/newPageTracking', () => ({ confirmNewPagePublication: vi.fn(), refreshNewPageTracking: vi.fn(), readNewPageTracking: vi.fn() }));
import { auth } from '../app/lib/firebaseAdmin';
import * as planning from '../app/lib/server/newPagePlanning';
import * as tracking from '../app/lib/server/newPageTracking';
import { RequestError } from '../app/lib/server/requestAuth';
import { GET } from '../app/api/new-page-plans/route';
import { POST as analyze } from '../app/api/new-page-plans/analyze/route';
import { POST as publish } from '../app/api/new-page-plans/publish/route';
import { POST as oldGenerate } from '../app/api/generic-keywords/analyze/route';
import { POST as oldOutline } from '../app/api/generic-keywords/content-outline/route';
import { POST as oldKeyword } from '../app/api/generic-keywords/keyword-analysis/route';
import { POST as oldPublish } from '../app/api/content-opportunities/mark-created/route';
import { POST as oldSkip } from '../app/api/content-opportunities/skip/route';
const request = (method = 'GET', body, token = 'valid', query = '') => new Request(`http://localhost/api/new-page-plans${query}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => { vi.clearAllMocks(); auth.verifyIdToken.mockResolvedValue({ uid: 'alice' }); planning.readNewPageWorkspace.mockResolvedValue({ plans: [] }); planning.assessNewPageIdeas.mockResolvedValue({ assessment: { outcome: 'no_opportunity' } }); });
it('anonymous requests cannot read or generate and receive private no-store', async () => {
  for (const [handler, req] of [[GET, request('GET', undefined, null)], [analyze, request('POST', {}, null)]]) {
    const response = await handler(req); expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  }
  expect(planning.readNewPageWorkspace).not.toHaveBeenCalled(); expect(planning.assessNewPageIdeas).not.toHaveBeenCalled();
});
it('rejects client-selected owners before service work', async () => {
  expect((await GET(request('GET', undefined, 'valid', '?userId=bob'))).status).toBe(403);
  expect((await analyze(request('POST', { userId: 'bob' }))).status).toBe(403);
  expect((await analyze(request('POST', { userData: { userId: 'bob' } }))).status).toBe(403);
  expect(planning.assessNewPageIdeas).not.toHaveBeenCalled();
});
it('passes only verified identity while saved reads do not invoke analysis', async () => {
  const response = await GET(request()); expect(response.status).toBe(200);
  expect(planning.readNewPageWorkspace).toHaveBeenCalledWith('alice'); expect(planning.assessNewPageIdeas).not.toHaveBeenCalled();
  expect(auth.verifyIdToken).toHaveBeenCalledWith('valid', true);
});
it('keeps a controlled redirect destination in confirmation errors', async () => {
  const error = new RequestError('Confirm destination', 409); error.code = 'confirm_redirect'; error.destination = 'https://business.example.org/service';
  tracking.confirmNewPagePublication.mockRejectedValue(error);
  const response = await publish(request('POST', { planId: 'p', confirmed: true }));
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Confirm destination', code: 'confirm_redirect', destination: error.destination });
});
it('sanitizes internal/provider error payloads', async () => {
  planning.assessNewPageIdeas.mockRejectedValue(new Error('secret API key and customer source'));
  const response = await analyze(request('POST', {})); expect(response.status).toBe(500); expect(await response.text()).not.toMatch(/secret|API key/);
});
it.each([oldGenerate, oldOutline, oldKeyword, oldPublish, oldSkip])('retires legacy writes without generating or changing data', async handler => {
  expect((await handler(request('POST', {}))).status).toBe(410);
  expect((await handler(request('POST', {}, null))).status).toBe(401);
  expect(planning.assessNewPageIdeas).not.toHaveBeenCalled();
});
