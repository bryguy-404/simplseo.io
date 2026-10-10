const { test, expect } = require('@playwright/test');
const signIn = async (request, email) => {
  const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email,password:'Test-only-pass123!',returnSecureToken:true}});
  expect(response.ok()).toBeTruthy(); return (await response.json()).idToken;
};
test('remaining paid and account APIs enforce real Firebase identity before provider work', async ({request}) => {
  const token = await signIn(request,'recovery-alice@example.test');
  for (const path of ['seo-assistant/meta-title','seo-assistant/meta-description','chatbot/chat','seo-assistant/chat','training/log-event','content-opportunities/skip','content-keywords/edit','conversations','scrape-content','page-content/cache']) {
    expect((await request.post(`/api/${path}`,{data:{userId:'other-bob'}})).status(),path).toBe(401);
    expect((await request.post(`/api/${path}`,{headers:{Authorization:`Bearer ${token}`},data:{userId:'other-bob'}})).status(),path).toBe(403);
  }
  const forbiddenAdmin = await request.get('/api/admin/approve?adminSecret=anything',{headers:{Authorization:`Bearer ${token}`}});
  expect(forbiddenAdmin.status()).toBe(403);
});
test('conversation IDs do not grant another account read, write or delete access', async ({request}) => {
  const alice = await signIn(request,'recovery-alice@example.test');
  const bob = await signIn(request,'other-bob@example.test');
  const documentUrl='http://127.0.0.1:8080/v1/projects/demo-simpleseo/databases/(default)/documents/conversations/phase2-bob-conversation';
  const seeded=await request.patch(documentUrl,{headers:{Authorization:'Bearer owner'},data:{fields:{userId:{stringValue:'other-bob'},title:{stringValue:'Bob private conversation'},messages:{arrayValue:{values:[]}},createdAt:{stringValue:new Date().toISOString()},updatedAt:{stringValue:new Date().toISOString()}}}});
  expect(seeded.ok()).toBeTruthy();
  const path='/api/conversations/phase2-bob-conversation';
  const headers={Authorization:`Bearer ${alice}`};
  expect((await request.get(path,{headers})).status()).toBe(404);
  expect((await request.put(path,{headers,data:{action:'rename',title:'Not allowed'}})).status()).toBe(404);
  expect((await request.delete(path,{headers,data:{}})).status()).toBe(404);
  const owned=await request.get(path,{headers:{Authorization:`Bearer ${bob}`}});
  expect(owned.status()).toBe(200);
  expect((await owned.json()).conversation.title).toBe('Bob private conversation');
  await request.delete(documentUrl,{headers:{Authorization:'Bearer owner'}});
});
