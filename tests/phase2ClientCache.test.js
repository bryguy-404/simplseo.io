import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('../app/lib/firebaseConfig',()=>({auth:{currentUser:null,authStateReady:async()=>{}}}));
vi.mock('../app/lib/authenticatedFetch',()=>({authenticatedFetch:vi.fn()}));
import { auth } from '../app/lib/firebaseConfig';
import { authenticatedFetch } from '../app/lib/authenticatedFetch';
import { getCachedData,setCachedData,fetchWithCache } from '../app/lib/apiCache';
beforeEach(()=>{
  const values=new Map();
  vi.stubGlobal('window',{});
  vi.stubGlobal('localStorage',{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)});
  auth.currentUser={uid:'alice'};
  authenticatedFetch.mockReset();
});
it('isolates identical endpoint parameters across accounts and denies signed-out cache reads',()=>{
  setCachedData('/api/seo-assistant/meta-title',{}, {title:'Private Alice title'});
  expect(getCachedData('/api/seo-assistant/meta-title',{},60000).data.title).toBe('Private Alice title');
  auth.currentUser={uid:'bob'};
  expect(getCachedData('/api/seo-assistant/meta-title',{},60000)).toBeNull();
  auth.currentUser=null;
  expect(getCachedData('/api/seo-assistant/meta-title',{},60000)).toBeNull();
});
it('does not cache or return an in-flight response after an account switch',async()=>{
  authenticatedFetch.mockImplementation(async()=>{auth.currentUser={uid:'bob'};return Response.json({title:'Private Alice title'});});
  await expect(fetchWithCache('/api/seo-assistant/meta-title',{},60000)).rejects.toThrow('account changed');
  expect(getCachedData('/api/seo-assistant/meta-title',{},60000)).toBeNull();
});
