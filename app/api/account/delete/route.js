import { requireUser, errorResponse } from '../../../lib/server/requestAuth';
import { db, auth } from '../../../lib/firebaseAdmin';
import { deleteAccountFirestore, deleteAccountBigQuery } from '../../../lib/server/accountDeletion';

export async function POST(request) {
  try {
    const body = await request.json();
    const uid = await requireUser(request, body.userId);
    // Keep the existing reauthenticated client/Auth deletion flow: only return
    // success after every account-data deletion succeeds. Never retain a copy of
    // the deleted profile, tokens, or email in an analytics/notification record.
    const user = await auth.getUser(uid);
    if (process.env.BIGQUERY_ENABLED === 'true') {
      const { getBigQueryClient } = await import('../../../lib/bigqueryClient');
      await deleteAccountBigQuery(await getBigQueryClient(), uid, {
        projectId: process.env.BIGQUERY_PROJECT_ID,
        dataset: process.env.BIGQUERY_DATASET,
        table: process.env.BIGQUERY_TABLE,
      });
    }
    const result = await deleteAccountFirestore(db, uid, user.email);
    return Response.json({ success: true, deletedCount: result.deletedRoots, message: 'Account data deleted.' });
  } catch (error) {
    // Provider errors may contain request details; return only the standard safe error.
    return errorResponse(error);
  }
}
