import { latestEligibleCheckpointDay, nextOngoingReviewDay, ongoingCheckpointWindows, pacificDay, PROGRESS_POLICY, shiftDay } from './progressAssessment';

export const isMonitoringCycle = cycle => cycle?.mode === 'monitoring';
export const cycleStartedAt = cycle => isMonitoringCycle(cycle) ? cycle.startedAt : cycle?.confirmedAt;
export const firstCheckpointDay = cycle => isMonitoringCycle(cycle) ? 0 : 28;

// Monitoring has its own observation anchor, never a fictional publication date.
// Day zero compares the two complete periods already available at enrollment.
export function cycleCheckpointWindows(cycle, day, now = new Date()) {
  if (!isMonitoringCycle(cycle)) return ongoingCheckpointWindows(cycle?.confirmedAt, day, now);
  const anchor = cycle.observationAnchorDay;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor || '') || !Number.isFinite(Date.parse(anchor))
    || new Date(anchor).toISOString().slice(0, 10) !== anchor || !Number.isSafeInteger(day) || day < 0 || day % 28) return null;
  const endDate = shiftDay(anchor, day), completeThrough = shiftDay(pacificDay(now), -PROGRESS_POLICY.reportingDelayDays);
  return { comparisonKind: 'monitoring',
    baseline: { startDate: shiftDay(endDate, -55), endDate: shiftDay(endDate, -28) },
    post: { startDate: shiftDay(endDate, -27), endDate }, completeThrough, ready: endDate <= completeThrough };
}

export function latestCycleCheckpointDay(cycle, now = new Date()) {
  if (!isMonitoringCycle(cycle)) return latestEligibleCheckpointDay(cycle?.confirmedAt, now);
  const windows = cycleCheckpointWindows(cycle, 0, now);
  if (!windows?.ready) return -1;
  const elapsed = Math.floor((Date.parse(windows.completeThrough) - Date.parse(cycle.observationAnchorDay)) / 86400000);
  return Math.floor(elapsed / 28) * 28;
}

export function nextCycleReviewDay(cycle, completedDay = 0) {
  if (!isMonitoringCycle(cycle)) return nextOngoingReviewDay(cycle?.confirmedAt, completedDay);
  return shiftDay(cycle.observationAnchorDay, completedDay + 28 + PROGRESS_POLICY.reportingDelayDays);
}
