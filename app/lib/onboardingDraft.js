// Local drafts are suggestions to restore into editable fields, never account authority.
const text = value => typeof value === 'string' ? value.slice(0, 2000) : '';
const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').map(text).slice(0, 30) : [];
export function editableOnboardingDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return {
    name: text(value.name), businessName: text(value.businessName), businessType: text(value.businessType), customBusinessType: text(value.customBusinessType),
    businessLocation: text(value.businessLocation), baseLocation: { city: text(value.baseLocation?.city), region: text(value.baseLocation?.region), country: text(value.baseLocation?.country) },
    services: list(value.services), serviceCities: list(value.serviceCities), serviceAreas: list(value.serviceAreas),
    cmsPlatform: text(value.cmsPlatform), goal: ['inquiries', 'quotes', 'bookings'].includes(value.goal) ? value.goal : '',
  };
}
