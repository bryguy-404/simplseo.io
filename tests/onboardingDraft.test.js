import { describe, expect, it } from 'vitest';
import { editableOnboardingDraft } from '../app/lib/onboardingDraft';

describe('browser-only onboarding draft boundary', () => {
  it('restores business facts without trusting browser completion, website, connection or consent', () => {
    const result = editableOnboardingDraft({ businessName: 'Owner business', businessLocation: 'Riverton', services: ['Heat, cooling'], serviceCities: ['Lakeside'],
      baseLocation: { city: 'Riverton', region: 'WY', country: 'US', gscProperty: 'evil' }, goal: 'quotes',
      isComplete: true, websiteUrl: 'https://other.test', gscProperty: 'sc-domain:other.test', google: { token: 'secret' }, privacyPolicyAccepted: true, revampRunId: 'fake' });
    expect(result).toMatchObject({ businessName: 'Owner business', businessLocation: 'Riverton', services: ['Heat, cooling'], serviceCities: ['Lakeside'], goal: 'quotes', baseLocation: { city: 'Riverton', region: 'WY', country: 'US' } });
    expect(JSON.stringify(result)).not.toMatch(/isComplete|websiteUrl|gscProperty|google|privacyPolicyAccepted|revampRunId|evil|secret/);
  });
  it('rejects malformed local values and does not import an arbitrary goal', () => {
    expect(editableOnboardingDraft(null)).toEqual({});
    expect(editableOnboardingDraft(['not an object'])).toEqual({});
    const result = editableOnboardingDraft({ businessName: { html: 'bad' }, services: ['Owner service', { invalid: true }], baseLocation: { city: ['bad'] }, goal: 'automatic publication' });
    expect(result.businessName).toBe(''); expect(result.services).toEqual(['Owner service']); expect(result.baseLocation.city).toBe(''); expect(result.goal).toBe('');
  });
});
