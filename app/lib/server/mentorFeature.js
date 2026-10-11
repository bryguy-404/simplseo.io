// Server-owned rollout switches. Never expose the pilot allowlist to a browser.
export function mentorEnabled(uid) {
  if (process.env.MENTOR_ENABLED !== 'true' || !uid) return false;
  const allowed = (process.env.MENTOR_PILOT_UIDS || '').split(',').map(value => value.trim()).filter(Boolean);
  return allowed.includes('*') || allowed.includes(uid);
}
export function mentorFeatures(uid) {
  const enabled = mentorEnabled(uid);
  return { enabled, generationEnabled: enabled && process.env.MENTOR_GENERATION_ENABLED === 'true',
    researchEnabled: enabled && process.env.MENTOR_RESEARCH_ENABLED === 'true' };
}
