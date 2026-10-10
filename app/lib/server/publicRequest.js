import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { RequestError, errorResponse } from './requestAuth';

export function publicRoute(handler, { limit = 10, windowMs = 3600000 } = {}) {
  return async request => {
    try {
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin) throw new RequestError('Request origin is not allowed.', 403);
      const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const bucket = Math.floor(Date.now() / windowMs);
      const key = createHash('sha256').update(`${new URL(request.url).pathname}:${ip}:${bucket}`).digest('hex');
      const ref = db.collection('requestLimits').doc(key);
      await db.runTransaction(async tx => {
        const count = (await tx.get(ref)).data()?.count || 0;
        if (count >= limit) throw new RequestError('Too many requests. Please try again later.', 429);
        tx.set(ref, { count: count + 1, expiresAt: new Date((bucket + 2) * windowMs) });
      });
      if (!['GET', 'HEAD'].includes(request.method)) {
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 20000) throw new RequestError('Request is too large.', 413);
        let body;
        try { body = JSON.parse(raw); } catch { throw new RequestError('Invalid request body.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('Invalid request body.');
        request = new Request(request.url, { method: request.method, headers: request.headers, body: raw });
      }
      return await handler(request);
    } catch (error) { return errorResponse(error); }
  };
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
