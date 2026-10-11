import { createHash } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';

const text = (value, max = 180) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const list = (value, max) => [...new Set((Array.isArray(value) ? value : []).map(item => text(item)).filter(Boolean))].slice(0, max);
export function accountWebsiteScope(setup = {}, user = {}, legacy = {}) {
  return { property: setup.gscProperty || user.gscSiteUrl || legacy.siteUrl || null,
    websiteUrl: setup.websiteUrl || user.websiteUrl || null, websiteRunId: setup.revampRunId || null };
}
export const sameBusinessScope = (a, b) => JSON.stringify([a?.property || null, a?.websiteUrl || null, a?.websiteRunId || null])
  === JSON.stringify([b?.property || null, b?.websiteUrl || null, b?.websiteRunId || null]);
export const businessProfileKey = scope => createHash('sha256').update(JSON.stringify([scope.property, scope.websiteUrl, scope.websiteRunId || null])).digest('hex');
export const businessProfileRef = (uid, scope) => db.collection('users').doc(uid).collection('businessProfiles').doc(businessProfileKey(scope));

export function cleanBusinessProfile(input = {}, { required = false, strict = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError('Enter your business details.');
  if (strict && ((Array.isArray(input.services) && input.services.length > 12) || (Array.isArray(input.serviceAreas) && input.serviceAreas.length > 30)
    || (Array.isArray(input.customerTypes) && input.customerTypes.length > 12))) throw new RequestError('Keep up to 12 services, 30 service areas and 12 customer types. Your saved details are unchanged.');
  const result = { businessName: text(input.businessName), businessType: text(input.businessType), services: list(input.services, 12),
    baseLocation: { city: text(input.baseLocation?.city, 120), region: text(input.baseLocation?.region, 120), country: text(input.baseLocation?.country, 120) },
    serviceAreas: list(input.serviceAreas, 30), goal: ['inquiries', 'quotes', 'bookings'].includes(input.goal) ? input.goal : '',
    cmsPlatform: text(input.cmsPlatform, 80), customerTypes: list(input.customerTypes, 12), differentiators: text(input.differentiators, 2000) };
  if (required && (!result.businessName || !result.businessType || !result.services.length || !result.baseLocation.city
    || !result.baseLocation.region || !result.baseLocation.country || !result.serviceAreas.length || !result.goal)) {
    throw new RequestError('Confirm your business name, category, services, base location, areas served and main goal.');
  }
  return result;
}
export function legacyBusinessProfile(setup = {}, user = {}) {
  return cleanBusinessProfile({ businessName: setup.businessName || user.businessName, businessType: setup.businessType === 'Other' ? setup.customBusinessType : setup.businessType,
    services: setup.services || [], baseLocation: { city: setup.businessLocation || user.businessLocation || '' },
    serviceAreas: setup.serviceCities || [], cmsPlatform: setup.cmsPlatform });
}
export function profileCompatibilityFields(profile) {
  return { businessName: profile.businessName, businessType: profile.businessType,
    businessLocation: [profile.baseLocation.city, profile.baseLocation.region, profile.baseLocation.country].filter(Boolean).join(', '),
    serviceCities: profile.serviceAreas, servesMultipleCities: profile.serviceAreas.length > 1, cmsPlatform: profile.cmsPlatform };
}
export async function readBusinessContext(uid, expectedScope) {
  const [userDoc, setupDoc, legacyDoc] = await Promise.all(['users', 'onboarding', 'gscTokens'].map(name => db.collection(name).doc(uid).get()));
  if (!userDoc.exists || userDoc.data()?.deletionInProgress) return null;
  const setup = setupDoc.data() || {}, user = userDoc.data() || {};
  const scope = accountWebsiteScope(setup, user, legacyDoc.data() || {});
  // Readers must not leak an older website's context into a newly scoped request.
  if (expectedScope && !sameBusinessScope(scope, expectedScope)) return null;
  const saved = (await businessProfileRef(uid, scope).get()).data();
  if (saved && sameBusinessScope(saved.scope, scope)) return { ...saved, status: 'confirmed' };
  return { schemaVersion: 1, revision: 0, scope, profile: legacyBusinessProfile(setup, user), status: 'legacy', confirmedAt: null,
    provenance: 'legacy_profile', limitations: ['These saved details have not been confirmed in the new business profile.'] };
}
export function profileEvidence(context) {
  if (!context || context.status !== 'confirmed') return null;
  return { revision: context.revision, confirmedAt: context.confirmedAt, provenance: 'owner_confirmation', ...context.profile };
}

// A confirmed profile can change during a long provider request. Save decisions
// against the facts actually reviewed, or ask for a fresh review without replacing work.
export async function assertBusinessProfileRevision(uid, expected, tx) {
  if (expected === undefined) return; // Pre-profile legacy requests remain readable.
  const read = ref => tx ? tx.get(ref) : ref.get();
  const [user, setup, legacy] = await Promise.all(['users', 'onboarding', 'gscTokens'].map(name => read(db.collection(name).doc(uid))));
  if (!user.exists || user.data()?.deletionInProgress) throw new RequestError('Your account changed. Reload before continuing.', 409);
  const scope = accountWebsiteScope(setup.data(), user.data(), legacy.data());
  const current = (await read(businessProfileRef(uid, scope))).data();
  if ((current?.revision || 0) !== expected) throw new RequestError('Your business details changed while this review was running. Your saved work is unchanged. Check for updates again.', 409);
}
