import { auth } from '../firebaseAdmin';

export class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export async function requireIdentity(request, suppliedUserId) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new RequestError('Sign in to continue.', 401);
  let decoded;
  try { decoded = await auth.verifyIdToken(token, true); }
  catch { throw new RequestError('Please sign in again.', 401); }
  if (suppliedUserId && suppliedUserId !== decoded.uid) throw new RequestError('Forbidden', 403);
  return decoded.uid;
}
export async function requireUser(request, suppliedUserId) {
  const uid = await requireIdentity(request, suppliedUserId);
  if (process.env.EARLY_ACCESS_ENABLED === 'true' || process.env.NEXT_PUBLIC_ENABLE_ACCESS_REQUEST === 'true') {
    const { readEarlyAccess } = await import('./earlyAccessPolicy');
    const access = await readEarlyAccess(uid);
    if (!access.approved) throw new RequestError(access.reason === 'verify_email' ? 'Verify your email before continuing.' : 'Accept your invitation or request early access to continue.', 403);
  }
  return uid;
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
