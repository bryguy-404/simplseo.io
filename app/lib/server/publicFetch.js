import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { RequestError } from './requestAuth';

const blockedV4 = new BlockList();
for (const [network, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blockedV4.addSubnet(network,prefix,'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
const blockedV6 = new BlockList();
for (const [network,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blockedV6.addSubnet(network,prefix,'ipv6');
export function isPublicAddress(address) {
  return isIP(address) === 4 ? !blockedV4.check(address,'ipv4') : isIP(address) === 6 && globalV6.check(address,'ipv6') && !blockedV6.check(address,'ipv6');
}
export async function resolvePublicUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new RequestError('Enter a valid website URL.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new RequestError('Only public HTTP or HTTPS websites can be scanned.');
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  let timer;
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
    lookup(hostname,{all:true}),
    new Promise((_,reject) => { timer = setTimeout(() => reject(new RequestError('The website could not be resolved.',504)),10000); }),
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(({address}) => !isPublicAddress(address))) throw new RequestError('Only public websites can be scanned.');
  return { url, address: addresses[0] };
}

// Resolve and pin the validated address for every request, including redirects.
// This prevents a second DNS answer from redirecting the connection internally.
export async function publicFetch(rawUrl, options = {}) {
  let currentUrl = rawUrl;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const { url, address } = await resolvePublicUrl(currentUrl);
    const response = await new Promise((resolve,reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const headers = { 'User-Agent': 'SimpleSEO/1.0', Accept: 'text/html,application/xml,text/xml', 'Accept-Encoding': 'identity' };
      // No credentials or caller-controlled headers are sent to scanned sites.
      const req = transport.request(url, {
        method: options.method === 'HEAD' ? 'HEAD' : 'GET', headers,
        lookup: (_hostname, lookupOptions, callback) => lookupOptions.all ? callback(null,[address]) : callback(null,address.address,address.family),
      }, res => {
        const chunks = []; let size = 0;
        res.on('data',chunk => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { req.destroy(new RequestError('This page is too large to scan.')); return; }
          chunks.push(chunk);
        });
        res.on('error',reject);
        res.on('end',() => {
          const responseHeaders = new Headers();
          for (const [name,value] of Object.entries(res.headers)) if (value !== undefined) responseHeaders.set(name,Array.isArray(value) ? value.join(', ') : value);
          const status = res.statusCode || 502;
          if (status < 200 || status > 599) { reject(new RequestError('The website returned an invalid response.',502)); return; }
          const result = new Response(options.method === 'HEAD' || [204,205,304].includes(status) ? null : Buffer.concat(chunks), {status,headers:responseHeaders});
          Object.defineProperty(result,'url',{value:url.href}); resolve(result);
        });
      });
      const deadline = setTimeout(() => req.destroy(new RequestError('The website took too long to respond.',504)),15000);
      req.on('close',() => clearTimeout(deadline));
      req.on('error',reject); req.end();
    });
    if (![301,302,303,307,308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    currentUrl = new URL(location,url).href;
  }
  throw new RequestError('The website redirects too many times.');
}
