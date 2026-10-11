import { requireUser, errorResponse } from '../../lib/server/requestAuth';
import { readBusinessContext } from '../../lib/server/businessProfile';
import { confirmOnboardingProfile } from '../../lib/server/onboardingWorkspace';
export async function GET(request) {
  try { return Response.json({ profile: await readBusinessContext(await requireUser(request)) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request) {
  try { const uid = await requireUser(request); return Response.json(await confirmOnboardingProfile(uid, await request.json())); }
  catch (error) { return errorResponse(error); }
}
