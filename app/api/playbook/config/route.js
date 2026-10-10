import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { getPlaybookConfig, updatePlaybookConfig } from '../../../lib/playbookConfig';
import { RequestError } from '../../../lib/server/requestAuth';

export const GET = authenticatedRoute(async () => Response.json({ success: true,
  config: { ...(await getPlaybookConfig()), enabled: false }, reason: 'automatic_promotion_disabled',
}), { admin: true });

export const POST = authenticatedRoute(async request => {
  const { userId: _userId, ...body } = await request.json();
  const allowed = ['enabled', 'minStrategiesPerBusinessType', 'minSuccessRate', 'minDaysOld', 'minBusinessesPerType', 'enabledBusinessTypes'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new RequestError('Unsupported configuration field.');
  if (body.enabled === true) throw new RequestError('Automatic promotion remains disabled while historical evidence is reviewed.', 409);
  if ('enabled' in body && body.enabled !== false) throw new RequestError('enabled must be false.');
  for (const key of ['minStrategiesPerBusinessType', 'minDaysOld', 'minBusinessesPerType']) {
    if (key in body && (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > 10000)) throw new RequestError(`Invalid ${key}.`);
  }
  if ('minSuccessRate' in body && (!Number.isFinite(body.minSuccessRate) || body.minSuccessRate < 0 || body.minSuccessRate > 1)) throw new RequestError('Invalid minSuccessRate.');
  if ('enabledBusinessTypes' in body && (!Array.isArray(body.enabledBusinessTypes) || body.enabledBusinessTypes.length > 100 || body.enabledBusinessTypes.some(value => typeof value !== 'string' || value.length > 100))) throw new RequestError('Invalid business types.');
  const result = await updatePlaybookConfig({ ...body, enabled: false });
  if (!result.success) throw new RequestError('Unable to update configuration.', 500);
  return Response.json(result);
}, { admin: true });
