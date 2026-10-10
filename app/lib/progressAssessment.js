// Dated observations, not a claim that a website change caused a ranking result.
export const PROGRESS_SCHEMA_VERSION = 1;
export const PROGRESS_SOURCE = 'google_search_console';
export const PROGRESS_POLICY = Object.freeze({ windowDays: 28, reportingDelayDays: 3, minImpressionsPerWindow: 100, minCombinedClicks: 10 });
export const cycleTimestamp = value => value?.toDate ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : value || null;

// Elapsed time alone never unlocks a new cycle. A server observation must have
// assessed this exact page/cycle/property and its complete comparison windows.
export function progressCycleIsReviewable(record, property, websiteRunId, now = new Date()) {
  const assessment = record?.progressAssessment;
  const windows = comparisonWindows(record?.implementedAt, now);
  if (!record || record.status !== 'implemented' || record.preRevampArchived || !windows?.ready || !property
    || (record.websiteRunId || null) !== (websiteRunId || null) || (record.gscProperty && record.gscProperty !== property)
    || !assessment || assessment.schemaVersion !== PROGRESS_SCHEMA_VERSION || assessment.source !== PROGRESS_SOURCE
    || assessment.pageUrl !== record.pageUrl || assessment.implementedAt !== cycleTimestamp(record.implementedAt)
    || assessment.property !== property || (assessment.websiteRunId || null) !== (websiteRunId || null)
    || !['ready', 'insufficient_data'].includes(assessment.state) || !Number.isFinite(Date.parse(assessment.attemptedAt))) return false;
  if (assessment.state === 'insufficient_data' && !['not_enough_search_activity', 'baseline_outside_available_history'].includes(assessment.reason)) return false;
  return ['baseline', 'post'].every(key => assessment.windows?.[key]?.startDate === windows[key].startDate && assessment.windows?.[key]?.endDate === windows[key].endDate)
    && assessment.windows?.ready === true;
}

export function shiftDay(day, count) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function pacificDay(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function comparisonWindows(implementedAt, now = new Date()) {
  // Legacy date-only entries are already calendar dates. Timestamp entries use PT,
  // the timezone of Search Analytics. Exclude the implementation day itself.
  let day;
  if (typeof implementedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(implementedAt)) {
    const parsed = new Date(`${implementedAt}T12:00:00Z`);
    day = Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === implementedAt ? implementedAt : null;
  } else day = implementedAt ? pacificDay(implementedAt) : null;
  if (!day) return null;
  const completeThrough = shiftDay(pacificDay(now), -PROGRESS_POLICY.reportingDelayDays);
  return {
    implementationDay: day,
    baseline: { startDate: shiftDay(day, -28), endDate: shiftDay(day, -1) },
    post: { startDate: shiftDay(day, 1), endDate: shiftDay(day, 28) },
    completeThrough,
    ready: shiftDay(day, 28) <= completeThrough,
  };
}
export function recentObservationWindow(now = new Date()) {
  const endDate = shiftDay(pacificDay(now), -3);
  return { startDate: shiftDay(endDate, -27), endDate };
}
export function progressIsPaused(onboarding) {
  return !onboarding || onboarding.progressReviewRequired === true || onboarding.revampStatus === 'in-progress';
}
export function compareObservations(baseline, post) {
  return {
    clicksDelta: post.clicks - baseline.clicks,
    clicksPercent: baseline.clicks > 0 ? (post.clicks - baseline.clicks) / baseline.clicks * 100 : null,
    impressionsDelta: post.impressions - baseline.impressions,
    impressionsPercent: baseline.impressions > 0 ? (post.impressions - baseline.impressions) / baseline.impressions * 100 : null,
    ctrPercentagePoints: baseline.ctr == null || post.ctr == null ? null : (post.ctr - baseline.ctr) * 100,
    positionDelta: baseline.position == null || post.position == null ? null : baseline.position - post.position,
  };
}
export function assessObservations(baseline, post) {
  // Product heuristics for displaying a comparison, not statistical significance.
  // No automatic success/pivot/audit verdict.
  const enough = baseline.impressions >= PROGRESS_POLICY.minImpressionsPerWindow
    && post.impressions >= PROGRESS_POLICY.minImpressionsPerWindow
    && baseline.clicks + post.clicks >= PROGRESS_POLICY.minCombinedClicks;
  return {
    state: enough ? 'ready' : 'insufficient_data',
    reason: enough ? 'comparison_available' : 'not_enough_search_activity',
    comparison: enough ? compareObservations(baseline, post) : null,
  };
}
