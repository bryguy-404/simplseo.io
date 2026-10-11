import { requireUser, RequestError, errorResponse } from '../../../lib/server/requestAuth';
import { readOnboardingWorkspace, beginOnboarding, saveOnboardingDraft, confirmOnboardingProfile, completeOnboarding, checkOnboardingReadiness } from '../../../lib/server/onboardingWorkspace';
export const runtime = 'nodejs';
export const maxDuration = 180;
const response = value => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
export async function GET(request) {
  try { return response(await readOnboardingWorkspace(await requireUser(request))); } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    const uid = await requireUser(request), input = await request.json();
    if (JSON.stringify(input).length > 32000) throw new RequestError('These business details are too long.');
    const actions = { begin: beginOnboarding, save: saveOnboardingDraft, confirmProfile: confirmOnboardingProfile, complete: completeOnboarding, readiness: checkOnboardingReadiness };
    if (actions[input.action]) return response(await actions[input.action](uid, input));
    if (input.action === 'review') {
      const { continueOnboardingInventory } = await import('../../../lib/server/onboardingInventory');
      await continueOnboardingInventory(uid, { ...input, signal: request.signal });
      return response(await readOnboardingWorkspace(uid));
    }
    if (input.action === 'extract') {
      const { extractOnboardingBusiness } = await import('../../../lib/server/onboardingExtraction');
      await extractOnboardingBusiness(uid, { ...input, signal: request.signal });
      return response(await readOnboardingWorkspace(uid));
    }
    throw new RequestError('Choose a supported setup action.');
  } catch (error) { return errorResponse(error); }
}
