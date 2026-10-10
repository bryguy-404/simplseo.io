import { beforeEach, describe, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: {
    verifyIdToken: vi.fn(async token => { if (!['alice', 'bob', 'admin'].includes(token)) throw Error('invalid'); return { uid: token }; }),
    getUser: vi.fn(async uid => ({ uid, customClaims: { admin: uid === 'admin' }, email: `${uid}@example.test` })),
  } };
});
vi.mock('openai', () => ({ default: class { constructor() { this.chat = { completions: { create: vi.fn(() => { throw Error('Unexpected paid request'); }) } }; } } }));
import { db, records, reset, auth } from '../app/lib/firebaseAdmin';
import { authenticatedRoute } from '../app/lib/server/authenticatedRoute';
import { getCachedMetaTitle, saveMetaTitle } from '../app/lib/firestoreMigrationHelpers';
import { GET as conversation, PUT as updateConversation, DELETE as deleteConversation } from '../app/api/conversations/[id]/route';
import { GET as approval } from '../app/api/check-approval/route';
import { POST as verifyCode } from '../app/api/verify-code/route';
import { GET as adminRequests } from '../app/api/admin/approve/route';
import { GET as legacyExchange } from '../app/api/auth/google/route';
import { GET as legacyCallback } from '../app/api/auth/google/callback/route';
import { POST as cache } from '../app/api/page-content/cache/route';
const loaders = import.meta.glob('../app/api/**/route.js');
const request = (path, method = 'POST', body = {}, uid = 'alice') => new Request(`http://localhost/api/${path}`, {
  method, headers: { ...(uid ? { Authorization: `Bearer ${uid}` } : {}), 'Content-Type': 'application/json' },
  ...(!['GET','HEAD'].includes(method) ? { body: JSON.stringify(body) } : {}),
});
beforeEach(() => { reset(); delete process.env.ADMIN_UIDS; delete process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST; });
const guarded = ['generic-keywords/analyze','generic-keywords/content-outline','generic-keywords/keyword-analysis','page-content/get-h1','seo-assistant/content-improvements','seo-assistant/internal-link','seo-assistant/content-gaps','seo-assistant/meta-description','seo-assistant/anchor-text','seo-assistant/meta-title','seo-assistant/chat','seo-assistant/suggest-keywords','content-opportunities/skip','content-opportunities/mark-created','recrawl-page','reset-page-implementation','content-keywords/edit','intent-analysis','content-audit','sitemap','long-tail-keywords/analyze','training/log-event','conversations','chatbot/chat','extract-keywords','filter-branded-keywords','content-expansion/analyze','scrape-content','page-content/cache'];
describe('account and paid API authorization', () => {
  for (const path of guarded) {
    it(`${path} rejects anonymous and cross-account calls before doing work`, async () => {
      const route = await loaders[`../app/api/${path}/route.js`]();
      for (const method of ['GET','POST','PUT','DELETE'].filter(method => route[method])) {
        expect((await route[method](request(path, method, {}, null))).status).toBe(401);
        const crossPath = method === 'GET' ? `${path}?userId=bob` : path;
        expect((await route[method](request(crossPath, method, { userId: 'bob' }))).status).toBe(403);
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(records.size).toBe(0);
    });
  }
  it('derives user identity when omitted and rejects nested chat identity spoofing', async () => {
    const endpoint = authenticatedRoute(async req => Response.json(await req.json()));
    expect(await (await endpoint(request('example', 'POST', { message: 'hello' }))).json()).toMatchObject({ userId: 'alice' });
    expect((await endpoint(request('example', 'POST', { userData: { userId: 'bob' } }))).status).toBe(403);
  });
  it('rejects invalid, oversized and expired authentication before a handler runs', async () => {
    const handler = vi.fn(); const endpoint = authenticatedRoute(handler);
    expect((await endpoint(request('example','POST',{},'expired'))).status).toBe(401);
    expect((await endpoint(request('example','POST',{ text:'x'.repeat(500001) }))).status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });
});
describe('private conversation and cache ownership', () => {
  it('protects conversation reads, updates and deletion even when the record ID is known', async () => {
    await db.collection('conversations').doc('private-bob').set({ userId: 'bob', title: 'Private', messages: [] });
    const params = { params: Promise.resolve({ id: 'private-bob' }) };
    for (const [method, handler] of [['GET',conversation],['PUT',updateConversation],['DELETE',deleteConversation]]) {
      expect((await handler(request('conversations/private-bob',method,{action:'rename',title:'Stolen'}),params)).status).toBe(404);
    }
    expect(records.get('conversations/private-bob').title).toBe('Private');
    expect((await conversation(request('conversations/private-bob','GET',{},'bob'),params)).status).toBe(200);
  });
  it('does not return or overwrite another user legacy meta cache', async () => {
    await db.collection('seoMetaTitles').doc('same-key').set({ userId:'bob',title:'Private title' });
    expect((await getCachedMetaTitle('alice','same-key')).success).toBe(false);
    await saveMetaTitle('alice','same-key',{title:'Alice title'});
    expect(records.get('seoMetaTitles/same-key').title).toBe('Private title');
    expect((await getCachedMetaTitle('alice','same-key')).data.title).toBe('Alice title');
  });
  it('owns new cached page records, overriding identity inside payload data', async () => {
    const response = await cache(request('page-content/cache','POST',{operation:'page-write',pageUrl:'https://example.test/page',data:{userId:'bob',title:'Page'}}));
    expect(response.status).toBe(200);
    expect(records.get('pageContentCache/alice/pages/https%3A%2F%2Fexample.test%2Fpage').userId).toBe('alice');
    expect([...records.values()].some(record=>record.userId==='bob')).toBe(false);
  });
});
describe('signup and administration boundaries', () => {
  it('rejects ordinary users and missing admin configuration regardless of supplied admin secrets', async () => {
    delete process.env.ADMIN_SECRET;
    expect((await adminRequests(request('admin/approve?adminSecret=anything','GET'))).status).toBe(403);
    expect((await adminRequests(request('admin/approve','GET',{},null))).status).toBe(401);
    expect((await adminRequests(request('admin/approve','GET',{},'admin'))).status).toBe(200);
    process.env.ADMIN_UIDS='alice';
    expect((await adminRequests(request('admin/approve','GET'))).status).toBe(200);
  });
  it('never discloses invitation codes through the public approval lookup and limits repeated requests', async () => {
    await db.collection('approvedUsers').doc('alice@example.test').set({invitationCode:'ABCD-EFGH',approvedAt:'private-time'});
    const read = () => approval(request('check-approval?email=alice%40example.test','GET',{},null));
    expect(await (await read()).json()).toEqual({approved:true,email:'alice@example.test'});
    for(let i=1;i<60;i++) expect((await read()).status).toBe(200);
    expect((await read()).status).toBe(429);
  });
  it('consumes an invitation once without logging or returning its code', async () => {
    await db.collection('invitationCodes').doc('ABCD-EFGH').set({ email:'alice@example.test', expiresAt:new Date(Date.now()+60000).toISOString(), used:false });
    expect((await verifyCode(request('verify-code','POST',{code:'ABCD-EFGH'},null))).status).toBe(200);
    expect((await verifyCode(request('verify-code','POST',{code:'ABCD-EFGH'},null))).status).toBe(400);
    expect(records.get('invitationCodes/ABCD-EFGH').used).toBe(true);
  });
  it('retires the anonymous Google exchange and forwards only code/state on legacy callbacks', async () => {
    expect((await legacyExchange()).status).toBe(410);
    const response=await legacyCallback(request('auth/google/callback?code=short-lived&state=state&access_token=secret','GET',{},null));
    const destination = new URL(response.headers.get('location'));
    expect(destination.pathname).toBe('/gsc-callback');
    expect(destination.searchParams.get('code')).toBe('short-lived');
    expect(destination.searchParams.has('access_token')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('applies shared per-user AI quota before a provider is called, without limiting other users', async () => {
  const handler=vi.fn(async()=>Response.json({ok:true}));
  const endpoint=authenticatedRoute(handler,{quota:'ai'});
  for(let i=0;i<30;i++) expect((await endpoint(request('test-ai'))).status).toBe(200);
  expect((await endpoint(request('another-ai-route'))).status).toBe(429);
  expect((await endpoint(request('test-ai','POST',{},'bob'))).status).toBe(200);
  expect(handler).toHaveBeenCalledTimes(31);
});

it('enforces enabled signup approval against verified Firebase email, never request email', async () => {
  process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST='true';
  try {
    const endpoint=authenticatedRoute(async()=>Response.json({ok:true}));
    await db.collection('approvedUsers').doc('victim@example.test').set({approved:true});
    auth.getUser.mockResolvedValue({uid:'alice',email:'alice@example.test',emailVerified:true});
    expect((await endpoint(request('example','POST',{email:'victim@example.test'}))).status).toBe(403);
    await db.collection('approvedUsers').doc('alice@example.test').set({approved:true});
    expect((await endpoint(request('example'))).status).toBe(200);
    auth.getUser.mockResolvedValue({uid:'alice',email:'alice@example.test',emailVerified:false});
    expect((await endpoint(request('example'))).status).toBe(403);
    process.env.ADMIN_UIDS='alice';
    expect((await endpoint(request('example'))).status).toBe(200);
  } finally { delete process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST; delete process.env.ADMIN_UIDS; }
});
