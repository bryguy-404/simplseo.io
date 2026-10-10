import { auth } from '../firebaseAdmin';
import { requireUser, RequestError, errorResponse } from './requestAuth';
import { consumeAiQuota } from './requestQuota';

// Authenticate before parsing untrusted input or running provider/database work.
// Legacy handlers receive the verified identity in the same place their callers
// previously supplied it. A supplied different identity is rejected, never used.
export function authenticatedRoute(handler, { admin = false, quota } = {}) {
  return async function authenticatedHandler(request, context) {
    try {
      const url = new URL(request.url);
      const uid = await requireUser(request, url.searchParams.get('userId'));
      if (admin) {
        const user = await auth.getUser(uid);
        const configured = (process.env.ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean);
        if (user.customClaims?.admin !== true && !configured.includes(uid)) throw new RequestError('Administrator access required.', 403);
      }
      const headers = new Headers(request.headers);
      let body;
      if (!['GET', 'HEAD'].includes(request.method)) {
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 500000) throw new RequestError('Request is too large.', 413);
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw new RequestError('Invalid request body.'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError('Invalid request body.');
        for (const supplied of [parsed.userId, parsed.userData?.userId]) {
          if (supplied && supplied !== uid) throw new RequestError('Forbidden', 403);
        }
        body = JSON.stringify({ ...parsed, userId: uid, ...(parsed.userData ? { userData: { ...parsed.userData, userId: uid } } : {}) });
        headers.set('Content-Type', 'application/json');
        headers.delete('content-length');
      }
      url.searchParams.set('userId', uid);
      if (quota === 'ai') await consumeAiQuota(uid);
      return await handler(new Request(url, { method: request.method, headers, body, signal: request.signal }), context);
    } catch (error) { return errorResponse(error); }
  };
}
