import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseAdmin', async () => {
  const { fakeFirestore } = await import('./fakeFirestore');
  return { ...fakeFirestore(), auth: { verifyIdToken: async () => ({ uid: 'alice' }) }, admin: { firestore: { FieldValue: { serverTimestamp: () => 'timestamp', delete: () => null } } } };
});
import { db, records, reset } from '../app/lib/firebaseAdmin';
import { POST } from '../app/api/revamp/crawl/route';
const request = () => new Request('http://localhost/api/revamp/crawl', { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'alice' }) });
beforeEach(async () => {
  reset();
  await db.collection('onboarding').doc('alice').set({ websiteUrl: 'https://example.test', isComplete: true });
  await db.collection('siteCrawls').doc('alice').set({ approvedUrls: ['https://example.test/old'], excludedUrls: ['https://example.test/excluded'], manualUrls: ['https://example.test/manual'] });
  records.set('pageContentCache/alice_old', { userId: 'alice', content: 'Keep old content' });
  records.set('pageContentCache/alice/pages/old', { userId: 'alice', content: 'Keep nested content' });
});
it('a failed scan preserves both cache formats and saved preferences', async () => {
  fetch.mockRejectedValue(new Error('Website unavailable'));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(records.get('pageContentCache/alice_old').content).toBe('Keep old content');
  expect(records.get('pageContentCache/alice/pages/old').content).toBe('Keep nested content');
  expect(records.get('siteCrawls/alice').approvedUrls).toEqual(['https://example.test/old']);
  expect(records.get('siteCrawls/alice').excludedUrls).toEqual(['https://example.test/excluded']);
});
it('a bounded successful scan stages review rather than retiring absent pages', async () => {
  fetch.mockImplementation(async url => {
    if (String(url).includes('/api/scrape-content')) return Response.json({ data: { title: 'Current page' } });
    if (String(url).includes('.xml')) return new Response('', { status: 404 });
    return new Response('<html><head><title>Home</title></head><body><a href="/new">New page</a></body></html>');
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(records.get('siteCrawls/alice').status).toBe('awaiting-review');
  expect(records.get('pageContentCache/alice_old').content).toBe('Keep old content');
  expect(records.get('siteCrawls/alice').excludedUrls).toEqual(['https://example.test/excluded']);
});
