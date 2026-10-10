import { beforeEach, it, expect, vi } from 'vitest';
const transportState = vi.hoisted(() => ({ responses: [] }));
vi.mock('../app/lib/firebaseAdmin', () => ({ auth: {}, db: {} }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: { request: vi.fn((url, options, callback) => {
    const request = new EventEmitter();
    request.destroyed = false;
    request.destroy = error => { request.destroyed = true; request.emit('error',error); request.emit('close'); };
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      const fixture = transportState.responses.shift() || { statusCode:200,headers:{},body:'ok' };
      Object.assign(response,{statusCode:fixture.statusCode,headers:fixture.headers});
      callback(response);
      response.emit('data',Buffer.from(fixture.body || ''));
      if (!request.destroyed) { response.emit('end'); request.emit('close'); }
    });
    return request;
  }) } };
});
vi.mock('node:https', async () => ({ default: (await import('node:http')).default }));
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import { isPublicAddress, publicFetch } from '../app/lib/server/publicFetch';
beforeEach(() => { transportState.responses=[]; lookup.mockReset().mockResolvedValue([{address:'93.184.216.34',family:4}]); http.request.mockClear(); });
it('rejects private, loopback, link-local, multicast and IPv4-mapped IPv6 targets', async () => {
  for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.20.1.1','192.168.1.1','100.64.1.1','0.0.0.0','224.0.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1']) expect(isPublicAddress(address),address).toBe(false);
  for (const url of ['http://127.0.0.1/','http://2130706433/','http://[::ffff:127.0.0.1]/','file:///etc/passwd','http://user:pass@example.test','http://example.test:8080']) await expect(publicFetch(url)).rejects.toMatchObject({status:400});
  expect(http.request).not.toHaveBeenCalled();
});
it('rejects hostnames resolving to an internal address even if another answer is public', async () => {
  lookup.mockResolvedValue([{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]);
  await expect(publicFetch('https://website.test')).rejects.toMatchObject({status:400});
  expect(http.request).not.toHaveBeenCalled();
});
it('pins the validated DNS address at connection time and strips supplied credentials', async () => {
  const response = await publicFetch('https://website.test/path',{headers:{Authorization:'Bearer must-not-leak'}});
  expect(await response.text()).toBe('ok');
  expect(response.url).toBe('https://website.test/path');
  const options = http.request.mock.calls[0][1]; const callback=vi.fn();
  options.lookup('website.test',{all:true},callback);
  expect(callback).toHaveBeenCalledWith(null,[{address:'93.184.216.34',family:4}]);
  expect(options.headers.Authorization).toBeUndefined();
  expect(lookup).toHaveBeenCalledTimes(1);
});
it('revalidates redirect destinations before connecting and bounds response size', async () => {
  transportState.responses.push({statusCode:302,headers:{location:'http://169.254.169.254/latest'},body:''});
  await expect(publicFetch('https://website.test')).rejects.toMatchObject({status:400});
  expect(http.request).toHaveBeenCalledTimes(1);
  transportState.responses.push({statusCode:200,headers:{},body:'x'.repeat(2*1024*1024+1)});
  await expect(publicFetch('https://website.test')).rejects.toMatchObject({status:400});
});
