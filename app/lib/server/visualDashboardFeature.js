// Rollback affects presentation only. No saved work is migrated or rewritten.
export function visualDashboardEnabled(uid) {
  if (process.env.VISUAL_DASHBOARD_ENABLED !== 'true' || !uid) return false;
  const allowed = (process.env.VISUAL_DASHBOARD_PILOT_UIDS || '').split(',').map(value => value.trim());
  return allowed.includes('*') || allowed.includes(uid);
}
