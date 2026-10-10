import { db } from '../../lib/firebaseAdmin';
import { publicRoute } from '../../lib/server/publicRequest';
import { RequestError } from '../../lib/server/requestAuth';

export const POST = publicRoute(async request => {
  const { code } = await request.json();
  if (typeof code !== 'string' || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/i.test(code.trim())) throw new RequestError('Invalid invitation code.');
  const normalizedCode = code.trim().toUpperCase();
  const ref = db.collection('invitationCodes').doc(normalizedCode);
  const email = await db.runTransaction(async tx => {
    const record = (await tx.get(ref)).data();
    if (!record || record.used || !record.email || !record.expiresAt || new Date(record.expiresAt).getTime() <= Date.now()) throw new RequestError('This invitation code is invalid, expired, or already used.');
    const now = new Date().toISOString();
    tx.update(ref, { used: true, usedAt: now });
    tx.set(db.collection('approvedUsers').doc(record.email), { email: record.email, approvedAt: record.createdAt || now, usedAt: now, approvedBy: record.approvedBy || null }, { merge: true });
    return record.email;
  });
  return Response.json({ success: true, email, message: 'Code verified successfully' });
}, { limit: 20, windowMs: 600000 });
