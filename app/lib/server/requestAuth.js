import { auth, db } from '../firebaseAdmin';

export class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export async function requireUser(request, suppliedUserId) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new RequestError('Sign in to continue.', 401);
  let decoded;
  try { decoded = await auth.verifyIdToken(token, true); }
  catch { throw new RequestError('Please sign in again.', 401); }
  if (suppliedUserId && suppliedUserId !== decoded.uid) throw new RequestError('Forbidden', 403);
  if (process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST === 'true') {
    const account = await auth.getUser(decoded.uid);
    const adminUids = (process.env.ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (account.customClaims?.admin !== true && !adminUids.includes(decoded.uid)) {
      if (!account.emailVerified || !account.email) throw new RequestError('Verify your email before continuing.', 403);
      const approved = await db.collection('approvedUsers').doc(account.email.trim().toLowerCase()).get();
      if (!approved.exists) throw new RequestError('Your account is awaiting access approval.', 403);
    }
  }
  return decoded.uid;
}
export function requireCron(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new RequestError('Unauthorized', 401);
  }
}
export function errorResponse(error) {
  const status = error.status || 500;
  return Response.json({ error: status === 500 ? 'Unable to save or load data. Please try again.' : error.message }, { status });
}
